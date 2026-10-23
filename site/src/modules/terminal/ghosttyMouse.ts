/**
 * Platform: mouse reporting for Ghostty's terminal (ghostty-web 0.4.0 has none: its mouse handlers only select text
 * and drag its scrollbar, and its wheel sends arrow keys). When a program turns mouse tracking on - tmux, btop, htop,
 * mc, vim with `mouse=a` - a click, a drag and the wheel go to it as the terminal's input, in the encoding it asked
 * for: SGR (mode 1006) or the classic one. Shift held, the mouse is the terminal's again (text selection), as in
 * other terminals.
 */

/** The DEC modes a program sets: what it is told about, and how. */
export type MouseModes = {
	/** 1000: presses and releases. */
	normal: boolean;
	/** 1002: and moves while a button is down. */
	buttonEvent: boolean;
	/** 1003: and every move. */
	anyEvent: boolean;
	/** 1006: SGR encoding (any size, releases say which button). */
	sgr: boolean;
};

export type MouseReport = {
	/** 0 left, 1 middle, 2 right; 64 / 65 wheel up / down; 3 for a move with no button (classic release too). */
	button: number;
	kind: "press" | "release" | "move";
	/** 1-based cell. */
	col: number;
	row: number;
	shift?: boolean;
	alt?: boolean;
	ctrl?: boolean;
};

/** The bytes a program reads for one mouse event; "" when the classic encoding cannot carry it. */
export const encodeMouse = (r: MouseReport, sgr: boolean): string => {
	let code = r.button;
	if (r.shift) code += 4;
	if (r.alt) code += 8;
	if (r.ctrl) code += 16;
	if (r.kind === "move") code += 32;
	if (sgr) {
		return `\x1b[<${code};${r.col};${r.row}${r.kind === "release" ? "m" : "M"}`;
	}
	// classic: a release is button 3, and each value is a byte (+32), so nothing past column / row 223
	if (r.kind === "release") {
		code = (code & ~3) | 3;
	}
	if (r.col > 223 || r.row > 223) {
		return "";
	}
	return `\x1b[M${String.fromCharCode(code + 32, r.col + 32, r.row + 32)}`;
};

type GhosttyTerminal = {
	cols: number;
	rows: number;
	element?: HTMLElement;
	getMode?: (mode: number, ansi?: boolean) => boolean;
	hasMouseTracking?: () => boolean;
	input: (data: string, wasUserInput?: boolean) => void;
	attachCustomWheelEventHandler?: (
		handler: (event: WheelEvent) => boolean,
	) => void;
	renderer?: {
		getMetrics?: () => { width: number; height: number };
		getCanvas?: () => HTMLCanvasElement;
	};
};

const modesOf = (t: GhosttyTerminal): MouseModes => {
	const mode = (n: number) => Boolean(t.getMode?.(n, false));
	return {
		normal: mode(1000),
		buttonEvent: mode(1002),
		anyEvent: mode(1003),
		sgr: mode(1006),
	};
};

/** Mouse reporting for a Ghostty terminal; the function it returns takes it off. */
export const attachGhosttyMouse = (t: GhosttyTerminal): (() => void) => {
	const element = t.element;
	if (!element) {
		return () => {};
	}
	const tracking = () => Boolean(t.hasMouseTracking?.());
	const cell = (event: MouseEvent) => {
		const canvas = t.renderer?.getCanvas?.() ?? element;
		const rect = canvas.getBoundingClientRect();
		const metrics = t.renderer?.getMetrics?.();
		const width = metrics?.width || rect.width / Math.max(t.cols, 1);
		const height = metrics?.height || rect.height / Math.max(t.rows, 1);
		return {
			col: Math.min(
				Math.max(Math.floor((event.clientX - rect.left) / width) + 1, 1),
				t.cols,
			),
			row: Math.min(
				Math.max(Math.floor((event.clientY - rect.top) / height) + 1, 1),
				t.rows,
			),
		};
	};
	const send = (
		event: MouseEvent,
		button: number,
		kind: MouseReport["kind"],
	) => {
		const { col, row } = cell(event);
		const data = encodeMouse(
			{ button, kind, col, row, alt: event.altKey, ctrl: event.ctrlKey },
			modesOf(t).sgr,
		);
		if (data) {
			t.input(data, true);
		}
	};
	let down: number | null = null;
	let last = "";

	const onDown = (event: MouseEvent) => {
		if (!tracking() || event.shiftKey || event.button > 2) {
			return;
		}
		// the program's, not a selection's or the scrollbar's: ahead of Ghostty's own handlers (capture)
		event.preventDefault();
		event.stopImmediatePropagation();
		down = event.button;
		send(event, event.button, "press");
		t.element?.querySelector("textarea")?.focus();
	};
	const onUp = (event: MouseEvent) => {
		if (down === null) {
			return;
		}
		const button = down;
		down = null;
		if (tracking()) {
			event.preventDefault();
			send(event, button, "release");
		}
	};
	const onMove = (event: MouseEvent) => {
		if (!tracking()) {
			return;
		}
		const modes = modesOf(t);
		if (!(modes.anyEvent || (modes.buttonEvent && down !== null))) {
			return;
		}
		const { col, row } = cell(event);
		const key = `${col}:${row}:${down}`;
		if (key === last) {
			return; // once per cell
		}
		last = key;
		send(event, down ?? 3, "move");
	};
	const onContextMenu = (event: MouseEvent) => {
		if (tracking() && !event.shiftKey) {
			event.preventDefault(); // the right button is the program's
		}
	};

	element.addEventListener("mousedown", onDown, { capture: true });
	document.addEventListener("mouseup", onUp, { capture: true });
	element.addEventListener("mousemove", onMove);
	element.addEventListener("contextmenu", onContextMenu, { capture: true });
	t.attachCustomWheelEventHandler?.((event) => {
		if (!tracking() || event.shiftKey || event.deltaY === 0) {
			return false; // Ghostty's own scrolling
		}
		send(event, event.deltaY < 0 ? 64 : 65, "press");
		return true;
	});
	return () => {
		element.removeEventListener("mousedown", onDown, { capture: true });
		document.removeEventListener("mouseup", onUp, { capture: true });
		element.removeEventListener("mousemove", onMove);
		element.removeEventListener("contextmenu", onContextMenu, {
			capture: true,
		});
		t.attachCustomWheelEventHandler?.(() => false);
	};
};
