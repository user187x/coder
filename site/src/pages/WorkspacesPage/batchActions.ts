import { useMutation } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorDetail } from "#/api/errors";
import type { Workspace, WorkspaceBuild } from "#/api/typesGenerated";

type UseBatchActionsOptions = {
	onSuccess: () => Promise<void>;
};

type UpdateAllPayload = Readonly<{
	workspaces: readonly Workspace[];
}>;

type UseBatchActionsResult = Readonly<{
	isProcessing: boolean;
	start: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	stop: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	delete: (workspaces: readonly Workspace[]) => Promise<WorkspaceBuild[]>;
	updateTemplateVersions: (
		payload: UpdateAllPayload,
	) => Promise<WorkspaceBuild[]>;
}>;

export function useBatchActions(
	options: UseBatchActionsOptions,
): UseBatchActionsResult {
	const { onSuccess } = options;

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
		delete: deleteAllMutation.mutateAsync,
		updateTemplateVersions: updateAllMutation.mutateAsync,
		isProcessing:
			startAllMutation.isPending ||
			stopAllMutation.isPending ||
			deleteAllMutation.isPending ||
			updateAllMutation.isPending,
	};
}
