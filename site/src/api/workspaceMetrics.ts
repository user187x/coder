import { platformGet } from "./platform";

/** A measured quantity and its capacity; missing observations remain null. */
export type InfrastructureMetric = {
	used: number | null;
	total: number | null;
	unit: "cores" | "bytes" | "load";
	collectedAt: string | null;
	error: string | null;
};
export type InfrastructureMetrics = Record<
	"cpu" | "memory" | "disk" | "load",
	InfrastructureMetric
>;
/** Infrastructure resolved from the authorized workspace's actual pod placement. */
export type WorkspaceInfrastructureMetrics = {
	allocation?: {
		cpu: number | null;
		memory: number | null;
		memoryReserved?: number;
		memoryUsable?: number;
		disk: number | null;
		diskEnforced: boolean | null;
		source: {
			cpu: "container-limit" | "vm-topology" | "unknown";
			memory: "container-limit" | "vm-memory" | "unknown";
			disk: "pvc-capacity" | "guest-block-capacity" | "unknown";
		};
	};
	workspaceId: string;
	workspaceName: string;
	nodeName: string | null;
	infrastructureRestricted?: boolean;
	node: InfrastructureMetrics | null;
	cluster: InfrastructureMetrics | null;
	nodeCount: number | null;
	generatedAt: string;
};
export const getWorkspaceInfrastructureMetrics = (
	organizationId: string,
	workspaceId: string,
) =>
	platformGet<WorkspaceInfrastructureMetrics>(
		`/__coder-ui/api/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/node-metrics`,
	);
