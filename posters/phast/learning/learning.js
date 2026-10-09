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
  diagnosticData: null,
  systemIndex: 0,
  step: 0,
  playing: true,
  timer: null,
  interval: 120,
  coordinate: 0,
  mechanism: "dissipation",
  equationTerm: "R",
  scalingAxis: "excitation",
  diagnostic: "evidence",
  evidenceExcitation: "broad",
  evidenceSurfaceView: "synthesis",
  evidenceNTrain: null,
  evidenceSeqLen: null,
  uncertaintyTemperature: 0.1,
  uncertaintyNoise: 0.05,
  uncertaintyMethod: "fdt",
  continualArm: "finetune",
  closedLoopAxis: "measurement_noise",
  closedLoopMethod: "casimir_qonly_phast",
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

  const axes = new Set(["excitation", "width", "optimization"]);
  if (axes.has(params.get("axis"))) state.scalingAxis = params.get("axis");

  const diagnostics = new Set(state.diagnosticData.studies.map((item) => item.id));
  if (diagnostics.has(params.get("study"))) state.diagnostic = params.get("study");

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
  url.searchParams.set("study", state.diagnostic);
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

function formatCompact(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric)) return String(numeric);
  if (Math.abs(numeric) >= 1) return numeric.toFixed(2);
  return numeric.toFixed(3);
}

function formatScientific(value) {
  return Number(value).toExponential(2);
}

function formatDuration(seconds) {
  return seconds < 60 ? `${seconds.toFixed(0)} s` : `${(seconds / 60).toFixed(1)} min`;
}

function coordinateLabels(system) {
  if (system.scene === "pendulum") return ["angle theta"];
  if (system.scene === "double-pendulum") return ["angle theta 1", "angle theta 2"];
  return ["cart position x", "pole angle theta"];
}

function coordinateAxisLabel(system, coordinate) {
  if (system.scene === "pendulum") return "angle theta (rad)";
  if (system.scene === "double-pendulum") return `angle theta ${coordinate + 1} (rad)`;
  return coordinate === 0 ? "cart position x" : "pole angle theta (rad)";
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

function makeBandPath(values, spreads, xScale, yScale) {
  const upper = values.map((value, index) => `${index ? "L" : "M"}${xScale(index).toFixed(2)},${yScale(value + spreads[index]).toFixed(2)}`).join(" ");
  const lower = values.map((value, index) => `L${xScale(values.length - index - 1).toFixed(2)},${yScale(values[values.length - index - 1] - spreads[values.length - index - 1]).toFixed(2)}`).join(" ");
  return `${upper}${lower}Z`;
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
  const margin = { left: 82, right: 24, top: 28, bottom: 62 };
  if (!series.length) {
    svg.innerHTML = `<text class="plot-label" x="450" y="155" text-anchor="middle">Select at least one model above.</text>`;
    return;
  }
  const allValues = series.map((item) => item.values.flatMap((value, index) => {
    const spread = item.stdValues?.[index] || 0;
    if (!spread) return [value];
    return options.logY ? [Math.max(value - spread, 1e-9), value + spread] : [value - spread, value + spread];
  }));
  const [minY, maxY] = options.logY
    ? extent(allValues.map((values) => values.map((value) => Math.log10(Math.max(value, 1e-9)))))
    : extent(allValues);
  const n = Math.max(...series.map((item) => item.values.length));
  const x = (index) => margin.left + index / Math.max(1, n - 1) * (width - margin.left - margin.right);
  const yValue = (value) => options.logY ? Math.log10(Math.max(value, 1e-9)) : value;
  const ySpan = Math.max(maxY - minY, 1e-9);
  const y = (value) => margin.top + (maxY - yValue(value)) / ySpan * (height - margin.top - margin.bottom);
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const gy = margin.top + ratio * (height - margin.top - margin.bottom);
    const raw = maxY - ratio * (maxY - minY);
    const label = options.logY ? `10^${raw.toFixed(1)}` : raw.toFixed(2);
    return `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${gy}" y2="${gy}"/><text class="plot-label" x="${margin.left - 12}" y="${gy + 7}" text-anchor="end">${label}</text>`;
  }).join("");
  const bands = series.filter((item) => item.stdValues?.some((value) => value > 0)).map((item) => `<path class="plot-uncertainty" fill="${item.color}" d="${makeBandPath(item.values, item.stdValues, x, y)}"/>`).join("");
  const paths = series.map((item) => `<path class="plot-line" stroke="${item.color}" ${item.dash ? `stroke-dasharray="${item.dash}"` : ""} d="${makePath(item.values, x, y)}"/>`).join("");
  const zeroLine = options.zeroLine && minY <= 0 && maxY >= 0
    ? `<line class="plot-zero" x1="${margin.left}" x2="${width - margin.right}" y1="${y(0)}" y2="${y(0)}"/><text class="plot-zero-label" x="${width - margin.right}" y="${y(0) - 7}" text-anchor="end">${escapeText(options.zeroLabel || "zero")}</text>`
    : "";
  const cursorIndex = Math.min(state.step, n - 1);
  const cursor = options.cursor === false ? "" : `<line class="plot-cursor" x1="${x(cursorIndex)}" x2="${x(cursorIndex)}" y1="${margin.top}" y2="${height - margin.bottom}"/>${options.cursorLabel ? `<text class="plot-cursor-label" x="${x(cursorIndex) + 7}" y="${margin.top + 13}">${escapeText(options.cursorLabel(cursorIndex))}</text>` : ""}`;
  const legendGap = Math.min(145, (width - margin.left - margin.right) / Math.max(1, series.length));
  const legend = series.map((item, index) => `<g transform="translate(${margin.left + index * legendGap},${height - 12})"><line x2="24" stroke="${item.color}" stroke-width="4" ${item.dash ? `stroke-dasharray="${item.dash}"` : ""}/><text class="plot-label" x="31" y="7">${escapeText(item.label)}</text></g>`).join("");
  const xTitle = options.xLabel ? `<text class="plot-axis-title" x="${(margin.left + width - margin.right) / 2}" y="${height - 30}" text-anchor="middle">${escapeText(options.xLabel)}</text>` : "";
  const yTitle = options.yLabel ? `<text class="plot-axis-title" transform="translate(17 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)" text-anchor="middle">${escapeText(options.yLabel)}</text>` : "";
  svg.innerHTML = `${grid}${zeroLine}<line class="plot-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"/>${bands}${paths}${cursor}${xTitle}${yTitle}${legend}`;
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
      const labelLines = index === 0 ? ["Bounded", "non-orthogonal"] : ["Ordered + PSD init.", "+ power loss"];
      return `<circle class="metric-point" cx="${x}" cy="${cy}" r="7" fill="${colors[index]}"/>
        <text class="metric-value" x="${x}" y="${cy - 15}" text-anchor="middle">${formatScientific(row[metric.key])}</text>
        <text class="metric-name" x="${x}" y="248" text-anchor="middle"><tspan x="${x}">${escapeText(labelLines[0])}</tspan><tspan x="${x}" dy="14">${escapeText(labelLines[1])}</tspan></text>`;
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
    ...methods.map((method) => ({
      label: shortLabel(method.id),
      color: COLORS[method.id],
      dash: lineDash(method.id),
      values: method.prediction_mean.map((q) => q[coordinate]),
      stdValues: method.prediction_std.map((q) => q[coordinate]),
    })),
  ], { xLabel: "forecast step h", yLabel: coordinateAxisLabel(system, coordinate), cursorLabel: (index) => `h = ${index + 1}` });
  renderPlot(byId("error-plot"), methods.map((method) => ({
    label: shortLabel(method.id), color: COLORS[method.id], dash: lineDash(method.id), values: method.error_by_step_mean, stdValues: method.error_by_step_std,
  })), { logY: true, xLabel: "forecast step h", yLabel: "coordinate MSE", cursorLabel: (index) => `h = ${index + 1}` });
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
    })), { cursor: false, xLabel: "forecast step h", yLabel: "normalized dissipated power" });
    return;
  }
  if (state.mechanism === "passivity") {
    const methods = mechanismMethods().map(currentMethod).filter((method) => Array.isArray(method.native_energy_change_normalized));
    renderPlot(svg, methods.map((method) => ({
      label: shortLabel(method.id),
      color: COLORS[method.id],
      dash: lineDash(method.id),
      values: method.native_energy_change_normalized.map((value, index, values) => index === 0 ? 0 : value - values[index - 1]),
    })), { zeroLine: true, zeroLabel: "no energy increase", cursor: false, xLabel: "forecast step h", yLabel: "normalized finite-step delta H" });
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
  const takeaways = {
    dissipation: "PHAST and pHNN expose a dissipative channel; HNN cannot. This diagnostic does not isolate a PHAST-specific gain.",
    passivity: "On this rollout, PHAST and pHNN have no upward energy steps; HNN has 24 of 99.",
    spectral: "Ordering and anchoring reduce rollout error 3.2x and modal-power error 492x on LJ-3.",
    ports: "PHAST port feedback matches 100% oracle success with 6.8% lower reported mean effort.",
    efficiency: "At fixed rank r=2, the structured primitives scale near-linearly through n=256; end-to-end scaling remains untested.",
  };
  const evidenceScope = evidenceScopes[mechanism.id] || { level: "Evidence", scope: mechanism.evidence_type };
  byId("mechanism-level").textContent = evidenceScope.level;
  byId("mechanism-kind").textContent = evidenceScope.scope;
  byId("mechanism-evidence").dataset.evidenceLevel = mechanism.id;
  byId("mechanism-formula").textContent = formulaCallbacks[mechanism.id] || "";
  const hnn = currentMethod("hnn_observer_qonly");
  byId("mechanism-takeaway").textContent = mechanism.id === "passivity"
    ? `On this rollout, PHAST and pHNN have no upward energy steps; HNN has ${hnn.native_energy_increase_steps} of ${system.truth.length - 1}.`
    : takeaways[mechanism.id] || mechanism.interpretation;
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
    byId("mechanism-caption").textContent = "Finite-step change in stored energy, normalized within each model; values above zero are upward steps";
    plot.hidden = false;
    result.innerHTML = mechanismResultTable(
      ["Model", "Native channel", "Upward finite-step increments"],
      mechanismMethods().map(currentMethod).filter(Boolean).map((method) => [
        escapeText(shortLabel(method.id)),
        method.native_channels.psd_damping ? "Hamiltonian + PSD loss" : "Hamiltonian only",
        method.native_energy_increase_steps == null ? "not available" : `${method.native_energy_increase_steps} / ${system.truth.length - 1}`,
      ]),
    ) + `<p class="result-callout"><strong>How to read the plot:</strong> each point is one finite-step energy change. A point above zero is an energy increase; a point below zero is a loss. Compare signs and counts, not vertical magnitudes, because every learned Hamiltonian is normalized separately.</p><p class="result-caveat">This count describes the displayed finite-step rollout. PHAST's formal passivity claim is continuous-time; the full numerical map is not asserted to be unconditionally energy-monotone.</p>`;
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
    ) + `<p class="result-callout"><strong>Result:</strong> the learned PHAST port matches oracle success and uses 6.8% less reported mean control effort. This is a separate full-state control experiment, not the q-only rollout shown above.</p><p class="result-caveat">The exported artifact does not include effort units or trial dispersion, so the effort difference is descriptive rather than an uncertainty-aware superiority claim.</p>`;
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

