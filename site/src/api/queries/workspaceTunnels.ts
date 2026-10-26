import type { QueryClient } from "react-query";
import { PlatformAPI, type WorkspaceTunnelPort } from "#/api/platform";

export const workspaceTunnelsKey = ["platform", "workspace-tunnels"] as const;
export const workspaceTunnels = (organizationId: string) => ({
	queryKey: [...workspaceTunnelsKey, organizationId],
	queryFn: () => PlatformAPI.getWorkspaceTunnels(organizationId),
	enabled: Boolean(organizationId),
	refetchInterval: 3000,
	retry: false,
});
export const createWorkspaceTunnel = (client: QueryClient) => ({
	mutationFn: (v: {
		organizationId: string;
		source: string;
		target: string;
		sourceSide: "left" | "right";
		targetSide: "left" | "right";
	}) =>
		PlatformAPI.createWorkspaceTunnel(
			v.organizationId,
			v.source,
			v.target,
			v.sourceSide,
			v.targetSide,
		),
	onSettled: () => client.invalidateQueries({ queryKey: workspaceTunnelsKey }),
});
export const deleteWorkspaceTunnel = (client: QueryClient) => ({
	mutationFn: (v: { organizationId: string; id: string }) =>
		PlatformAPI.deleteWorkspaceTunnel(v.organizationId, v.id),
	onSettled: () => client.invalidateQueries({ queryKey: workspaceTunnelsKey }),
});

export const updateWorkspaceTunnelPorts = (client: QueryClient) => ({
	mutationFn: (value: {
		organizationId: string;
		id: string;
		revision: number;
		ports: WorkspaceTunnelPort[] | null;
	}) =>
		PlatformAPI.updateWorkspaceTunnelPorts(
			value.organizationId,
			value.id,
			value.revision,
			value.ports,
		),
	onSettled: () => client.invalidateQueries({ queryKey: workspaceTunnelsKey }),
});
