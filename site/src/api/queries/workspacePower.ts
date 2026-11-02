import type { Query, QueryClient } from "react-query";
import { PlatformAPI, type WorkspacePowerOperation } from "#/api/platform";
import type { Workspace } from "#/api/typesGenerated";
import { globalLockdownKey } from "./globalLockdown";
import { workspacesQueryKeyPrefix } from "./workspaces";

const workspacePowerKey = ["platform", "workspace-power"] as const;
export const workspacePowerHistory = (organizationId: string) => ({
	queryKey: [...workspacePowerKey, organizationId],
	queryFn: () => PlatformAPI.getWorkspacePowerHistory(organizationId),
	refetchInterval: (query: Query<{ operations: WorkspacePowerOperation[] }>) =>
		query.state.data?.operations.some((op) => op.status === "running")
			? 2000
			: false,
	retry: false,
});
const operationQuery = (organizationId: string, id: string) => ({
	queryKey: [...workspacePowerKey, organizationId, id],
	queryFn: () => PlatformAPI.getWorkspacePowerOperation(organizationId, id),
	staleTime: 0,
	retry: false,
});
const remember = (client: QueryClient, operation: WorkspacePowerOperation) => {
	client.setQueryData<{ operations: WorkspacePowerOperation[] }>(
		workspacePowerHistory(operation.organization_id).queryKey,
		(before) => ({
			operations: [
				operation,
				...(before?.operations ?? []).filter((op) => op.id !== operation.id),
			],
		}),
	);
};

export type WorkspacePowerResult = {
	operations: WorkspacePowerOperation[];
	errors: {
		organization_id: string;
		workspace_ids: string[];
		message: string;
	}[];
};

/** Submits only reviewed IDs, serializing batches within each organization. */
export const runWorkspacePower = (
	client: QueryClient,
	globalToken?: string,
) => ({
	mutationFn: async ({
		action,
		targets,
		excludeAdmins = false,
	}: {
		action: WorkspacePowerOperation["action"];
		targets: readonly Workspace[];
		excludeAdmins?: boolean;
	}): Promise<WorkspacePowerResult> => {
		const result: WorkspacePowerResult = { operations: [], errors: [] };
		const groups = new Map<string, string[]>();
		for (const w of targets)
			groups.set(w.organization_id, [
				...(groups.get(w.organization_id) ?? []),
				w.id,
			]);
		const pending = [...groups];
		let next = 0;
		const worker = async () => {
			while (next < pending.length) {
				const group = pending[next++];
				if (!group) return;
				const [organizationId, ids] = group;
				for (let offset = 0; offset < ids.length; offset += 100) {
					const batch = ids.slice(offset, offset + 100);
					try {
						let operation = globalToken
							? await PlatformAPI.startGlobalWorkspacePower(
									organizationId,
									action,
									batch,
									globalToken,
									excludeAdmins,
								)
							: await PlatformAPI.startWorkspacePower(
									organizationId,
									action,
									batch,
									excludeAdmins,
								);
						remember(client, operation);
						while (operation.status === "running") {
							await new Promise((resolve) => setTimeout(resolve, 2000));
							operation = await client.fetchQuery(
								operationQuery(organizationId, operation.id),
							);
							remember(client, operation);
						}
						result.operations.push(operation);
					} catch (error) {
						result.errors.push({
							organization_id: organizationId,
							workspace_ids: ids.slice(offset),
							message:
								error instanceof Error
									? error.message
									: "Workspace power request failed",
						});
						break;
					}
				}
			}
		};
		// The service accepts at most four organization operations at once.
		await Promise.all(
			Array.from({ length: Math.min(4, pending.length) }, () => worker()),
		);
		return result;
	},
	onSettled: async () => {
		await Promise.all([
			client.invalidateQueries({ queryKey: workspacePowerKey }),
			client.invalidateQueries({ queryKey: workspacesQueryKeyPrefix }),
			client.invalidateQueries({ queryKey: globalLockdownKey }),
		]);
	},
});

export const clearWorkspacePowerHistory = (client: QueryClient) => ({
	mutationFn: async (operations: readonly WorkspacePowerOperation[]) => {
		const results = await Promise.allSettled(
			operations
				.filter((op) => op.status !== "running")
				.map((op) =>
					PlatformAPI.clearWorkspacePowerOperation(op.organization_id, op.id),
				),
		);
		const errors = results.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (errors.length)
			throw new AggregateError(
				errors,
				`${errors.length} operation entries could not be cleared. Refresh and try again.`,
			);
	},
	onSettled: () => client.invalidateQueries({ queryKey: workspacePowerKey }),
});