function renderTrajectoryCaption() {
  const system = currentSystem();
  byId("trajectory-caption-title").textContent = "Mean forecast +/- 1 SD across five model seeds";
  byId("trajectory-caption-detail").textContent = `${coordinateAxisLabel(system, state.coordinate)} · same held-out motion for every model`;
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
      <th scope="row"><span>${escapeText(startingMotionName(cell.excitation))}</span><small>$N_{\\mathrm{train}}=${cell.n_train}$ · width ${cell.hidden_dim}</small></th>
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
      <th scope="row"><span>${escapeText(startingMotionName(cell.excitation))}</span><small>$N_{\\mathrm{train}}=${cell.n_train}$ · width 64</small></th>
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
      <th scope="row"><span>${escapeText(startingMotionName(excitation))}</span><small>$N_{\\mathrm{train}}=256$</small></th>
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
        <span>$N_{\\mathrm{train}}=${row.n_train}$ · width ${row.hidden_dim}</span>
        <strong>${formatSigned(value)}</strong>
        <small>+/- ${row.bounded.std.toFixed(3)}</small>
        <p>uncapped ${formatSigned(row.uncapped.mean, 1)}</p>
      </div>`;
    }).join("");
    return `<section class="recovery-group" aria-label="${escapeText(startingMotionName(excitation))} recovery">
      <header><h5>${escapeText(startingMotionName(excitation))}</h5><p>${escapeText(state.scalingData.study.excitation[excitation])}</p></header>
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

function startingMotionName(excitation, includeScale = false) {
  const label = excitation === "narrow" ? "small starting motion" : "large starting motion";
  if (!includeScale) return label;
  return `${label} (momentum scale ${excitation === "narrow" ? "0.35" : "4.0"})`;
}

function scalingAxisSpecification(axis) {
  if (axis === "excitation") {
    const seriesForTrainingSize = (nTrain, color) => ({
      label: `N_train=${nTrain}`,
      legendLabel: `fixed model: N_train=${nTrain}`,
      color,
      forecast: ["narrow", "broad"].map((excitation) => boundedForecast(excitation, nTrain, 64).mean),
      forecastStd: ["narrow", "broad"].map((excitation) => boundedForecast(excitation, nTrain, 64).std),
      recovery: ["narrow", "broad"].map((excitation) => boundedRecovery(excitation, nTrain, 64).mean),
      recoveryStd: ["narrow", "broad"].map((excitation) => boundedRecovery(excitation, nTrain, 64).std),
    });
    return {
      question: "Does starting the pendulum with more momentum reveal the damping law more clearly?",
      fixed: "Bounded PHAST, N_train=256, width 64, 50 epochs, and 160 samples per trajectory. Only initial momentum changes: scale 0.35 versus 4.0.",
      takeaway: "Larger starting motion reveals damping better, but the wider state range is harder to forecast.",
      xLabel: "range of starting motion",
      xValues: [
        { label: "Small momentum", detail: "initial scale = 0.35" },
        { label: "Large momentum", detail: "initial scale = 4.0" },
      ],
      series: [seriesForTrainingSize(256, SCALING_COLORS.phast_partial_bounded)],
      tableSeries: [
        seriesForTrainingSize(64, SCALING_COLORS.phnn_observer),
        seriesForTrainingSize(256, SCALING_COLORS.phast_partial_bounded),
      ],
      interpretation: "Larger starting momentum makes the trajectories harder to forecast, but it reveals substantially more about damping. At N_train=256, rollout error changes from 0.0425 to 0.164 while damping R² rises from +0.097 to +0.437. Forecast accuracy and physical identification therefore move in opposite directions.",
      caption: "The left and right panels evaluate the same two starting-motion conditions. Each pair compares small initial momentum (scale 0.35) with large initial momentum (scale 4.0); the points are independent evaluations, not a time trajectory.",
    };
  }
  if (axis === "width") {
    return {
      question: "Is neural capacity the limiting factor in this study?",
      fixed: "Bounded PHAST, N_train=256, 50 epochs; small and large starting-motion ranges are shown separately.",
      takeaway: "No clear width effect appears from 32 to 64; observed recovery changes overlap seed variation.",
      xLabel: "hidden width",
      xValues: [{ label: "Width 32", detail: "hidden units" }, { label: "Width 64", detail: "hidden units" }],
      series: ["narrow", "broad"].map((excitation, index) => ({
        label: startingMotionName(excitation, true),
        color: index ? SCALING_COLORS.s5 : SCALING_COLORS.phast_partial_bounded,
        forecast: [32, 64].map((width) => boundedForecast(excitation, 256, width).mean),
        forecastStd: [32, 64].map((width) => boundedForecast(excitation, 256, width).std),
        recovery: [32, 64].map((width) => boundedRecovery(excitation, 256, width).mean),
        recoveryStd: [32, 64].map((width) => boundedRecovery(excitation, 256, width).std),
      })),
      interpretation: "Doubling width barely changes rollout error: 0.0429 to 0.0425 for small starting motions and 0.163 to 0.164 for large starting motions. The damping-recovery intervals overlap across seeds, so this experiment does not establish a width effect.",
      caption: "Two measured widths at fixed data volume. Forecasting is nearly flat, and damping-recovery changes are not separated from seed variation.",
    };
  }
  return {
    question: "Does PHAST's forecasting advantage disappear when every model receives a larger training budget?",
    fixed: "Separate strict UNKNOWN study, N_train=1000, five model seeds; no physical components are supplied. Each run retains its best validation checkpoint within the budget.",
    takeaway: "PHAST's advantage persists as the maximum epoch budget increases from 50 to 200.",
    xLabel: "maximum epoch budget",
    xValues: [50, 100, 200],
    interpretation: "PHAST-UNKNOWN improves from 0.114 at a 50-epoch budget to 0.0181 at a 200-epoch budget, a 6.3x reduction. This tests optimization sensitivity, not a general compute scaling law; the selected checkpoint can occur before the final epoch.",
    caption: "H=100 windy-pendulum rollout error under a strict UNKNOWN contract. Lines show means and bars show one standard deviation; each point uses the best validation checkpoint within its budget.",
  };
}

function panelMarkup({ x, y, width, height, title, subtitle, xValues, series, format, includeZero = false, logScale = false, connectSeries = true }) {
  const allValues = series.flatMap((item) => item.values.flatMap((value, index) => {
    const spread = item.stdValues?.[index] || 0;
    const lower = value - spread;
    return [logScale ? Math.max(lower, Number.EPSILON) : lower, value + spread];
  }));
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
  const right = x + width - 28;
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
    const points = item.values.map((value, index) => {
      const spread = item.stdValues?.[index] || 0;
      const low = logScale ? Math.max(value - spread, Number.EPSILON) : value - spread;
      const high = value + spread;
      const whisker = spread ? `<line class="axis-whisker" stroke="${item.color}" x1="${px(index)}" x2="${px(index)}" y1="${py(high)}" y2="${py(low)}"/><line class="axis-whisker" stroke="${item.color}" x1="${px(index) - 5}" x2="${px(index) + 5}" y1="${py(high)}" y2="${py(high)}"/><line class="axis-whisker" stroke="${item.color}" x1="${px(index) - 5}" x2="${px(index) + 5}" y1="${py(low)}" y2="${py(low)}"/>` : "";
      return `${whisker}<circle class="axis-point" cx="${px(index)}" cy="${py(value)}" r="5" fill="${item.color}"/><text class="axis-value" x="${px(index)}" y="${py(value) + (seriesIndex % 2 ? -12 : 20)}" text-anchor="middle">${format(value)}</text>`;
    }).join("");
    return `${connectSeries ? `<path class="axis-series" stroke="${item.color}" d="${path}"/>` : ""}${points}`;
  }).join("");
  const labels = xValues.map((value, index) => {
    const label = typeof value === "object" ? value.label : value;
    const detail = typeof value === "object" ? value.detail : "";
    return `<text class="axis-x-label" x="${px(index)}" y="${bottom + 25}" text-anchor="middle"><tspan class="axis-x-label-main" x="${px(index)}">${escapeText(label)}</tspan>${detail ? `<tspan class="axis-x-label-detail" x="${px(index)}" dy="15">${escapeText(detail)}</tspan>` : ""}</text>`;
  }).join("");
  return `<g><text class="axis-panel-title" x="${x}" y="${y + 17}">${escapeText(title)}</text><text class="axis-panel-subtitle" x="${x}" y="${y + 36}">${escapeText(subtitle)}</text>${grid}${zero}<line class="axis-baseline" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/>${paths}${labels}</g>`;
}

