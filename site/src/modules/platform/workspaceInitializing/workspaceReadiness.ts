import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";

/**
 * Platform: an agent's apps (and its terminal, port forwarding and SSH) open
 * only once the whole workspace is ready: the agent is connected and its
 * startup scripts - the terminal's tmux, code-server, the desktop, ... - have
 * finished. A startup that failed or timed out also opens them, so one broken
 * module never locks the user out (the card's border turns orange for it).
 */
export const agentAppsReady = (agent: WorkspaceAgent): boolean =>
	agent.status === "connected" &&
	(agent.lifecycle_state === "ready" ||
		agent.lifecycle_state === "start_error" ||
		agent.lifecycle_state === "start_timeout");

/**
 * The agent of a starting (or just started) workspace is still coming up:
 * connecting, or running its startup scripts. WorkspaceInitializing shows in
 * place of its apps meanwhile.
 */
export const agentInitializing = (
	workspace: Workspace,
	agent: WorkspaceAgent,
): boolean => {
	const build = workspace.latest_build;
	if (
		build.transition !== "start" ||
		(build.status !== "starting" && build.status !== "running")
	) {
		return false;
	}
	return (
		agent.status === "connecting" ||
		(agent.status === "connected" &&
			(agent.lifecycle_state === "created" ||
				agent.lifecycle_state === "starting"))
	);
};

type InitializingStep = {
	/** What is happening now. */
	step: string;
	/** Startup scripts finished, of all that run on start (starting only). */
	scripts?: { done: number; total: number; running: string[] };
};

export const initializingStep = (agent: WorkspaceAgent): InitializingStep => {
	if (agent.status === "connecting") {
		return { step: "Waiting for the workspace agent to connect" };
	}
	const onStart = agent.scripts.filter((s) => s.run_on_start);
	if (agent.lifecycle_state === "created" || onStart.length === 0) {
		return { step: "Workspace agent connected, preparing the startup" };
	}
	const running = onStart.filter((s) => !s.status).map((s) => s.display_name);
	return {
		step: "Running the startup scripts",
		scripts: {
			done: onStart.length - running.length,
			total: onStart.length,
			running,
		},
	};
};
