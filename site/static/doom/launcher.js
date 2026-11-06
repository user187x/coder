// The launcher's script, a file of its own: the dashboard's Content-Security-Policy (script-src 'self') runs no
// inline script or handler attribute.
// Offline DOOM: the Chocolate Doom WebAssembly engine (see README.md) with Freedoom's game data, all served here.
// Music is off, as in the engine's own page: its software synthesizer runs on the page's thread and starves the game.
// The engine loads on the first click (a user gesture, so its sound may start) and runs its main with these
// arguments as soon as the game data is in place.
var IWAD = "freedoom1.wad";
// The game takes the right mouse button; the browser's menu would cover it.
document.getElementById("canvas").addEventListener("contextmenu", (event) => event.preventDefault());
var start = document.getElementById("start");
var label = document.getElementById("status");
var loading = false;
var Module = {
  arguments: ["-iwad", IWAD, "-window", "-nogui", "-nomusic", "-config", "default.cfg"],
  canvas: document.getElementById("canvas"),
  preRun: [() => {
    Module.FS.createPreloadedFile("", IWAD, IWAD, true, true);
    Module.FS.createPreloadedFile("", "default.cfg", "default.cfg", true, true);
  }],
  onRuntimeInitialized: () => {
    start.hidden = true;
    Module.canvas.focus();
  },
  // Quitting from the game's menu ends the overlay in the dashboard too.
  onExit: () => { parent.postMessage({ type: "coder:doom-exit" }, location.origin); },
  setStatus: () => {},
};
var play = () => {
  if (loading) return;
  loading = true;
  label.textContent = "LOADING…";
  var engine = document.createElement("script");
  engine.src = "websockets-doom.js";
  engine.onerror = () => { label.textContent = "DOOM ENGINE NOT INSTALLED (scripts/build-doom.sh)"; };
  document.body.appendChild(engine);
};
start.addEventListener("click", play);
start.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") play(); });
window.addEventListener("load", () => { start.focus(); });
window.onerror = () => { label.textContent = "DOOM COULD NOT START"; };
