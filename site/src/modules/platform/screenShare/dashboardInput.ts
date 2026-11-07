/** Input is limited to the consented dashboard document; no selectors or executable code cross the channel. */
export type DashboardInput =
	| { type: "move"; x: number; y: number }
	| { type: "click"; x: number; y: number; button: 0 | 2; count: 1 | 2 }
	| { type: "wheel"; x: number; y: number; dx: number; dy: number }
	| {
			type: "key";
			key: string;
			ctrl: boolean;
			alt: boolean;
			shift: boolean;
			meta: boolean;
	  }
	| { type: "text"; text: string };

const protectedSelector =
	'[data-dashboard-support-ignore],iframe,input[type="password"],input[type="file"],[autocomplete="one-time-code"]';
const point = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= 1;
const delta = (value: unknown): value is number =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	Math.abs(value) <= 2000;
export const parseDashboardInput = (raw: unknown): DashboardInput | null => {
	if (typeof raw !== "string" || raw.length > 8192) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object" || !("type" in value)) return null;
	if (
		value.type === "text" &&
		"text" in value &&
		typeof value.text === "string" &&
		value.text.length <= 4096
	)
		return { type: "text", text: value.text };
	if (
		value.type === "key" &&
		"key" in value &&
		typeof value.key === "string" &&
		value.key.length <= 32 &&
		"ctrl" in value &&
		typeof value.ctrl === "boolean" &&
		"alt" in value &&
		typeof value.alt === "boolean" &&
		"shift" in value &&
		typeof value.shift === "boolean" &&
		"meta" in value &&
		typeof value.meta === "boolean"
	)
		return {
			type: "key",
			key: value.key,
			ctrl: value.ctrl,
			alt: value.alt,
			shift: value.shift,
			meta: value.meta,
		};
	if (!("x" in value) || !point(value.x) || !("y" in value) || !point(value.y))
		return null;
	if (value.type === "move") return { type: "move", x: value.x, y: value.y };
	if (
		value.type === "click" &&
		"button" in value &&
		(value.button === 0 || value.button === 2) &&
		"count" in value &&
		(value.count === 1 || value.count === 2)
	)
		return {
			type: "click",
			x: value.x,
			y: value.y,
			button: value.button,
			count: value.count,
		};
	if (
		value.type === "wheel" &&
		"dx" in value &&
		delta(value.dx) &&
		"dy" in value &&
		delta(value.dy)
	)
		return {
			type: "wheel",
			x: value.x,
			y: value.y,
			dx: value.dx,
			dy: value.dy,
		};
	return null;
};

/** The sharer's echo of where it applied the controller's last move. */
export const parseDashboardPointer = (
	raw: unknown,
): { x: number; y: number } | null => {
	if (typeof raw !== "string" || raw.length > 256) return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (
			value &&
			typeof value === "object" &&
			"type" in value &&
			value.type === "dashboard-pointer" &&
			"x" in value &&
			point(value.x) &&
			"y" in value &&
			point(value.y)
		)
			return { x: value.x, y: value.y };
	} catch {
		// Not JSON: ignore like any other unknown message.
	}
	return null;
};

let hovered: HTMLElement | null = null;

const allowed = (element: Element | null): element is HTMLElement =>
	element instanceof HTMLElement &&
	!element.closest(protectedSelector) &&
	!element.closest('[inert],[aria-hidden="true"]') &&
	!element.matches(':disabled,[aria-disabled="true"]');
const editable = (
	element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement =>
	(element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement) &&
	!element.readOnly &&
	!element.disabled &&
	![
		"checkbox",
		"radio",
		"range",
		"button",
		"submit",
		"reset",
		"color",
	].includes(element.type);
const focusables = () =>
	Array.from(
		document.querySelectorAll<HTMLElement>(
			"button,input,textarea,select,a[href],[tabindex]",
		),
	).filter(
		(element) =>
			allowed(element) &&
			element.tabIndex >= 0 &&
			element.getClientRects().length > 0,
	);

const insertText = (
	element: HTMLInputElement | HTMLTextAreaElement,
	text: string,
	start = element.selectionStart ?? element.value.length,
	end = element.selectionEnd ?? start,
) => {
	const next = element.value.slice(0, start) + text + element.value.slice(end);
	if (element.maxLength >= 0 && next.length > element.maxLength) return;
	if (
		!element.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: text ? "insertText" : "deleteContentBackward",
				data: text,
			}),
		)
	)
		return;
	// The native setter lets React observe the input event, including controlled inputs.
	const prototype =
		element instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, next);
	try {
		element.setSelectionRange(start + text.length, start + text.length);
	} catch {
		/* Number inputs have no selection API. */
	}
	element.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			inputType: text ? "insertText" : "deleteContentBackward",
			data: text,
		}),
	);
	element.dispatchEvent(new Event("change", { bubbles: true }));
};