function renderMatchedAxisPlot(specification) {
  const leftSeries = specification.series.map((item) => ({ label: item.label, color: item.color, values: item.forecast, stdValues: item.forecastStd }));
  const rightSeries = specification.series.map((item) => ({ label: item.label, color: item.color, values: item.recovery, stdValues: item.recoveryStd }));
  const connectSeries = state.scalingAxis !== "excitation";
  byId("scaling-axis-legend").innerHTML = specification.series.map((item) => `<span style="--series-color:${item.color}">${escapeText(item.legendLabel || item.label)}</span>`).join("");
  byId("scaling-axis-note").textContent = `Each dot is the mean over ${state.scalingData.study.model_seeds} model seeds. Whiskers show +/- one standard deviation; data seed ${state.scalingData.study.data_seed} is fixed.`;
  byId("scaling-axis-plot").innerHTML = `${panelMarkup({ x: 22, y: 10, width: 440, height: 330, title: "Forecasting", subtitle: "H=100 rollout MSE · lower is better", xValues: specification.xValues, series: leftSeries, format: (value) => value.toFixed(3), connectSeries })}${panelMarkup({ x: 502, y: 10, width: 436, height: 330, title: "Physical recovery", subtitle: "damping R² · higher is better", xValues: specification.xValues, series: rightSeries, format: (value) => formatSigned(value, 2), includeZero: true, connectSeries })}`;
}

function renderOptimizationAxisPlot() {
  const rows = state.scalingData.optimization.values;
  const methodOrder = ["phast_unknown", "phnn_observer", "s5", "transformer"];
  const epochs = [50, 100, 200];
  const series = methodOrder.map((method) => ({
    label: scalingMethod(method).label,
    color: SCALING_COLORS[method],
    values: epochs.map((epoch) => rows.find((row) => row.method === method && row.epochs === epoch).mean),
    stdValues: epochs.map((epoch) => rows.find((row) => row.method === method && row.epochs === epoch).std),
  }));
  byId("scaling-axis-legend").innerHTML = series.map((item) => `<span style="--series-color:${item.color}">${escapeText(item.label)}</span>`).join("");
  byId("scaling-axis-note").textContent = `Each dot is the mean over ${state.scalingData.optimization.model_seeds} model seeds. Whiskers show +/- one standard deviation.`;
  const budgetLabels = epochs.map((epoch) => ({ label: String(epoch), detail: "epoch budget" }));
  byId("scaling-axis-plot").innerHTML = panelMarkup({ x: 45, y: 10, width: 870, height: 330, title: "Optimization sensitivity", subtitle: "H=100 rollout MSE · logarithmic axis · lower is better", xValues: budgetLabels, series, format: (value) => value.toFixed(value < .1 ? 3 : 2), logScale: true });
}

