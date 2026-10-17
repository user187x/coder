import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { appsStarting } from "../workspaceInitializing/workspaceReadiness";

/**
 * Which effect the workspace page's agent card wears (AgentBorderFx):
 *   initializing  the electric green border: the workspace is starting and the
 *                 agent is connecting or running its startup scripts, or its
 *                 apps have not answered their health checks yet
 *   pending       the same border in fiery orange: the build is queued
 *                 (pending), or something went wrong without stopping the
 *                 workspace (a startup script / module failed or timed out, the
 *                 agent timed out connecting, a dev container failed)
 *   failed        the same border in red: the build failed, or the agent of a
 *                 running workspace is disconnected
 *   ready         the rotating green border: started, connected, scripts done
 *   null          Coder's own border (stopped, stopping, deleted, ...)
 */
export type AgentBorderState =
	| "initializing"
	| "pending"
	| "failed"
	| "ready"
	/** No contact with Coder about the workspace (the workspace page's check): a still grey border. */
	| "lost";

type Problems = {
	/** A startup script (or module) failed or timed out. */
	scriptIssues: boolean;
	/** Dev container errors, or subdomain apps without a wildcard hostname. */
	otherIssues: boolean;
};

export const agentBorderState = (
	workspace: Workspace,
	agent: WorkspaceAgent,
	{ scriptIssues, otherIssues }: Problems,
): AgentBorderState | null => {
	const build = workspace.latest_build;
	if (build.status === "failed") {
		return "failed";
	}
	if (build.status === "pending") {
		return "pending";
	}
	if (build.transition !== "start") {
		return null;
	}
	if (build.status === "starting") {
		return "initializing";
	}
	if (build.status !== "running") {
		return null;
	}
	if (agent.status === "disconnected") {
		return "failed";
	}
	if (
		agent.status === "timeout" ||
		agent.lifecycle_state === "start_timeout" ||
		agent.lifecycle_state === "start_error" ||
		scriptIssues ||
		otherIssues
	) {
		return "pending";
	}
	if (
		agent.status === "connecting" ||
		agent.lifecycle_state === "created" ||
		agent.lifecycle_state === "starting" ||
		appsStarting(agent).length > 0
	) {
		return "initializing";
	}
	if (agent.status === "connected" && agent.lifecycle_state === "ready") {
		return "ready";
	}
	return null;
};
