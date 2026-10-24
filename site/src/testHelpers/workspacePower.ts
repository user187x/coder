import type { WorkspacePowerOperation } from "#/api/platform";
import { MockWorkspace } from "./entities";

export const MockWorkspacePowerOperation: WorkspacePowerOperation = {
	id: "workspace-power-operation",
	organization_id: MockWorkspace.organization_id,
	action: "shutdown",
	status: "completed",
	created_at: 1792800000,
	finished_at: 1792800010,
	completed: 1,
	total: 1,
	workspaces: [
		{
			id: MockWorkspace.id,
			name: MockWorkspace.name,
			owner_name: MockWorkspace.owner_name,
			status: "stopped",
			coder_status: "stopped",
			physical_verified: null,
			force_requested: false,
			runtime_objects_removed: null,
		},
	],
};