function renderScalingAxisTable(specification) {
  if (state.scalingAxis === "optimization") {
    const rows = state.scalingData.optimization.values;
    const epochs = [50, 100, 200];
    const methods = ["phast_unknown", "phnn_observer", "s5", "transformer"];
    byId("scaling-axis-table").innerHTML = `<table><thead><tr><th>Method</th>${epochs.map((epoch) => `<th>${epoch} epochs</th>`).join("")}<th>Reduction</th></tr></thead><tbody>${methods.map((method) => {
      const values = epochs.map((epoch) => rows.find((row) => row.method === method && row.epochs === epoch));
      return `<tr><th>${escapeText(scalingMethod(method).label)}</th>${values.map((value) => `<td>${formatScore(value.mean)} <small>+/- ${formatScore(value.std)}<br>median selected epoch ${value.median_best_epoch}</small></td>`).join("")}<td>${(values[0].mean / values[2].mean).toFixed(1)}x</td></tr>`;
    }).join("")}</tbody></table>`;
    return;
  }
  const tableSeries = specification.tableSeries || specification.series;
  const rows = tableSeries.flatMap((item) => specification.xValues.map((xValue, index) => {
    const condition = typeof xValue === "object" ? `${xValue.label} (${xValue.detail})` : xValue;
    return `<tr><th>${escapeText(item.label)}</th><td>${escapeText(condition)}</td><td>${formatScore(item.forecast[index])}</td><td>${formatSigned(item.recovery[index])}</td></tr>`;
  })).join("");
  byId("scaling-axis-table").innerHTML = `<table><thead><tr><th>Condition</th><th>${escapeText(specification.xLabel)}</th><th>Mean H=100 MSE</th><th>Mean damping R²</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderScalingAxisReader() {
  const specification = scalingAxisSpecification(state.scalingAxis);
  document.querySelectorAll("[data-scaling-axis]").forEach((button) => button.setAttribute("aria-selected", button.dataset.scalingAxis === state.scalingAxis ? "true" : "false"));
  byId("scaling-axis-question").textContent = specification.question;
  byId("scaling-axis-fixed").textContent = specification.fixed;
  byId("scaling-axis-takeaway").textContent = specification.takeaway;
  byId("scaling-axis-interpretation").textContent = specification.interpretation;
  byId("scaling-axis-caption").textContent = specification.caption;
  if (state.scalingAxis === "optimization") renderOptimizationAxisPlot();
  else renderMatchedAxisPlot(specification);
  renderScalingAxisTable(specification);
}

function renderScalingFindings() {
  const forecast = state.scalingData.forecast;
  const recovery = state.scalingData.recovery;
  const broadRecovery = scalingCell(recovery, "broad", 256, 64).bounded.mean;
  const narrowRecovery = scalingCell(recovery, "narrow", 256, 64).bounded.mean;
  const broadWidth32 = scalingCell(forecast, "broad", 256, 32).values.find((value) => value.method === "phast_partial_bounded").mean;
  const broadWidth64 = scalingCell(forecast, "broad", 256, 64).values.find((value) => value.method === "phast_partial_bounded").mean;

  byId("scaling-findings").innerHTML = `
    <article><span>Scope</span><h4>This is a hypothesis-forming pilot.</h4><p>Cross-cell data-volume claims are deferred to the nested, fixed-test $N\\times T$ surface in Section 5. The values here remain useful only for matched within-cell comparisons and the controlled axes shown above.</p></article>
    <article><span>Starting motion</span><h4>Recovery needs trajectories that visit informative states.</h4><p>At $N_{\\mathrm{train}}=256$ and width 64, increasing the initial-momentum scale from 0.35 to 4.0 raises damping $R_D^2$ from ${formatSigned(narrowRecovery)} to ${formatSigned(broadRecovery)}, although the wider-motion rollout is harder.</p></article>
    <article><span>Capacity</span><h4>Width is not the limiting axis here.</h4><p>For large starting motions and $N_{\\mathrm{train}}=256$, width 32 and 64 give nearly identical errors: ${formatScore(broadWidth32)} and ${formatScore(broadWidth64)}.</p></article>
    <article><span>Boundary</span><h4>Bounds improve attribution, not uniqueness.</h4><p>The best $R_D^2$ is ${formatSigned(broadRecovery)}. The experiment supports conditional recovery, not general identifiability from positions.</p></article>`;
}

function renderScalingProvenance() {
  const data = state.scalingData;
  byId("scaling-provenance").innerHTML = `
    <p><strong>Matched 50-epoch study.</strong> Windy pendulum, $K=${data.study.history}$, $H=${data.study.horizon}$, data seed ${data.study.data_seed}, and ${data.study.model_seeds} model seeds. Narrow and broad initial-momentum distributions are crossed with $N_{\\mathrm{train}}\\in\\{64,256\\}$ and width $\\in\\{32,64\\}$.</p>
    <p><strong>Recovery contract.</strong> Potential, mass, chart, damping floor ${data.study.damping_floor}, and damping-variation cap ${data.study.damping_variation_cap} are declared. The position-dependent PSD damping is learned.</p>
    <p><strong>Historical split caveat.</strong> The pilot regenerated each data-volume cell from the same seed, so its held-out trajectories were not identical across $N_{\\mathrm{train}}$. Do not read cross-$N$ differences as a scaling effect. The Section 5 surface supersedes that comparison with nested training prefixes and fixed validation/test trajectories.</p>
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

function diagnosticStudy() {
  return state.diagnosticData.studies.find((study) => study.id === state.diagnostic);
}

function diagnosticHeatFill(value, min, max, higherIsBetter) {
  const normalized = max === min ? .5 : (value - min) / (max - min);
  const score = higherIsBetter ? normalized : 1 - normalized;
  if (score >= .5) return `rgba(23, 111, 80, ${(.08 + score * .22).toFixed(3)})`;
  return `rgba(185, 75, 75, ${(.06 + (1 - score) * .18).toFixed(3)})`;
}

function renderEvidenceDiagnostic() {
  const study = diagnosticStudy();
  if (study.surface) {
    renderEvidenceSurface(study);
    return;
  }
  const runFor = (profile) => study.execution.runs.find((run) => run.profile === profile);
  const recovery = runFor("diagnostic_surface") || { complete: 0, expected: 80 };
  const forecast = runFor("diagnostic_forecast_surface") || { complete: 0, expected: 120 };
  const progress = (run, label, detail) => {
    const fraction = Math.min(1, run.complete / run.expected);
    return `<div class="surface-progress-row"><span>${label}</span><div aria-label="${label}: ${run.complete} of ${run.expected} cells complete"><i style="--progress:${(100 * fraction).toFixed(1)}%"></i></div><strong>${run.complete}/${run.expected}</strong><p>${detail}</p></div>`;
  };
  byId("diagnostic-visual").innerHTML = `<div class="surface-pending">
    <p class="diagnostic-matrix-note">Evidence gate</p>
    <h4>No $N\\times T$ conclusion is displayed until every preregistered cell is verified.</h4>
    <p>Training sets are nested prefixes. Every validation and test trajectory retains the same 320 samples in every cell, so only the training evidence changes with $T$. Partial means remain hidden to avoid selecting a favorable region while the matrix is incomplete.</p>
    <div class="surface-progress">
      ${progress(forecast, "Strict forecast", "PHAST-UNKNOWN, pHNN observer, and S5; five seeds per cell")}
      ${progress(recovery, "Damping recovery", "Bounded and uncapped PHAST-PARTIAL; five seeds per cell")}
    </div>
    <dl><div><dt>Trajectory count</dt><dd>32, 64, 128, 256, 512</dd></div><div><dt>Samples per trajectory</dt><dd>120, 160, 240, 320</dd></div><div><dt>Motion coverage</dt><dd>small and large starting momentum</dd></div><div><dt>Decision</dt><dd>A/B/C/D from forecast winner and damping R-squared above or below zero</dd></div></dl>
  </div>`;
}

function renderEvidenceSurface(study) {
  const surface = study.surface;
  const methodLabels = {
    phast_unknown: "PHAST",
    phnn_observer: "pHNN",
    s5: "S5",
  };
  const regions = {
    A: { label: "A · both", short: "forecast + recovery", detail: "PHAST forecasts best and recovers damping" },
    B: { label: "B · forecast only", short: "forecast only", detail: "PHAST forecasts best; damping recovery is below zero" },
    C: { label: "C · recovery only", short: "recovery only", detail: "Damping is recovered; another model forecasts better" },
    D: { label: "D · neither", short: "neither criterion", detail: "Neither criterion is met" },
  };
  const cellAt = (nTrain, seqLen) => surface.cells.find((cell) => (
    cell.excitation === state.evidenceExcitation
    && cell.n_train === nTrain
    && cell.seq_len === seqLen
  ));
  const regionFor = (cell) => {
    if (cell.region && regions[cell.region]) return cell.region;
    const forecast = cell.forecast_winner === "phast_unknown";
    const recovery = cell.recovery.bounded.mean > 0;
    if (forecast && recovery) return "A";
    if (forecast) return "B";
    if (recovery) return "C";
    return "D";
  };
  const selectedCells = surface.cells.filter((cell) => cell.excitation === state.evidenceExcitation);
  const recoveryMeans = surface.cells
    .filter((cell) => cell.excitation === state.evidenceExcitation)
    .map((cell) => cell.recovery.bounded.mean);
  const recoveryMin = Math.min(...recoveryMeans);
  const recoveryMax = Math.max(...recoveryMeans);
  const headers = `<div class="surface-corner"><span>T ↓ samples / trajectory</span><b>N → trajectories</b></div>${surface.n_train_values.map((nTrain) => `<div class="surface-axis-label">N=${nTrain}</div>`).join("")}`;
  const mapRows = surface.seq_len_values.map((seqLen) => {
    const cells = surface.n_train_values.map((nTrain) => {
      const cell = cellAt(nTrain, seqLen);
      const region = regionFor(cell);
      const budgetClass = cell.has_fixed_budget_peer ? "has-budget-peer" : "";
      if (state.evidenceSurfaceView === "forecast") {
        const winner = methodLabels[cell.forecast_winner];
        const phastWins = cell.forecast_winner === "phast_unknown";
        return `<button type="button" class="surface-cell surface-forecast ${phastWins ? "is-phast" : "is-baseline"} ${budgetClass}" data-surface-cell data-n-train="${nTrain}" data-seq-len="${seqLen}"><strong>${winner}</strong><small>${cell.forecast_winner_margin.toFixed(2)}x lower error</small></button>`;
      }
      if (state.evidenceSurfaceView === "recovery") {
        const value = cell.recovery.bounded.mean;
        return `<button type="button" class="surface-cell surface-recovery ${value > 0 ? "is-positive" : "is-negative"} ${budgetClass}" style="--surface-fill:${diagnosticHeatFill(value, recoveryMin, recoveryMax, true)}" data-surface-cell data-n-train="${nTrain}" data-seq-len="${seqLen}"><strong>${formatSigned(value, 2)}</strong><small>${value > 0 ? "above mean law" : "below mean law"}</small></button>`;
      }
      return `<button type="button" class="surface-cell surface-region-${region.toLowerCase()} ${budgetClass}" data-surface-cell data-n-train="${nTrain}" data-seq-len="${seqLen}"><strong>${regions[region].label}</strong><small>${regions[region].short}</small></button>`;
    }).join("");
    return `<div class="surface-axis-label">T=${seqLen}</div>${cells}`;
  }).join("");
  const controls = Object.entries(surface.excitations).map(([id, label]) => `<button type="button" data-surface-excitation="${id}" aria-selected="${id === state.evidenceExcitation}">${escapeText(label)}</button>`).join("");
  const viewLabels = { synthesis: "Conclusion", forecast: "Forecast", recovery: "Damping recovery" };
  const viewControls = Object.entries(viewLabels).map(([id, label]) => `<button type="button" data-surface-view="${id}" aria-selected="${id === state.evidenceSurfaceView}">${label}</button>`).join("");
  const regionCounts = Object.keys(regions).map((region) => `${region}: ${selectedCells.filter((cell) => regionFor(cell) === region).length}`).join(" · ");
  const mapHeadings = {
    synthesis: ["Where do both claims hold?", "A cell is positive only when PHAST wins the matched forecast comparison and bounded PHAST recovers more than a constant mean-damping law. A marked corner identifies a fixed-sample-budget comparison."],
    forecast: ["Who forecasts best?", "Lowest five-seed mean H=100 rollout error; the number is the margin over the second-best method."],
    recovery: ["Is the damping law recovered?", "Bounded-PHAST damping R-squared; zero equals a constant mean-damping law."],
  };
  const [mapTitle, mapDescription] = mapHeadings[state.evidenceSurfaceView];
  const regionKey = state.evidenceSurfaceView === "synthesis"
    ? `<div class="surface-region-key">${Object.entries(regions).map(([id, region]) => `<span class="surface-region-${id.toLowerCase()}"><b>${region.label}</b>${region.detail}</span>`).join("")}</div>`
    : "";
  const summarizeEffectList = (effects) => {
    if (!effects.length) return "pending";
    const count = (classification) => effects.filter((effect) => effect.classification === classification).length;
    return `${count("improves")}/${effects.length} improve · ${count("degrades")} degrade · ${count("not_resolved")} unresolved`;
  };
  const summarizeEffects = (axis, metric) => {
    const effects = (surface.endpoint_effects || []).filter((effect) => (
      effect.excitation === state.evidenceExcitation
      && effect.axis === axis
      && effect.metric === metric
    ));
    return summarizeEffectList(effects);
  };
  const summarizeFixedBudget = (metric) => {
    const effects = (surface.fixed_budget_effects || []).filter((effect) => (
      effect.excitation === state.evidenceExcitation
      && effect.metric === metric
    ));
    return summarizeEffectList(effects);
  };
  const effectSummary = surface.endpoint_effects ? `<div class="surface-effect-summary">
    <div><span>Endpoint comparison</span><b>PHAST forecast</b><b>Bounded recovery</b></div>
    <div><strong>More trajectories at 100 epochs<br><small>N=${surface.n_train_values[0]} to ${surface.n_train_values.at(-1)}, across T</small></strong><span>${summarizeEffects("n_train", "forecast")}</span><span>${summarizeEffects("n_train", "recovery")}</span></div>
    <div><strong>Longer trajectories<br><small>T=${surface.seq_len_values[0]} to ${surface.seq_len_values.at(-1)}, across N</small></strong><span>${summarizeEffects("seq_len", "forecast")}</span><span>${summarizeEffects("seq_len", "recovery")}</span></div>
    <div><strong>More, shorter trajectories at fixed samples<br><small>matched N×T pairs</small></strong><span>${summarizeFixedBudget("forecast")}</span><span>${summarizeFixedBudget("recovery")}</span></div>
    <p>Improvement or degradation requires the paired 95% seed interval to exclude zero; otherwise the endpoint effect is unresolved.</p>
  </div>` : "";
  byId("diagnostic-visual").innerHTML = `
    <div class="surface-reader">
      <div class="surface-excitation" role="group" aria-label="Choose starting-motion coverage">${controls}</div>
      <div class="surface-contracts">
        <p><span>Forecast contract</span>${escapeText(surface.forecast_contract)}</p>
        <p><span>Recovery contract</span>${escapeText(surface.recovery_contract)}</p>
      </div>
      <div class="surface-view-controls" role="group" aria-label="Choose map reading">${viewControls}</div>
      <p class="surface-counts"><span>Cells in this motion regime</span>${regionCounts}</p>
      ${regionKey}
      ${effectSummary}
      <section class="surface-map-frame"><header><h4>${mapTitle}</h4><p>${mapDescription}</p></header><div class="surface-map">${headers}${mapRows}</div></section>
      <div class="surface-cell-reading" id="surface-cell-reading" aria-live="polite"></div>
    </div>`;

  const showReading = (nTrain, seqLen) => {
    const cell = cellAt(nTrain, seqLen);
    state.evidenceNTrain = nTrain;
    state.evidenceSeqLen = seqLen;
    document.querySelectorAll("[data-surface-cell]").forEach((button) => button.setAttribute("aria-pressed", "false"));
    const active = document.querySelector(`[data-surface-cell][data-n-train="${nTrain}"][data-seq-len="${seqLen}"]`);
    active?.setAttribute("aria-pressed", "true");
    const trainingText = (result) => result.training_seconds
      ? `<small>training ${formatDuration(result.training_seconds.mean)} +/- ${formatDuration(result.training_seconds.std)}</small>`
      : "";
    const scores = ["phast_unknown", "phnn_observer", "s5"].map((method) => {
      const result = cell.forecast[method];
      return `<span><b>${methodLabels[method]}</b>${formatScore(result.mean)} +/- ${formatScore(result.std)}${trainingText(result)}</span>`;
    }).join("");
    const bounded = cell.recovery.bounded;
    const uncapped = cell.recovery.uncapped;
    const forecastEffect = cell.forecast_phast_effect;
    const boundEffect = cell.recovery.bound_effect;
    const intervalText = (effect) => effect
      ? `${formatSigned(effect.mean_gain, 3)} [${formatSigned(effect.ci95[0], 3)}, ${formatSigned(effect.ci95[1], 3)}] · ${effect.classification.replace("not_resolved", "unresolved")}`
      : "not computed";
    const region = regionFor(cell);
    const sampleBudget = cell.sample_budget ?? nTrain * seqLen;
    const budgetPeer = selectedCells.find((candidate) => (
      candidate.sample_budget === sampleBudget
      && (candidate.n_train !== nTrain || candidate.seq_len !== seqLen)
    ));
    const budgetReading = budgetPeer
      ? ` Same total sample budget as N=${budgetPeer.n_train}, T=${budgetPeer.seq_len}.`
      : " No other measured cell has the same total sample budget.";
    byId("surface-cell-reading").innerHTML = `<strong>N=${nTrain}, T=${seqLen}<small>${regions[region].label}</small></strong><p>${regions[region].detail}. Total observed training samples: ${sampleBudget.toLocaleString()}.${budgetReading} Every model receives 100 epochs. Increasing N adds optimizer steps; increasing N or T adds sample processing and wall time. Forecast and recovery use the two separate contracts stated above.</p><div class="surface-reading-groups"><section><em>Strict forecast</em>${scores}<span class="surface-contrast"><b>PHAST MSE advantage vs ${forecastEffect ? methodLabels[forecastEffect.baseline] : "best baseline"}</b>${intervalText(forecastEffect)}</span></section><section><em>Grey-box recovery</em><span><b>Bounded PHAST</b>${formatSigned(bounded.mean)} +/- ${bounded.std.toFixed(3)}${trainingText(bounded)}</span><span><b>Uncapped PHAST</b>${formatSigned(uncapped.mean)} +/- ${uncapped.std.toFixed(3)}${trainingText(uncapped)}</span><span class="surface-contrast"><b>Bounded minus uncapped R-squared</b>${intervalText(boundEffect)}</span></section></div>`;
  };
  document.querySelectorAll("[data-surface-excitation]").forEach((button) => button.addEventListener("click", () => {
    state.evidenceExcitation = button.dataset.surfaceExcitation;
    renderEvidenceSurface(study);
  }));
  document.querySelectorAll("[data-surface-view]").forEach((button) => button.addEventListener("click", () => {
    state.evidenceSurfaceView = button.dataset.surfaceView;
    renderEvidenceSurface(study);
  }));
  document.querySelectorAll("[data-surface-cell]").forEach((button) => button.addEventListener("click", () => {
    showReading(Number(button.dataset.nTrain), Number(button.dataset.seqLen));
  }));
  const selectedN = surface.n_train_values.includes(state.evidenceNTrain) ? state.evidenceNTrain : surface.n_train_values.at(-1);
  const selectedT = surface.seq_len_values.includes(state.evidenceSeqLen) ? state.evidenceSeqLen : surface.seq_len_values.at(-1);
  showReading(selectedN, selectedT);
}

function unwrapNear(value, reference) {
  let unwrapped = value;
  while (unwrapped - reference > Math.PI) unwrapped -= 2 * Math.PI;
  while (unwrapped - reference < -Math.PI) unwrapped += 2 * Math.PI;
  return unwrapped;
}

function unwrapAngleSeries(values, firstReference = null) {
  if (!values.length) return [];
  const first = firstReference === null ? values[0] : unwrapNear(values[0], firstReference);
  const output = [first];
  for (let index = 1; index < values.length; index += 1) {
    output.push(unwrapNear(values[index], output[index - 1]));
  }
  return output;
}

function calibrationFanChart(condition, method, label) {
  const rows = condition.methods[method].fan;
  const width = 900;
  const height = 330;
  const margin = { left: 70, right: 24, top: 24, bottom: 48 };
  const truth = unwrapAngleSeries(rows.map((row) => row.truth));
  const mean = unwrapAngleSeries(rows.map((row) => row.mean), truth[0]);
  const centers = rows.map((row, index) => unwrapNear(row.band.center, mean[index]));
  const lower = rows.map((row, index) => centers[index] - row.band.half_width);
  const upper = rows.map((row, index) => centers[index] + row.band.half_width);
  const minY = Math.min(...truth, ...mean, ...lower);
  const maxY = Math.max(...truth, ...mean, ...upper);
  const pad = Math.max((maxY - minY) * 0.08, 0.05);
  const low = minY - pad;
  const high = maxY + pad;
  const x = (index) => margin.left + index / Math.max(1, rows.length - 1) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (high - value) / Math.max(high - low, 1e-9) * (height - margin.top - margin.bottom);
  const path = (values) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const band = `${path(upper)} ${lower.map((value, index) => `L${x(lower.length - 1 - index).toFixed(2)},${y(lower[lower.length - 1 - index]).toFixed(2)}`).join(" ")} Z`;
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const value = high - ratio * (high - low);
    const gy = y(value);
    return `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${gy}" y2="${gy}"/><text class="plot-label" x="${margin.left - 10}" y="${gy + 5}" text-anchor="end">${value.toFixed(2)}</text>`;
  }).join("");
  const xTicks = [1, 50, 100, 150, 200].map((horizon) => {
    const index = horizon - 1;
    return `<text class="plot-label" x="${x(index)}" y="${height - 18}" text-anchor="middle">${horizon}</text>`;
  }).join("");
  return `<div class="calibration-chart calibration-fan"><header><div><span>One held-out future</span><h4>${escapeText(label)}</h4></div><p>Line: predictive circular mean · band: central 80% predictive mass</p></header><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(label)} predictive fan chart"><path class="calibration-band" d="${band}"/>${grid}<path class="plot-line" stroke="#11191d" d="${path(truth)}"/><path class="plot-line" stroke="#167251" d="${path(mean)}"/>${xTicks}<text class="plot-axis-title" x="${(margin.left + width - margin.right) / 2}" y="${height - 2}" text-anchor="middle">forecast horizon H</text></svg><div class="calibration-legend"><span class="is-truth">realized trajectory</span><span class="is-model">predictive mean</span><span class="is-band">80% predictive arc</span></div></div>`;
}

