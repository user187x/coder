import type { ClusterNetworkReport, MeshReport } from "#/api/clusterNetwork";
import type { HealthSeverity } from "#/api/typesGenerated";

/** Summarizes the same readiness and connection reports shown on the Network page. */
export const networkHealth = (
	report: ClusterNetworkReport | undefined,
	mesh: MeshReport | undefined,
	unavailable = false,
): { severity: HealthSeverity | null; label: string } => {
	if (unavailable)
		return { severity: null, label: "Network status unavailable" };
	if (!report || !mesh)
		return { severity: null, label: "Checking network status" };
	const incomplete =
		!report.nodes.length ||
		report.podsAvailable === false ||
		!report.workspacesApi ||
		report.servicesError ||
		report.services?.some(
			(service) => service.type !== "ExternalName" && service.ready === null,
		);

	const errors: string[] = [];
	const warnings: string[] = [];
	if (report.nodes.some((node) => !node.ready)) errors.push("nodes not ready");
	if (
		report.coder.some(
			(pod) => !pod.deleting && pod.phase !== "Succeeded" && !pod.ready,
		)
	)
		errors.push("platform components not ready");
	if (
		report.services?.some(
			(service) => service.type !== "ExternalName" && service.ready === 0,
		)
	)
		errors.push("services without ready endpoints");
	if (
		mesh.edges.some((edge) => edge.error || edge.samples.some((s) => s.error))
	)
		errors.push("failed network connections");
	if (report.nodes.some((node) => node.unschedulable || node.pressure.length))
		warnings.push("nodes cordoned or under pressure");
	if (
		report.workspaces.some(
			(workspace) =>
				!workspace.pod.deleting &&
				workspace.pod.phase !== "Succeeded" &&
				(!workspace.pod.ready ||
					workspace.healthy === false ||
					workspace.agents.some((agent) => agent.status !== "connected")),
		) ||
		report.unplaced.length
	)
		warnings.push("workspaces not connected or not placed on the map");
	if (
		report.services?.some(
			(service) =>
				service.ready !== null &&
				service.endpoints !== null &&
				service.ready > 0 &&
				service.ready < service.endpoints,
		)
	)
		warnings.push("services with some endpoints not ready");
	return {
		severity: errors.length
			? "error"
			: warnings.length
				? "warning"
				: incomplete
					? null
					: "ok",
		label:
			errors.length || warnings.length
				? `Network needs attention: ${[...errors, ...warnings, ...(incomplete ? ["some checks unavailable"] : [])].join("; ")}`
				: incomplete
					? "Network status incomplete"
					: "Network checks passed",
	};
};
