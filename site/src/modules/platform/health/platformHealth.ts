import type { ClusterNetworkReport } from "#/api/clusterNetwork";
import type {
	BaseReport,
	HealthcheckReport,
	HealthSeverity,
} from "#/api/typesGenerated";

type ComponentHealth = {
	name: string;
	severity: HealthSeverity | "unknown";
	detail: string;
};

/** Each component is counted once; relay node details belong to the relay check. */
export const platformHealth = (
	health: HealthcheckReport | undefined,
	network: ClusterNetworkReport | undefined,
): ComponentHealth[] => {
	const result: ComponentHealth[] = [];
	if (health) {
		const checks: [string, BaseReport][] = [
			["Coder access URL", health.access_url],
			["WebSocket", health.websocket],
			["Database", health.database],
			["Workspace proxies", health.workspace_proxy],
			["Provisioner daemons", health.provisioner_daemons],
			["DERP relays", health.derp],
		];
		for (const [name, report] of checks) {
			result.push({
				name,
				severity: report.severity,
				detail: [report.error, ...report.warnings.map((w) => w.message)]
					.filter(Boolean)
					.join("; "),
			});
		}
		const relay = result[result.length - 1];
		for (const region of Object.values(health.derp.regions)) {
			if (!region) continue;
			for (const node of region.node_reports) {
				if (node.severity !== "ok") {
					relay.detail += `${relay.detail ? "; " : ""}${node.node?.Name ?? "Relay"}: ${node.error || node.severity}`;
				}
			}
		}
	}
	if (network) {
		if (network.podsAvailable !== false) {
			for (const pod of network.coder) {
				if (pod.phase === "Succeeded" || pod.deleting) continue;
				result.push({
					name: `Pod ${pod.namespace}/${pod.name}`,
					severity: pod.ready && pod.phase === "Running" ? "ok" : "error",
					detail: `${pod.phase ?? "Unknown phase"}, ${pod.ready ? "ready" : "not ready"}, ${pod.restarts} restarts`,
				});
			}
		}
		for (const service of network.services ?? []) {
			if (service.type === "ExternalName" || service.kind === "workspace")
				continue;
			result.push({
				name: `Service ${service.namespace}/${service.name}`,
				severity:
					service.ready === null
						? "unknown"
						: service.ready > 0
							? "ok"
							: "error",
				detail:
					service.ready === null
						? "Endpoint readiness unavailable"
						: `${service.ready}/${service.endpoints ?? "?"} endpoints ready`,
			});
		}
	}
	return result;
};