function calibrationMetricChart(condition, metric) {
  const methods = ["initial_state", "fdt", "oracle"];
  const colors = { initial_state: "#a9671b", fdt: "#167251", oracle: "#326fa6" };
  const labels = { initial_state: "initial state only", fdt: "PHAST + FDT", oracle: "oracle" };
  const rows = Object.fromEntries(methods.map((method) => [method, condition.methods[method].metrics]));
  const horizons = rows.fdt.map((row) => row.horizon);
  const values = Object.fromEntries(methods.map((method) => [method, rows[method].map((row) => (
    metric === "coverage" ? row.coverage["0.8"].mean : row.energy_score.mean
  ))]));
  const width = 440;
  const height = 270;
  const margin = { left: 58, right: 18, top: 22, bottom: 48 };
  const allValues = methods.flatMap((method) => values[method]);
  const low = metric === "coverage" ? 0 : Math.min(0, ...allValues);
  const high = metric === "coverage" ? 1 : Math.max(...allValues) * 1.08;
  const logMin = Math.log10(horizons[0]);
  const logMax = Math.log10(horizons.at(-1));
  const x = (horizon) => margin.left + (Math.log10(horizon) - logMin) / (logMax - logMin) * (width - margin.left - margin.right);
  const y = (value) => margin.top + (high - value) / Math.max(high - low, 1e-9) * (height - margin.top - margin.bottom);
  const path = (method) => values[method].map((value, index) => `${index ? "L" : "M"}${x(horizons[index]).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const gridValues = metric === "coverage" ? [0, .25, .5, .75, 1] : [0, .25, .5, .75, 1].map((ratio) => low + ratio * (high - low));
  const grid = gridValues.map((value) => `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}"/><text class="plot-label" x="${margin.left - 8}" y="${y(value) + 5}" text-anchor="end">${value.toFixed(2)}</text>`).join("");
  const target = metric === "coverage" ? `<rect class="calibration-target-band" x="${margin.left}" y="${y(.85)}" width="${width - margin.left - margin.right}" height="${y(.75) - y(.85)}"/><line class="calibration-target" x1="${margin.left}" x2="${width - margin.right}" y1="${y(.8)}" y2="${y(.8)}"/>` : "";
  const series = methods.map((method) => `<path class="plot-line" stroke="${colors[method]}" d="${path(method)}"/>${values[method].map((value, index) => `<circle cx="${x(horizons[index])}" cy="${y(value)}" r="3.2" fill="${colors[method]}"/>`).join("")}`).join("");
  const xTicks = horizons.map((horizon) => `<text class="plot-label" x="${x(horizon)}" y="${height - 20}" text-anchor="middle">${horizon}</text>`).join("");
  const title = metric === "coverage" ? "Does 80% mean 80%?" : "Is the predictive distribution useful?";
  const subtitle = metric === "coverage" ? "empirical coverage · target 0.80" : "circular energy score · lower is better";
  return `<div class="calibration-chart"><header><div><span>Five-seed aggregate</span><h4>${title}</h4></div><p>${subtitle}</p></header><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">${target}${grid}${series}${xTicks}<text class="plot-axis-title" x="${(margin.left + width - margin.right) / 2}" y="${height - 2}" text-anchor="middle">forecast horizon H · log spacing</text></svg><div class="calibration-legend">${methods.map((method) => `<span style="--legend-color:${colors[method]}">${labels[method]}</span>`).join("")}</div></div>`;
}

