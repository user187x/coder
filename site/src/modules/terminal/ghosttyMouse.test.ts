import { attachGhosttyMouse, encodeMouse } from "./ghosttyMouse";

describe("encodeMouse", () => {
	it("SGR: press, release (lower-case m), moves, wheel and modifiers", () => {
		expect(
			encodeMouse({ button: 0, kind: "press", col: 5, row: 3 }, true),
		).toBe("\x1b[<0;5;3M");
		expect(
			encodeMouse({ button: 0, kind: "release", col: 5, row: 3 }, true),
		).toBe("\x1b[<0;5;3m");
		expect(encodeMouse({ button: 0, kind: "move", col: 6, row: 3 }, true)).toBe(
			"\x1b[<32;6;3M",
		);
		expect(
			encodeMouse({ button: 64, kind: "press", col: 1, row: 1 }, true),
		).toBe("\x1b[<64;1;1M");
		expect(
			encodeMouse(
				{ button: 2, kind: "press", col: 300, row: 2, ctrl: true },
				true,
			),
		).toBe("\x1b[<18;300;2M");
	});

	it("classic: bytes plus 32, a release is button 3, nothing past cell 223", () => {
		expect(
			encodeMouse({ button: 0, kind: "press", col: 1, row: 1 }, false),
		).toBe("\x1b[M !!");
		expect(
			encodeMouse({ button: 0, kind: "release", col: 1, row: 1 }, false),
		).toBe("\x1b[M#!!");
		expect(
			encodeMouse({ button: 0, kind: "press", col: 224, row: 1 }, false),
		).toBe("");
	});
});

describe("attachGhosttyMouse", () => {
	const setup = (modes: number[]) => {
		const element = document.createElement("div");
		document.body.append(element);
		const canvas = document.createElement("canvas");
		element.append(canvas);
		canvas.getBoundingClientRect = () =>
			({ left: 0, top: 0, width: 800, height: 480 }) as DOMRect;
		const sent: string[] = [];
		let wheel: ((e: WheelEvent) => boolean) | undefined;
		const term = {
			cols: 80,
			rows: 24,
			element,
			getMode: (n: number) => modes.includes(n),
			hasMouseTracking: () => modes.some((m) => m >= 1000 && m <= 1003),
			input: (data: string) => sent.push(data),
			attachCustomWheelEventHandler: (h: (e: WheelEvent) => boolean) => {
				wheel = h;
			},
			renderer: {
				getMetrics: () => ({ width: 10, height: 20 }),
				getCanvas: () => canvas,
			},
		};
		const detach = attachGhosttyMouse(term);
		return { element, sent, wheel: () => wheel, detach };
	};

	it("a program tracking the mouse gets the click (its cell), the release and the wheel", () => {
		const { element, sent, wheel, detach } = setup([1000, 1006]);
		element.dispatchEvent(
			new MouseEvent("mousedown", {
				button: 0,
				clientX: 45,
				clientY: 50,
				bubbles: true,
			}),
		);
		document.dispatchEvent(
			new MouseEvent("mouseup", {
				button: 0,
				clientX: 45,
				clientY: 50,
				bubbles: true,
			}),
		);
		expect(sent).toEqual(["\x1b[<0;5;3M", "\x1b[<0;5;3m"]);
		expect(
			wheel()?.(
				new WheelEvent("wheel", { deltaY: -50, clientX: 0, clientY: 0 }),
			),
		).toBe(true);
		expect(sent.at(-1)).toBe("\x1b[<64;1;1M");
		detach();
	});

	it("no tracking, or Shift held: the terminal's own (selection, scrolling)", () => {
		const off = setup([]);
		off.element.dispatchEvent(
			new MouseEvent("mousedown", { button: 0, bubbles: true }),
		);
		expect(off.sent).toEqual([]);
		expect(off.wheel()?.(new WheelEvent("wheel", { deltaY: 10 }))).toBe(false);
		off.detach();
		const on = setup([1000]);
		on.element.dispatchEvent(
			new MouseEvent("mousedown", { button: 0, shiftKey: true, bubbles: true }),
		);
		expect(on.sent).toEqual([]);
		on.detach();
	});
});
