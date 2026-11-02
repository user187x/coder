// The desktop's clipboard and the computer's, both ways, without noVNC's Clipboard panel (noVNC 1.6 has only the
// panel; vnc.html loads this module after its own). The page is served over HTTPS by Coder's app proxy, where browsers
// allow it:
//   - copied on the desktop (its CLIPBOARD: the VNC server sends it) -> the computer's clipboard (writeText; the
//     browser allows it while the page has the focus, which it has: the copy was a key or a click in it);
//   - Ctrl+V, Ctrl+Shift+V or Shift+Insert in the desktop -> the browser's own paste (no permission needed) hands the
//     computer's clipboard to the desktop first, then the key goes on, so the desktop pastes it at once;
//   - coming back to the page (focus, the pointer in) -> where the browser lets the page read the clipboard
//     (Chromium, once allowed), it goes to the desktop too, for a paste by the mouse.
// The panel stays, and shows what the clipboard holds.
import UI from "./ui.js";

const XK_v = 0x76;
const XK_V = 0x56;
const XK_Insert = 0xff63;

const clipboard = navigator.clipboard;
// The text both sides hold now: never sent back to where it came from.
let last = null;

const panel = () => document.getElementById("noVNC_clipboard_text");

/** The desktop copied: to the computer's clipboard. */
const fromDesktop = (e) => {
	last = e.detail.text;
	if (clipboard?.writeText) {
		clipboard.writeText(last).catch(() => {});
	}
};

/** The computer's clipboard: to the desktop's. */
const toDesktop = (text) => {
	if (typeof text !== "string" || text === "" || text === last || !UI.rfb) {
		return;
	}
	last = text;
	if (panel()) {
		panel().value = text;
	}
	UI.rfb.clipboardPasteFrom(text);
};

// The connection's clipboard events, whenever it is made (now or later).
const watched = new WeakSet();
const watch = () => {
	if (UI.rfb && !watched.has(UI.rfb)) {
		watched.add(UI.rfb);
		UI.rfb.addEventListener("clipboard", fromDesktop);
	}
};
const connect = UI.connect;
UI.connect = function (...args) {
	const result = connect.apply(this, args);
	watch();
	return result;
};
watch();

// A paste key: noVNC would send the key and stop the browser's paste, so it never sees it; the browser's paste goes
// first instead (the paste event below), then the key. If no paste event comes (nothing to paste), the key goes on.
let pending = null;
const pasteKey = (e) =>
	(e.ctrlKey && !e.altKey && !e.metaKey && e.code === "KeyV") ||
	(e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && e.code === "Insert");
const sendPending = () => {
	if (pending && UI.rfb) {
		UI.rfb.sendKey(pending.keysym, pending.code);
	}
	clearTimeout(pending?.timer);
	pending = null;
};
window.addEventListener(
	"keydown",
	(e) => {
		if (!UI.rfb || !pasteKey(e) || !document.getElementById("noVNC_container").contains(e.target)) {
			return;
		}
		e.stopImmediatePropagation(); // past noVNC; the browser's paste is not prevented
		sendPending();
		pending = {
			keysym: e.code === "Insert" ? XK_Insert : e.shiftKey ? XK_V : XK_v,
			code: e.code,
			timer: setTimeout(sendPending, 150),
		};
	},
	true,
);
window.addEventListener(
	"keyup",
	(e) => {
		if (UI.rfb && pasteKey(e) && document.getElementById("noVNC_container").contains(e.target)) {
			e.stopImmediatePropagation(); // its press went as sendKey (down and up)
		}
	},
	true,
);
document.addEventListener(
	"paste",
	(e) => {
		if (e.target === panel()) {
			return; // the panel's own paste: noVNC sends the panel's text
		}
		toDesktop(e.clipboardData?.getData("text/plain"));
		if (pending) {
			e.preventDefault();
			sendPending();
		}
	},
	true,
);

// Back on the page: the computer's clipboard to the desktop, where the browser lets the page read it (Chromium asks
// once; Firefox would ask at every read, so it is left to the paste keys there).
let reading = false;
const pull = async () => {
	if (reading || !UI.rfb || !clipboard?.readText || !document.hasFocus()) {
		return;
	}
	try {
		const state = (await navigator.permissions.query({ name: "clipboard-read" })).state;
		if (state === "denied") {
			return;
		}
	} catch {
		return; // no such permission (Firefox): the paste keys only
	}
	reading = true;
	try {
		toDesktop(await clipboard.readText());
	} catch {
		// not allowed (yet), or the page lost the focus
	} finally {
		reading = false;
	}
};
window.addEventListener("focus", pull);
document.addEventListener("visibilitychange", () => {
	if (!document.hidden) {
		pull();
	}
});
document.getElementById("noVNC_container")?.addEventListener("pointerenter", pull);