function renderUncertaintyDiagnostic(study) {
  const matched = study.matched_law;
  const before = matched.before_intervention;
  const after = matched.after_external_channel_removal;
  const cellOrder = ["thermal_only", "external_drift_only", "external_diffusion_only", "combined"];
  const channelMark = (active) => `<span class="channel-mark ${active ? "is-active" : ""}">${active ? "yes" : "no"}</span>`;
  const rows = cellOrder.map((cellId) => {
    const cell = study.cells[cellId];
    return `<tr>
      <th scope="row">${escapeText(cell.label)}</th>
      <td>${channelMark(cell.channels.thermal_noise)}</td>
      <td>${channelMark(cell.channels.external_drift)}</td>
      <td>${channelMark(cell.channels.external_diffusion)}</td>
      <td>${(100 * cell.max_covariance_relative_error).toFixed(2)}%</td>
      <td>${Math.max(cell.max_drift_z, cell.max_discrete_energy_z).toFixed(2)}</td>
    </tr>`;
  }).join("");
  const attribution = `<details class="attribution-secondary">
      <summary>Why a calibrated stochastic law still does not identify the noise source</summary>
      <div class="attribution-reader">
      <section class="matched-law">
        <p class="diagnostic-matrix-note">Decisive test</p>
        <div class="attribution-stage">
          <span>During training</span>
          <h4>Same observable transition law</h4>
          <p><i>b</i><sub>total</sub><sup>thermal</sup> = <i>b</i><sub>total</sub><sup>external</sup></p>
          <p><i>A</i><sub>total</sub><sup>thermal</sup> = <i>A</i><sub>total</sub><sup>external</sup></p>
          <small>maximum numerical gaps: drift ${formatScientific(before.maximum_drift_gap)}, covariance ${formatScientific(before.maximum_covariance_gap)}</small>
        </div>
        <div class="intervention-arrow" aria-hidden="true"><span>remove external shaker</span><b>&darr;</b></div>
        <div class="attribution-outcomes">
          <article>
            <span>Thermal hypothesis predicts</span>
            <strong>No change</strong>
            <p>drift ${formatCompact(after.thermal_hypothesis_drift_change)} · covariance ${formatCompact(after.thermal_hypothesis_covariance_change)}</p>
          </article>
          <article>
            <span>External-source hypothesis predicts</span>
            <strong>${(100 * after.external_source_relative_covariance_drop).toFixed(0)}% less covariance</strong>
            <p>mean drift changes by ${after.external_source_mean_drift_change.toFixed(3)}</p>
          </article>
        </div>
        <p class="attribution-conclusion"><strong>Observed answer:</strong> fitting the training law identifies total stochastic dynamics, not their physical source. The intervention supplies the missing evidence.</p>
      </section>
      <details class="attribution-checks">
        <summary>Inspect the four source-isolation checks</summary>
        <div class="capability-table-wrap"><table>
          <thead><tr><th>Cell</th><th>Thermal</th><th>External drift</th><th>External diffusion</th><th>Covariance error</th><th>Max |z|</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p>Each cell uses ${study.sampling.probe_seed_pairs_per_cell} probe/seed pairs and ${study.sampling.samples_per_probe.toLocaleString()} one-step samples per probe. “Max |z|” is the larger of the drift and discrete-energy deviations measured in standard errors.</p>
      </details>
      </div>
    </details>`;
  if (!study.calibration) {
    byId("diagnostic-visual").innerHTML = attribution;
    return;
  }
  const calibration = study.calibration;
  const temperatures = [...new Set(calibration.conditions.map((condition) => condition.process_temperature))];
  const noises = [...new Set(calibration.conditions.map((condition) => condition.observation_noise))];
  if (!temperatures.includes(state.uncertaintyTemperature)) state.uncertaintyTemperature = temperatures.at(-1);
  if (!noises.includes(state.uncertaintyNoise)) state.uncertaintyNoise = noises.at(-1);
  const condition = calibration.conditions.find((candidate) => (
    candidate.process_temperature === state.uncertaintyTemperature
    && candidate.observation_noise === state.uncertaintyNoise
  ));
  const methods = Object.keys(calibration.method_labels);
  if (!methods.includes(state.uncertaintyMethod)) state.uncertaintyMethod = "fdt";
  const h100 = Object.fromEntries(methods.map((method) => [
    method,
    condition.methods[method].metrics.find((row) => row.horizon === 100),
  ]));
  const metricRows = methods.map((method) => {
    const row = h100[method];
    return `<tr><th scope="row">${escapeText(calibration.method_labels[method])}</th><td>${row.coverage["0.8"].mean.toFixed(3)} +/- ${row.coverage["0.8"].std.toFixed(3)}</td><td>${row.width["0.8"].mean.toFixed(3)}</td><td>${row.energy_score.mean.toFixed(3)} +/- ${row.energy_score.std.toFixed(3)}</td></tr>`;
  }).join("");
  const temperatureControls = temperatures.map((value) => `<button type="button" data-uncertainty-temperature="${value}" aria-selected="${value === state.uncertaintyTemperature}">${value === 0 ? "none" : value.toFixed(2)}</button>`).join("");
  const noiseControls = noises.map((value) => `<button type="button" data-uncertainty-noise="${value}" aria-selected="${value === state.uncertaintyNoise}">${value === 0 ? "none" : value.toFixed(2)}</button>`).join("");
  const methodControls = methods.map((method) => `<button type="button" data-uncertainty-method="${method}" aria-selected="${method === state.uncertaintyMethod}">${escapeText(calibration.method_labels[method])}</button>`).join("");
  byId("diagnostic-visual").innerHTML = `<div class="calibration-reader">
      <div class="calibration-controls">
        <fieldset><legend>Process temperature</legend><div>${temperatureControls}</div></fieldset>
        <fieldset><legend>Measurement noise sigma</legend><div>${noiseControls}</div></fieldset>
      </div>
      <div class="calibration-takeaway"><span>Measured answer</span><p>At long horizons, FDT improves both score and coverage in <strong>${calibration.summary.long_cells}/${calibration.summary.long_cells}</strong> stochastic cells. It does not finish calibration: only <strong>${calibration.summary.nominal_cells}/${calibration.summary.stochastic_cells}</strong> FDT cells lie within 0.80 +/- 0.05 coverage.</p></div>
      <div class="calibration-methods" role="group" aria-label="Choose predictive fan">${methodControls}</div>
      ${calibrationFanChart(condition, state.uncertaintyMethod, calibration.method_labels[state.uncertaintyMethod])}
      <p class="calibration-note">${escapeText(calibration.fan_note)}</p>
      <div class="calibration-metrics">${calibrationMetricChart(condition, "coverage")}${calibrationMetricChart(condition, "energy")}</div>
      <div class="calibration-table-wrap"><table><caption>H=100 quantitative reading for the selected noise cell</caption><thead><tr><th>Uncertainty contract</th><th>80% coverage</th><th>Arc width</th><th>Energy score</th></tr></thead><tbody>${metricRows}</tbody></table></div>
    </div>${attribution}`;
  document.querySelectorAll("[data-uncertainty-temperature]").forEach((button) => button.addEventListener("click", () => {
    state.uncertaintyTemperature = Number(button.dataset.uncertaintyTemperature);
    renderUncertaintyDiagnostic(study);
  }));
  document.querySelectorAll("[data-uncertainty-noise]").forEach((button) => button.addEventListener("click", () => {
    state.uncertaintyNoise = Number(button.dataset.uncertaintyNoise);
    renderUncertaintyDiagnostic(study);
  }));
  document.querySelectorAll("[data-uncertainty-method]").forEach((button) => button.addEventListener("click", () => {
    state.uncertaintyMethod = button.dataset.uncertaintyMethod;
    renderUncertaintyDiagnostic(study);
  }));
}

