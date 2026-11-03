import { platformRequest } from "./platform";

type NodeOperation = {
	id: string;
	profile: string;
	phase: "queued" | "provisioning" | "ready" | "failed";
	message: string;
};

type NodeOperator = {
	online: boolean;
	profiles: { id: string; label: string; kind: string }[];
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
