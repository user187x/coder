import type { QueryClient } from "react-query";
import { API } from "#/api/api";
import type { Workspace } from "#/api/typesGenerated";
import {
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
