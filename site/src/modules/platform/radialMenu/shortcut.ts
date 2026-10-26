type KeyEvent = Pick<
	KeyboardEvent,
	"key" | "repeat" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey"
>;

/** Canonical key names shared with the Quick Menu settings API. */
export const shortcutFromEvent = (event: KeyEvent): string | undefined => {
	if (
		["Control", "Alt", "Shift", "Meta", "Dead", "Unidentified"].includes(
			event.key,
		) ||
		event.repeat
	)
		return;
	const key =
		event.key === " "
			? "Space"
			: event.key === "+"
				? "Plus"
				: event.key.length === 1
					? event.key.toUpperCase()
					: event.key;
	return [
		event.ctrlKey && "Ctrl",
		event.altKey && "Alt",
		event.shiftKey && "Shift",
		event.metaKey && "Meta",
		key,
	]
		.filter(Boolean)
		.join("+");
};

export const matchesShortcut = (
	event: KeyEvent,
	shortcut: string,
	doc: Document = document,
): boolean => {
	if (doc.documentElement.dataset.screenBroken || event.repeat) return false;
	const plainCharacter =
		!event.ctrlKey &&
		!event.altKey &&
		!event.metaKey &&
		(event.key.length === 1 ||
			event.key === "Enter" ||
			event.key === "Tab" ||
			event.key === "Backspace" ||
			event.key === "Delete");
	if (
		plainCharacter &&
		doc.activeElement?.closest(
			"input, textarea, select, [contenteditable], .xterm, .workspace-terminal",
		)
	)
		return false;
	return shortcutFromEvent(event) === shortcut;
};
