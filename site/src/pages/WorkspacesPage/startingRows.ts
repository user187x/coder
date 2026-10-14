import { useSyncExternalStore } from "react";
import type { Workspace } from "#/api/typesGenerated";
import { agentInitializing } from "#/modules/platform/workspaceInitializing/workspaceReadiness";

/**
 * The Workspaces list's starting rows: a workspace being started, updated or
 * restarted shows a moving barber-pole stripe across its whole row until it
 * is completely initialized - its build done, every agent's startup scripts
 * finished and every app's health check answered, so the row shows its app
 * icons the moment the stripes end - or its start failed.
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
 * initializing (agentInitializing: connecting, running its startup scripts,
 * or an app's health check not answered yet - the row's app icons wait for
 * that too); with a restart, its stop too. Not once it is fully up, nor when
 * its build failed, an agent's start failed or timed out, or an app failed its
 * checks (those do not hold the others back).
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
		(resource.agents ?? []).some((agent) =>
			agentInitializing(workspace, agent),
		),
	);
};
