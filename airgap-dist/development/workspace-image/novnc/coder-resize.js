// Only the viewer in use sets the desktop's size (vnc.html loads this module after its own). With "Remote resizing",
// the Desktop app's default, every viewer of a desktop asks the VNC server for its own window's size; two of them - a
// Desktop tab and the workspace page's Desktop panel, or two tabs - kept answering each other's change, some 18
// resizes a second, and the desktop flickered. A viewer now asks only while its page has the focus, and once when it
// gets it; the others show the desktop at the size it has (as "None" does). The other scaling modes are left alone.
import UI from "./ui.js";

const apply = () => {
	if (!UI.rfb || UI.getSetting("resize") !== "remote") {
		return;
	}
	const inUse = document.hasFocus();
	if (UI.rfb.resizeSession !== inUse) {
		UI.rfb.resizeSession = inUse; // true asks for this window's size at once
	}
};

// After noVNC's own: when it connects, and when the scaling setting changes.
const connect = UI.connect;
UI.connect = function (...args) {
	const result = connect.apply(this, args);
	apply();
	return result;
};
UI.addSettingChangeHandler("resize", () => setTimeout(apply)); // after noVNC's own handler, whichever came first
window.addEventListener("focus", apply);
window.addEventListener("pointerdown", apply, true);
window.addEventListener("blur", apply);
document.addEventListener("visibilitychange", apply);
apply();
