(() => {
  const root = document.documentElement;
  const poster = document.querySelector(".poster");
  const pageKey = document.body.dataset.poster || "poster";
  const storageKey = `live-poster:${pageKey}:layout`;
  const overviewDialog = document.querySelector(".overview-dialog");
  const overviewVideo = overviewDialog?.querySelector(".overview-video");
  const variableGlossaries = {
    phast: {
      "q-history": ["q_{t-K+1:t}", "The recent position-only observation window supplied to the causal observer."],
      observer: ["o_{\\phi}", "The causal observer that infers hidden phase information from position history."],
      "phase-state": ["\\hat{x}_t", "The inferred phase state used to initialize the Markov rollout."],
      position: ["q_t", "The observed configuration or position at the current time."],
      momentum: ["\\hat{p}_t", "The observer's inferred momentum-like latent variable; it is not directly observed."],
      "state-rate": ["\\dot{x}", "The continuous-time rate of change of the phase state."],
      "phase-rollout": ["\\hat{x}_{t+1:t+H}", "The predicted latent phase trajectory produced by repeatedly applying the PHAST transition."],
      "position-readout": ["\\Pi_q", "The fixed observation map that selects configuration or position from the predicted phase state."],
      "position-rollout": ["\\hat{q}_{t+1:t+H}", "The model's open-loop forecast output: future positions over horizon H. This is the quantity compared with position targets."],
      "phast-loss": ["\\mathcal{L}_q", "The teacher-forced next-position loss used in the headline tables. All optional auxiliary-loss coefficients are zero there."],
      "index-count": ["N_{\\mathcal I}=|\\mathcal I|", "The number of valid minibatch and time-index pairs contributing to the PHAST training loss."],
      J: ["J", "The skew-symmetric interconnection operator. It redistributes energy without producing net power."],
      R: ["R", "The positive-semidefinite dissipation operator. Its contribution to the energy rate is nonpositive."],
      H: ["H", "The Hamiltonian: stored energy, including potential and kinetic terms for a mechanical block."],
      "H-rate": ["\\dot{H}", "The instantaneous rate of change of stored energy along the learned continuous-time dynamics."],
      G: ["G", "The port matrix selecting how external inputs enter the state dynamics."],
      u: ["u", "The external input or forcing applied through the declared port."],
      "port-output": ["y^{\\mathrm{port}}", "The power-conjugate port output G^T grad H; external power is u^T y^port."],
    },
    cphast: {
      history: ["h", "The recent observation history used to refresh the state. Spot examples: speed/contact, arm and gripper state, image/depth quality, and TF/depth novelty."],
      candidate: ["a_k", "Numeric descriptor for candidate k. Spot examples: intended base speed, turn rate, gripper opening, and primitive parameters; this is not a primitive label."],
      "deployment-spec": ["\\mathcal S", "The current deployment specification before choosing a candidate: typed blocks, robot metadata, active graph or contacts, ports, and available observation channels."],
      spec: ["\\mathcal S_k", "The deployment specification after candidate a_k is activated. It records the blocks, ports, contacts, interconnection, observations, and candidate controls used for that hypothetical future."],
      "phase-state-cphast": ["\\hat{x}_t", "The refreshed typed phase state inferred from the current observation history before any candidate is rolled out."],
      "observe-op": ["\\mathrm{Observe}_{\\theta}", "The learned state-refresh operator. It maps recent telemetry and the current deployment specification to the present typed phase state."],
      "activate-op": ["\\mathrm{Activate}", "The deterministic candidate-activation operator. It converts the current deployment and candidate descriptor into the candidate-specific specification S_k."],
      "cphast-model": ["\\mathrm{CPHAST}_{\\theta}", "The compositional port-Hamiltonian dynamics model. It advances the refreshed state under candidate a_k and activated specification S_k."],
      "candidate-rollout": ["\\hat{x}_{t:t+H}^{(k)}", "The predicted state trajectory for candidate k. Robot examples include future base, joint, arm, and contact-related state."],
      consequences: ["\\rho^{(k)}", "The typed consequence vector predicted before scoring. Spot examples: work, battery draw, support/contact, collision proxy, sensing quality, depth novelty, and residuals."],
      "ph-readout": ["O_{\\mathrm{pH}}", "A post-rollout readout operator, not the dynamics model. It computes stored energy, dissipation, port work, and internal exchange from the predicted pH trajectory."],
      "learned-readout": ["O_{\\mathrm{learned},\\theta}", "A post-rollout learned readout operator, not the dynamics model. Spot examples include sensing quality, depth novelty, and perceptual collision proxies."],
      factors: ["\\phi^{(k)}", "Planner-facing factors built from typed consequences. Examples: progress reward, work cost, support risk, map reward, residual warning, and collision veto."],
      "factor-map": ["\\mathrm{Factors}", "The deterministic horizon aggregation and calibration map. It has no learned parameters."],
      score: ["s_k", "The objective-conditioned score used to rank candidate k after its physical and perceptual consequences have been predicted."],
      weights: ["w", "The objective-specific weights applied downstream to the same planner-factor vector."],
      envelope: ["g_j", "Hard feasibility test j. Robot examples include excessive support loss, collision risk, force-limit violation, or residual mismatch."],
      "isaac-loss": ["\\mathcal L_{\\mathrm{data}}", "The matched Isaac comparison uses coordinate-aware next-step position MSE only: Euclidean error for linear coordinates and wrapped error for angles. It matches the baselines' 50-epoch objective."],
      "batch-count": ["|\\mathcal B|", "The number of valid robot-trajectory and time-index pairs in the training batch."],
      "spot-loss": ["\\mathcal L_{\\mathrm{Spot}}", "Weighted mean-squared error over train-scaled typed consequence targets. Objective and action-card weights are applied only after prediction."],
      "spot-normalizer": ["N d_{\\rho}", "The number of Spot windows times the number of predicted consequence channels."],
      "total-storage": ["H_{\\mathrm{total}}", "The additive stored energy of the composed deployment: the sum of local block Hamiltonians."],
      "local-storage": ["H_i", "The local Hamiltonian of block i; capacitor, inductor, and mechanical storage live here."],
      "coupling-output": ["\\hat{y}_i", "The power-conjugate output exposed by block i at its internal coupling port."],
      "port-matrix": ["B_i", "The local port matrix mapping a port input into block i's state dynamics."],
      "coupling-input": ["\\hat{u}_i", "The internal port input received by block i from the deployed interconnection."],
      interconnect: ["\\hat{C}", "The skew-symmetric deployed interconnection. It redirects internal power but injects zero net power."],
      "total-storage-rate": ["\\dot{H}_{\\mathrm{total}}", "The rate of change of total stored energy in the composed deployment."],
      "port-flow": ["v_i=\\partial H_i/\\partial p_i", "The local power-conjugate flow derived from block i's Hamiltonian."],
      "local-dissipation": ["R_i", "The positive-semidefinite local dissipation operator of block i."],
      "local-input": ["u_i^{\\mathrm{loc}}", "A local external or constitutive port, such as mechanical control torque."],
      "domain-input": ["u_i^{\\mathrm{dom}}", "Explicit benchmark-specific forcing, such as converter or load forcing in a microgrid."],
      "composed-state": ["x", "The stacked state of all blocks in the composed deployment."],
    },
  };
  const variableTooltip = document.createElement("div");
  variableTooltip.className = "variable-tooltip";
  variableTooltip.id = "math-variable-tooltip";
  variableTooltip.setAttribute("role", "tooltip");
  variableTooltip.hidden = true;
  variableTooltip.innerHTML = "<strong></strong><span></span>";
  document.body.appendChild(variableTooltip);
  let fontScale = Number(localStorage.getItem(`${storageKey}:font`)) || 1;
  let draggedCard = null;
  let activeVariable = null;
  let pinnedVariable = null;

  function fitPoster() {
    if (!poster || window.matchMedia("(max-width: 1050px)").matches || window.matchMedia("print").matches) {
      if (poster) {
        poster.style.transform = "";
        poster.style.left = "";
        poster.style.top = "";
      }
      return;
    }

    poster.style.transform = "none";
    const naturalWidth = 1920;
    const naturalHeight = poster.scrollHeight;
    const scale = Math.min(window.innerWidth / naturalWidth, window.innerHeight / naturalHeight);
    const left = Math.max(0, (window.innerWidth - naturalWidth * scale) / 2);
    const top = Math.max(0, (window.innerHeight - naturalHeight * scale) / 2);
    poster.style.left = `${left}px`;
    poster.style.top = `${top}px`;
    poster.style.transform = `scale(${scale})`;
  }

  function applyFontScale() {
    root.style.setProperty("--poster-font", fontScale.toFixed(2));
    localStorage.setItem(`${storageKey}:font`, String(fontScale));
    window.requestAnimationFrame(fitPoster);
  }

  function setStaticMode(enabled) {
    poster?.classList.toggle("static-mode", enabled);
    const button = document.querySelector("[data-action='static']");
    button?.setAttribute("aria-pressed", String(enabled));
    button?.setAttribute("title", enabled ? "Return to live media" : "Show printable media");
    document.querySelectorAll("video").forEach((video) => {
      if (enabled) video.pause();
      else if (video.hasAttribute("autoplay")) video.play().catch(() => {});
    });

    document.querySelectorAll("img[data-live-src]").forEach((image) => {
      image.src = enabled ? image.dataset.staticSrc : image.dataset.liveSrc;
    });
  }

  function setMediaPaused(paused) {
    const button = document.querySelector("[data-action='pause']");
    button?.setAttribute("aria-pressed", String(paused));
    button?.setAttribute("title", paused ? "Resume live media" : "Pause live media");
    button && (button.textContent = paused ? "Play" : "Pause");
    document.querySelectorAll("video[autoplay]").forEach((video) => {
      if (paused) video.pause();
      else video.play().catch(() => {});
    });

    document.querySelectorAll("img[data-live-src]").forEach((image) => {
      image.src = paused ? image.dataset.staticSrc : image.dataset.liveSrc;
    });
  }

  function openOverview() {
    if (!overviewDialog || !overviewVideo) return;
    overviewDialog.showModal();
    overviewVideo.play().catch(() => {});
  }

  function closeOverview() {
    if (!overviewDialog || !overviewVideo) return;
    overviewVideo.pause();
    overviewDialog.close();
  }

  function variableDefinition(variable) {
    return variableGlossaries[pageKey]?.[variable.dataset.var];
  }

  function positionVariableTooltip(variable) {
    if (variableTooltip.hidden) return;
    const anchor = variable.getBoundingClientRect();
    const tooltip = variableTooltip.getBoundingClientRect();
    const margin = 8;
    const centeredLeft = anchor.left + anchor.width / 2 - tooltip.width / 2;
    const left = Math.min(Math.max(margin, centeredLeft), window.innerWidth - tooltip.width - margin);
    let top = anchor.top - tooltip.height - 10;
    if (top < margin) top = anchor.bottom + 10;
    variableTooltip.style.left = `${left}px`;
    variableTooltip.style.top = `${top}px`;
  }

  function showVariable(variable, pinned = false) {
    const definition = variableDefinition(variable);
    if (!definition) return;
    activeVariable?.classList.remove("variable-active");
    activeVariable?.removeAttribute("aria-describedby");
    activeVariable = variable;
    if (pinned) pinnedVariable = variable;
    variable.classList.add("variable-active");
    variable.setAttribute("aria-describedby", variableTooltip.id);
    const title = variableTooltip.querySelector("strong");
    if (window.katex) {
      window.katex.render(definition[0], title, { throwOnError: false, strict: false });
    } else {
      title.textContent = definition[0];
    }
    variableTooltip.querySelector(":scope > span").textContent = definition[1];
    variableTooltip.hidden = false;
    window.requestAnimationFrame(() => positionVariableTooltip(variable));
  }

  function hideVariable(force = false) {
    if (pinnedVariable && !force) return;
    activeVariable?.classList.remove("variable-active");
    activeVariable?.removeAttribute("aria-describedby");
    activeVariable = null;
    if (force) pinnedVariable = null;
    variableTooltip.hidden = true;
  }

  document.querySelectorAll("[data-var]").forEach((variable) => {
    const definition = variableDefinition(variable);
    if (!definition) return;
    variable.classList.add("math-var");
    variable.tabIndex = 0;
    variable.setAttribute("aria-label", `${variable.textContent.trim()}: ${definition[1]}`);
  });

  function activateTab(button) {
    const group = button.closest("[data-switcher]");
    if (!group) return;
    group.querySelectorAll("[role='tab']").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab === button));
    });

    const content = JSON.parse(button.dataset.content || "{}");
    const target = document.querySelector(group.dataset.target);
    if (!target) return;

    Object.entries(content).forEach(([key, value]) => {
      const node = target.querySelector(`[data-field='${key}']`);
      if (node) node.textContent = value;
    });
    window.requestAnimationFrame(fitPoster);
  }

  function saveLayout() {
    const columns = [...document.querySelectorAll(".poster-column")].map((column) => ({
      id: column.id,
      cards: [...column.querySelectorAll(":scope > .poster-card")].map((card) => card.id),
    }));
    localStorage.setItem(storageKey, JSON.stringify(columns));
  }

  function restoreLayout() {
    try {
      const layout = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!Array.isArray(layout)) return;
      layout.forEach(({ id, cards }) => {
        const column = document.getElementById(id);
        if (!column) return;
        cards.forEach((cardId) => {
          const card = document.getElementById(cardId);
          if (card) column.appendChild(card);
        });
      });
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  function setEditing(enabled) {
    poster?.classList.toggle("editing", enabled);
    const button = document.querySelector("[data-action='edit']");
    button?.setAttribute("aria-pressed", String(enabled));
    document.querySelectorAll(".poster-card").forEach((card) => {
      card.draggable = enabled;
    });
  }

  document.addEventListener("click", (event) => {
    const variable = event.target.closest(".math-var");
    if (variable) {
      const shouldPin = pinnedVariable !== variable;
      if (pinnedVariable && pinnedVariable !== variable) hideVariable(true);
      if (shouldPin) showVariable(variable, true);
      else hideVariable(true);
      return;
    }
    if (pinnedVariable) hideVariable(true);

    const button = event.target.closest("button");
    if (!button) return;

    if (button.matches("[role='tab'][data-content]")) {
      activateTab(button);
      return;
    }

    switch (button.dataset.action) {
      case "font-down":
        fontScale = Math.max(0.82, fontScale - 0.05);
        applyFontScale();
        break;
      case "font-up":
        fontScale = Math.min(1.22, fontScale + 0.05);
        applyFontScale();
        break;
      case "static":
        setStaticMode(button.getAttribute("aria-pressed") !== "true");
        break;
      case "pause":
        setMediaPaused(button.getAttribute("aria-pressed") !== "true");
        break;
      case "edit":
        setEditing(button.getAttribute("aria-pressed") !== "true");
        break;
      case "reset":
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`${storageKey}:font`);
        window.location.reload();
        break;
      case "print":
        window.print();
        break;
      case "overview-open":
        openOverview();
        break;
      case "overview-close":
        closeOverview();
        break;
    }
  });

  document.addEventListener("mouseover", (event) => {
    const variable = event.target.closest(".math-var");
    if (variable && !pinnedVariable) showVariable(variable);
  });

  document.addEventListener("mouseout", (event) => {
    const variable = event.target.closest(".math-var");
    if (!variable || pinnedVariable) return;
    if (variable.contains(event.relatedTarget)) return;
    hideVariable();
  });

  document.addEventListener("focusin", (event) => {
    const variable = event.target.closest(".math-var");
    if (variable && !pinnedVariable) showVariable(variable);
  });

  document.addEventListener("focusout", (event) => {
    if (event.target.matches(".math-var") && !pinnedVariable) hideVariable();
  });

  document.addEventListener("keydown", (event) => {
    const variable = event.target.closest?.(".math-var");
    if (variable && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const shouldPin = pinnedVariable !== variable;
      if (pinnedVariable) hideVariable(true);
      if (shouldPin) showVariable(variable, true);
    } else if (event.key === "Escape") {
      hideVariable(true);
    }
  });

  overviewDialog?.addEventListener("cancel", () => {
    overviewVideo?.pause();
  });

  overviewDialog?.addEventListener("click", (event) => {
    if (event.target === overviewDialog) closeOverview();
  });

  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".poster-card");
    if (!card || !poster?.classList.contains("editing")) return;
    draggedCard = card;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  document.addEventListener("dragend", () => {
    draggedCard?.classList.remove("dragging");
    document.querySelectorAll(".poster-column").forEach((column) => column.classList.remove("drag-target"));
    draggedCard = null;
    saveLayout();
  });

  document.querySelectorAll(".poster-column").forEach((column) => {
    column.addEventListener("dragover", (event) => {
      if (!draggedCard) return;
      event.preventDefault();
      column.classList.add("drag-target");
      const cards = [...column.querySelectorAll(":scope > .poster-card:not(.dragging)")];
      const next = cards.find((card) => event.clientY < card.getBoundingClientRect().top + card.offsetHeight / 2);
      column.insertBefore(draggedCard, next || null);
    });
    column.addEventListener("dragleave", () => column.classList.remove("drag-target"));
    column.addEventListener("drop", (event) => {
      event.preventDefault();
      column.classList.remove("drag-target");
    });
  });

  applyFontScale();
  restoreLayout();
  document.querySelectorAll("[data-switcher]").forEach((group) => {
    const selected = group.querySelector("[aria-selected='true']");
    if (selected) activateTab(selected);
  });
  window.addEventListener("resize", () => {
    fitPoster();
    if (activeVariable) positionVariableTooltip(activeVariable);
  });
  window.addEventListener("load", fitPoster);
  window.setTimeout(fitPoster, 300);
})();
