import { platformRequest } from "./platform";

export type MigrationNode = {
	name: string;
	ips: string[];
	cpu: { total: number; used: number | null; requested: number };
	memory: { total: number; used: number | null; requested: number };
	disk: { total: number | null; used: number | null; free: number | null };
	eligible: boolean;
	reasons: string[];
	/** What this workspace needs from a destination: cores, memory bytes, disk bytes. */
	needs?: { cpu: number; memory: number; disk: number };
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
/** One row of the admin list. percent is the share of the home volume copied. */
export type WorkspaceMigrationSummary = {
	id: string;
	workspaceId: string;
	workspaceName: string | null;
	status: WorkspaceMigration["status"];
	phase: string | null;
	percent: number;
	/** Cores and bytes the workspace requests, when its pod spec was recorded. */
	cpu: number | null;
	memoryBytes: number | null;
	diskBytes: number | null;
	copiedBytes: number | null;
	sourceNode: string | null;
	target: string | null;
	message: string | null;
	error: string | null;
	startedAt: string;
	updatedAt: string;
};
const path = (id: string) =>
	`${platformRequest.base}/api/workspace-migrations/${encodeURIComponent(id)}`;
export const WorkspaceMigrationsAPI = {
	list: () =>
		platformRequest.get<{ migrations: WorkspaceMigrationSummary[] }>(
			`${platformRequest.base}/api/workspace-migrations`,
		),
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
