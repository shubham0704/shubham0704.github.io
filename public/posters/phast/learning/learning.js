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

const state = {
  data: null,
  systemIndex: 0,
  step: 0,
  playing: true,
  timer: null,
  interval: 120,
  coordinate: 0,
  visibleMethods: new Set(),
};

const byId = (id) => document.getElementById(id);
const currentSystem = () => state.data.systems[state.systemIndex];
const currentMethod = (id) => currentSystem().methods.find((method) => method.id === id);

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

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function formatScore(value) {
  if (value < 0.001) return value.toExponential(2);
  return value.toFixed(value < 0.1 ? 4 : 3);
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
  const paths = series.map((item) => `<path class="plot-line" stroke="${item.color}" d="${makePath(item.values, x, y)}"/>`).join("");
  const cursor = options.cursor === false ? "" : `<line class="plot-cursor" x1="${x(state.step)}" x2="${x(state.step)}" y1="${margin.top}" y2="${height - margin.bottom}"/>`;
  const legendGap = Math.min(145, (width - margin.left - margin.right) / Math.max(1, series.length));
  const legend = series.map((item, index) => `<g transform="translate(${margin.left + index * legendGap},${height - 12})"><line x2="24" stroke="${item.color}" stroke-width="4"/><text class="plot-label" x="31" y="7">${escapeText(item.label)}</text></g>`).join("");
  svg.innerHTML = `${grid}<line class="plot-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"/>${paths}${cursor}${legend}`;
}

function drawPlots() {
  const system = currentSystem();
  const coordinate = state.coordinate;
  const methods = system.methods.filter((method) => state.visibleMethods.has(method.id));
  renderPlot(byId("trajectory-plot"), [
    { label: "Truth", color: COLORS.truth, values: system.truth.map((q) => q[coordinate]) },
    ...methods.map((method) => ({ label: shortLabel(method.id), color: COLORS[method.id], values: method.prediction.map((q) => q[coordinate]) })),
  ]);
  renderPlot(byId("error-plot"), methods.map((method) => ({
    label: shortLabel(method.id), color: COLORS[method.id], values: method.error_by_step,
  })), { logY: true });
  renderPlot(byId("training-plot"), methods.map((method) => ({
    label: shortLabel(method.id),
    color: COLORS[method.id],
    values: method.aggregate.training_history_seed42.map((item) => item.train),
  })), { logY: true, cursor: false });
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
  const mark = (value) => value === null ? "Varies" : value ? "Yes" : "No";
  byId("capability-table").querySelector("tbody").innerHTML = state.data.table2_methods.map((row) => `<tr>
    <td><strong>${escapeText(row.method)}</strong><small>${escapeText(row.note)}</small></td>
    <td class="capability-${String(row.dissipative)}">${mark(row.dissipative)}</td>
    <td class="capability-${String(row.passivity)}">${mark(row.passivity)}</td>
    <td class="capability-${String(row.spectral_control)}">${mark(row.spectral_control)}</td>
    <td class="capability-${String(row.efficient)}">${mark(row.efficient)}</td>
    <td><span class="evidence-tag">${escapeText(row.evidence)}</span></td>
  </tr>`).join("");
  byId("comparison-note").textContent = state.data.comparison_note;
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

function renderInterpretation() {
  const system = currentSystem();
  const phast = system.methods[0].aggregate.mean;
  const bestBaseline = Math.min(...system.methods.slice(1).map((method) => method.aggregate.mean));
  const ratio = bestBaseline / phast;
  byId("claim-title").textContent = system.claim;
  const explanations = {
    pendulum: "The true damping changes with angle. A conservative HNN cannot represent irreversible contraction; pHNN adds damping, while PHAST separates potential, mass, and damping inside its transition.",
    "double-pendulum": "The two angular coordinates exchange energy through coupled nonlinear motion while damping removes it. The observer and transition must remain stable after ground-truth positions stop.",
    "cart-pole": "The cart moves on the real line while the pole angle wraps on a circle. The declared chart prevents an artificial discontinuity at the angular branch cut.",
  };
  byId("claim-explanation").textContent = explanations[system.scene];
  byId("claim-result").textContent = `PHAST has ${ratio.toFixed(1)}x lower mean rollout error than the strongest matched structured baseline on this system.`;
}

function renderProvenance() {
  byId("contract-detail").textContent = state.data.information_contract;
  const lines = currentSystem().methods.map((method) => `${method.label}\n${method.aggregate.checkpoint}\nsha256 ${method.aggregate.checkpoint_sha256}`);
  byId("checkpoint-detail").textContent = lines.join("\n\n");
}

function renderSystem() {
  const system = currentSystem();
  state.step = 0;
  state.coordinate = 0;
  state.visibleMethods = new Set(system.methods.map((method) => method.id));
  byId("time-scrubber").value = 0;
  byId("step-output").value = 1;
  byId("system-question").textContent = system.question;
  byId("selection-note").textContent = `${system.selection}; held-out trajectory index ${system.trajectory_index}.`;
  const select = byId("coordinate-select");
  select.innerHTML = coordinateLabels(system).map((label, index) => `<option value="${index}">${escapeText(label)}</option>`).join("");
  renderMethodFilter();
  renderMotionPanels();
  renderScoreTable();
  renderSubmittedScoreTable();
  renderInterpretation();
  renderProvenance();
  drawPlots();
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
  document.querySelectorAll("[data-system]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-system]").forEach((candidate) => candidate.setAttribute("aria-selected", "false"));
      button.setAttribute("aria-selected", "true");
      state.systemIndex = Number(button.dataset.system);
      renderSystem();
    });
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
    drawPlots();
  });
  window.addEventListener("resize", drawScenes);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    state.playing = false;
    byId("play-toggle").textContent = "Play";
  }
}

async function init() {
  const response = await fetch("data/comparison.json?v=3");
  if (!response.ok) throw new Error(`Could not load comparison data (${response.status})`);
  state.data = await response.json();
  renderCapabilityTable();
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