function renderContinualDiagnostic(study) {
  if (study.matrices) {
    const armLabels = {
      frozen: "Frozen",
      finetune: "Fine-tune all",
      oracle_block: "Named block",
      replay: "Replay",
      joint_offline: "Joint offline",
      separate_experts: "Separate experts",
    };
    if (!study.arms.includes(state.continualArm)) state.continualArm = "finetune";
    const gate = study.competence_gate;
    const controls = study.arms.map((arm) => `<button type="button" data-continual-arm="${arm}" aria-selected="${arm === state.continualArm}">${escapeText(armLabels[arm] || arm)}</button>`).join("");
    const matrix = study.matrices[state.continualArm];
    const finite = Object.values(study.matrices).flat(2).map((cell) => cell?.h100_mean).filter((value) => Number.isFinite(value) && value > 0).map(Math.log10);
    const heatMin = Math.min(...finite);
    const heatMax = Math.max(...finite);
    const headers = `<div class="matrix-label">trained through</div>${study.columns.map((column) => `<div class="matrix-label">test: ${escapeText(column)}</div>`).join("")}`;
    const rows = study.rows.map((row, rowIndex) => `<div class="matrix-label">${escapeText(row)}</div>${study.columns.map((_, columnIndex) => {
      const cell = matrix[rowIndex][columnIndex];
      const fill = diagnosticHeatFill(Math.log10(cell.h100_mean), heatMin, heatMax, false);
      const randomReference = gate ? ` · ${Math.round(100 * cell.h100_mean / gate.random_phase_mse)}% ref.` : "";
      return `<div class="matrix-value ${cell.seen ? "" : "is-future"}" style="--heat-fill:${fill};background:var(--heat-fill)"><strong>${formatScore(cell.h100_mean)}</strong><small>H=100${randomReference}${cell.seen ? "" : " · not trained yet"}</small><small>1-step ${formatScore(cell.one_step_mean)}</small></div>`;
    }).join("")}`).join("");
    const summaryRows = study.arm_summary.map((item) => `<tr class="${item.arm === state.continualArm ? "is-selected" : ""}"><th>${escapeText(armLabels[item.arm] || item.arm)}</th><td>${formatScore(item.current_h100)}</td><td>${formatScore(item.retained_h100)}</td><td>${formatScore(item.worst_h100)}</td><td>${formatScore(item.one_step)}</td></tr>`).join("");
    const unsupported = study.unsupported?.length
      ? `<p class="diagnostic-warning"><strong>Interface limit:</strong> the named-block arm cannot update the changed actuation map because the current model exposes no trainable input-map parameter. It is marked unsupported, not ranked as a successful adaptation method.</p>`
      : "";
    const competenceGate = gate
      ? `<div class="diagnostic-takeaway"><span>Competence gate</span><p><strong>One-step fit did not become a usable long rollout.</strong> Final H=100 errors span ${formatScore(gate.h100_min)}-${formatScore(gate.h100_max)}, compared with ${formatScore(gate.random_phase_mse)} for a uniform random phase error. Only ${gate.positive_forgetting_cells}/${gate.forgetting_cells} forgetting entries are positive, so near-zero forgetting cannot be interpreted as retention here.</p></div>`
      : "";
    const actionContract = continualActionContract(study);
    byId("diagnostic-visual").innerHTML = `<div class="continual-reader">
      ${competenceGate}
      <div class="continual-controls" role="group" aria-label="Choose update rule">${controls}</div>
      <p class="diagnostic-matrix-note">Each cell is a controlled forecast: ten observed positions initialize the state, the held-out future commands are supplied, and the next 100 positions are predicted. “ref.” is the fraction of the uniform random-phase MSE; lower is better. The color scale is shared by every update rule.</p>
      <div class="diagnostic-matrix-wrap continual-matrix-wrap"><div class="diagnostic-matrix diagnostic-matrix-wide" style="--diagnostic-cols:${study.columns.length}">${headers}${rows}</div></div>
      <div class="continual-summary"><table><caption>Competence after the final environment; H=100 except the final column</caption><thead><tr><th>Update rule</th><th>Current</th><th>Earlier mean</th><th>Worst</th><th>One-step mean</th></tr></thead><tbody>${summaryRows}</tbody></table></div>
      ${unsupported}
    </div>${actionContract}`;
    document.querySelectorAll("[data-continual-arm]").forEach((button) => button.addEventListener("click", () => {
      state.continualArm = button.dataset.continualArm;
      renderContinualDiagnostic(study);
    }));
    return;
  }
  const headers = `<div class="matrix-label">evaluation</div>${study.columns.map((column) => `<div class="matrix-label">${escapeText(column)}</div>`).join("")}`;
  const rows = study.rows.map((row, rowIndex) => `<div class="matrix-label">${escapeText(row)}</div>${study.columns.map((column, columnIndex) => {
    const value = study.matrix?.[rowIndex]?.[columnIndex];
    return value === null || value === undefined
      ? '<div class="matrix-empty">not seen</div>'
      : `<div class="matrix-value"><strong>${formatScore(value)}</strong></div>`;
  }).join("")}`).join("");
  const note = study.matrix
    ? `Smoke integration · ${study.matrix_arm} · ${study.matrix_metric} · not a scientific estimate`
    : "Evaluation contract. No result is implied.";
  const actionContract = continualActionContract(study);
  byId("diagnostic-visual").innerHTML = `<div class="diagnostic-matrix-wrap"><p class="diagnostic-matrix-note">${escapeText(note)}</p><div class="diagnostic-matrix">${headers}${rows}</div></div>${actionContract}`;
}

function continualActionContract(study) {
  return study.action_contract?.length
    ? `<section class="action-contract-audit">
        <div><span>Required interface</span><h4>A command is not a force.</h4><p><i>a</i><sub>r</sub> &rarr; A<sub>r</sub>(q, q&#775;) &rarr; &tau;<sub>r</sub></p></div>
        <div class="action-contract-table">
          <div class="matrix-label">robot</div><div class="matrix-label">controller</div><div class="matrix-label">command std</div><div class="matrix-label">torque std</div><div class="matrix-label">mean corr.</div>
          ${study.action_contract.map((row) => `<div><strong>${escapeText(row.robot)}</strong></div><div>Kp ${formatCompact(row.kp)} · Kd ${formatCompact(row.kd)} · scale ${formatCompact(row.action_scale)}</div><div>${formatCompact(row.raw_std)}</div><div>${formatCompact(row.torque_std)}</div><div>${formatSigned(row.raw_to_torque_corr)}</div>`).join("")}
        </div>
        <p>Before testing adaptation across robots, the model must use each robot's declared command-to-effort map. Otherwise an apparent dynamics shift can be an actuator-interface error.</p>
      </section>`
    : "";
}

const CLOSED_LOOP_METHODS = {
  casimir_true: { label: "Oracle state", color: "#17252c" },
  casimir_qonly_fd: { label: "Finite difference", color: "#bd4d4d" },
  casimir_qonly_map: { label: "MAP smoother", color: "#326fa6" },
  casimir_qonly_fdtcn: { label: "FD-TCN observer", color: "#b7791f" },
  casimir_qonly_phast: { label: "Current q-only PHAST", color: "#167251" },
};

