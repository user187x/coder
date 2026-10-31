// The private Coder app and its parent share an origin.
if (new URL(location.href).searchParams.has("embed")) {
  const style = document.createElement("style");
  style.textContent = ".video-menu { display: none !important; }";
  document.head.appendChild(style);
  const sessionOwner = window.opener || window.parent;
  const statusTimer = window.setInterval(async () => {
    try {
      const response = await fetch(new URL("status", location.href), {cache: "no-store"});
      if (!response.ok) return;
      const state = await response.json();
      if (state.running !== false) return;
      window.clearInterval(statusTimer);
      sessionOwner.postMessage({type: "coder:browser-exited"}, location.origin);
    } catch (error) {
      console.debug("Browser session status unavailable", error);
    }
  }, 1000);
  window.addEventListener("pagehide", () => window.clearInterval(statusTimer), {once: true});
  let requestedResolution = "";
  let appliedResolution = "";
  let resizeTimer = 0;
  let resizing = false;
  const resizeScreen = async () => {
    if (resizing || !requestedResolution || requestedResolution === appliedResolution) return;
    resizing = true;
    const resolution = requestedResolution;
    try {
      const [width, height] = resolution.split("x").map(Number);
      const response = await fetch(new URL("api/room/screen", location.href), {
        method: "POST",
        credentials: "same-origin",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({width, height, rate: 60}),
      });
      if (!response.ok) throw new Error(`Screen resize failed: ${response.status}`);
      appliedResolution = resolution;
    } catch (error) {
      console.debug("Browser screen size unavailable", error);
    } finally {
      resizing = false;
      if (requestedResolution !== appliedResolution) {
        scheduleResize(1000);
      }
    }
  };
  const scheduleResize = (delay = 300) => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resizeScreen, delay);
  };
  const fitScreen = (size = window) => {
    if (new URL(location.href).searchParams.has("support")) return;
		const width = Math.max(640, Math.floor(size.width ?? size.innerWidth));
		const height = Math.max(360, Math.floor(size.height ?? size.innerHeight));
    const scale = Math.min(
      1,
      3840 / width,
      2160 / height,
      Math.sqrt(4_000_000 / (width * height)),
    );
    const screenWidth = Math.max(640, Math.round((width * scale) / 8) * 8);
    const screenHeight = Math.max(360, Math.round((height * scale) / 2) * 2);
    const next = `${screenWidth}x${screenHeight}`;
    if (next === requestedResolution) return;
    requestedResolution = next;
    scheduleResize();
  };
  window.addEventListener("resize", () => fitScreen());
  window.addEventListener("pagehide", () => {
    window.clearTimeout(resizeTimer);
    window.removeEventListener("resize", fitScreen);
  }, {once: true});
  fitScreen();
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
    if (event.data?.type === "coder:browser-fit") {
      if (
        Number.isFinite(event.data.width) &&
        Number.isFinite(event.data.height) &&
        event.data.width >= 320 &&
        event.data.height >= 200
      ) {
        fitScreen(event.data);
      }
      return;
    }
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
