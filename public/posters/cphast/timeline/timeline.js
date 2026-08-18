document.querySelectorAll("[data-katex]").forEach((equation) => {
  if (!window.katex) {
    equation.textContent = equation.dataset.katex;
    return;
  }

  window.katex.render(equation.dataset.katex, equation, {
    displayMode: !equation.classList.contains("katex-inline"),
    throwOnError: false,
    strict: false,
    trust: (context) => context.command === "\\htmlData",
  });
});

const decisionVariableGlossary = {
  "inferred-state": ["\\hat{x}_t", "The current latent robot state inferred from recent telemetry. Example: estimated base motion, joint state, and contact-related state immediately after the push."],
  observer: ["\\mathcal O_\\phi", "The learned observer that refreshes the latent state from recent measurements and the current deployment specification; \\phi denotes its learned parameters."],
  "telemetry-history": ["y_{t-K:t}", "The latest K telemetry samples. For Go2 these include root and joint measurements plus contact and slip geometry."],
  "current-telemetry": ["y_t", "The newest measured telemetry supplied to the frozen locomotion policy at time t."],
  "deployment-spec": ["\\mathcal S_t", "Declared information about the current deployment, such as robot composition, active contacts, available channels, and terrain material. It is supplied rather than inferred in this study."],
  "command-library": ["\\mathcal A", "The matched library of high-level candidates. The Go2 study uses nine recovery commands; the Spot pilot uses four bounded behavior primitives."],
  "command-candidate": ["a", "One high-level candidate. Go2 examples include hold or step left; Spot examples include slow base loop or move-and-scan."],
  "command-sequence": ["a_{t:t+H-1}", "The candidate command supplied throughout a forecast horizon. The submitted experiment evaluates each of the nine discrete commands."],
  "predicted-trajectory": ["\\hat{\\tau}_{t:t+H}^{(a)}", "C-PHAST's predicted physical trajectory over H model steps if candidate a were applied."],
  "prediction-horizon": ["H", "The number of model steps forecast before ranking a command. The submitted one-shot Go2 experiment uses H = 8."],
  "world-model": ["F_\\theta^{\\mathcal S_t}", "The C-PHAST transition assembled for deployment specification S_t; \\theta denotes learned model parameters."],
  "consequence-vector": ["c_t^{(a)}", "Planner-facing consequences extracted for candidate a, including predicted stability, support/contact, slip, energy, dissipation, and task progress."],
  "consequence-readout": ["\\Phi", "The declared readout and horizon-aggregation map that converts a predicted trajectory into comparable consequences."],
  "selected-command": ["a_t^\\star", "The high-level command selected by the downstream planner for the current decision cycle."],
  "planner-objective": ["J_w", "The downstream objective used to compare consequence vectors. The weights w encode the chosen tradeoff, such as recovery, safety, energy, or progress."],
  "joint-actions": ["u_{t:t+M-1}", "The low-level joint commands executed during the next M control steps."],
  "execution-interval": ["M", "The number of control steps executed before the observer is refreshed and planning repeats. The current one-shot study executes M = 24 without replanning."],
  "low-level-policy": ["\\pi_{\\mathrm{RSL-RL}}", "The frozen locomotion policy that converts telemetry and the selected high-level command into joint-level actions."],
  "state-belief": ["\\pi_t", "The conditional distribution of the current physical state given all measurements available through time t and the declared deployment specification."],
  "physical-state": ["x_t", "The robot's physical state at time t, including observed quantities and hidden variables such as velocity, momentum, or contact state."],
  "continuous-configuration": ["\\rho_t", "A continuously adjustable physical configuration, such as body width, wing sweep, curvature, stiffness, or valve opening."],
  "discrete-mode": ["\\kappa_t", "The active discrete physical mode, such as a contact set, feeder topology, locked-joint pattern, or set of connected modules."],
  "ordinary-control": ["u_t", "The ordinary control input that moves the system within its current configuration. For a soft robot this can command translation or segment motion without defining the configuration change itself."],
  "reconfiguration-control": ["r_t", "The control input that deliberately changes physical configuration, such as narrowing the body, changing contact sequence, activating a module, switching a feeder, or changing a sensing arrangement."],
  "reconfiguration-dynamics": ["g_\\rho", "The mechanism-specific dynamics governing how reconfiguration input changes the continuous configuration. It prevents the planner from treating shape or stiffness changes as instantaneous."],
  "reconfiguration-power": ["P_{\\mathrm{reconfig}}", "Power required to change configuration. It is represented through a physical reconfiguration port, or as parameter work when configuration is explicitly treated as an external time-varying parameter, but not counted twice."],
  "pre-switch-state": ["x^-", "The physical state immediately before a discrete contact, topology, or module transition."],
  "post-switch-state": ["x^+", "The physical state immediately after a discrete contact, topology, or module transition."],
  "state-reset": ["\\Delta_{\\kappa^-\\to\\kappa^+}", "The state-transfer map across a discrete mode change. Examples include an impact reset or charge and flux redistribution after electrical switching."],
  "switching-energy": ["\\Delta H_{\\mathrm{switch}}", "The change in stored energy across a discrete transition after applying the state-transfer map. It must be modeled, measured, or bounded."],
  "mode-sequence": ["\\kappa_{t:t+H}", "The candidate sequence of supported contact, topology, or module modes considered over the planning horizon."],
  "reconfiguration-objective": ["J_{\\mathrm{task}}+\\lambda_WW_{\\mathrm{reconfig}}+\\lambda_SC_{\\mathrm{switch}}", "The joint planning cost: task performance plus declared continuous reconfiguration work and discrete switching cost."],
  "measurement-record": ["y_{0:t}", "The telemetry record available through the current decision time. Spot examples include joint, base, contact, arm, gripper, image, and depth summaries."],
  diffusion: ["\\Sigma_\\theta", "The stochastic diffusion operator. In stochastic PHAST it is collocated with the dissipative channels rather than learned as an unconstrained output variance."],
  temperature: ["\\Theta", "The calibrated physical-noise intensity in the fluctuation-dissipation model. It does not represent every form of model or deployment error."],
  dissipation: ["R_\\theta", "The positive-semidefinite pH dissipation operator through which collocated physical process noise enters."],
  "model-residual": ["r_t", "The discrepancy between a real measurement and the model's corresponding prediction. Persistent residuals can indicate stale dynamics, sensing, or deployment assumptions."],
  "predicted-measurement": ["\\hat y_t", "The measurement predicted by the current C-PHAST belief and deployment model for comparison with real telemetry."],
  "risk-trajectory": ["\\hat\\tau_{t:t+H}^{(a,s)}", "One sampled action-conditioned trajectory for candidate a over horizon H. The index s identifies the state or model sample."],
  "state-sample": ["x_t^{(s)}", "One possible current state drawn from the anchored belief. Multiple samples propagate state uncertainty into candidate consequences."],
  "risk-consequence": ["c_{j,t}^{(a)}", "Safety- or task-relevant consequence j for candidate a, such as work, battery draw, support loss, collision proxy, or sensing quality."],
  "calibrated-bound": ["U_{j,1-\\delta}^{(a)}", "The held-out upper prediction bound for consequence j and candidate a at nominal coverage level 1 minus delta."],
  "risk-level": ["\\delta", "The allowed miscoverage or chance-constraint violation probability chosen before test evaluation."],
  "risk-selected-command": ["a_t^\\star", "The candidate selected by the tail-aware risk layer after calibration and feasibility checks."],
  cvar: ["\\operatorname{CVaR}_\\alpha", "Conditional Value at Risk: the average objective value in the declared worst tail beyond the alpha quantile."],
  "risk-objective": ["J_w(c_t^{(a)})", "The objective-specific cost of candidate a computed from its typed consequence vector using declared weights w."],
  "safety-envelope": ["g_j(c_t^{(a)})", "Safety envelope j. Values at or below zero are feasible; examples include support, collision, force, energy, or residual limits."],
  "supervisory-mode": ["m_t", "The supervisory outcome at the current decision time: execute a bounded candidate, request another observation, or abstain and hold."],
  "execute-mode": ["\\mathrm{execute}", "Send the approved high-level primitive to Spot's native controller because its calibrated consequences clear every declared envelope."],
  "reobserve-mode": ["\\mathrm{reobserve}", "Pause and acquire fresh telemetry when uncertainty is primarily caused by a stale or ambiguous state belief."],
  "abstain-mode": ["\\mathrm{abstain}", "Decline all candidate futures and retain the conservative fallback when no candidate is sufficiently supported."],
  "shielded-action": ["u_t", "The hardware command after independent safety filtering. C-PHAST does not directly produce raw joint torque commands."],
  "hardware-shield": ["\\mathsf{Shield}", "The independent runtime safety layer that enforces native limits and can replace or block the advanced decision."],
  "spot-policy": ["\\pi_{\\mathrm{Spot}}", "Spot's native low-level controller that tracks the approved high-level primitive inside its supported interface."],
};

