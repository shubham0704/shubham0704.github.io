const COLORS = {
  truth: "#11191d",
  phast_unknown_qonly: "#167251",
  hnn_observer_qonly: "#bd4d4d",
  phnn_observer_qonly: "#326fa6",
  s5: "#b7791f",
  linoss: "#00838f",
  dlinoss: "#7252a3",
  vpt: "#4f5862",
};

const SCALING_COLORS = {
  phast_partial_bounded: "#176f50",
  phast_no_damping: "#b94b4b",
  phast_unknown: "#00838f",
  phnn_observer: "#326fa6",
  s5: "#b7781f",
  transformer: "#4f5862",
};

const CONTRACTS = {
  phast_unknown_qonly: "q-history; coordinate chart; learned V/M/D/G",
  hnn_observer_qonly: "q-history; coordinate chart; learned Hamiltonian",
  phnn_observer_qonly: "q-history; coordinate chart; learned Hamiltonian + PSD damping",
  s5: "q-history; no supplied physical components",
  linoss: "q-history; no supplied physical components",
  dlinoss: "q-history; no supplied physical components",
  vpt: "q-history; no supplied physical components",
};

const METHOD_DESCRIPTIONS = {
  phast_unknown_qonly: "typed V/M/D channels",
  hnn_observer_qonly: "conservative Hamiltonian flow",
  phnn_observer_qonly: "Hamiltonian flow + PSD damping",
  s5: "general state-space sequence model",
  linoss: "oscillatory linear state-space model",
  dlinoss: "damped oscillatory state-space model",
  vpt: "volume-preserving transformer",
};

const DEFAULT_COMPARE_METHODS = [
  "phast_unknown_qonly",
  "hnn_observer_qonly",
  "phnn_observer_qonly",
  "s5",
];

const state = {
  data: null,
  scalingData: null,
  systemIndex: 0,
  step: 0,
  playing: true,
  timer: null,
  interval: 120,
  coordinate: 0,
  mechanism: "dissipation",
  equationTerm: "R",
  scalingAxis: "data",
  visibleMethods: new Set(),
  initialVisibleMethods: null,
  initialCoordinate: null,
};

const byId = (id) => document.getElementById(id);
const currentSystem = () => state.data.systems[state.systemIndex];
const currentMethod = (id) => currentSystem().methods.find((method) => method.id === id);
const currentMechanism = () => state.data.mechanism_evidence.find((item) => item.id === state.mechanism);

function readViewState() {
  const params = new URLSearchParams(window.location.search);
  const system = params.get("system");
  const systemIndex = state.data.systems.findIndex((item) => item.scene === system);
  if (systemIndex >= 0) state.systemIndex = systemIndex;

  const mechanisms = new Set(state.data.mechanism_evidence.map((item) => item.id));
  if (mechanisms.has(params.get("mechanism"))) state.mechanism = params.get("mechanism");

  const equationTerms = new Set(["H", "J", "R", "G"]);
  if (equationTerms.has(params.get("term"))) state.equationTerm = params.get("term");

  const axes = new Set(["data", "excitation", "width", "optimization"]);
  if (axes.has(params.get("axis"))) state.scalingAxis = params.get("axis");

  const coordinate = Number(params.get("coordinate"));
  if (params.has("coordinate") && Number.isInteger(coordinate) && coordinate >= 0) {
    state.initialCoordinate = coordinate;
  }

  if (params.has("methods")) {
    const available = new Set(currentSystem().methods.map((method) => method.id));
    const requested = params.get("methods") === "none"
      ? []
      : params.get("methods").split(",").filter((id) => available.has(id));
    state.initialVisibleMethods = requested;
  }
}

function writeViewState() {
  const url = new URL(window.location.href);
  url.searchParams.set("system", currentSystem().scene);
  url.searchParams.set("mechanism", state.mechanism);
  url.searchParams.set("term", state.equationTerm);
  url.searchParams.set("axis", state.scalingAxis);
  url.searchParams.set("coordinate", String(state.coordinate));
  url.searchParams.set("methods", [...state.visibleMethods].join(",") || "none");
  window.history.replaceState(null, "", url.toString());
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function shortLabel(methodId) {
  if (methodId === "phast_unknown_qonly") return "PHAST";
  if (methodId === "hnn_observer_qonly") return "HNN";
  if (methodId === "phnn_observer_qonly") return "pHNN";
  if (methodId === "s5") return "S5";
  if (methodId === "linoss") return "LinOSS";
  if (methodId === "dlinoss") return "D-LinOSS";
  if (methodId === "vpt") return "VPT";
  return "Truth";
}

function lineDash(methodId) {
  const patterns = {
    hnn_observer_qonly: "12 6",
    phnn_observer_qonly: "4 5",
    s5: "14 5 3 5",
    linoss: "9 4",
    dlinoss: "3 4",
    vpt: "16 5",
  };
  return patterns[methodId] || "";
}

function benchmarkPurpose(system) {
  const purposes = {
    pendulum: "Tests damping that changes with angle.",
    "double-pendulum": "Tests coupled nonlinear motion with irreversible loss.",
    "cart-pole": "Tests Euclidean and periodic coordinates in one rollout.",
  };
  return purposes[system.scene];
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function formatScore(value) {
  if (value < 0.001) return value.toExponential(2);
  return value.toFixed(value < 0.1 ? 4 : 3);
}

function formatScientific(value) {
  return Number(value).toExponential(2);
}

function coordinateLabels(system) {
  if (system.scene === "pendulum") return ["angle theta"];
  if (system.scene === "double-pendulum") return ["angle theta 1", "angle theta 2"];
  return ["cart position x", "pole angle theta"];
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width * ratio));
  const height = Math.max(210, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

function drawBackground(ctx, width, height) {
  ctx.fillStyle = "#fbfcfc";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#dfe6e7";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width * 0.08, height * 0.77);
  ctx.lineTo(width * 0.92, height * 0.77);
  ctx.stroke();
}

function drawPendulum(ctx, q, width, height, color) {
  const theta = q[0];
  const ox = width * 0.5;
  const oy = height * 0.22;
  const length = Math.min(width, height) * 0.48;
  const x = ox + length * Math.sin(theta);
  const y = oy + length * Math.cos(theta);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, width * 0.008);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x, y); ctx.stroke();
  ctx.beginPath(); ctx.arc(ox, oy, width * 0.018, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, width * 0.05, 0, Math.PI * 2); ctx.fill();
}

function drawDoublePendulum(ctx, q, width, height, color) {
  const ox = width * 0.5;
  const oy = height * 0.13;
  const length = Math.min(width, height) * 0.32;
  const x1 = ox + length * Math.sin(q[0]);
  const y1 = oy + length * Math.cos(q[0]);
  const x2 = x1 + length * Math.sin(q[1]);
  const y2 = y1 + length * Math.cos(q[1]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, width * 0.008);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  [ [ox, oy, .014], [x1, y1, .035], [x2, y2, .045] ].forEach(([x, y, radius]) => {
    ctx.beginPath(); ctx.arc(x, y, width * radius, 0, Math.PI * 2); ctx.fill();
  });
}

function drawCartPole(ctx, q, width, height, color, system) {
  const all = [system.truth, ...system.methods.map((method) => method.prediction)];
  const positions = all.flatMap((series) => series.map((item) => item[0]));
  const minX = Math.min(...positions);
  const maxX = Math.max(...positions);
  const span = Math.max(maxX - minX, 1);
  const cartX = width * (0.18 + 0.64 * (q[0] - minX) / span);
  const cartY = height * 0.68;
  const cartW = width * 0.18;
  const cartH = height * 0.1;
  const length = Math.min(width, height) * 0.36;
  const tipX = cartX + length * Math.sin(q[1]);
  const tipY = cartY - length * Math.cos(q[1]);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, width * 0.008);
  ctx.fillRect(cartX - cartW / 2, cartY - cartH / 2, cartW, cartH);
  ctx.beginPath(); ctx.moveTo(cartX, cartY); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.beginPath(); ctx.arc(tipX, tipY, width * 0.025, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cartX - cartW * .3, cartY + cartH * .65, width * .025, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cartX + cartW * .3, cartY + cartH * .65, width * .025, 0, Math.PI * 2); ctx.fill();
}

function drawTrail(ctx, series, step, system, width, height, color) {
  const start = Math.max(0, step - 14);
  ctx.save();
  ctx.globalAlpha = .22;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, width * .004);
  ctx.beginPath();
  for (let index = start; index <= step; index += 1) {
    const q = series[index];
    let point;
    if (system.scene === "pendulum") {
      const length = Math.min(width, height) * .48;
      point = [width * .5 + length * Math.sin(q[0]), height * .22 + length * Math.cos(q[0])];
    } else if (system.scene === "double-pendulum") {
      const length = Math.min(width, height) * .32;
      const x1 = width * .5 + length * Math.sin(q[0]);
      const y1 = height * .13 + length * Math.cos(q[0]);
      point = [x1 + length * Math.sin(q[1]), y1 + length * Math.cos(q[1])];
    } else {
      continue;
    }
    if (index === start) ctx.moveTo(...point); else ctx.lineTo(...point);
  }
  ctx.stroke();
  ctx.restore();
}

function drawScenes() {
  const system = currentSystem();
  document.querySelectorAll("canvas[data-scene]").forEach((canvas) => {
    const { width, height } = resizeCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const sceneId = canvas.dataset.scene;
    const series = sceneId === "truth" ? system.truth : currentMethod(sceneId).prediction;
    const color = COLORS[sceneId];
    drawBackground(ctx, width, height);
    drawTrail(ctx, series, state.step, system, width, height, color);
    const q = series[state.step];
    if (system.scene === "pendulum") drawPendulum(ctx, q, width, height, color);
    if (system.scene === "double-pendulum") drawDoublePendulum(ctx, q, width, height, color);
    if (system.scene === "cart-pole") drawCartPole(ctx, q, width, height, color, system);
  });
  system.methods.forEach((method) => {
    const node = document.querySelector(`[data-error="${method.id}"]`);
    if (node) node.textContent = `step MSE ${formatScore(method.error_by_step[state.step])}`;
  });
}

