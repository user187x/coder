/**
 * Terminal sessions that can really be ended. Coder's agent keeps a terminal
 * session (a "reconnecting PTY", keyed by its reconnect id) running for a few
 * minutes after its last connection closes, and its protocol has no "end
 * session" message. So the session's first connection runs the user's login
 * shell through a small wrapper that records the shell's process id and marks
 * its environment; ending the session runs a one-off command in the workspace
 * that sends that shell SIGHUP (what closing a terminal window does), and
 * SIGKILL a second later if it is still there. On Linux the mark is checked
 * first, so a reused process id is never hit.
 *
 * Windows agents get Coder's plain session: closing only disconnects, and the
 * agent ends the session after its idle timeout.
 */

import { generateConnectionSessionId, generateUUID } from "#/utils/random";
import { terminalWebsocketUrl } from "#/utils/terminal";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const END_ON_CLOSE_KEY = "coder-ui-terminal-end-on-close";
const END_WAIT_MS = 10_000;

export type TerminalSession = {
	id: string;
	/** Started through the wrapper, so it can be ended from here. */
	wrapped: boolean;
};

const sessionKey = (agentId: string) => `coder-ui-terminal:${agentId}`;

const isSession = (value: unknown): value is TerminalSession =>
	typeof value === "object" &&
	value !== null &&
	"id" in value &&
	typeof value.id === "string" &&
	UUID_RE.test(value.id) &&
	"wrapped" in value &&
	typeof value.wrapped === "boolean";

/** The session survives reloads of this tab (sessionStorage), not other tabs. */
export const loadSession = (agentId: string): TerminalSession | null => {
	try {
		const parsed: unknown = JSON.parse(
			sessionStorage.getItem(sessionKey(agentId)) ?? "null",
		);
		return isSession(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

export const saveSession = (
	agentId: string,
	session: TerminalSession | null,
) => {
	try {
		if (session) {
			sessionStorage.setItem(sessionKey(agentId), JSON.stringify(session));
		} else {
			sessionStorage.removeItem(sessionKey(agentId));
		}
	} catch {
		// The agent still ends the session after its idle timeout.
	}
};

export const newSession = (operatingSystem: string): TerminalSession => ({
	id: generateUUID(),
	wrapped: operatingSystem !== "windows",
});

/** "End session when closed": on by default, remembered per browser. */
export const readEndOnClose = (): boolean => {
	try {
		return localStorage.getItem(END_ON_CLOSE_KEY) !== "0";
	} catch {
		return true;
	}
};

export const writeEndOnClose = (on: boolean) => {
	try {
		localStorage.setItem(END_ON_CLOSE_KEY, on ? "1" : "0");
	} catch {
		// Not remembered.
	}
};

// Run with the user's login shell -c: one `exec`, the rest single-quoted for
// /bin/sh, with no backslashes or single quotes inside (fish treats those
// differently).
const pidFile = (id: string) => `/tmp/coder-ui-terminal-${id}.pid`;

export const startCommand = (session: TerminalSession): string | undefined =>
	session.wrapped
		? "exec /bin/sh -c '" +
			`echo $$ >${pidFile(session.id)}; s=$SHELL; [ -n "$s" ] || s=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7); ` +
			`exec env CODER_UI_TERMINAL=${session.id} "\${s:-/bin/sh}" -l'`
		: undefined;

const endCommand = (id: string) =>
	"exec /bin/sh -c '" +
	`f=${pidFile(id)}; p=$(cat "$f" 2>/dev/null); rm -f "$f"; case "$p" in ""|*[!0-9]*) exit 0;; esac; ` +
	`if [ -r /proc/self/environ ]; then case "$(tr "\\000" " " <"/proc/$p/environ" 2>/dev/null)" in *"CODER_UI_TERMINAL=${id} "*) ;; *) exit 0;; esac; fi; ` +
	`kill -HUP "$p" 2>/dev/null || exit 0; sleep 1; kill -0 "$p" 2>/dev/null && kill -KILL "$p"; exit 0'`;

/**
 * Ends the session's shell. true: ended; false: the workspace did not
 * confirm it in time; null: nothing to end from here (Windows), the agent
 * ends it when idle.
 */
export const endSession = async (
	agentId: string,
	session: TerminalSession,
	baseUrl: string | undefined,
): Promise<boolean | null> => {
	if (!session.wrapped) {
		return null;
	}
	const url = await terminalWebsocketUrl(
		baseUrl,
		generateUUID(),
		agentId,
		endCommand(session.id),
		24,
		80,
		undefined,
		undefined,
		generateConnectionSessionId(),
	);
	return new Promise((resolve) => {
		let opened = false;
		let settled = false;
		let socket: WebSocket | null = null;
		const done = (ok: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			window.clearTimeout(timer);
			socket?.close(1000);
			resolve(ok);
		};
		const timer = window.setTimeout(() => done(false), END_WAIT_MS);
		try {
			socket = new WebSocket(url);
		} catch {
			done(false);
			return;
		}
		socket.onopen = () => {
			opened = true;
		};
		// The agent closes the connection once the command has run.
		socket.onclose = () => done(opened);
	});
};
