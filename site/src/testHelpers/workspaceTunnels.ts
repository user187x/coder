import type { WorkspaceTunnel } from "#/api/platform";
import { MockWorkspace } from "./entities";

export const MockWorkspaceTunnel: WorkspaceTunnel = {
	id: "workspace-tunnel",
	organization_id: MockWorkspace.organization_id,
	source_workspace_id: "tunnel-source",
	target_workspace_id: "tunnel-target",
	source_side: "right",
	target_side: "left",
	status: "ready",
	source_address: "10.244.100.1",
	target_address: "10.244.100.2",
};

export const MockWorkspaceTunnelStats = {
	updated_at: 1792800000,
	stale: false,
	ports_available: true,
	series: Array.from({ length: 12 }, (_, index) => ({
		timestamp: 1792799945 + index * 5,
		rx_bytes_per_second: (index % 4) * 1024,
		tx_bytes_per_second: (index % 3) * 512,
	})),
	ports: [
		{ protocol: "tcp" as const, local_port: 40320, remote_port: 8080 },
		{ protocol: "udp" as const, local_port: 5000, remote_port: 5001 },
	],
};
