import { platformRequest } from "./platform";

export type MigrationNode = {
	name: string;
	ips: string[];
	cpu: { total: number; used: number | null; requested: number };
	memory: { total: number; used: number | null; requested: number };
	disk: { total: number | null; used: number | null; free: number | null };
	eligible: boolean;
	reasons: string[];
};
type WorkspaceMigration = {
	id: string;
	status: "running" | "failed" | "interrupted" | "done";
	phase: string;
	target: string;
	sourceNode: string;
	message: string | null;
	error: string | null;
	retainedVolume: string | null;
};
export type WorkspaceMigrationPlan = {
	workspaceId: string;
	workspaceName: string;
	sourceNode: string;
	diskBytes: number;
	homeUsedBytes: number | null;
	generatedAt: string;
	nodes: MigrationNode[];
	operation: WorkspaceMigration | null;
};
const path = (id: string) =>
	`${platformRequest.base}/api/workspace-migrations/${encodeURIComponent(id)}`;
export const WorkspaceMigrationsAPI = {
	cancel: (id: string) =>
		platformRequest.post<{ operation: WorkspaceMigration }>(path(id), {
			cancel: true,
		}),
	plan: (id: string) => platformRequest.get<WorkspaceMigrationPlan>(path(id)),
	start: (id: string, target: string) =>
		platformRequest.post<{ operation: WorkspaceMigration }>(path(id), {
			target,
		}),
	resume: (id: string) =>
		platformRequest.post<{ operation: WorkspaceMigration }>(path(id), {
			resume: true,
		}),
};
