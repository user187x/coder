// The private Coder app and its parent share an origin.
if (new URL(location.href).searchParams.has("embed")) {
  const style = document.createElement("style");
  style.textContent = ".video-menu { display: none !important; }";
  document.head.appendChild(style);
  const reportAudio = () => {
    const video = document.querySelector("video");
    if (video) window.parent.postMessage({
      type: "coder:browser-audio",
      muted: video.muted,
    }, location.origin);
  };
  const observeVideo = new MutationObserver(() => {
    const video = document.querySelector("video");
    if (!video) return;
    video.addEventListener("volumechange", reportAudio);
    video.addEventListener("loadedmetadata", reportAudio);
    reportAudio();
    observeVideo.disconnect();
  });
  observeVideo.observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === "coder:browser-mute" && typeof event.data.muted === "boolean") {
      const video = document.querySelector("video");
      if (!video) return;
      document.documentElement.toggleAttribute("data-coder-muted", event.data.muted);
      video.muted = event.data.muted;
      reportAudio();
    }
    if (event.data?.type !== "coder:browser-resolution") return;
    const control = document.querySelector(".video-menu.top .fa-desktop");
    control?.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      clientX: Math.max(8, window.innerWidth - 190),
      clientY: 8,
    }));
  });
}
