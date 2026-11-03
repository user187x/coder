import type { Workspace } from "#/api/typesGenerated";
import {
	getWorkspaceInfrastructureMetrics,
	getWorkspaceStartup,
} from "#/api/workspaceMetrics";

const workspaceInfrastructureMetricsKey = [
	"platform",
	"workspace-infrastructure-metrics",
] as const;
export const workspaceInfrastructureMetrics = (
	organizationId: string,
	workspaceId: string,
	seconds = 300,
) => ({
	queryKey: [
		...workspaceInfrastructureMetricsKey,
		organizationId,
		workspaceId,
		seconds,
	],
	queryFn: () =>
		getWorkspaceInfrastructureMetrics(organizationId, workspaceId, seconds),
	enabled: Boolean(organizationId && workspaceId),
	refetchInterval: 5000,
	retry: false,
});

export const workspaceStartup = (workspace: Workspace) => {
	const build = workspace.latest_build;
	const waiting =
		build.transition === "start" &&
		(build.status === "starting" ||
			(build.status === "running" &&
				build.resources.some((r) =>
					r.agents?.some(
						(a) =>
							a.status === "connecting" ||
							a.status === "timeout" ||
							a.lifecycle_state === "starting",
					),
				)));
	return {
		queryKey: [
			"platform",
			"workspace-startup",
			workspace.organization_id,
			workspace.id,
			build.id,
		],
		queryFn: () => getWorkspaceStartup(workspace.organization_id, workspace.id),
		enabled: waiting,
		refetchInterval: 5000,
		retry: false,
	};
};
