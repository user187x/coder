import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";

/** The startup scripts are done (or failed, or timed out). */
const startupDone = (agent: WorkspaceAgent): boolean =>
	agent.status === "connected" &&
	(agent.lifecycle_state === "ready" ||
		agent.lifecycle_state === "start_error" ||
		agent.lifecycle_state === "start_timeout");

/**
 * Apps whose health check has not answered yet. Apps started in the
 * background by the startup script (code-server, File Browser) are
 * still coming up when the script ends. An app that fails its checks is
 * "unhealthy", not "initializing", so it does not hold the others back.
 */
export const appsStarting = (agent: WorkspaceAgent) =>
	agent.apps.filter((app) => !app.hidden && app.health === "initializing");

/**
 * Platform: an agent's apps (and its terminal, port forwarding and SSH) open
 * only once the whole workspace is ready: the agent is connected, its startup
 * scripts - the terminal's tmux, the desktop, ... - have finished, and every
 * app with a health check has answered it. A startup that failed or timed out
 * also opens them, and so does an app that fails its checks, so one broken
 * module never locks the user out (the card's border turns orange for it).
 */
export const agentAppsReady = (agent: WorkspaceAgent): boolean =>
	startupDone(agent) && appsStarting(agent).length === 0;

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
				agent.lifecycle_state === "starting")) ||
		(startupDone(agent) && appsStarting(agent).length > 0)
	);
};

type InitializingStep = {
	/** What is happening now. */
	step: string;
	/**
	 * Progress: startup scripts finished of those that run on start, or apps up
	 * of those with a health check; and the ones still going.
	 */
	progress?: {
		of: "scripts" | "apps";
		done: number;
		total: number;
		pending: string[];
	};
};

export const initializingStep = (agent: WorkspaceAgent): InitializingStep => {
	if (agent.status === "connecting") {
		return { step: "Waiting for the workspace agent to connect" };
	}
	if (startupDone(agent)) {
		const checked = agent.apps.filter(
			(app) => !app.hidden && app.health !== "disabled",
		);
		const pending = appsStarting(agent).map(
			(app) => app.display_name || app.slug,
		);
		return {
			step: "Starting the apps",
			progress: {
				of: "apps",
				done: checked.length - pending.length,
				total: checked.length,
				pending,
			},
		};
	}
	const onStart = agent.scripts.filter((s) => s.run_on_start);
	if (agent.lifecycle_state === "created" || onStart.length === 0) {
		return { step: "Workspace agent connected, preparing the startup" };
	}
	const running = onStart.filter((s) => !s.status).map((s) => s.display_name);
	return {
		step: "Running the startup scripts",
		progress: {
			of: "scripts",
			done: onStart.length - running.length,
			total: onStart.length,
			pending: running,
		},
	};
};

/**
 * How far the whole start has come, in milestones: the agent connecting, each
 * startup script finishing, each app answering its health check (healthy or
 * unhealthy). The progress bar moves on these, not on a timer.
 */
export const initializingMilestones = (
	agent: WorkspaceAgent,
): { done: number; total: number } => {
	const scripts = agent.scripts.filter((s) => s.run_on_start);
	const apps = agent.apps.filter(
		(app) => !app.hidden && app.health !== "disabled",
	);
	const connected = agent.status === "connected" ? 1 : 0;
	const scriptsDone = startupDone(agent)
		? scripts.length
		: scripts.filter((s) => s.status).length;
	const appsDone = apps.filter((app) => app.health !== "initializing").length;
	return {
		done: connected + scriptsDone + appsDone,
		total: 1 + scripts.length + apps.length,
	};
};
