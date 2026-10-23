/**
 * Platform: what a terminal page says to the dashboard panel that shows it (in a frame) or popped it out (a window it
 * opened) when its shell exits: the panel rolls up and starts over, as the agent's Terminal drop-down does.
 */
export const TERMINAL_EXITED = "platform:terminal-exited";

/** Whether a message is a terminal's exit, from this origin and the given window (the panel's frame or pop-out). */
export const isTerminalExit = (
	event: MessageEvent,
	from: (Window | null | undefined)[],
): boolean =>
	event.origin === window.location.origin &&
	(event.data as { type?: unknown } | null)?.type === TERMINAL_EXITED &&
	from.some((w) => w && event.source === w);
