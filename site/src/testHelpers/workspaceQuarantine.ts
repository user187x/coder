import type { WorkspaceQuarantine } from "#/api/typesGenerated";
import type { QuarantineEnforcement } from "#/api/workspaceQuarantine";
import { MockUserOwner, MockWorkspace } from "./entities";

export const MockWorkspaceQuarantine: WorkspaceQuarantine = {
	organization_id: MockWorkspace.organization_id,
	workspace_id: MockWorkspace.id,
	enabled: true,
	revision: "03fc3163-1f24-434d-b9fd-02069a0a1da8",
	reason: "Investigating unexpected traffic",
	updated_by: MockUserOwner.id,
	updated_at: "2026-10-24T10:00:00Z",
	manual_start_required: true,
};
export const MockQuarantineEnforcement: QuarantineEnforcement = {
	organization_id: MockWorkspace.organization_id,
	workspace_id: MockWorkspace.id,
	revision: MockWorkspaceQuarantine.revision,
	state: "unverified",
	checked_at: "2026-10-24T10:00:05Z",
	components: {
		coder_access: {
			state: "blocked",
			detail: "Workspace access denied for all users.",
		},
		runtime: {
			state: "unverified",
			detail: "Stop requested; trusted host confirmation is unavailable.",
		},
		sessions: { state: "revoking", detail: "Waiting for session revocation." },
		tunnels: {
			state: "revoking",
			detail: "Waiting for endpoint acknowledgement.",
		},
		cloud_drive: { state: "revoked", detail: "Workspace links disconnected." },
		network: {
			state: "unverified",
			detail: "Runtime object absence does not prove network isolation.",
		},
	},
	limitations: [
		"Copied account credentials are outside the workspace quarantine boundary.",
	],
};
