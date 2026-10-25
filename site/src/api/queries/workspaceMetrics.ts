import { getWorkspaceInfrastructureMetrics } from "#/api/workspaceMetrics";

export const workspaceInfrastructureMetricsKey = [
	"platform",
	"workspace-infrastructure-metrics",
] as const;
export const workspaceInfrastructureMetrics = (
	organizationId: string,
	workspaceId: string,
) => ({
	queryKey: [...workspaceInfrastructureMetricsKey, organizationId, workspaceId],
	queryFn: () => getWorkspaceInfrastructureMetrics(organizationId, workspaceId),
	enabled: Boolean(organizationId && workspaceId),
	refetchInterval: 5000,
	retry: false,
});