function renderMotionPanels() {
  const system = currentSystem();
  const visible = system.methods.filter((method) => state.visibleMethods.has(method.id));
  byId("motion-grid").innerHTML = [
    `<figure class="motion-panel truth-panel">
      <figcaption><strong>Ground truth</strong><span>held-out simulator trajectory</span></figcaption>
      <canvas data-scene="truth" width="560" height="360"></canvas>
      <p class="instant-error">Reference</p>
    </figure>`,
    ...visible.map((method) => `<figure class="motion-panel" style="--method-color:${COLORS[method.id]}">
      <figcaption><strong>${escapeText(method.label)}</strong><span>${escapeText(METHOD_DESCRIPTIONS[method.id])}</span></figcaption>
      <canvas data-scene="${escapeText(method.id)}" width="560" height="360"></canvas>
      <p class="instant-error" data-error="${escapeText(method.id)}"></p>
    </figure>`),
  ].join("");
  drawScenes();
}

function renderMethodFilter() {
  const methods = currentSystem().methods;
  byId("method-filter").innerHTML = methods.map((method) => `<label style="--method-color:${COLORS[method.id]}">
    <input type="checkbox" value="${escapeText(method.id)}" ${state.visibleMethods.has(method.id) ? "checked" : ""}>
    <span>${escapeText(shortLabel(method.id))}</span>
  </label>`).join("");
  byId("method-filter").querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.visibleMethods.add(input.value);
      else state.visibleMethods.delete(input.value);
      renderMotionPanels();
      drawPlots();
      writeViewState();
    });
  });
}

function mechanismMethods() {
  const available = new Set(currentSystem().methods.map((method) => method.id));
  return currentMechanism().methods.filter((id) => available.has(id));
}

function applyComparisonMethods() {
  const available = new Set(currentSystem().methods.map((method) => method.id));
  const selected = Array.isArray(state.initialVisibleMethods)
    ? state.initialVisibleMethods.filter((id) => available.has(id))
    : DEFAULT_COMPARE_METHODS.filter((id) => available.has(id));
  state.visibleMethods = new Set(selected);
  state.initialVisibleMethods = null;
}

function renderMechanismTabs() {
  byId("mechanism-tabs").innerHTML = state.data.mechanism_evidence.filter((item) => item.id !== "comparison").map((item) => `<button
    type="button"
    role="tab"
    data-mechanism="${escapeText(item.id)}"
    aria-selected="${item.id === state.mechanism ? "true" : "false"}"
  >${escapeText(item.label)}</button>`).join("");
  byId("mechanism-tabs").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mechanism = button.dataset.mechanism;
      renderMechanismTabs();
      renderMechanismEvidence();
      writeViewState();
    });
  });
}

function extent(series) {
  const values = series.flat().filter(Number.isFinite);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const padding = (max - min) * .08;
  return [min - padding, max + padding];
}

function makePath(values, xScale, yScale) {
  return values.map((value, index) => `${index ? "L" : "M"}${xScale(index).toFixed(2)},${yScale(value).toFixed(2)}`).join(" ");
}

function drawHeroRollout() {
  const svg = byId("hero-rollout");
  if (!svg || !state.data) return;
  const system = currentSystem();
  const coordinate = Math.min(state.coordinate, system.truth[0].length - 1);
  const observed = system.context.map((value) => value[coordinate]);
  const truth = system.truth.map((value) => value[coordinate]);
  const phast = currentMethod("phast_unknown_qonly").prediction.map((value) => value[coordinate]);
  const all = [...observed, ...truth, ...phast];
  const [minY, maxY] = extent([all]);
  const width = 960;
  const height = 360;
  const margin = { left: 58, right: 24, top: 38, bottom: 54 };
  const total = observed.length + truth.length;
  const x = (index) => margin.left + index / (total - 1) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (maxY - value) / (maxY - minY) * (height - margin.top - margin.bottom);
  const joinedTruth = [...observed.slice(-1), ...truth];
  const joinedPhast = [...observed.slice(-1), ...phast];
  const futureX = (index) => x(index + observed.length - 1);
  const grid = [0, .5, 1].map((ratio) => {
    const gy = margin.top + ratio * (height - margin.top - margin.bottom);
    const value = maxY - ratio * (maxY - minY);
    return `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${gy}" y2="${gy}"/><text class="plot-label" x="${margin.left - 10}" y="${gy + 5}" text-anchor="end">${value.toFixed(2)}</text>`;
  }).join("");
  const observedPath = makePath(observed, x, y);
  const truthPath = makePath(joinedTruth, futureX, y);
  const phastPath = makePath(joinedPhast, futureX, y);
  const split = x(observed.length - 1);
  svg.innerHTML = `
    <rect class="hero-observed-band" x="${margin.left}" y="${margin.top}" width="${split - margin.left}" height="${height - margin.top - margin.bottom}"/>
    ${grid}
    <path class="hero-observed-line" d="${observedPath}"/>
    ${observed.map((value, index) => `<circle class="hero-observed-point" cx="${x(index)}" cy="${y(value)}" r="4"/>`).join("")}
    <path class="hero-truth-line" d="${truthPath}"/>
    <path class="hero-phast-line" d="${phastPath}"/>
    <line class="hero-split" x1="${split}" x2="${split}" y1="${margin.top}" y2="${height - margin.bottom}"/>
    <text class="hero-region-label" x="${split - 10}" y="24" text-anchor="end">observed history</text>
    <text class="hero-region-label" x="${split + 10}" y="24">open-loop future</text>
    <g class="hero-legend" transform="translate(${width - 260},${height - 18})">
      <line x2="24" class="hero-truth-line"/><text x="31" y="5">truth</text>
      <line x1="82" x2="106" class="hero-phast-line"/><text x="113" y="5">PHAST</text>
    </g>`;
}

const EQUATION_TERMS = {
  H: {
    label: "Stored energy",
    title: "$H_\\theta$ gives the latent state a physical scale.",
    copy: "Potential and kinetic energy share one scalar ledger. A forecast can therefore be inspected in energy units rather than only coordinate error.",
    formula: "$H_\\theta(q,p)=V_\\theta(q)+\\tfrac12p^\\top M_\\theta(q)^{-1}p$",
    caption: "Change in the learned Hamiltonian along the selected PHAST rollout.",
  },
  J: {
    label: "Conservative exchange",
    title: "$J$ moves energy without creating or destroying it.",
    copy: "Its skew symmetry makes the internal power cancel. In a mechanical system, this is the reversible exchange between potential and kinetic energy.",
    formula: "$J^\\top=-J,\\qquad \\nabla H_\\theta^\\top J\\nabla H_\\theta=0$",
    caption: "The interconnection redistributes energy while the total ledger is unchanged.",
  },
  R: {
    label: "Dissipation",
    title: "$R_\\theta$ makes irreversible loss explicit.",
    copy: "Its mechanical block $D_\\theta(q)\\succeq0$ removes energy without being allowed to create it. This is the quantity tested in the recovery study.",
    formula: "$P_{\\mathrm{loss}}=\\nabla H_\\theta^\\top R_\\theta\\nabla H_\\theta\\geq0$",
    caption: "PHAST exposes a non-negative dissipated-power channel along the rollout.",
  },
  G: {
    label: "External port",
    title: "$G_\\theta$ records where external effort enters.",
    copy: "The input and its conjugate output form a power pair. This lets a controller act through a declared physical interface without changing the internal energy model.",
    formula: "$y^{\\mathrm{port}}=G_\\theta^\\top\\nabla H_\\theta,\\qquad P_{\\mathrm{in}}=u^\\top y^{\\mathrm{port}}$",
    caption: "The port separates externally supplied power from internal storage and loss.",
  },
};

function drawEquationVisual() {
  const svg = byId("equation-visual");
  if (!svg || !state.data) return;
  const method = currentMethod("phast_unknown_qonly");
  if (state.equationTerm === "H") {
    const values = method.native_energy_change_normalized || [];
    renderPlot(svg, [{ label: "delta H", color: COLORS.phast_unknown_qonly, values }], { cursor: false });
    return;
  }
  if (state.equationTerm === "R") {
    const values = normalizedPower(method.native_dissipation_power, currentSystem().truth.length);
    renderPlot(svg, [{ label: "dissipated power", color: COLORS.phast_unknown_qonly, values }], { cursor: false });
    return;
  }
  if (state.equationTerm === "J") {
    svg.innerHTML = `<defs><marker id="exchange-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#167251"/></marker></defs>
      <circle class="equation-node" cx="280" cy="138" r="72"/><circle class="equation-node" cx="620" cy="138" r="72"/>
      <text class="equation-node-title" x="280" y="132" text-anchor="middle">potential</text><text class="equation-node-symbol" x="280" y="158" text-anchor="middle">V(q)</text>
      <text class="equation-node-title" x="620" y="132" text-anchor="middle">kinetic</text><text class="equation-node-symbol" x="620" y="158" text-anchor="middle">T(p)</text>
      <path class="equation-arrow" marker-end="url(#exchange-arrow)" d="M360,108 C420,65 480,65 540,108"/><path class="equation-arrow" marker-end="url(#exchange-arrow)" d="M540,168 C480,211 420,211 360,168"/>
      <text class="equation-total" x="450" y="272" text-anchor="middle">exchange changes V and T, not H = V + T</text>`;
    return;
  }
  svg.innerHTML = `<defs><marker id="port-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#167251"/></marker></defs>
    <text class="equation-port-label" x="108" y="130">effort u</text><line class="equation-arrow" marker-end="url(#port-arrow)" x1="190" y1="124" x2="340" y2="124"/>
    <rect class="equation-port" x="350" y="65" width="200" height="118"/><text class="equation-node-title" x="450" y="116" text-anchor="middle">physical port</text><text class="equation-node-symbol" x="450" y="149" text-anchor="middle">G(q)</text>
    <line class="equation-arrow" marker-end="url(#port-arrow)" x1="560" y1="124" x2="710" y2="124"/><text class="equation-port-label" x="728" y="130">flow y</text>
    <text class="equation-total" x="450" y="260" text-anchor="middle">instantaneous supplied power = u transpose y</text>`;
}

