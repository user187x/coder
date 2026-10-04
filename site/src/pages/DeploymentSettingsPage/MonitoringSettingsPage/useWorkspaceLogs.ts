import { useEffect, useRef, useState } from "react";
import {
	PlatformAPI,
	type WorkspaceLogLine,
	type WorkspaceLogs,
} from "#/api/platform";

const POLL_MS = 1000;
const CATCH_UP_MS = 50;
const RETRY_MS = 5000;
/** The page keeps at most this many lines; the service keeps 5 MB per workspace. */
export const MAX_SHOWN_LINES = 3000;

type LogStreamState = {
	lines: WorkspaceLogLine[];
	info: Omit<WorkspaceLogs, "lines"> | null;
	error: string | null;
};

/**
 * Follows a workspace pod's log, streamed by the platform service into its
 * temporary log database: new lines are fetched every second (at once while
 * catching up), and only the newest MAX_SHOWN_LINES are kept on the page.
 */
export const useWorkspaceLogs = (workspaceId: string, paused: boolean) => {
	const [state, setState] = useState<LogStreamState>({
		lines: [],
		info: null,
		error: null,
	});
	const after = useRef(0);

	useEffect(() => {
		if (paused) {
			return;
		}
		let stopped = false;
		let timer: number | undefined;
		const tick = async () => {
			if (stopped) {
				return;
			}
			try {
				const { lines, ...info } = await PlatformAPI.getWorkspaceLogs(
					workspaceId,
					after.current,
				);
				if (stopped) {
					return;
				}
				const last = lines.at(-1);
				if (last) {
					after.current = last[0];
				}
				setState((current) => ({
					info,
					error: null,
					lines: lines.length
						? [...current.lines, ...lines].slice(-MAX_SHOWN_LINES)
						: current.lines,
				}));
				timer = window.setTimeout(
					tick,
					lines.length >= 2000 ? CATCH_UP_MS : POLL_MS,
				);
			} catch (error) {
				if (stopped) {
					return;
				}
				setState((current) => ({
					...current,
					error:
						error instanceof Error ? error.message : "Logs are not available.",
				}));
				timer = window.setTimeout(tick, RETRY_MS);
			}
		};
		void tick();
		return () => {
			stopped = true;
			window.clearTimeout(timer);
		};
	}, [workspaceId, paused]);

	return {
		...state,
		clear: () => setState((current) => ({ ...current, lines: [] })),
	};
};
