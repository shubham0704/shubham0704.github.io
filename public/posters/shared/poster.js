(() => {
  const root = document.documentElement;
  const poster = document.querySelector(".poster");
  const pageKey = document.body.dataset.poster || "poster";
  const storageKey = `live-poster:${pageKey}:layout`;
  const overviewDialog = document.querySelector(".overview-dialog");
  const overviewVideo = overviewDialog?.querySelector(".overview-video");
  const variableGlossaries = {
    phast: {
      "q-history": ["q(t-K+1:t)", "The recent position-only observation window supplied to the causal observer."],
      observer: ["o_phi", "The causal observer that infers hidden phase information from position history."],
      "phase-state": ["x-hat_t", "The inferred phase state used to initialize the Markov rollout."],
      position: ["q_t", "The observed configuration or position at the current time."],
      momentum: ["p-hat_t", "The observer's inferred momentum-like latent variable; it is not directly observed."],
      "state-rate": ["x-dot", "The continuous-time rate of change of the phase state."],
      J: ["J", "The skew-symmetric interconnection operator. It redistributes energy without producing net power."],
      R: ["R", "The positive-semidefinite dissipation operator. Its contribution to the energy rate is nonpositive."],
      H: ["H", "The Hamiltonian: stored energy, including potential and kinetic terms for a mechanical block."],
      "H-rate": ["H-dot", "The instantaneous rate of change of stored energy along the learned continuous-time dynamics."],
      G: ["G", "The port matrix selecting how external inputs enter the state dynamics."],
      u: ["u", "The external input or forcing applied through the declared port."],
      "port-output": ["y^port", "The power-conjugate port output G^T grad H; external power is u^T y^port."],
    },
    cphast: {
      history: ["h", "The recent observation history used to initialize or refresh the deployed state."],
      candidate: ["a_k", "Candidate k: a supplied behavior primitive, control sequence, contact choice, or network action."],
      spec: ["S_k", "The candidate-activated deployment specification: blocks, graph, ports, observations, and context."],
      "candidate-rollout": ["x-hat^(k)", "The predicted state trajectory obtained by rolling candidate k forward from the common inferred state."],
      consequences: ["rho^(k)", "The typed consequence vector for candidate k, evaluated before an objective score is formed."],
      "ph-readout": ["O_pH", "Closed-form pH readouts such as storage, dissipation, port work, and internal exchange."],
      "learned-readout": ["O_learned,theta", "Learned perceptual readout heads for sensing quality, map novelty, and related task-facing channels."],
      factors: ["phi^(k)", "The planner-facing factor vector: declared costs, rewards, residuals, barriers, or constraint margins."],
      "factor-map": ["Factors", "The deterministic horizon aggregation and calibration map. It has no learned parameters."],
      score: ["s_k", "The objective-conditioned scalar score assigned to candidate k."],
      weights: ["w", "The objective-specific weights applied downstream to the same planner-factor vector."],
      envelope: ["g_j", "Hard envelope j. A candidate is feasible when every declared envelope satisfies g_j(phi) <= 0."],
      "total-storage": ["H_total", "The additive stored energy of the composed deployment: the sum of local block Hamiltonians."],
      "local-storage": ["H_i", "The local Hamiltonian of block i; capacitor, inductor, and mechanical storage live here."],
      "coupling-output": ["y-hat_i", "The power-conjugate output exposed by block i at its internal coupling port."],
      "port-matrix": ["B_i", "The local port matrix mapping a port input into block i's state dynamics."],
      "coupling-input": ["u-hat_i", "The internal port input received by block i from the deployed interconnection."],
      interconnect: ["C-hat", "The skew-symmetric deployed interconnection. It redirects internal power but injects zero net power."],
      "total-storage-rate": ["H-dot_total", "The rate of change of total stored energy in the composed deployment."],
      "port-flow": ["v_i", "The local power-conjugate flow, defined in the paper as partial H_i / partial p_i."],
      "local-dissipation": ["R_i", "The positive-semidefinite local dissipation operator of block i."],
      "local-input": ["u_i^loc", "A local external or constitutive port, such as mechanical control torque."],
      "domain-input": ["u_i^dom", "Explicit benchmark-specific forcing, such as converter or load forcing in a microgrid."],
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
    variableTooltip.querySelector("strong").textContent = definition[0];
    variableTooltip.querySelector("span").textContent = definition[1];
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
    variable.setAttribute("aria-label", `${definition[0]}: ${definition[1]}`);
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
