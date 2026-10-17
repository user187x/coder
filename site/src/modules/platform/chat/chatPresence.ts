import { PlatformAPI } from "#/api/platform";

/** No input in this tab for this long: its user is idle (grey in the People lists). */
export const IDLE_MS = 30_000;

/** This tab's id: the service tells several tabs of one user apart (online while any is open). */
export const TAB_ID =
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const INPUT_EVENTS = [
	"pointermove",
	"pointerdown",
	"keydown",
	"wheel",
	"touchstart",
	"focus",
] as const;

let running = false;
let idle = false;
let timer: number | undefined;
let lastInput = 0;

const report = (next: boolean) => {
	if (next === idle) {
		return;
	}
	idle = next;
	PlatformAPI.chatActivity(TAB_ID, idle).catch(() => {
		// The next poll still keeps the tab online; the next change says it again.
	});
};

const arm = () => {
	window.clearTimeout(timer);
	timer = window.setTimeout(() => report(true), IDLE_MS);
};

const onInput = () => {
	const now = Date.now();
	// pointermove fires constantly: a timer reset at most every second is enough
	if (now - lastInput < 1000 && !idle) {
		return;
	}
	lastInput = now;
	report(false);
	arm();
};

const onLeave = () => {
	void PlatformAPI.chatLeave(TAB_ID);
};

/**
 * The tab's presence for the chat's People lists and Admin Controls > Online Users: it reports its user idle after
 * IDLE_MS without input (pointer, keys, wheel, touch, focus) and active again at the next input, and says goodbye when
 * it closes. Its polls (with TAB_ID) keep it online meanwhile.
 */
export const startPresence = () => {
	if (running) {
		return;
	}
	running = true;
	idle = false;
	for (const event of INPUT_EVENTS) {
		window.addEventListener(event, onInput, { passive: true, capture: true });
	}
	window.addEventListener("pagehide", onLeave);
	arm();
};

export const stopPresence = () => {
	if (!running) {
		return;
	}
	running = false;
	window.clearTimeout(timer);
	for (const event of INPUT_EVENTS) {
		window.removeEventListener(event, onInput, { capture: true });
	}
	window.removeEventListener("pagehide", onLeave);
};
