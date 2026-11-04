// Switching viewers keeps the remote display and browser profile in the same session.
(() => {
  const page = new URL(location.href);
  if (page.searchParams.has("support")) return;
  const mode = page.pathname.endsWith("/compatibility.html") ? "https" : "webrtc";
  if (page.searchParams.has("panel") && window.parent !== window) {
    const report = () => window.parent.postMessage({type: "coder:browser-transport", mode}, page.origin);
    window.addEventListener("message", event => {
      if (event.origin !== page.origin || event.source !== window.parent) return;
      if (event.data?.type === "coder:browser-fit") report();
      if (event.data?.type !== "coder:browser-set-transport") return;
      const next = event.data.mode;
      if (next !== "https" && next !== "webrtc") return;
      const url = new URL(next === "https" ? "compatibility.html" : "./", page);
      url.search = page.search;
      url.searchParams.set("transport", next);
      if (mode !== next) location.replace(url);
      else {
        // A deliberate WebRTC selection also disables automatic fallback for this viewer.
        page.search = url.search;
        history.replaceState(null, "", url);
        report();
      }
    });
    report();
  }
  if (mode === "https" || page.searchParams.get("transport") === "webrtc") return;
  let lastFrame = performance.now();
  document.addEventListener("visibilitychange", () => { lastFrame = performance.now(); });
  const timer = window.setInterval(() => {
    if (page.searchParams.get("transport") === "webrtc") {
      window.clearInterval(timer);
      return;
    }
    const video = document.querySelector("video");
    if (video?.srcObject instanceof MediaStream && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 2 && video.videoHeight > 2) {
      lastFrame = performance.now();
    } else if (performance.now() - lastFrame >= 20000 && !document.hidden) {
      window.clearInterval(timer);
      const url = new URL("compatibility.html", page);
      url.search = page.search;
      location.replace(url);
    }
  }, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), {once: true});
})();