const decisionVariableTooltip = document.createElement("div");
decisionVariableTooltip.className = "decision-variable-tooltip";
decisionVariableTooltip.id = "decision-variable-tooltip";
decisionVariableTooltip.setAttribute("role", "tooltip");
decisionVariableTooltip.hidden = true;
decisionVariableTooltip.innerHTML = "<strong></strong><span></span>";
document.body.appendChild(decisionVariableTooltip);

let activeDecisionVariable = null;
let pinnedDecisionVariable = null;

function decisionVariableDefinition(variable) {
  return decisionVariableGlossary[variable.dataset.var];
}

function positionDecisionVariableTooltip(variable) {
  if (decisionVariableTooltip.hidden) return;
  const anchor = variable.getBoundingClientRect();
  const tooltip = decisionVariableTooltip.getBoundingClientRect();
  const margin = 8;
  const centeredLeft = anchor.left + anchor.width / 2 - tooltip.width / 2;
  const left = Math.min(Math.max(margin, centeredLeft), window.innerWidth - tooltip.width - margin);
  let top = anchor.top - tooltip.height - 10;
  if (top < margin) top = anchor.bottom + 10;
  decisionVariableTooltip.style.left = `${left}px`;
  decisionVariableTooltip.style.top = `${top}px`;
}

