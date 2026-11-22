import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { DetailedError, getErrorDetail } from "#/api/errors";
import { PlatformError } from "#/api/platform";
import { workspacesKey } from "#/api/queries/workspaces";
import type { Workspace, WorkspaceBuild } from "#/api/typesGenerated";
import { getWorkspaceStartup } from "#/api/workspaceMetrics";
import { delay } from "#/utils/delay";

// Concurrent starts unpack workspace images and compete for host resources.
const WORKSPACE_START_CONCURRENCY = 2;

/** A completed stop build can leave a pod holding resources during shutdown. */
async function waitForWorkspacePodShutdown(
	workspace: Workspace,
): Promise<void> {
	const deadline = Date.now() + 180_000;
	let waitingForPods = false;
	while (Date.now() < deadline) {
		try {
			const startup = await getWorkspaceStartup(
				workspace.organization_id,
				workspace.id,
			);
			if (startup?.hasWorkspacePods === false) return;
			// Deployments without the platform field use the provisioner result.
			if (startup?.hasWorkspacePods === undefined && !waitingForPods) return;
			waitingForPods = true;
		} catch (error) {
			if (
				error instanceof PlatformError &&
				error.status === 404 &&
				!waitingForPods
			)
				return;
			throw error;
		}
		await delay(2_000);
	}
	throw new DetailedError(
		"Workspace shutdown timed out.",
		`The previous pods for ${workspace.name} are still shutting down.`,
	);
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once. */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	const failures: unknown[] = [];
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			try {
				results[index] = await fn(items[index]);
			} catch (error) {
				failures.push(error);
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	if (failures.length > 0) throw failures[0];
	return results;
}

type RestartProgress = Readonly<{ completed: number; total: number }>;

type UseBatchActionsOptions = {
	onSuccess: () => Promise<void>;
};

/** The build action shown for a workspace in the bulk update review. */
export type WorkspaceUpdate = Readonly<{
	workspace: Workspace;
	kind: "template" | "agent";
}>;

type UseBatchActionsResult = Readonly<{
	isProcessing: boolean;
	/** Set while a bulk restart is running. */
	restartProgress: RestartProgress | undefined;
	start: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	stop: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	restart: (workspaces: readonly Workspace[]) => Promise<unknown[]>;
	delete: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	updateWorkspaces: (
		updates: readonly WorkspaceUpdate[],
		onComplete: () => void,
	) => void;
}>;

export function useBatchActions(
	options: UseBatchActionsOptions,
): UseBatchActionsResult {
	const { onSuccess } = options;
	const queryClient = useQueryClient();

	const [restartProgress, setRestartProgress] = useState<RestartProgress>();

	const startAllMutation = useMutation({
		mutationFn: (workspaces: readonly Workspace[]) => {
			return mapWithConcurrency(
				workspaces.filter((w) => w.latest_build.status === "stopped"),
				WORKSPACE_START_CONCURRENCY,
				async (workspace) => {
					await waitForWorkspacePodShutdown(workspace);
					return API.startWorkspace(
						workspace.id,
						workspace.latest_build.template_version_id,
					);
				},
			);
		},
		onSuccess,
		onError: async (error) => {
			toast.error("Failed to start workspaces.", {
				description: getErrorDetail(error),
			});
			await queryClient.invalidateQueries({ queryKey: workspacesKey() });
		},
	});

	const stopAllMutation = useMutation({
		mutationFn: (workspaces: readonly Workspace[]) => {
			return Promise.all(
				workspaces
					.filter((w) => w.latest_build.status === "running")
					.map((w) => API.stopWorkspace(w.id)),
			);
		},
		onSuccess,
		onError: (error) => {
			toast.error("Failed to stop workspaces.", {
				description: getErrorDetail(error),
			});
		},
	});

	// Same stop-then-start sequence as restarting a single workspace, staggered
	// so a large selection does not hit the host all at once.
	const restartAllMutation = useMutation({
		mutationFn: async (workspaces: readonly Workspace[]) => {
			const running = workspaces.filter(
				(w) => w.latest_build.status === "running",
			);
			let completed = 0;
			setRestartProgress({ completed, total: running.length });
			try {
				return await mapWithConcurrency(
					running,
					WORKSPACE_START_CONCURRENCY,
					async (workspace) => {
						await API.restartWorkspace({
							workspace,
							beforeStart: () => waitForWorkspacePodShutdown(workspace),
						});
						completed++;
						setRestartProgress({ completed, total: running.length });
					},
				);
			} finally {
				setRestartProgress(undefined);
			}
		},
		onSuccess,
		onError: async (error) => {
			toast.error("Failed to restart workspaces.", {
				description: getErrorDetail(error),
			});
			await queryClient.invalidateQueries({ queryKey: workspacesKey() });
		},
	});

	const deleteAllMutation = useMutation({
		mutationFn: (workspaces: readonly Workspace[]) => {
			return Promise.all(workspaces.map((w) => API.deleteWorkspace(w.id)));
		},
		onSuccess,
		onError: (error) => {
			toast.error("Failed to delete some workspaces.", {
				description: getErrorDetail(error),
			});
		},
	});

	const updateAllMutation = useMutation({
		mutationFn: async (updates: readonly WorkspaceUpdate[]) => {
			await mapWithConcurrency(
				updates,
				WORKSPACE_START_CONCURRENCY,
				async ({ workspace, kind }) => {
					const beforeStart = () => waitForWorkspacePodShutdown(workspace);
					if (kind === "template") {
						await API.updateWorkspace(workspace, undefined, beforeStart);
					} else {
						await API.restartWorkspace({ workspace, beforeStart });
					}
				},
			);
		},
		onSuccess,
		onError: async (error) => {
			toast.error("Failed to update some workspaces.", {
				description: getErrorDetail(error),
			});
			await queryClient.invalidateQueries({ queryKey: workspacesKey() });
		},
	});

	// Not a great idea to return the promises from the Promise.all calls below
	// because that then gives you a void array, which doesn't make sense with
	// TypeScript's type system. Best to await them, and then have the wrapper
	// mutation function return its own void promise

	return {
		start: startAllMutation.mutateAsync,
		stop: stopAllMutation.mutateAsync,
		restart: restartAllMutation.mutateAsync,
		restartProgress,
		delete: deleteAllMutation.mutateAsync,
		updateWorkspaces: (updates, onComplete) =>
			updateAllMutation.mutate(updates, { onSuccess: onComplete }),
		isProcessing:
			startAllMutation.isPending ||
			stopAllMutation.isPending ||
			restartAllMutation.isPending ||
			deleteAllMutation.isPending ||
			updateAllMutation.isPending,
	};
}