function renderEquationTerm() {
  const term = EQUATION_TERMS[state.equationTerm];
  if (!term || !byId("equation-term-label")) return;
  document.querySelectorAll("[data-equation-term]").forEach((button) => button.setAttribute("aria-selected", button.dataset.equationTerm === state.equationTerm ? "true" : "false"));
  byId("equation-term-label").textContent = term.label;
  byId("equation-term-title").textContent = term.title;
  byId("equation-term-copy").textContent = term.copy;
  byId("equation-term-formula").textContent = term.formula;
  byId("equation-visual-caption").textContent = term.caption;
  drawEquationVisual();
  if (typeof window.renderMathInElement === "function") {
    window.renderMathInElement(byId("model"), {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
      throwOnError: false,
    });
  }
}

function renderPlot(svg, series, options = {}) {
  const width = 900;
  const height = 310;
  const margin = { left: 72, right: 24, top: 22, bottom: 48 };
  if (!series.length) {
    svg.innerHTML = `<text class="plot-label" x="450" y="155" text-anchor="middle">Select at least one model above.</text>`;
    return;
  }
  const allValues = series.map((item) => item.values);
  const [minY, maxY] = options.logY
    ? extent(allValues.map((values) => values.map((value) => Math.log10(Math.max(value, 1e-9)))))
    : extent(allValues);
  const n = Math.max(...series.map((item) => item.values.length));
  const x = (index) => margin.left + index / Math.max(1, n - 1) * (width - margin.left - margin.right);
  const yValue = (value) => options.logY ? Math.log10(Math.max(value, 1e-9)) : value;
  const y = (value) => margin.top + (maxY - yValue(value)) / (maxY - minY) * (height - margin.top - margin.bottom);
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const gy = margin.top + ratio * (height - margin.top - margin.bottom);
    const raw = maxY - ratio * (maxY - minY);
    const label = options.logY ? `10^${raw.toFixed(1)}` : raw.toFixed(2);
    return `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${gy}" y2="${gy}"/><text class="plot-label" x="${margin.left - 12}" y="${gy + 7}" text-anchor="end">${label}</text>`;
  }).join("");
  const paths = series.map((item) => `<path class="plot-line" stroke="${item.color}" ${item.dash ? `stroke-dasharray="${item.dash}"` : ""} d="${makePath(item.values, x, y)}"/>`).join("");
  const zeroLine = options.zeroLine && minY <= 0 && maxY >= 0
    ? `<line class="plot-zero" x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}"/><text class="plot-zero-label" x="${width - margin.right}" y="${y(0) - 7}" text-anchor="end">initial energy</text>`
    : "";
  const cursor = options.cursor === false ? "" : `<line class="plot-cursor" x1="${x(state.step)}" x2="${x(state.step)}" y1="${margin.top}" y2="${height - margin.bottom}"/>`;
  const legendGap = Math.min(145, (width - margin.left - margin.right) / Math.max(1, series.length));
  const legend = series.map((item, index) => `<g transform="translate(${margin.left + index * legendGap},${height - 12})"><line x2="24" stroke="${item.color}" stroke-width="4" ${item.dash ? `stroke-dasharray="${item.dash}"` : ""}/><text class="plot-label" x="31" y="7">${escapeText(item.label)}</text></g>`).join("");
  svg.innerHTML = `${grid}${zeroLine}<line class="plot-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"/>${paths}${cursor}${legend}`;
}

function drawLowerIsBetterComparison(svg, rows) {
  const metrics = [
    { label: "H=100 rollout MSE", key: "rollout" },
    { label: "Modal-power MSE", key: "power_mse" },
  ];
  const colors = ["#9b5b4d", COLORS.phast_unknown_qonly];
  const panels = metrics.map((metric, panelIndex) => {
    const left = 40 + panelIndex * 450;
    const values = rows.map((row) => row[metric.key]);
    const logs = values.map((value) => Math.log10(value));
    const high = Math.max(...logs) + 0.25;
    const low = Math.min(...logs) - 0.25;
    const y = (value) => 72 + (high - Math.log10(value)) / (high - low) * 150;
    const ratio = values[0] / values[1];
    const points = rows.map((row, index) => {
      const x = left + 115 + index * 205;
      const cy = y(row[metric.key]);
      return `<circle class="metric-point" cx="${x}" cy="${cy}" r="7" fill="${colors[index]}"/>
        <text class="metric-value" x="${x}" y="${cy - 15}" text-anchor="middle">${formatScientific(row[metric.key])}</text>
        <text class="metric-name" x="${x}" y="254" text-anchor="middle">${escapeText(index === 0 ? "bounded" : "ordered + anchored")}</text>`;
    }).join("");
    return `<g><text class="metric-title" x="${left + 225}" y="28" text-anchor="middle">${metric.label}</text>
      <text class="metric-reading" x="${left + 225}" y="48" text-anchor="middle">log scale · lower is better</text>
      <line class="metric-link" x1="${left + 115}" y1="${y(values[0])}" x2="${left + 320}" y2="${y(values[1])}"/>
      ${points}<text class="metric-ratio" x="${left + 225}" y="292" text-anchor="middle">${ratio < 10 ? ratio.toFixed(1) : ratio.toFixed(0)}x lower</text></g>`;
  }).join("");
  svg.innerHTML = `<line class="metric-divider" x1="450" x2="450" y1="18" y2="292"/>${panels}`;
}

function drawPortComparison(svg, rows) {
  const [oracle, phast] = rows;
  const bar = (x, value, max, color, valueLabel, name) => {
    const height = 150 * value / max;
    const y = 220 - height;
    return `<rect class="metric-bar" x="${x}" y="${y}" width="72" height="${height}" fill="${color}"/>
      <text class="metric-value" x="${x + 36}" y="${y - 12}" text-anchor="middle">${valueLabel}</text>
      <text class="metric-name" x="${x + 36}" y="252" text-anchor="middle">${escapeText(name)}</text>`;
  };
  svg.innerHTML = `<line class="metric-divider" x1="450" x2="450" y1="18" y2="292"/>
    <text class="metric-title" x="225" y="28" text-anchor="middle">Stabilization success</text>
    <text class="metric-reading" x="225" y="48" text-anchor="middle">100 trials · higher is better</text>
    ${bar(125, oracle.success, 1, "#9b5b4d", `${Math.round(oracle.success * 100)}%`, "oracle velocity")}
    ${bar(275, phast.success, 1, COLORS.phast_unknown_qonly, `${Math.round(phast.success * 100)}%`, "PHAST port")}
    <text class="metric-title" x="675" y="28" text-anchor="middle">Mean control effort</text>
    <text class="metric-reading" x="675" y="48" text-anchor="middle">same controller · lower is better</text>
    ${bar(575, oracle.effort, 290, "#9b5b4d", oracle.effort.toFixed(1), "oracle velocity")}
    ${bar(725, phast.effort, 290, COLORS.phast_unknown_qonly, phast.effort.toFixed(1), "PHAST port")}`;
}

function drawPlots() {
  const system = currentSystem();
  const coordinate = state.coordinate;
  const methods = system.methods.filter((method) => state.visibleMethods.has(method.id));
  renderPlot(byId("trajectory-plot"), [
    { label: "Truth", color: COLORS.truth, values: system.truth.map((q) => q[coordinate]) },
    ...methods.map((method) => ({ label: shortLabel(method.id), color: COLORS[method.id], dash: lineDash(method.id), values: method.prediction.map((q) => q[coordinate]) })),
  ]);
  renderPlot(byId("error-plot"), methods.map((method) => ({
    label: shortLabel(method.id), color: COLORS[method.id], dash: lineDash(method.id), values: method.error_by_step,
  })), { logY: true });
  drawMechanismPlot();
}

function normalizedPower(values, length) {
  if (!Array.isArray(values)) return Array(length).fill(0);
  const scale = Math.max(...values.map((value) => Math.abs(value)), 1e-12);
  return values.map((value) => value / scale);
}

function drawMechanismPlot() {
  const svg = byId("mechanism-plot");
  const system = currentSystem();
  if (state.mechanism === "dissipation") {
    const methods = mechanismMethods().map(currentMethod).filter(Boolean);
    renderPlot(svg, methods.map((method) => ({
      label: method.id === "hnn_observer_qonly" ? "HNN: R=0" : shortLabel(method.id),
      color: COLORS[method.id],
      dash: lineDash(method.id),
      values: normalizedPower(method.native_dissipation_power, system.truth.length),
    })));
    return;
  }
  if (state.mechanism === "passivity") {
    const methods = mechanismMethods().map(currentMethod).filter((method) => Array.isArray(method.native_energy_change_normalized));
    renderPlot(svg, methods.map((method) => ({
      label: shortLabel(method.id),
      color: COLORS[method.id],
      dash: lineDash(method.id),
      values: method.native_energy_change_normalized,
    })), { zeroLine: true });
    return;
  }
  if (state.mechanism === "spectral") {
    drawLowerIsBetterComparison(svg, currentMechanism().result.rows);
    return;
  }
  if (state.mechanism === "ports") {
    drawPortComparison(svg, currentMechanism().result.rows);
    return;
  }
  if (state.mechanism === "efficiency") {
    svg.innerHTML = `<image href="./assets/phast-primitives-timing.svg?v=1" x="55" y="8" width="790" height="292" preserveAspectRatio="xMidYMid meet"/>`;
    return;
  }
  svg.innerHTML = "";
}