export const applyDashboardInput = (
	input: DashboardInput,
	locate: (x: number, y: number) => Element | null = (x, y) =>
		document.elementFromPoint(x, y),
) => {
	if (
		input.type === "move" ||
		input.type === "click" ||
		input.type === "wheel"
	) {
		const x = Math.min(innerWidth - 1, input.x * innerWidth);
		const y = Math.min(innerHeight - 1, input.y * innerHeight);
		let element = locate(x, y);
		while (element && !(element instanceof HTMLElement))
			element = element.parentElement;
		if (!allowed(element)) return;
		if (input.type === "move") {
			const options = {
				bubbles: true,
				clientX: x,
				clientY: y,
				pointerId: 1,
				pointerType: "mouse",
				isPrimary: true,
			};
			// Over and out drive React's enter and leave handlers, so hover menus and tooltips respond.
			if (hovered !== element) {
				const previous = hovered;
				hovered = element;
				if (previous?.isConnected) {
					previous.dispatchEvent(
						new PointerEvent("pointerout", {
							...options,
							relatedTarget: element,
						}),
					);
					previous.dispatchEvent(
						new MouseEvent("mouseout", { ...options, relatedTarget: element }),
					);
				}
				element.dispatchEvent(
					new PointerEvent("pointerover", {
						...options,
						relatedTarget: previous,
					}),
				);
				element.dispatchEvent(
					new MouseEvent("mouseover", { ...options, relatedTarget: previous }),
				);
			}
			element.dispatchEvent(new PointerEvent("pointermove", options));
			element.dispatchEvent(new MouseEvent("mousemove", options));
			return;
		}
		if (input.type === "wheel") {
			let scroll: HTMLElement | null = element;
			while (
				scroll &&
				!(
					scroll.scrollHeight > scroll.clientHeight &&
					/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)
				)
			)
				scroll = scroll.parentElement;
			if (scroll)
				scroll.scrollBy({ left: input.dx, top: input.dy, behavior: "instant" });
			else
				window.scrollBy({ left: input.dx, top: input.dy, behavior: "instant" });
			return;
		}
		const link = element.closest("a[href]");
		if (
			link instanceof HTMLAnchorElement &&
			(new URL(link.href, location.href).origin !== location.origin ||
				link.hasAttribute("download"))
		)
			return;
		const options = {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y,
			button: input.button,
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true,
		};
		if (input.button === 2) {
			element.dispatchEvent(new MouseEvent("contextmenu", options));
			return;
		}
		const focus = element.closest<HTMLElement>(
			"button,input,textarea,select,a[href],[tabindex]",
		);
		if (focus && allowed(focus)) focus.focus({ preventScroll: true });
		for (let i = 0; i < input.count; i++) {
			element.dispatchEvent(
				new PointerEvent("pointerdown", { ...options, buttons: 1 }),
			);
			element.dispatchEvent(
				new MouseEvent("mousedown", { ...options, buttons: 1 }),
			);
			element.dispatchEvent(new PointerEvent("pointerup", options));
			element.dispatchEvent(new MouseEvent("mouseup", options));
			element.click();
		}
		if (input.count === 2)
			element.dispatchEvent(
				new MouseEvent("dblclick", { ...options, detail: 2 }),
			);
		return;
	}
	const element = document.activeElement;
	if (!allowed(element)) return;
	if (input.type === "text") {
		if (editable(element)) insertText(element, input.text);
		return;
	}
	const event = {
		key: input.key,
		ctrlKey: input.ctrl,
		altKey: input.alt,
		shiftKey: input.shift,
		metaKey: input.meta,
		bubbles: true,
		cancelable: true,
	};
	if (!element.dispatchEvent(new KeyboardEvent("keydown", event))) return;
	if (input.key === "Tab") {
		const items = focusables();
		const next =
			(items.indexOf(element) + (input.shift ? -1 : 1) + items.length) %
			items.length;
		items[next]?.focus();
	} else if (editable(element)) {
		const start = element.selectionStart ?? element.value.length;
		const end = element.selectionEnd ?? start;
		if ((input.ctrl || input.meta) && input.key.toLowerCase() === "a")
			element.select();
		else if (!input.ctrl && !input.meta && !input.alt) {
			if (input.key.length === 1) insertText(element, input.key);
			else if (input.key === "Backspace")
				insertText(
					element,
					"",
					start === end ? Math.max(0, start - 1) : start,
					end,
				);
			else if (input.key === "Delete")
				insertText(element, "", start, start === end ? end + 1 : end);
			else if (input.key === "Enter") {
				if (element instanceof HTMLTextAreaElement) insertText(element, "\n");
				else element.form?.requestSubmit();
			} else if (
				["ArrowLeft", "ArrowRight", "Home", "End"].includes(input.key)
			) {
				const cursor =
					input.key === "Home"
						? 0
						: input.key === "End"
							? element.value.length
							: input.key === "ArrowLeft"
								? Math.max(0, start - 1)
								: Math.min(element.value.length, end + 1);
				try {
					element.setSelectionRange(input.shift ? start : cursor, cursor);
				} catch {
					/* Number inputs have no caret. */
				}
			}
		}
	} else if (
		(input.key === "Enter" || input.key === " ") &&
		element.matches('button,a[href],input[type="checkbox"],input[type="radio"]')
	) {
		if (
			!(element instanceof HTMLAnchorElement) ||
			new URL(element.href, location.href).origin === location.origin
		)
			element.click();
	}
	element.dispatchEvent(new KeyboardEvent("keyup", event));
};
