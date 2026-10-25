import type { QueryClient } from "react-query";
import type {
	UpdateWorkspaceQuarantineRequest,
	WorkspaceQuarantine,
} from "#/api/typesGenerated";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
export const workspaceQuarantineKey = (org: string, workspace: string) =>
	["workspace-quarantine", org, workspace] as const;
export const quarantineEnforcementKey = (org: string, workspace: string) =>
	["workspace-quarantine-enforcement", org, workspace] as const;
export const workspaceQuarantine = (org: string, workspace: string) => ({
	queryKey: workspaceQuarantineKey(org, workspace),
	queryFn: () => WorkspaceQuarantineAPI.get(org, workspace),
	refetchInterval: 2000,
	retry: false,
});
export const quarantineEnforcement = (org: string, workspace: string) => ({
	queryKey: quarantineEnforcementKey(org, workspace),
	queryFn: () => WorkspaceQuarantineAPI.enforcement(org, workspace),
	refetchInterval: 2000,
	retry: false,
});
export const setWorkspaceQuarantine = (
	client: QueryClient,
	org: string,
	workspace: string,
) => ({
	mutationFn: (request: UpdateWorkspaceQuarantineRequest) =>
		WorkspaceQuarantineAPI.set(org, workspace, request),
	onSuccess: (state: WorkspaceQuarantine) => {
		client.setQueryData(workspaceQuarantineKey(org, workspace), state);
		void client.invalidateQueries({
			queryKey: quarantineEnforcementKey(org, workspace),
		});
	},
});
