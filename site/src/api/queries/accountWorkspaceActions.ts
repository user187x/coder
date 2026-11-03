import type { QueryClient } from "react-query";
import { API, type DeleteWorkspaceOptions } from "#/api/api";
import { isApiError } from "#/api/errors";
import type { ProvisionerJobStatus, Workspace } from "#/api/typesGenerated";
import { delay } from "#/utils/delay";
import {
	deleteWorkspace,
	workspaceById,
	workspaceByIdKey,
	workspacesQueryKeyPrefix,
} from "./workspaces";

/** Restarts reviewed workspaces using their current build, reporting every failure. */
export const restartAccountWorkspaces = (client: QueryClient) => ({
	mutationFn: async (targets: readonly Workspace[]) => {
		const results: { id: string; name: string; error?: string }[] = [];
		let next = 0;
		const worker = async () => {
			while (next < targets.length) {
				const target = targets[next++];
				if (!target) return;
				try {
					const workspace = await client.fetchQuery({
						...workspaceById(target.id),
						staleTime: 0,
					});
					await API.restartWorkspace({ workspace });
					const updated = await API.getWorkspace(target.id);
					client.setQueryData(workspaceByIdKey(target.id), updated);
					if (updated.latest_build.status !== "running")
						throw new Error(
							`Restart did not finish running (${updated.latest_build.status}).`,
						);
					results.push({
						id: target.id,
						name: `${target.owner_name}/${target.name}`,
					});
				} catch (error) {
					results.push({
						id: target.id,
						name: `${target.owner_name}/${target.name}`,
						error:
							error instanceof Error
								? error.message
								: typeof error === "object" &&
										error !== null &&
										"error" in error &&
										typeof error.error === "string"
									? error.error
									: "Workspace restart failed",
					});
				}
			}
		};
		await Promise.all(
			Array.from({ length: Math.min(4, targets.length) }, () => worker()),
		);
		return results;
	},
	onSettled: () =>
		client.invalidateQueries({ queryKey: workspacesQueryKeyPrefix }),
});

/** Cancel the reviewed build before deleting. A newer build requires another review. */
export const deleteAccountWorkspace = (
	workspace: Workspace,
	client: QueryClient,
) => {
	const remove = deleteWorkspace(workspace, client);
	return {
		...remove,
		mutationFn: async (options: DeleteWorkspaceOptions) => {
			try {
				return await remove.mutationFn(options);
			} catch (error) {
				if (!isApiError(error) || error.response.status !== 409) throw error;
				const { latest_build: build } = await API.getWorkspace(workspace.id);
				if (build.id !== workspace.latest_build.id) {
					throw new Error(
						"The workspace has a newer build. Close this dialog and review it before deleting.",
					);
				}
				if (!activeJob(build.job.status)) return remove.mutationFn(options);
				if (build.transition === "delete" && build.job.status !== "canceling")
					return build;
				if (build.job.status !== "canceling") {
					try {
						await API.cancelWorkspaceBuild(build.id);
					} catch (cancelError) {
						if (!isApiError(cancelError) || cancelError.response.status !== 400)
							throw cancelError;
						const current = await API.getWorkspaceBuild(build.id);
						if (
							activeJob(current.job.status) &&
							current.job.status !== "canceling"
						)
							throw cancelError;
					}
				}
				const deadline = Date.now() + 120_000;
				while (activeJob((await API.getWorkspaceBuild(build.id)).job.status)) {
					if (Date.now() >= deadline)
						throw new Error(
							"The provisioner is still canceling the build. Retry deletion after cancellation finishes.",
						);
					await delay(1000);
				}
				return remove.mutationFn(options);
			}
		},
		onSettled: () =>
			client.invalidateQueries({ queryKey: workspacesQueryKeyPrefix }),
	};
};

const activeJob = (status: ProvisionerJobStatus) =>
	status === "pending" || status === "running" || status === "canceling";
