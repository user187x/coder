import { platformRequest } from "./platform";

type NodeOperation = {
	id: string;
	profile: string;
	action?: "create" | "restart-node" | "drain-node";
	node?: string;
	phase: "queued" | "provisioning" | "ready" | "failed";
	message: string;
};

export type NodeOperator = {
	online: boolean;
	maintenance?: boolean;
	profiles: { id: string; label: string; kind: string; restart?: boolean }[];
	operation: NodeOperation | null;
};

const endpoint = (organization: string) =>
	`${platformRequest.base}/api/organizations/${encodeURIComponent(organization)}/node-provisioning`;

export const nodeOperator = (organization: string) => ({
	queryKey: ["platform", "node-provisioning", organization] as const,
	queryFn: () => platformRequest.get<NodeOperator>(endpoint(organization)),
	refetchInterval: 3_000,
	retry: false,
});

export const createWorkerNode = (organization: string) => ({
	mutationFn: (body: {
		id: string;
		profile: string;
		previous: string | null;
	}) => platformRequest.post<NodeOperation>(endpoint(organization), body),
	retry: false,
});

export const maintainClusterNode = (organization: string) => ({
	mutationFn: (body: {
		id: string;
		previous: string | null;
		profile: string;
		action: "restart-node" | "drain-node";
		node: string;
		uid: string;
		confirmation: string;
	}) => platformRequest.post<NodeOperation>(endpoint(organization), body),
	retry: false,
});