function mechanismResultTable(headers, rows) {
  return `<div class="mechanism-table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeText(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderMechanismEvidence() {
  const mechanism = currentMechanism();
  const system = currentSystem();
  const plot = byId("mechanism-plot");
  const evidenceScopes = {
    dissipation: { level: "Matched family comparison", scope: `Active benchmark · ${system.label}` },
    passivity: { level: "Trajectory diagnostic", scope: `Active benchmark · ${system.label}` },
    spectral: { level: "Separate benchmark", scope: "Modal-damped LJ-3" },
    ports: { level: "Controller study", scope: "Energy–Casimir pendulum · full-state input" },
    efficiency: { level: "Primitive microbenchmark", scope: "Synthetic dimensions · fixed rank r=2" },
  };
  const formulaCallbacks = {
    dissipation: "$R_\\theta\\nabla H_\\theta$ and $-\\nabla H^\\top R_\\theta\\nabla H$",
    passivity: "$H_\\theta$ and $\\dot H=-\\nabla H^\\top R_\\theta\\nabla H+u^\\top y^{\\mathrm{port}}$",
    spectral: "$\\lambda(R_\\theta)\\in[0,\\bar\\beta]$",
    ports: "$G_\\theta(q)u$ and $u^\\top y^{\\mathrm{port}}$",
    efficiency: "$M_\\theta(q)^{-1}p$ and $R_\\theta\\nabla H_\\theta$",
  };
  const evidenceScope = evidenceScopes[mechanism.id] || { level: "Evidence", scope: mechanism.evidence_type };
  byId("mechanism-level").textContent = evidenceScope.level;
  byId("mechanism-kind").textContent = evidenceScope.scope;
  byId("mechanism-evidence").dataset.evidenceLevel = mechanism.id;
  byId("mechanism-formula").textContent = formulaCallbacks[mechanism.id] || "";
  byId("mechanism-title").textContent = mechanism.title;
  byId("mechanism-question").textContent = mechanism.question;
  byId("mechanism-interpretation").textContent = mechanism.interpretation;
  byId("construction-input").textContent = mechanism.construction.input;
  byId("construction-intervention").textContent = mechanism.construction.intervention;
  byId("construction-fixed").textContent = mechanism.construction.fixed;
  byId("construction-readout").textContent = mechanism.construction.readout;
  const relevantRows = new Set(mechanism.formula_rows);
  document.querySelectorAll("[data-formula]").forEach((row) => {
    row.classList.toggle("is-relevant", relevantRows.has(row.dataset.formula));
  });
  const result = byId("mechanism-result");

  if (mechanism.id === "comparison") {
    byId("mechanism-caption").textContent = "Matched five-seed result for the selected system";
    plot.hidden = true;
    result.innerHTML = mechanismResultTable(
      ["Model", "H=100 error", "Relative to PHAST"],
      system.methods.map((method) => {
        const phast = system.methods[0].aggregate.mean;
        const ratio = method.aggregate.mean / phast;
        return [
          escapeText(shortLabel(method.id)),
          `${formatScore(method.aggregate.mean)} +/- ${formatScore(method.aggregate.std)}`,
          method.id === "phast_unknown_qonly" ? "1.0x" : `${ratio.toFixed(1)}x higher`,
        ];
      }),
    );
  } else if (mechanism.id === "dissipation") {
    byId("mechanism-caption").textContent = "Native dissipated-power readout, normalized within each model";
    plot.hidden = false;
    result.innerHTML = `<p class="result-callout"><strong>What the family comparison tests:</strong> HNN has no damping channel through which energy can be lost; pHNN and PHAST do. Power curves are normalized separately because their learned Hamiltonian scales are not comparable. This is not yet a one-switch PHAST ablation.</p>`;
  } else if (mechanism.id === "passivity") {
    byId("mechanism-caption").textContent = "Stored-energy change from rollout start, normalized within each model";
    plot.hidden = false;
    result.innerHTML = mechanismResultTable(
      ["Model", "Native channel", "Upward finite-step increments"],
      mechanismMethods().map(currentMethod).filter(Boolean).map((method) => [
        escapeText(shortLabel(method.id)),
        method.native_channels.psd_damping ? "Hamiltonian + PSD loss" : "Hamiltonian only",
        method.native_energy_increase_steps == null ? "not available" : `${method.native_energy_increase_steps} / ${system.truth.length - 1}`,
      ]),
    ) + `<p class="result-callout"><strong>How to read the plot:</strong> zero is each model's energy at the start of the forecast. Moving below zero means that model reports a net loss of stored energy. Any upward segment is a finite-step energy increase. Compare direction and upward increments, not curve heights, because every learned Hamiltonian has its own scale and is normalized separately.</p><p class="result-caveat">This count describes the displayed finite-step rollout. PHAST's formal passivity claim is continuous-time; the full numerical map is not asserted to be unconditionally energy-monotone.</p>`;
  } else if (mechanism.id === "spectral") {
    const [base, controlled] = mechanism.result.rows;
    byId("mechanism-caption").textContent = mechanism.result.benchmark;
    plot.hidden = false;
    result.innerHTML = `<div class="result-pair">
      <div><span>${mechanism.result.rollout_improvement.toFixed(1)}x</span><strong>lower rollout error</strong><small>${formatScientific(base.rollout)} to ${formatScientific(controlled.rollout)}</small></div>
      <div><span>${mechanism.result.power_improvement.toFixed(0)}x</span><strong>lower modal-power error</strong><small>${formatScientific(base.power_mse)} to ${formatScientific(controlled.power_mse)}</small></div>
    </div><p class="result-caveat">Direct targeted ablation; no synchronized checkpoint animation is attached to this result.</p>`;
  } else if (mechanism.id === "ports") {
    byId("mechanism-caption").textContent = mechanism.result.benchmark;
    plot.hidden = false;
    result.innerHTML = mechanismResultTable(
      ["Feedback signal", "Success", "Mean control effort"],
      mechanism.result.rows.map((row) => [escapeText(row.label), `${Math.round(row.success * 100)}%`, row.effort.toFixed(1)]),
    ) + `<p class="result-callout"><strong>Result:</strong> the learned PHAST port matches oracle success and uses 6.8% less control effort. This is a separate full-state control experiment, not the q-only rollout shown above.</p>`;
  } else {
    byId("mechanism-caption").textContent = "Measured CPU time per structured operation as physical dimension increases (fixed rank r=2)";
    plot.hidden = false;
    result.innerHTML = `<div class="complexity-row">
      <div><code>D(q)v</code><strong>Householder damping</strong><span>O(nr)</span></div>
      <div><code>M(q)^-1 p</code><strong>Woodbury mass solve</strong><span>O(nr^2 + r^3)</span></div>
    </div><p class="result-caveat">Measured near-linear CPU scaling at fixed rank r=2. End-to-end throughput against HNN, pHNN, and the sequence baselines was not measured.</p>`;
  }
  drawMechanismPlot();
  if (typeof window.renderMathInElement === "function") {
    window.renderMathInElement(byId("mechanism-evidence"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

function renderSubmittedScoreTable() {
  const rows = currentSystem().submitted_results;
  const best = Math.min(...rows.map((row) => row.mean));
  byId("submitted-score-table").querySelector("tbody").innerHTML = rows.map((row) => `<tr>
    <td>${escapeText(row.label)}</td>
    <td>${escapeText(row.contract)}</td>
    <td class="${row.mean === best ? "best-score" : ""}">${formatScore(row.mean)} +/- ${formatScore(row.std)}</td>
    <td>${row.parameter_count.toLocaleString()}</td>
  </tr>`).join("");
}

function renderCapabilityTable() {
  const contextualOnly = new Set(["LNN", "DHNN"]);
  const displayName = (row) => row.method === "Dissipative SymODEN" ? "pHNN observer" : row.method;
  const displayNote = (row) => row.method === "Dissipative SymODEN"
    ? "Matched q-only dissipative Hamiltonian baseline; used as the closest experimental comparison for this capability."
    : row.note;
  const lossDescription = {
    "None": "Irreversible loss is not represented",
    "PSD R": "Positive-semidefinite damping R",
    "Learned loss": "Unconstrained learned loss term",
    "Latent / varies": "Latent forgetting; model dependent",
    "PSD D": "Positive-semidefinite physical damping D",
  };
  const lawDescription = {
    "Conservation": "Energy conservation",
    "Passivity": "Passive energy balance",
    "Not certified": "No certified energy law",
    "Geometric invariant": "A geometric invariant, not dissipation",
    "Not physical": "No physical energy law",
  };
  const rolloutDescription = {
    "Direct vector field": "Integrate a learned vector field",
    "Hessian solve": "Solve the Lagrangian equations",
    "Explicit map": "Apply a learned discrete map",
    "Linear recurrence": "Update a latent linear state",
    "Low-rank pH": "Apply the split pH transition",
  };
  const evidenceLabel = (row) => {
    if (row.method === "Dissipative SymODEN") return "Matched dissipative pH proxy";
    if (row.evidence.includes("matched")) return "Yes";
    return row.evidence;
  };
  const renderRows = (rows) => rows.map((row) => `<tr>
    <td><strong>${escapeText(displayName(row))}</strong><small>${escapeText(displayNote(row))}</small></td>
    <td>${escapeText(lossDescription[row.loss_channel] || row.loss_channel)}</td>
    <td>${escapeText(lawDescription[row.storage_law] || row.storage_law)}</td>
    <td>${row.damping_spectrum === "Bounded" ? "Yes" : "No"}</td>
    <td>${escapeText(rolloutDescription[row.rollout_primitive] || row.rollout_primitive)}</td>
    <td><span class="evidence-tag">${escapeText(evidenceLabel(row))}</span></td>
  </tr>`).join("");
  byId("capability-table").querySelector("tbody").innerHTML = renderRows(state.data.table2_methods.filter((row) => !contextualOnly.has(row.method)));
  byId("capability-context-table").querySelector("tbody").innerHTML = renderRows(state.data.table2_methods.filter((row) => contextualOnly.has(row.method)));
  byId("comparison-note").textContent = "A structural capability is not itself a performance result. The experiments below test whether these differences matter when models receive the same position history and predict the same horizon.";
}

function renderScoreTable() {
  const system = currentSystem();
  const phast = system.methods.find((method) => method.id === "phast_unknown_qonly").aggregate.mean;
  const body = byId("score-table").querySelector("tbody");
  body.innerHTML = system.methods.map((method) => {
    const aggregate = method.aggregate;
    const ratio = aggregate.mean / phast;
    return `<tr>
      <td>${escapeText(method.label)}</td>
      <td>${escapeText(CONTRACTS[method.id])}</td>
      <td class="${method.id === "phast_unknown_qonly" ? "best-score" : ""}">${formatScore(aggregate.mean)} +/- ${formatScore(aggregate.std)}</td>
      <td>${aggregate.parameter_count.toLocaleString()}</td>
      <td>${method.id === "phast_unknown_qonly" ? "1.0x" : `${ratio.toFixed(1)}x higher error`}</td>
    </tr>`;
  }).join("");
}

function strongestMatchedBaseline(system) {
  return system.methods.slice(1).reduce((best, method) => (
    method.aggregate.mean < best.aggregate.mean ? method : best
  ));
}

function nextCausalTest(system) {
  const tests = {
    pendulum: "Full PHAST versus R=0, unconstrained damping, and unbounded damping under the same seeds.",
    "double-pendulum": "Observer, damping, mass, and integrator ablations under the same coupled rollout contract.",
    "cart-pole": "Continuous chart versus raw angular coordinates, followed by matched damping and mass ablations.",
  };
  return tests[system.scene];
}

function renderResultSummary() {
  byId("result-summary").innerHTML = state.data.systems.map((system, index) => {
    const phast = system.methods[0];
    const baseline = strongestMatchedBaseline(system);
    const ratio = baseline.aggregate.mean / phast.aggregate.mean;
    return `<a class="result-signal" href="#evidence" data-summary-system="${index}">
      <div>
        <h3>${escapeText(system.label)}</h3>
        <p>${escapeText(system.claim)}</p>
        <small>${escapeText(benchmarkPurpose(system))}</small>
      </div>
      <div>
        <span class="result-ratio">${ratio.toFixed(1)}x</span>
        <strong>lower mean error than ${escapeText(shortLabel(baseline.id))}</strong>
      </div>
      <p>PHAST ${formatScore(phast.aggregate.mean)} +/- ${formatScore(phast.aggregate.std)}</p>
    </a>`;
  }).join("");
}

function renderSynthesisTable() {
  byId("synthesis-table").querySelector("tbody").innerHTML = state.data.systems.map((system) => {
    const phast = system.methods[0];
    const baseline = strongestMatchedBaseline(system);
    const ratio = baseline.aggregate.mean / phast.aggregate.mean;
    return `<tr>
      <td>${escapeText(system.label)}</td>
      <td class="best-score">${formatScore(phast.aggregate.mean)} +/- ${formatScore(phast.aggregate.std)}</td>
      <td>${escapeText(shortLabel(baseline.id))}: ${formatScore(baseline.aggregate.mean)} +/- ${formatScore(baseline.aggregate.std)}</td>
      <td>${ratio.toFixed(1)}x lower</td>
      <td>${escapeText(nextCausalTest(system))}</td>
    </tr>`;
  }).join("");
}

function renderActiveResult() {
  const system = currentSystem();
  const phast = system.methods[0];
  const baseline = strongestMatchedBaseline(system);
  const ratio = baseline.aggregate.mean / phast.aggregate.mean;
  byId("active-result-number").textContent = `${ratio.toFixed(1)}x`;
  byId("active-result-title").textContent = `lower mean rollout error than ${shortLabel(baseline.id)}`;
  byId("active-result-detail").textContent = `${system.label}: PHAST ${formatScore(phast.aggregate.mean)} +/- ${formatScore(phast.aggregate.std)}; ${shortLabel(baseline.id)} ${formatScore(baseline.aggregate.mean)} +/- ${formatScore(baseline.aggregate.std)} over five model seeds.`;
}

function renderInterpretation() {
  const system = currentSystem();
  const phast = system.methods[0].aggregate.mean;
  const bestBaseline = Math.min(...system.methods.slice(1).map((method) => method.aggregate.mean));
  const ratio = bestBaseline / phast;
  byId("claim-title").textContent = system.claim;
  const explanations = {
    pendulum: "The true damping changes with angle. A conservative HNN cannot represent irreversible energy loss; pHNN adds damping, while PHAST separates potential, mass, and damping inside its transition.",
    "double-pendulum": "The two angular coordinates exchange energy through coupled nonlinear motion while damping removes it. The observer and transition must remain stable after ground-truth positions stop.",
    "cart-pole": "The cart moves on the real line while the pole angle wraps on a circle. The declared chart prevents an artificial discontinuity at the angular branch cut.",
  };
  byId("claim-explanation").textContent = explanations[system.scene];
  byId("claim-result").textContent = `PHAST has ${ratio.toFixed(1)}x lower mean rollout error than the strongest matched structured baseline on this system.`;
  byId("next-test-title").textContent = system.scene === "cart-pole" ? "Isolate the coordinate chart" : "Isolate the PHAST mechanism";
  byId("next-test-copy").textContent = nextCausalTest(system);
}

function renderProvenance() {
  byId("contract-detail").textContent = state.data.information_contract;
  const lines = currentSystem().methods.map((method) => `${method.label}\n${method.aggregate.checkpoint}\nsha256 ${method.aggregate.checkpoint_sha256}`);
  byId("checkpoint-detail").textContent = lines.join("\n\n");
}

function scalingMethod(methodId) {
  return state.scalingData.methods[methodId];
}

function formatSigned(value, digits = 3) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function sortedScalingCells(rows) {
  const excitationOrder = { narrow: 0, broad: 1 };
  return [...rows].sort((left, right) => (
    excitationOrder[left.excitation] - excitationOrder[right.excitation]
    || left.n_train - right.n_train
    || left.hidden_dim - right.hidden_dim
  ));
}

function renderScalingSummary() {
  const cells = sortedScalingCells(state.scalingData.forecast);
  const wins = cells.filter((cell) => {
    const bounded = cell.values.find((value) => value.method === "phast_partial_bounded").mean;
    return bounded === Math.min(...cell.values.map((value) => value.mean));
  }).length;
  const ratios = cells.map((cell) => {
    const bounded = cell.values.find((value) => value.method === "phast_partial_bounded").mean;
    const alternative = Math.min(...cell.values.filter((value) => value.method !== "phast_partial_bounded").map((value) => value.mean));
    return alternative / bounded;
  });
  const bestRecovery = Math.max(...state.scalingData.recovery.map((cell) => cell.bounded.mean));

  byId("scaling-summary").innerHTML = `
    <div><span>${wins}/${cells.length}</span><strong>matched conditions won</strong><p>Bounded PHAST has the lowest $H=100$ error in every cell.</p></div>
    <div><span>${Math.min(...ratios).toFixed(2)}-${Math.max(...ratios).toFixed(2)}x</span><strong>lower rollout error</strong><p>Relative to the best alternative in each matched cell.</p></div>
    <div><span>${formatSigned(bestRecovery)}</span><strong>best damping $R_D^2$</strong><p>Recovery improves, but remains far from complete identification.</p></div>`;
}

function renderFullForecastScaling() {
  const methodOrder = ["phast_partial_bounded", "phast_no_damping", "phast_unknown", "phnn_observer", "s5"];
  const rows = sortedScalingCells(state.scalingData.forecast).map((cell) => {
    const best = Math.min(...cell.values.map((value) => value.mean));
    const bounded = cell.values.find((value) => value.method === "phast_partial_bounded").mean;
    const bestAlternative = Math.min(...cell.values.filter((value) => value.method !== "phast_partial_bounded").map((value) => value.mean));
    const values = methodOrder.map((methodId) => {
      const value = cell.values.find((candidate) => candidate.method === methodId);
      const className = Math.abs(value.mean - best) < 1e-12 ? "best-scaling-score" : "";
      return `<td class="${className}" data-label="${escapeText(scalingMethod(methodId).label)}"><strong>${formatScore(value.mean)}</strong><small>+/- ${formatScore(value.std)}</small></td>`;
    }).join("");
    return `<tr>
      <th scope="row"><span>${escapeText(cell.excitation)}</span><small>$N=${cell.n_train}$ · width ${cell.hidden_dim}</small></th>
      ${values}
      <td data-label="Advantage"><strong>${(bestAlternative / bounded).toFixed(2)}x</strong><small>lower</small></td>
    </tr>`;
  }).join("");

  byId("forecast-full-table").innerHTML = `<table class="scaling-table">
    <thead><tr>
      <th scope="col">Condition</th>
      ${methodOrder.map((methodId) => `<th scope="col"><span class="method-swatch" style="--swatch:${SCALING_COLORS[methodId]}"></span>${escapeText(scalingMethod(methodId).label)}</th>`).join("")}
      <th scope="col">Advantage</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderForecastScaling() {
  const rows = sortedScalingCells(state.scalingData.forecast).filter((cell) => cell.hidden_dim === 64).map((cell) => {
    const valueFor = (methodId) => cell.values.find((value) => value.method === methodId);
    const bounded = valueFor("phast_partial_bounded");
    const noDamping = valueFor("phast_no_damping");
    const nonPhast = [valueFor("phnn_observer"), valueFor("s5")].sort((left, right) => left.mean - right.mean)[0];
    const bestAlternative = Math.min(...cell.values.filter((value) => value.method !== "phast_partial_bounded").map((value) => value.mean));
    return `<tr>
      <th scope="row"><span>${escapeText(cell.excitation)} excitation</span><small>$N=${cell.n_train}$ · width 64</small></th>
      <td class="best-scaling-score" data-label="Bounded PHAST"><strong>${formatScore(bounded.mean)}</strong><small>+/- ${formatScore(bounded.std)}</small></td>
      <td data-label="PHAST without damping"><strong>${formatScore(noDamping.mean)}</strong><small>+/- ${formatScore(noDamping.std)}</small></td>
      <td data-label="Best non-PHAST"><strong>${formatScore(nonPhast.mean)}</strong><small>${escapeText(scalingMethod(nonPhast.method).label)} · +/- ${formatScore(nonPhast.std)}</small></td>
      <td data-label="Advantage"><strong>${(bestAlternative / bounded.mean).toFixed(2)}x</strong><small>vs best alternative</small></td>
    </tr>`;
  }).join("");

  byId("forecast-scaling-table").innerHTML = `<table class="scaling-table primary-scaling-table">
    <thead><tr><th scope="col">Condition</th><th scope="col">Bounded PHAST</th><th scope="col">Without damping</th><th scope="col">Best non-PHAST</th><th scope="col">Advantage</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  renderFullForecastScaling();
}

function renderCapacityScaling() {
  const forecast = state.scalingData.forecast;
  const recovery = state.scalingData.recovery;
  const rows = ["narrow", "broad"].map((excitation) => {
    const values = [32, 64].map((width) => {
      const forecastCell = scalingCell(forecast, excitation, 256, width);
      const recoveryCell = scalingCell(recovery, excitation, 256, width);
      return {
        forecast: forecastCell.values.find((value) => value.method === "phast_partial_bounded"),
        recovery: recoveryCell.bounded,
      };
    });
    return `<tr>
      <th scope="row"><span>${excitation} excitation</span><small>$N=256$</small></th>
      <td data-label="Width 32 · H=100 MSE"><strong>${formatScore(values[0].forecast.mean)}</strong><small>+/- ${formatScore(values[0].forecast.std)}</small></td>
      <td data-label="Width 64 · H=100 MSE"><strong>${formatScore(values[1].forecast.mean)}</strong><small>+/- ${formatScore(values[1].forecast.std)}</small></td>
      <td data-label="Width 32 · damping R²"><strong>${formatSigned(values[0].recovery.mean)}</strong><small>+/- ${values[0].recovery.std.toFixed(3)}</small></td>
      <td data-label="Width 64 · damping R²"><strong>${formatSigned(values[1].recovery.mean)}</strong><small>+/- ${values[1].recovery.std.toFixed(3)}</small></td>
    </tr>`;
  }).join("");
  byId("capacity-scaling-table").innerHTML = `<table class="scaling-table capacity-scaling-table">
    <thead><tr><th scope="col">Condition</th><th scope="col">Width 32 · $H=100$ MSE</th><th scope="col">Width 64 · $H=100$ MSE</th><th scope="col">Width 32 · $R_D^2$</th><th scope="col">Width 64 · $R_D^2$</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRecoveryGrid(rows, targetId) {
  const groups = ["narrow", "broad"].map((excitation) => {
    const cells = rows.filter((row) => row.excitation === excitation).map((row) => {
      const value = row.bounded.mean;
      const positive = value >= 0;
      const alpha = positive ? Math.min(.28, .07 + value * .45) : Math.min(.16, .07 + Math.abs(value) * .25);
      const fill = positive ? `rgba(23, 111, 80, ${alpha})` : `rgba(185, 75, 75, ${alpha})`;
      return `<div class="recovery-cell" style="--recovery-fill:${fill}">
        <span>$N=${row.n_train}$ · width ${row.hidden_dim}</span>
        <strong>${formatSigned(value)}</strong>
        <small>+/- ${row.bounded.std.toFixed(3)}</small>
        <p>uncapped ${formatSigned(row.uncapped.mean, 1)}</p>
      </div>`;
    }).join("");
    return `<section class="recovery-group" aria-label="${excitation} excitation recovery">
      <header><h5>${excitation} excitation</h5><p>${escapeText(state.scalingData.study.excitation[excitation])}</p></header>
      <div>${cells}</div>
    </section>`;
  }).join("");
  byId(targetId).innerHTML = groups;
}

function renderRecoveryScaling() {
  const rows = sortedScalingCells(state.scalingData.recovery);
  renderRecoveryGrid(rows.filter((row) => row.hidden_dim === 64), "recovery-scaling-grid");
  renderRecoveryGrid(rows, "recovery-full-grid");
}

function renderOptimizationScalingPlot() {
  const svg = byId("optimization-scaling-plot");
  const width = 900;
  const height = 350;
  const margin = { left: 84, right: 28, top: 32, bottom: 78 };
  const epochs = [50, 100, 200];
  const methodOrder = ["phast_unknown", "phnn_observer", "s5", "transformer"];
  const rows = state.scalingData.optimization.values;
  const means = rows.map((row) => row.mean);
  const minLog = Math.log10(Math.min(...means)) - .12;
  const maxLog = Math.log10(Math.max(...means)) + .12;
  const x = (epoch) => margin.left + epochs.indexOf(epoch) / (epochs.length - 1) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (maxLog - Math.log10(Math.max(value, 1e-8))) / (maxLog - minLog) * (height - margin.top - margin.bottom);
  const ticks = Array.from({ length: 5 }, (_, index) => maxLog - index * (maxLog - minLog) / 4);
  const grid = ticks.map((tick) => {
    const gy = margin.top + (maxLog - tick) / (maxLog - minLog) * (height - margin.top - margin.bottom);
    return `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${gy}" y2="${gy}"/><text class="plot-label" x="${margin.left - 12}" y="${gy + 6}" text-anchor="end">${formatScore(10 ** tick)}</text>`;
  }).join("");
  const series = methodOrder.map((methodId) => {
    const values = epochs.map((epoch) => rows.find((row) => row.method === methodId && row.epochs === epoch));
    const path = values.map((value, index) => `${index ? "L" : "M"}${x(value.epochs)},${y(value.mean)}`).join(" ");
    const marks = values.map((value) => {
      const low = Math.max(value.mean - value.std, 1e-8);
      const high = value.mean + value.std;
      return `<line class="scaling-error" stroke="${SCALING_COLORS[methodId]}" x1="${x(value.epochs)}" x2="${x(value.epochs)}" y1="${y(high)}" y2="${y(low)}"/><line class="scaling-error" stroke="${SCALING_COLORS[methodId]}" x1="${x(value.epochs) - 5}" x2="${x(value.epochs) + 5}" y1="${y(high)}" y2="${y(high)}"/><line class="scaling-error" stroke="${SCALING_COLORS[methodId]}" x1="${x(value.epochs) - 5}" x2="${x(value.epochs) + 5}" y1="${y(low)}" y2="${y(low)}"/><circle class="scaling-point" fill="${SCALING_COLORS[methodId]}" cx="${x(value.epochs)}" cy="${y(value.mean)}" r="6"/>`;
    }).join("");
    return `<path class="plot-line" stroke="${SCALING_COLORS[methodId]}" d="${path}"/>${marks}`;
  }).join("");
  const xLabels = epochs.map((epoch) => `<text class="plot-label" x="${x(epoch)}" y="${height - 54}" text-anchor="middle">${epoch}</text>`).join("");
  const legendGap = 190;
  const legend = methodOrder.map((methodId, index) => `<g transform="translate(${margin.left + index * legendGap},${height - 16})"><line x2="22" stroke="${SCALING_COLORS[methodId]}" stroke-width="4"/><text class="plot-label" x="29" y="6">${escapeText(scalingMethod(methodId).label)}</text></g>`).join("");
  svg.innerHTML = `${grid}<line class="plot-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"/>${series}${xLabels}${legend}`;
}

function renderOptimizationScalingTable() {
  const rows = state.scalingData.optimization.values;
  const methodOrder = ["phast_unknown", "phnn_observer", "s5", "transformer"];
  const epochs = [50, 100, 200];
  const body = methodOrder.map((methodId) => {
    const values = epochs.map((epoch) => rows.find((row) => row.method === methodId && row.epochs === epoch));
    const gain = values[0].mean / values[2].mean;
    return `<tr><th scope="row"><span class="method-swatch" style="--swatch:${SCALING_COLORS[methodId]}"></span>${escapeText(scalingMethod(methodId).label)}</th>${values.map((value) => `<td>${formatScore(value.mean)} <small>+/- ${formatScore(value.std)}</small></td>`).join("")}<td><strong>${gain.toFixed(1)}x</strong></td></tr>`;
  }).join("");
  byId("optimization-scaling-table").innerHTML = `<table class="scaling-table compact-scaling-table"><thead><tr><th scope="col">Model</th>${epochs.map((epoch) => `<th scope="col">${epoch} epochs</th>`).join("")}<th scope="col">50 to 200</th></tr></thead><tbody>${body}</tbody></table>`;
}

function scalingCell(rows, excitation, nTrain, hiddenDim) {
  return rows.find((row) => row.excitation === excitation && row.n_train === nTrain && row.hidden_dim === hiddenDim);
}

function boundedForecast(excitation, nTrain, hiddenDim) {
  return scalingCell(state.scalingData.forecast, excitation, nTrain, hiddenDim).values
    .find((value) => value.method === "phast_partial_bounded");
}

function boundedRecovery(excitation, nTrain, hiddenDim) {
  return scalingCell(state.scalingData.recovery, excitation, nTrain, hiddenDim).bounded;
}

function scalingAxisSpecification(axis) {
  const excitationName = (excitation) => excitation === "narrow"
    ? "narrow excitation (momentum scale 0.35)"
    : "broad excitation (momentum scale 4.0)";
  if (axis === "data") {
    return {
      question: "Does adding trajectories improve both long-horizon prediction and recovery of the damping law?",
      fixed: "Bounded PHAST, width 64, 50 epochs, 160 samples per trajectory; narrow and broad excitation are shown separately.",
      xLabel: "training trajectories",
      xValues: [64, 256],
      series: ["narrow", "broad"].map((excitation, index) => ({
        label: excitationName(excitation),
        color: index ? SCALING_COLORS.s5 : SCALING_COLORS.phast_partial_bounded,
        forecast: [64, 256].map((nTrain) => boundedForecast(excitation, nTrain, 64).mean),
        recovery: [64, 256].map((nTrain) => boundedRecovery(excitation, nTrain, 64).mean),
      })),
      interpretation: "Increasing the number of trajectories lowers narrow-regime forecast error from 0.0949 to 0.0425 and raises damping recovery from -0.190 to +0.097. Under broad excitation, recovery improves from +0.017 to +0.437, but rollout error rises from 0.107 to 0.164. More trajectories do not erase the cost of covering a harder physical regime.",
      caption: "Changing the number of training trajectories at fixed trajectory length and width. Left: H=100 rollout MSE (lower is better). Right: damping R² (higher is better).",
    };
  }
  if (axis === "excitation") {
    return {
      question: "Does observing a wider range of motion make the physical law easier to recover?",
      fixed: "Bounded PHAST, width 64, 50 epochs; N=64 and N=256 are shown separately.",
      xLabel: "initial-momentum regime",
      xValues: ["narrow (0.35)", "broad (4.0)"],
      series: [64, 256].map((nTrain, index) => ({
        label: `N=${nTrain}`,
        color: index ? SCALING_COLORS.phast_partial_bounded : SCALING_COLORS.phnn_observer,
        forecast: ["narrow", "broad"].map((excitation) => boundedForecast(excitation, nTrain, 64).mean),
        recovery: ["narrow", "broad"].map((excitation) => boundedRecovery(excitation, nTrain, 64).mean),
      })),
      interpretation: "Broad excitation makes the forecasting task harder, yet it makes damping substantially more recoverable. At N=256, rollout error changes from 0.0425 to 0.164 while damping R² rises from +0.097 to +0.437. Forecast accuracy and physical identification therefore move in opposite directions.",
      caption: "Changing the range of observed initial momenta at fixed width. The same intervention has different effects on prediction and identification.",
    };
  }
  if (axis === "width") {
    return {
      question: "Is neural capacity the limiting factor in this study?",
      fixed: "Bounded PHAST, N=256, 50 epochs; narrow and broad excitation are shown separately.",
      xLabel: "hidden width",
      xValues: [32, 64],
      series: ["narrow", "broad"].map((excitation, index) => ({
        label: excitationName(excitation),
        color: index ? SCALING_COLORS.s5 : SCALING_COLORS.phast_partial_bounded,
        forecast: [32, 64].map((width) => boundedForecast(excitation, 256, width).mean),
        recovery: [32, 64].map((width) => boundedRecovery(excitation, 256, width).mean),
      })),
      interpretation: "Doubling width barely changes rollout error: 0.0429 to 0.0425 under narrow excitation and 0.163 to 0.164 under broad excitation. Recovery improves modestly. In this range, neural capacity is not the primary forecasting bottleneck.",
      caption: "Changing hidden width at fixed data volume. Forecasting is nearly flat, while damping recovery improves modestly.",
    };
  }
  return {
    question: "Does PHAST's forecasting advantage disappear when every model trains longer?",
    fixed: "Separate strict UNKNOWN study, N=1000, five model seeds; no physical components are supplied.",
    xLabel: "training epochs",
    xValues: [50, 100, 200],
    interpretation: "PHAST-UNKNOWN improves from 0.114 at 50 epochs to 0.0181 at 200 epochs, a 6.3x reduction. Longer training strengthens rather than removes its advantage in this study; this is evidence about optimization sensitivity, not a general scaling law.",
    caption: "H=100 windy-pendulum rollout error under a strict UNKNOWN contract. Lines show means and bars show one standard deviation.",
  };
}

function panelMarkup({ x, y, width, height, title, subtitle, xValues, series, format, includeZero = false, logScale = false }) {
  const allValues = series.flatMap((item) => item.values);
  let minValue = includeZero ? Math.min(0, ...allValues) : 0;
  let maxValue = Math.max(...allValues);
  if (logScale) {
    minValue = Math.log10(Math.min(...allValues)) - .12;
    maxValue = Math.log10(maxValue) + .12;
  } else {
    const span = Math.max(maxValue - minValue, .001);
    minValue -= includeZero ? span * .12 : 0;
    maxValue += span * .18;
  }
  const left = x + 58;
  const right = x + width - 18;
  const top = y + 54;
  const bottom = y + height - 56;
  const px = (index) => xValues.length === 1 ? (left + right) / 2 : left + index / (xValues.length - 1) * (right - left);
  const transformed = (value) => logScale ? Math.log10(value) : value;
  const py = (value) => top + (maxValue - transformed(value)) / (maxValue - minValue) * (bottom - top);
  const tickPositions = Array.from({ length: 4 }, (_, index) => minValue + index * (maxValue - minValue) / 3);
  const ticks = tickPositions.map((value) => logScale ? 10 ** value : value);
  const grid = ticks.map((value) => `<line class="axis-grid" x1="${left}" x2="${right}" y1="${py(value)}" y2="${py(value)}"/><text class="axis-tick" x="${left - 10}" y="${py(value) + 4}" text-anchor="end">${format(value)}</text>`).join("");
  const zero = !logScale && includeZero && minValue < 0 && maxValue > 0 ? `<line class="axis-zero" x1="${left}" x2="${right}" y1="${py(0)}" y2="${py(0)}"/>` : "";
  const paths = series.map((item, seriesIndex) => {
    const path = item.values.map((value, index) => `${index ? "L" : "M"}${px(index)},${py(value)}`).join(" ");
    const points = item.values.map((value, index) => `<circle class="axis-point" cx="${px(index)}" cy="${py(value)}" r="5" fill="${item.color}"/><text class="axis-value" x="${px(index)}" y="${py(value) + (seriesIndex % 2 ? -10 : 18)}" text-anchor="middle">${format(value)}</text>`).join("");
    return `<path class="axis-series" stroke="${item.color}" d="${path}"/>${points}`;
  }).join("");
  const labels = xValues.map((value, index) => `<text class="axis-x-label" x="${px(index)}" y="${bottom + 30}" text-anchor="middle">${escapeText(value)}</text>`).join("");
  return `<g><text class="axis-panel-title" x="${x}" y="${y + 17}">${escapeText(title)}</text><text class="axis-panel-subtitle" x="${x}" y="${y + 36}">${escapeText(subtitle)}</text>${grid}${zero}<line class="axis-baseline" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/>${paths}${labels}</g>`;
}

function renderMatchedAxisPlot(specification) {
  const leftSeries = specification.series.map((item) => ({ label: item.label, color: item.color, values: item.forecast }));
  const rightSeries = specification.series.map((item) => ({ label: item.label, color: item.color, values: item.recovery }));
  const legend = specification.series.map((item, index) => `<g transform="translate(${335 + index * 190},366)"><line x2="24" stroke="${item.color}" stroke-width="3"/><text class="axis-legend" x="32" y="4">${escapeText(item.label)}</text></g>`).join("");
  byId("scaling-axis-plot").innerHTML = `${panelMarkup({ x: 22, y: 10, width: 440, height: 330, title: "Forecasting", subtitle: "H=100 rollout MSE · lower is better", xValues: specification.xValues, series: leftSeries, format: (value) => value.toFixed(3) })}${panelMarkup({ x: 502, y: 10, width: 436, height: 330, title: "Physical recovery", subtitle: "damping R² · higher is better", xValues: specification.xValues, series: rightSeries, format: (value) => formatSigned(value, 2), includeZero: true })}${legend}`;
}

function renderOptimizationAxisPlot() {
  const rows = state.scalingData.optimization.values;
  const methodOrder = ["phast_unknown", "phnn_observer", "s5", "transformer"];
  const epochs = [50, 100, 200];
  const series = methodOrder.map((method) => ({
    label: scalingMethod(method).label,
    color: SCALING_COLORS[method],
    values: epochs.map((epoch) => rows.find((row) => row.method === method && row.epochs === epoch).mean),
  }));
  const legend = series.map((item, index) => `<g transform="translate(${90 + index * 205},366)"><line x2="24" stroke="${item.color}" stroke-width="3"/><text class="axis-legend" x="32" y="4">${escapeText(item.label)}</text></g>`).join("");
  byId("scaling-axis-plot").innerHTML = `${panelMarkup({ x: 45, y: 10, width: 870, height: 330, title: "Optimization sensitivity", subtitle: "H=100 rollout MSE · logarithmic axis · lower is better", xValues: epochs, series, format: (value) => value.toFixed(value < .1 ? 3 : 2), logScale: true })}${legend}`;
}

function renderScalingAxisTable(specification) {
  if (state.scalingAxis === "optimization") {
    const rows = state.scalingData.optimization.values;
    const epochs = [50, 100, 200];
    const methods = ["phast_unknown", "phnn_observer", "s5", "transformer"];
    byId("scaling-axis-table").innerHTML = `<table><thead><tr><th>Method</th>${epochs.map((epoch) => `<th>${epoch} epochs</th>`).join("")}<th>Reduction</th></tr></thead><tbody>${methods.map((method) => {
      const values = epochs.map((epoch) => rows.find((row) => row.method === method && row.epochs === epoch));
      return `<tr><th>${escapeText(scalingMethod(method).label)}</th>${values.map((value) => `<td>${formatScore(value.mean)} <small>+/- ${formatScore(value.std)}</small></td>`).join("")}<td>${(values[0].mean / values[2].mean).toFixed(1)}x</td></tr>`;
    }).join("")}</tbody></table>`;
    return;
  }
  const rows = specification.series.flatMap((item) => specification.xValues.map((xValue, index) => `<tr><th>${escapeText(item.label)}</th><td>${escapeText(xValue)}</td><td>${formatScore(item.forecast[index])}</td><td>${formatSigned(item.recovery[index])}</td></tr>`)).join("");
  byId("scaling-axis-table").innerHTML = `<table><thead><tr><th>Condition</th><th>${escapeText(specification.xLabel)}</th><th>H=100 MSE</th><th>Damping R²</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderScalingAxisReader() {
  const specification = scalingAxisSpecification(state.scalingAxis);
  document.querySelectorAll("[data-scaling-axis]").forEach((button) => button.setAttribute("aria-selected", button.dataset.scalingAxis === state.scalingAxis ? "true" : "false"));
  byId("scaling-axis-question").textContent = specification.question;
  byId("scaling-axis-fixed").textContent = specification.fixed;
  byId("scaling-axis-interpretation").textContent = specification.interpretation;
  byId("scaling-axis-caption").textContent = specification.caption;
  if (state.scalingAxis === "optimization") renderOptimizationAxisPlot();
  else renderMatchedAxisPlot(specification);
  renderScalingAxisTable(specification);
}

function renderScalingFindings() {
  const forecast = state.scalingData.forecast;
  const recovery = state.scalingData.recovery;
  const narrowSmall = scalingCell(forecast, "narrow", 64, 64).values.find((value) => value.method === "phast_partial_bounded").mean;
  const narrowLarge = scalingCell(forecast, "narrow", 256, 64).values.find((value) => value.method === "phast_partial_bounded").mean;
  const broadRecovery = scalingCell(recovery, "broad", 256, 64).bounded.mean;
  const narrowRecovery = scalingCell(recovery, "narrow", 256, 64).bounded.mean;
  const broadWidth32 = scalingCell(forecast, "broad", 256, 32).values.find((value) => value.method === "phast_partial_bounded").mean;
  const broadWidth64 = scalingCell(forecast, "broad", 256, 64).values.find((value) => value.method === "phast_partial_bounded").mean;

  byId("scaling-findings").innerHTML = `
    <article><span>Number of trajectories</span><h4>More trajectories improve the familiar regime.</h4><p>At fixed $T_{\\mathrm{traj}}=160$, increasing $N_{\\mathrm{traj}}$ from 64 to 256 lowers bounded-PHAST error from ${formatScore(narrowSmall)} to ${formatScore(narrowLarge)}. Scaling with trajectory length remains unmeasured.</p></article>
    <article><span>Excitation</span><h4>Recovery needs informative motion.</h4><p>At $N=256$ and width 64, broad excitation raises damping $R_D^2$ from ${formatSigned(narrowRecovery)} to ${formatSigned(broadRecovery)}, although its rollout is harder.</p></article>
    <article><span>Capacity</span><h4>Width is not the limiting axis here.</h4><p>At broad excitation and $N=256$, width 32 and 64 give nearly identical errors: ${formatScore(broadWidth32)} and ${formatScore(broadWidth64)}.</p></article>
    <article><span>Boundary</span><h4>Bounds improve attribution, not uniqueness.</h4><p>The best $R_D^2$ is ${formatSigned(broadRecovery)}. The experiment supports conditional recovery, not general identifiability from positions.</p></article>`;
}

function renderScalingProvenance() {
  const data = state.scalingData;
  byId("scaling-provenance").innerHTML = `
    <p><strong>Matched 50-epoch study.</strong> Windy pendulum, $K=${data.study.history}$, $H=${data.study.horizon}$, data seed ${data.study.data_seed}, and ${data.study.model_seeds} model seeds. Narrow and broad initial-momentum distributions are crossed with $N\\in\\{64,256\\}$ and width $\\in\\{32,64\\}$.</p>
    <p><strong>Recovery contract.</strong> Potential, mass, chart, damping floor ${data.study.damping_floor}, and damping-variation cap ${data.study.damping_variation_cap} are declared. The position-dependent PSD damping is learned.</p>
    <pre>conda run -n math python scripts/run_phast_dissipation_scaling.py --profile pilot
conda run -n math python scripts/run_phast_dissipation_scaling.py --profile bounded_pilot</pre>
    <p><strong>Artifacts.</strong> <code>${escapeText(data.provenance.forecast_source)}</code> and <code>${escapeText(data.provenance.bounded_source)}</code>. The optimization curves come from <code>${escapeText(data.provenance.optimization_source)}</code>.</p>
    <p>${escapeText(data.provenance.note)}</p>`;
}

function renderScalingStudy() {
  renderFullForecastScaling();
  renderScalingAxisReader();
  renderRecoveryScaling();
  renderOptimizationScalingTable();
  renderScalingFindings();
  renderScalingProvenance();
}

function renderSystem() {
  const system = currentSystem();
  state.step = 0;
  applyComparisonMethods();
  document.querySelectorAll("[data-system]").forEach((button) => {
    button.setAttribute("aria-selected", Number(button.dataset.system) === state.systemIndex ? "true" : "false");
  });
  byId("time-scrubber").value = 0;
  byId("step-output").value = 1;
  byId("system-question").textContent = system.question;
  byId("findings-system").textContent = `Active system · ${system.label} · ${system.claim}`;
  const localMeans = system.methods.map((method) => ({
    method,
    mean: method.error_by_step.reduce((sum, value) => sum + value, 0) / method.error_by_step.length,
  })).sort((left, right) => left.mean - right.mean);
  const localBest = localMeans[0];
  const phastLocal = localMeans.find(({ method }) => method.id === "phast_unknown_qonly");
  const localReading = localBest.method.id === "phast_unknown_qonly"
    ? `PHAST also has the lowest mean step error on this displayed trajectory (${formatScore(phastLocal.mean)}).`
    : `${shortLabel(localBest.method.id)} is closer on this displayed trajectory (${formatScore(localBest.mean)} versus PHAST ${formatScore(phastLocal.mean)}); the five-seed table below is the benchmark result.`;
  byId("selection-note").textContent = `${system.selection}; held-out trajectory index ${system.trajectory_index}. ${localReading}`;
  const select = byId("coordinate-select");
  const labels = coordinateLabels(system);
  const requestedCoordinate = state.initialCoordinate === null ? 0 : state.initialCoordinate;
  state.coordinate = Math.min(requestedCoordinate, labels.length - 1);
  state.initialCoordinate = null;
  select.innerHTML = labels.map((label, index) => `<option value="${index}">${escapeText(label)}</option>`).join("");
  select.value = String(state.coordinate);
  drawHeroRollout();
  renderEquationTerm();
  renderMethodFilter();
  renderMotionPanels();
  renderScoreTable();
  renderSubmittedScoreTable();
  renderActiveResult();
  renderInterpretation();
  renderProvenance();
  drawPlots();
  renderMechanismEvidence();
}

function advance() {
  state.step = (state.step + 1) % 100;
  byId("time-scrubber").value = state.step;
  byId("step-output").value = state.step + 1;
  drawScenes();
  drawPlots();
}

function restartTimer() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = state.playing ? window.setInterval(advance, state.interval) : null;
}

function wireControls() {
  const selectSystem = (index) => {
    document.querySelectorAll("[data-system]").forEach((candidate) => {
      candidate.setAttribute("aria-selected", Number(candidate.dataset.system) === index ? "true" : "false");
    });
    state.systemIndex = index;
    renderSystem();
    writeViewState();
  };
  document.querySelectorAll("[data-system]").forEach((button) => {
    button.addEventListener("click", () => {
      selectSystem(Number(button.dataset.system));
    });
  });
  document.querySelectorAll("[data-summary-system]").forEach((link) => {
    link.addEventListener("click", () => selectSystem(Number(link.dataset.summarySystem)));
  });
  byId("play-toggle").addEventListener("click", () => {
    state.playing = !state.playing;
    byId("play-toggle").textContent = state.playing ? "Pause" : "Play";
    restartTimer();
  });
  byId("time-scrubber").addEventListener("input", (event) => {
    state.step = Number(event.target.value);
    byId("step-output").value = state.step + 1;
    drawScenes();
    drawPlots();
  });
  byId("speed-control").addEventListener("change", (event) => {
    state.interval = Number(event.target.value);
    restartTimer();
  });
  byId("coordinate-select").addEventListener("change", (event) => {
    state.coordinate = Number(event.target.value);
    drawHeroRollout();
    drawPlots();
    writeViewState();
  });
  document.querySelectorAll("[data-equation-term]").forEach((button) => {
    button.addEventListener("click", () => {
      state.equationTerm = button.dataset.equationTerm;
      renderEquationTerm();
      writeViewState();
    });
  });
  document.querySelectorAll("[data-scaling-axis]").forEach((button) => {
    button.addEventListener("click", () => {
      state.scalingAxis = button.dataset.scalingAxis;
      renderScalingAxisReader();
      writeViewState();
    });
  });
  document.querySelectorAll("[data-view-mechanism]").forEach((link) => {
    link.addEventListener("click", () => {
      state.mechanism = link.dataset.viewMechanism;
      renderMechanismTabs();
      renderMechanismEvidence();
      writeViewState();
    });
  });
  byId("copy-view-link").addEventListener("click", async () => {
    writeViewState();
    await copyText(window.location.href);
    byId("copy-view-status").textContent = "Copied";
  });
  byId("copy-citation").addEventListener("click", async () => {
    await copyText(byId("citation-text").textContent.trim());
    byId("copy-citation-status").textContent = "Copied";
  });
  window.addEventListener("resize", () => {
    drawScenes();
    drawHeroRollout();
    drawEquationVisual();
  });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.playing = false;
    byId("play-toggle").textContent = "Play";
  }
}

async function init() {
  const [response, scalingResponse] = await Promise.all([
    fetch("data/comparison.json?v=7"),
    fetch("data/scaling.json?v=1"),
  ]);
  if (!response.ok) throw new Error(`Could not load comparison data (${response.status})`);
  if (!scalingResponse.ok) throw new Error(`Could not load scaling data (${scalingResponse.status})`);
  state.data = await response.json();
  state.scalingData = await scalingResponse.json();
  readViewState();
  renderResultSummary();
  renderSynthesisTable();
  renderCapabilityTable();
  renderMechanismTabs();
  renderScalingStudy();
  wireControls();
  renderSystem();
  restartTimer();
  if (typeof window.renderMathInElement === "function") {
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

init().catch((error) => {
  byId("system-question").textContent = error.message;
  console.error(error);
});