function showDecisionVariable(variable, pinned = false) {
  const definition = decisionVariableDefinition(variable);
  if (!definition) return;
  activeDecisionVariable?.classList.remove("variable-active");
  activeDecisionVariable?.removeAttribute("aria-describedby");
  activeDecisionVariable = variable;
  if (pinned) pinnedDecisionVariable = variable;
  variable.classList.add("variable-active");
  variable.setAttribute("aria-describedby", decisionVariableTooltip.id);
  const workstreamAccent = window.getComputedStyle(variable.closest(".workstream") || document.documentElement).getPropertyValue("--workstream-accent").trim();
  decisionVariableTooltip.style.setProperty("--tooltip-accent", workstreamAccent || "#bd6869");
  const title = decisionVariableTooltip.querySelector("strong");
  if (window.katex) {
    window.katex.render(definition[0], title, { throwOnError: false, strict: false });
  } else {
    title.textContent = definition[0];
  }
  decisionVariableTooltip.querySelector(":scope > span").textContent = definition[1];
  decisionVariableTooltip.hidden = false;
  window.requestAnimationFrame(() => positionDecisionVariableTooltip(variable));
}

function hideDecisionVariable(force = false) {
  if (pinnedDecisionVariable && !force) return;
  activeDecisionVariable?.classList.remove("variable-active");
  activeDecisionVariable?.removeAttribute("aria-describedby");
  activeDecisionVariable = null;
  if (force) pinnedDecisionVariable = null;
  decisionVariableTooltip.hidden = true;
}

document.querySelectorAll("#controller-study [data-var], #stochastic-cphast-study [data-var]").forEach((variable) => {
  const definition = decisionVariableDefinition(variable);
  if (!definition) return;
  variable.classList.add("decision-math-var");
  variable.tabIndex = 0;
  variable.setAttribute("aria-label", `${variable.textContent.trim()}: ${definition[1]}`);
});

document.addEventListener("mouseover", (event) => {
  const variable = event.target.closest(".decision-math-var");
  if (variable && !pinnedDecisionVariable) showDecisionVariable(variable);
});

document.addEventListener("mouseout", (event) => {
  const variable = event.target.closest(".decision-math-var");
  if (!variable || pinnedDecisionVariable || variable.contains(event.relatedTarget)) return;
  hideDecisionVariable();
});

document.addEventListener("focusin", (event) => {
  const variable = event.target.closest(".decision-math-var");
  if (variable && !pinnedDecisionVariable) showDecisionVariable(variable);
});

