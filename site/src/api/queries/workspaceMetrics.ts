import { getWorkspaceInfrastructureMetrics } from "#/api/workspaceMetrics";

export const workspaceInfrastructureMetricsKey = [
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
