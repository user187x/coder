import { useSyncExternalStore } from "react";
import type { Workspace } from "#/api/typesGenerated";

/**
 * The Workspaces list's starting rows: a workspace being started, updated or
 * restarted shows a moving barber-pole stripe across its whole row until it
 * has started (its build done and every agent ready) or failed.
 */

const restarting = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
	version++;
	for (const listener of listeners) {
		listener();
	}
};

/** A restart from the list: its stop comes first, which is part of starting it again. */
export const markRestarting = (workspaceId: string, on: boolean) => {
	if (on === restarting.has(workspaceId)) {
		return;
	}
	if (on) {
		restarting.add(workspaceId);
	} else {
		restarting.delete(workspaceId);
	}
	changed();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/** Whether the workspace is being restarted from the list (re-renders when that changes). */
export const useRestarting = (workspaceId: string): boolean => {
	useSyncExternalStore(subscribe, () => version);
	return restarting.has(workspaceId);
};

/**
 * Whether the workspace is on its way up: a start (or update, which is a
 * start of the new version) queued or running, or done with an agent still
 * starting; with a restart, its stop too. Not once it runs with every agent
 * ready, nor when its build or an agent's start failed.
 */
export const isStartingUp = (
	workspace: Workspace,
	restartingNow = false,
): boolean => {
	const build = workspace.latest_build;
	if (
		["failed", "canceled", "canceling", "deleting", "deleted"].includes(
			build.status,
		)
	) {
		return false;
	}
	if (
		restartingNow &&
		(build.transition === "stop" ||
			build.status === "pending" ||
			build.status === "starting")
	) {
		return true;
	}
	if (build.transition !== "start") {
		return false;
	}
	if (build.status === "pending" || build.status === "starting") {
		return true;
	}
	if (build.status !== "running") {
		return false;
	}
	return build.resources.some((resource) =>
		(resource.agents ?? []).some(
			(agent) =>
				agent.lifecycle_state === "created" ||
				agent.lifecycle_state === "starting",
		),
	);
};