document.addEventListener("focusout", (event) => {
  if (event.target.matches(".decision-math-var") && !pinnedDecisionVariable) hideDecisionVariable();
});

document.addEventListener("click", (event) => {
  const variable = event.target.closest(".decision-math-var");
  if (variable) {
    const shouldPin = pinnedDecisionVariable !== variable;
    if (pinnedDecisionVariable) hideDecisionVariable(true);
    if (shouldPin) showDecisionVariable(variable, true);
    return;
  }
  if (pinnedDecisionVariable) hideDecisionVariable(true);
});

document.addEventListener("keydown", (event) => {
  const variable = event.target.closest?.(".decision-math-var");
  if (variable && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    const shouldPin = pinnedDecisionVariable !== variable;
    if (pinnedDecisionVariable) hideDecisionVariable(true);
    if (shouldPin) showDecisionVariable(variable, true);
  } else if (event.key === "Escape") {
    hideDecisionVariable(true);
  }
});

window.addEventListener("resize", () => {
  if (activeDecisionVariable) positionDecisionVariableTooltip(activeDecisionVariable);
});

const workstreams = [...document.querySelectorAll(".workstream")];
const evidenceToggles = [...document.querySelectorAll("[data-evidence-target]")];
const evidencePanels = [...document.querySelectorAll("[data-evidence-panel]")];
let printState = [];
let protocolPrintState = [];
let evidencePrintState = [];
let printMode = false;

function closeEvidencePanels() {
  evidencePanels.forEach((panel) => {
    panel.hidden = true;
  });
  evidenceToggles.forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Open experiment";
  });
}

evidenceToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const panel = document.getElementById(toggle.dataset.evidenceTarget);
    const shouldOpen = panel?.hidden;
    closeEvidencePanels();
    if (shouldOpen && panel) {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "Close experiment";
    }
  });
});

function openHashTarget() {
  if (!window.location.hash) {
    return;
  }
  const target = document.querySelector(window.location.hash);
  if (target?.matches(".workstream")) {
    target.open = true;
  }
}

workstreams.forEach((workstream) => {
  workstream.addEventListener("toggle", () => {
    const action = workstream.querySelector(".workstream-action");
    action.textContent = workstream.open ? "Close target" : "Open target";

    if (printMode || !workstream.open) {
      return;
    }

    workstreams.forEach((other) => {
      if (other !== workstream) {
        other.open = false;
      }
    });
    window.history.replaceState(null, "", `#${workstream.id}`);
  });
});

window.addEventListener("hashchange", openHashTarget);
window.addEventListener("beforeprint", () => {
  printMode = true;
  printState = workstreams.map((workstream) => workstream.open);
  protocolPrintState = [...document.querySelectorAll(".protocol-details")].map((details) => details.open);
  evidencePrintState = evidencePanels.map((panel) => panel.hidden);
  workstreams.forEach((workstream) => {
    workstream.open = true;
  });
  document.querySelectorAll(".protocol-details").forEach((details) => {
    details.open = true;
  });
  evidencePanels.forEach((panel) => {
    panel.hidden = false;
  });
});
window.addEventListener("afterprint", () => {
  workstreams.forEach((workstream, index) => {
    workstream.open = printState[index];
  });
  document.querySelectorAll(".protocol-details").forEach((details, index) => {
    details.open = protocolPrintState[index];
  });
  evidencePanels.forEach((panel, index) => {
    panel.hidden = evidencePrintState[index];
  });
  window.setTimeout(() => {
    printMode = false;
  }, 0);
});

openHashTarget();

const domainTabs = [...document.querySelectorAll("[data-domain-tab]")];
const domainPanels = [...document.querySelectorAll("[data-domain-panel]")];

function selectDomain(domain, moveFocus = false) {
  domainTabs.forEach((tab) => {
    const selected = tab.dataset.domainTab === domain;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) {
      tab.focus();
    }
  });

  domainPanels.forEach((panel) => {
    panel.hidden = panel.dataset.domainPanel !== domain;
  });
}

domainTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectDomain(tab.dataset.domainTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + domainTabs.length) % domainTabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % domainTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = domainTabs.length - 1;
    selectDomain(domainTabs[nextIndex].dataset.domainTab, true);
  });
});
