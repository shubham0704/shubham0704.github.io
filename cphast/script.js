const modal = document.createElement("div");
modal.className = "video-modal";
modal.hidden = true;
modal.innerHTML = `
  <div class="video-modal__panel" role="dialog" aria-modal="true" aria-label="Expanded video player">
    <button class="video-modal__close" type="button" aria-label="Close video">×</button>
    <video controls playsinline></video>
    <div class="video-modal__caption"></div>
  </div>
`;
document.body.appendChild(modal);

const modalVideo = modal.querySelector("video");
const modalCaption = modal.querySelector(".video-modal__caption");
const modalClose = modal.querySelector(".video-modal__close");

function openVideo(video) {
  const figure = video.closest("figure");
  const caption = figure?.querySelector("figcaption")?.innerText?.trim() || "C-PHAST demo video";
  modalVideo.src = video.currentSrc || video.src;
  modalCaption.textContent = caption;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  modalVideo.play().catch(() => {});
}

function closeVideo() {
  modalVideo.pause();
  modalVideo.removeAttribute("src");
  modalVideo.load();
  modal.hidden = true;
  document.body.style.overflow = "";
}

document.querySelectorAll(".preview-video, .hero-video").forEach((video) => {
  const figure = video.closest("figure");
  figure?.setAttribute("tabindex", "0");
  figure?.setAttribute("role", "button");
  figure?.setAttribute("aria-label", "Preview video. Click to expand.");

  video.muted = true;
  video.loop = true;
  video.playsInline = true;

  const startPreview = () => {
    figure?.classList.add("is-previewing");
    video.muted = true;
    video.play().catch(() => {
      // Keep the poster visible if the browser refuses hover-initiated playback.
    });
  };

  const stopPreview = () => {
    figure?.classList.remove("is-previewing");
    video.pause();
  };

  for (const target of [figure, video]) {
    target?.addEventListener("pointerenter", startPreview);
    target?.addEventListener("mouseenter", startPreview);
    target?.addEventListener("focus", startPreview);
    target?.addEventListener("pointerleave", stopPreview);
    target?.addEventListener("mouseleave", stopPreview);
    target?.addEventListener("blur", stopPreview);
  }

  figure?.addEventListener("click", () => openVideo(video));
  figure?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openVideo(video);
    }
  });
});

modalClose.addEventListener("click", closeVideo);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeVideo();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeVideo();
});
