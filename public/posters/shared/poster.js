(() => {
  const root = document.documentElement;
  const poster = document.querySelector(".poster");
  const pageKey = document.body.dataset.poster || "poster";
  const storageKey = `live-poster:${pageKey}:layout`;
  const overviewDialog = document.querySelector(".overview-dialog");
  const overviewVideo = overviewDialog?.querySelector(".overview-video");
  let fontScale = Number(localStorage.getItem(`${storageKey}:font`)) || 1;
  let draggedCard = null;

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
  window.addEventListener("resize", fitPoster);
  window.addEventListener("load", fitPoster);
  window.setTimeout(fitPoster, 300);
})();