function closedLoopThresholdChart(study, axis) {
  const width = 820;
  const height = 330;
  const margin = { left: 54, right: 18, top: 22, bottom: 58 };
  const cells = study.threshold_cells.filter((cell) => cell.axis === axis);
  const levels = [...new Map(cells.map((cell) => [cell.severity_index, cell.level])).entries()].sort((a, b) => a[0] - b[0]);
  const x = (index) => margin.left + index * (width - margin.left - margin.right) / Math.max(1, levels.length - 1);
  const y = (value) => margin.top + (1 - value) * (height - margin.top - margin.bottom);
  const grid = [0, .5, .8, 1].map((value) => `<line class="plot-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}"/><text class="plot-tick" x="${margin.left - 10}" y="${y(value) + 4}" text-anchor="end">${Math.round(value * 100)}%</text>`).join("");
  const series = study.methods.map((method) => {
    const rows = cells.filter((cell) => cell.method === method).sort((a, b) => a.severity_index - b.severity_index);
    const color = CLOSED_LOOP_METHODS[method]?.color || "#59666d";
    const path = rows.map((cell, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(cell.success_rate).toFixed(1)}`).join(" ");
    const intervals = rows.map((cell, index) => `<line class="threshold-interval" stroke="${color}" x1="${x(index)}" x2="${x(index)}" y1="${y(cell.wilson_95[1])}" y2="${y(cell.wilson_95[0])}"/><circle cx="${x(index)}" cy="${y(cell.success_rate)}" r="${method === state.closedLoopMethod ? 4 : 2.5}" fill="${color}"/>`).join("");
    return `<path class="plot-line" stroke="${color}" d="${path}"/>${intervals}`;
  }).join("");
  const labels = levels.map(([index, level]) => `<text class="plot-tick" x="${x(index)}" y="${height - 30}" text-anchor="middle">${formatCompact(level)}</text>`).join("");
  return `<div class="threshold-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Success with 95 percent intervals as stress increases">${grid}<line class="threshold-target" x1="${margin.left}" x2="${width - margin.right}" y1="${y(study.reliability_target)}" y2="${y(study.reliability_target)}"/>${series}${labels}<text class="plot-axis-title" x="${(margin.left + width - margin.right) / 2}" y="${height - 3}" text-anchor="middle">${escapeText(axis.replaceAll("_", " "))}</text></svg></div>`;
}

function renderClosedLoopDiagnostic(study) {
  if (study.threshold_cells) {
    if (!study.threshold_axes.includes(state.closedLoopAxis)) state.closedLoopAxis = study.threshold_axes[0];
    if (!study.methods.includes(state.closedLoopMethod)) state.closedLoopMethod = "casimir_qonly_phast";
    const axisLabels = { measurement_noise: "Noise", measurement_delay: "Delay", measurement_dropout: "Dropout", actuator_gain: "Actuator gain" };
    const axisControls = study.threshold_axes.map((axis) => `<button type="button" data-threshold-axis="${axis}" aria-selected="${axis === state.closedLoopAxis}">${escapeText(axisLabels[axis] || axis)}</button>`).join("");
    const methodControls = study.methods.map((method) => `<button type="button" data-threshold-method="${method}" aria-selected="${method === state.closedLoopMethod}">${escapeText(CLOSED_LOOP_METHODS[method]?.label || method)}</button>`).join("");
    const selected = study.threshold_cells.filter((cell) => cell.axis === state.closedLoopAxis && cell.method === state.closedLoopMethod).sort((a, b) => a.severity_index - b.severity_index);
    const selectedRows = selected.map((cell) => `<tr><th>${formatCompact(cell.level)}</th><td>${Math.round(100 * cell.success_rate)}% <small>[${Math.round(100 * cell.wilson_95[0])}, ${Math.round(100 * cell.wilson_95[1])}]</small></td><td>${escapeText(cell.conclusion)}</td><td>${formatSigned(cell.final_error_regret_mean, 3)}</td><td>${formatCompact(cell.velocity_error_mean)}</td></tr>`).join("");
    const boundary = study.threshold_boundaries.find((item) => item.axis === state.closedLoopAxis && item.method === state.closedLoopMethod);
    const boundaryText = boundary?.first_resolved_failure_level === null
      ? "No statistically resolved failure was reached on this sweep."
      : `First resolved failure at ${formatCompact(boundary.first_resolved_failure_level)}.`;
    const diagnostic = study.decision_diagnostics?.find((item) => item.method === state.closedLoopMethod);
    let diagnosticText = "";
    if (diagnostic) {
      if (Number.isFinite(diagnostic.velocity_failure_correlation)) {
        diagnosticText = `Mean velocity error is ${formatCompact(diagnostic.velocity_error_success)} on successful trials and ${formatCompact(diagnostic.velocity_error_failure)} on failed trials; its correlation with the failure indicator is ${formatSigned(diagnostic.velocity_failure_correlation)}.`;
      } else if (diagnostic.success_rate === 0) {
        diagnosticText = "Every trial fails for this interface, so there is no within-method success-to-failure transition to correlate with velocity error.";
      } else if (diagnostic.success_rate === 1) {
        diagnosticText = "Every trial succeeds for this interface, so there is no within-method transition to attribute to velocity error.";
      } else {
        diagnosticText = "Velocity error does not vary enough here to estimate a within-method association with failure.";
      }
    }
    byId("diagnostic-visual").innerHTML = `<div class="threshold-reader">
      <div class="threshold-axis-controls" role="group" aria-label="Choose feedback stress">${axisControls}</div>
      <div class="threshold-takeaway"><span>Fixed decision rule</span><p>Reliable means the lower 95% Wilson bound is at least ${Math.round(100 * study.reliability_target)}%. Unreliable means the upper bound is below it. ${escapeText(boundaryText)}</p></div>
      ${closedLoopThresholdChart(study, state.closedLoopAxis)}
      <div class="threshold-method-controls" role="group" aria-label="Inspect one state or port interface">${methodControls}</div>
      ${diagnosticText ? `<div class="diagnostic-takeaway"><span>Failure attribution</span><p>${escapeText(diagnosticText)}</p></div>` : ""}
      <div class="threshold-table"><table><caption>${escapeText(CLOSED_LOOP_METHODS[state.closedLoopMethod]?.label || state.closedLoopMethod)}: outcome and interface error</caption><thead><tr><th>Stress</th><th>Success [95%]</th><th>Decision</th><th>Terminal-error regret</th><th>Velocity error</th></tr></thead><tbody>${selectedRows}</tbody></table></div>
      <details class="attribution-secondary"><summary>View the categorical failure overview</summary>${closedLoopMatrix(study)}</details>
    </div>`;
    document.querySelectorAll("[data-threshold-axis]").forEach((button) => button.addEventListener("click", () => { state.closedLoopAxis = button.dataset.thresholdAxis; renderClosedLoopDiagnostic(study); }));
    document.querySelectorAll("[data-threshold-method]").forEach((button) => button.addEventListener("click", () => { state.closedLoopMethod = button.dataset.thresholdMethod; renderClosedLoopDiagnostic(study); }));
    return;
  }
  if (study.success_matrix) {
    byId("diagnostic-visual").innerHTML = closedLoopMatrix(study);
    return;
  }
  const series = [
    { key: "oracle", label: "Oracle velocity", color: "#17252c" },
    { key: "finite_difference", label: "Finite difference", color: "#bf4f4f" },
    { key: "noise_aware", label: "Noise-aware observer", color: "#176f50" },
  ];
  const legend = series.map((item) => `<span style="--bar-color:${item.color}">${item.label}</span>`).join("");
  const groups = study.noise_results.map((row) => `<div class="diagnostic-bar-group">${series.map((item) => `<div class="diagnostic-bar" style="--bar-value:${row[item.key]};--bar-color:${item.color}"><strong>${Math.round(row[item.key] * 100)}%</strong></div>`).join("")}<span>noise sigma ${row.sigma}</span></div>`).join("");
  byId("diagnostic-visual").innerHTML = `<div class="diagnostic-bars"><div class="diagnostic-bar-legend">${legend}</div><div class="diagnostic-bar-groups">${groups}</div></div>`;
}

function closedLoopMatrix(study) {
  const stressorLabels = { nominal: "nominal", noise: "noise", delay: "delay", dropout: "dropout", actuator_loss: "actuator loss", combined: "combined" };
  const headers = `<div class="matrix-label">success rate</div>${study.stressors.map((item) => `<div class="matrix-label">${escapeText(stressorLabels[item] || item)}</div>`).join("")}`;
  const rows = study.methods.map((method, rowIndex) => `<div class="matrix-label">${escapeText(CLOSED_LOOP_METHODS[method]?.label || method)}</div>${study.stressors.map((_, columnIndex) => {
    const value = study.success_matrix[rowIndex][columnIndex];
    return `<div class="matrix-value" style="--heat-fill:${diagnosticHeatFill(value, 0, 1, true)};background:var(--heat-fill)"><strong>${Math.round(value * 100)}%</strong><small>100 trials</small></div>`;
  }).join("")}`).join("");
  return `<div class="diagnostic-matrix-wrap closed-loop-wrap"><p class="diagnostic-matrix-note">Success aggregated over four initial-condition regimes. Each cell is an observed result.</p><div class="diagnostic-matrix diagnostic-matrix-wide" style="--diagnostic-cols:${study.stressors.length}">${headers}${rows}</div></div>`;
}

function renderDiagnosticStudy() {
  const study = diagnosticStudy();
  document.querySelectorAll("[data-diagnostic]").forEach((button) => button.setAttribute("aria-selected", button.dataset.diagnostic === study.id ? "true" : "false"));
  const status = byId("diagnostic-status");
  status.textContent = study.status;
  status.dataset.status = study.status.toLowerCase().replaceAll(" ", "-");
  byId("diagnostic-source").textContent = study.source;
  byId("diagnostic-question").textContent = study.question;
  byId("diagnostic-execution").textContent = study.execution?.summary || "";
  byId("diagnostic-observed").textContent = study.answer;
  byId("diagnostic-boundary").textContent = study.not_established;
  byId("diagnostic-motivates").textContent = study.motivates;
  byId("diagnostic-input").textContent = study.protocol.input;
  byId("diagnostic-change").textContent = study.protocol.change;
  byId("diagnostic-fixed").textContent = study.protocol.fixed;
  byId("diagnostic-readout").textContent = study.protocol.readout;
  byId("diagnostic-evidence").textContent = study.evidence;
  if (study.id === "evidence") renderEvidenceDiagnostic();
  else if (study.id === "uncertainty") renderUncertaintyDiagnostic(study);
  else if (study.id === "continual") renderContinualDiagnostic(study);
  else renderClosedLoopDiagnostic(study);
  byId("diagnostic-caption").textContent = study.evidence;
  if (typeof window.renderMathInElement === "function") {
    window.renderMathInElement(byId("diagnostic-study"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }
}

function renderDiagnosticTabs() {
  byId("diagnostic-tabs").innerHTML = state.diagnosticData.studies.map((study) => `<button type="button" role="tab" data-diagnostic="${study.id}" aria-controls="diagnostic-study" aria-selected="${study.id === state.diagnostic}">${escapeText(study.label)}</button>`).join("");
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
  renderTrajectoryCaption();
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
    renderTrajectoryCaption();
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
  document.querySelectorAll("[data-diagnostic]").forEach((button) => {
    button.addEventListener("click", () => {
      state.diagnostic = button.dataset.diagnostic;
      renderDiagnosticStudy();
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
  const [response, scalingResponse, diagnosticResponse] = await Promise.all([
    fetch("data/comparison.json?v=8"),
    fetch("data/scaling.json?v=1"),
    fetch("data/diagnostic-program.json?v=7"),
  ]);
  if (!response.ok) throw new Error(`Could not load comparison data (${response.status})`);
  if (!scalingResponse.ok) throw new Error(`Could not load scaling data (${scalingResponse.status})`);
  if (!diagnosticResponse.ok) throw new Error(`Could not load diagnostic data (${diagnosticResponse.status})`);
  state.data = await response.json();
  state.scalingData = await scalingResponse.json();
  state.diagnosticData = await diagnosticResponse.json();
  readViewState();
  renderResultSummary();
  renderSynthesisTable();
  renderCapabilityTable();
  renderMechanismTabs();
  renderScalingStudy();
  renderDiagnosticTabs();
  renderDiagnosticStudy();
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
