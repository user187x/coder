import { API } from "./api";
import { platformGet } from "./platform";
import type {
	UpdateWorkspaceQuarantineRequest,
	WorkspaceQuarantine,
} from "./typesGenerated";

export type QuarantineComponent = {
	state:
		| "pending"
		| "blocked"
		| "revoking"
		| "revoked"
		| "unverified"
		| "released"
		| "unsupported";
	detail: string;
};
export type QuarantineEnforcement = {
	organization_id: string;
	workspace_id: string;
	revision: string;
	state:
		| "inactive"
		| "quarantining"
		| "quarantined"
		| "released"
		| "unverified";
	checked_at: string;
	components: Record<
		| "coder_access"
		| "runtime"
		| "sessions"
		| "tunnels"
		| "cloud_drive"
		| "network",
		QuarantineComponent
	>;
	limitations: string[];
};
const path = (org: string, workspace: string) =>
	`/api/v2/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/quarantine`;

/** Organization-scoped quarantine policy and independently observed enforcement. */
export const WorkspaceQuarantineAPI = {
	get: async (org: string, workspace: string): Promise<WorkspaceQuarantine> =>
		(
			await API.getAxiosInstance().get<WorkspaceQuarantine>(
				path(org, workspace),
			)
		).data,
	set: async (
		org: string,
		workspace: string,
		request: UpdateWorkspaceQuarantineRequest,
	): Promise<WorkspaceQuarantine> =>
		(
			await API.getAxiosInstance().put<WorkspaceQuarantine>(
				path(org, workspace),
				request,
			)
		).data,
	enforcement: (
		org: string,
		workspace: string,
	): Promise<QuarantineEnforcement> =>
		platformGet(
			`/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/quarantine-enforcement`,
		),
};
