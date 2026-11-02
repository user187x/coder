// Only the viewer in use sets the desktop's size (vnc.html loads this module after its own). With "Remote resizing",
// the Desktop app's default, every viewer of a desktop asks the VNC server for its own window's size; two of them - a
// Desktop tab and the workspace page's Desktop panel, or two tabs - kept answering each other's change, some 18
// resizes a second, and the desktop flickered. A viewer now asks only while its page has the focus, and once when it
// gets it; the others show the desktop at the size it has (as "None" does). The other scaling modes are left alone.
import UI from "./ui.js";

const support = new URL(location.href).searchParams.get("support") === "1";
const parentOrigin = document.referrer ? new URL(document.referrer).origin : null;
let inputEnabled = false;
const notify = (type, extra = {}) => {
	if (support && parentOrigin && window.parent !== window) {
		window.parent.postMessage({type, ...extra}, parentOrigin);
	}
};
const applySupport = () => {
	if (!support || !UI.rfb) return;
	UI.rfb.viewOnly = !inputEnabled;
	UI.rfb.resizeSession = false;
	UI.rfb.scaleViewport = true;
	if (UI.connected) notify("coder:support-control-state", {enabled: inputEnabled});
};
let fitting = false;
let fitTimer;
const apply = () => {
	if (support || !UI.rfb || UI.getSetting("resize") !== "remote") {
		return;
	}
	const inUse = document.hasFocus() || fitting;
	if (UI.rfb.resizeSession !== inUse) {
		UI.rfb.resizeSession = inUse; // true asks for this window's size at once
	}
};

let observedRfb;
const observeSupport = () => {
	if (support && UI.rfb && UI.rfb !== observedRfb) {
		observedRfb = UI.rfb;
		UI.rfb.addEventListener("connect", () => {
			applySupport();
			notify("coder:support-ready");
		}, {once: true});
		UI.rfb.addEventListener("disconnect", () => notify("coder:support-ended"), {once: true});
	}
};
// Autoconnect may have started before this module loads.
observeSupport();
const connect = UI.connect;
UI.connect = function (...args) {
	const result = connect.apply(this, args);
	observeSupport();
	applySupport();
	apply();
	return result;
};
UI.addSettingChangeHandler("resize", () => setTimeout(apply)); // after noVNC's own handler, whichever came first
window.addEventListener("focus", apply);
window.addEventListener("pointerdown", apply, true);
window.addEventListener("blur", apply);
document.addEventListener("visibilitychange", apply);
apply();
applySupport();

// A dashboard resize moves focus out of the iframe. Allow its requested fit to
// finish, including noVNC's throttled requests, then return ownership to focus.
window.addEventListener("message", (event) => {
	if (support && window.parent !== window && event.source === window.parent &&
		event.origin === parentOrigin && event.data?.type === "coder:support-control" &&
		typeof event.data.enabled === "boolean") {
		inputEnabled = event.data.enabled;
		applySupport();
		return;
	}
	if (support) return;
	if (window.parent === window || event.source !== window.parent ||
		event.data?.type !== "coder:desktop-fit" || !document.referrer ||
		event.origin !== new URL(document.referrer).origin ||
		document.visibilityState !== "visible" || window.innerWidth <= 0 || window.innerHeight <= 0 ||
		!UI.rfb || UI.getSetting("resize") !== "remote") return;
	fitting = true;
	clearTimeout(fitTimer);
	UI.rfb.resizeSession = true;
	fitTimer = setTimeout(() => {
		fitting = false;
		apply();
	}, 1000);
});

if (support && UI.connected) notify("coder:support-ready");
