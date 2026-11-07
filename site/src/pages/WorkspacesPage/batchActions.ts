import { useState } from "react";
import { useMutation } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorDetail } from "#/api/errors";
import type { Workspace, WorkspaceBuild } from "#/api/typesGenerated";

/**
 * Restarts unpack workspace images and load the host, so only a few run at
 * once. Each slot is held until the whole stop and start has finished.
 */
const RESTART_CONCURRENCY = 2;

/** Runs `fn` over `items` with at most `limit` calls in flight at once. */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index]);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

type RestartProgress = Readonly<{ completed: number; total: number }>;

type UseBatchActionsOptions = {
	onSuccess: () => Promise<void>;
};

type UpdateAllPayload = Readonly<{
	workspaces: readonly Workspace[];
}>;

type UseBatchActionsResult = Readonly<{
	isProcessing: boolean;
	/** Set while a bulk restart is running. */
	restartProgress: RestartProgress | undefined;
	start: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	stop: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	restart: (workspaces: readonly Workspace[]) => Promise<unknown[]>;
	delete: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	updateTemplateVersions: (
		payload: UpdateAllPayload,
	) => Promise<WorkspaceBuild[]>;
}>;

export function useBatchActions(
	options: UseBatchActionsOptions,
): UseBatchActionsResult {
	const { onSuccess } = options;

	const [restartProgress, setRestartProgress] = useState<RestartProgress>();

	const startAllMutation = useMutation({
		mutationFn: (workspaces: readonly Workspace[]) => {
			return Promise.all(
				workspaces
					.filter((w) => w.latest_build.status === "stopped")
					.map((w) =>
						API.startWorkspace(w.id, w.latest_build.template_version_id),
					),
			);
		},
		onSuccess,
		onError: (error) => {
			toast.error("Failed to start workspaces.", {
				description: getErrorDetail(error),
			});
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
					RESTART_CONCURRENCY,
					async (workspace) => {
						await API.restartWorkspace({ workspace });
						completed++;
						setRestartProgress({ completed, total: running.length });
					},
				);
			} finally {
				setRestartProgress(undefined);
			}
		},
		onSuccess,
		onError: (error) => {
			toast.error("Failed to restart workspaces.", {
				description: getErrorDetail(error),
			});
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
		mutationFn: (payload: UpdateAllPayload) => {
			const { workspaces } = payload;
			return Promise.all(
				workspaces
					.filter((w) => w.outdated && !w.dormant_at)
					.map((w) => API.updateWorkspace(w)),
			);
		},
		onSuccess,
		onError: (error) => {
			toast.error("Failed to update some workspaces.", {
				description: getErrorDetail(error),
			});
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
		updateTemplateVersions: updateAllMutation.mutateAsync,
		isProcessing:
			startAllMutation.isPending ||
			stopAllMutation.isPending ||
			restartAllMutation.isPending ||
			deleteAllMutation.isPending ||
			updateAllMutation.isPending,
	};
}
