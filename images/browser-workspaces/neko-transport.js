// Keep the same remote display and browser profile if relay media cannot start.
(() => {
  if (new URL(location.href).searchParams.has("support")) return;
  let lastFrame = performance.now();
  document.addEventListener("visibilitychange", () => { lastFrame = performance.now(); });
  const timer = window.setInterval(() => {
    const video = document.querySelector("video");
    if (video?.srcObject instanceof MediaStream && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 2 && video.videoHeight > 2) {
      lastFrame = performance.now();
    } else if (performance.now() - lastFrame >= 20000 && !document.hidden) {
      window.clearInterval(timer);
      const url = new URL("compatibility.html", location.href);
      url.search = location.search;
      location.replace(url);
    }
  }, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), {once: true});
})();
