import type {
	NodeImageCleanupPlan,
	NodeImageCleanupResult,
} from "#/api/images";
export const MockNodeImageCleanupPlan: NodeImageCleanupPlan = {
	images: ["old:v1"],
	review: "reviewed-image-set",
	nodes: [{ node: "node", images: ["old:v1"] }],
};
export const MockNodeImageCleanupResult: NodeImageCleanupResult = {
	id: "cleanup-id",
	status: "complete",
	jobs: [{ name: "cleanup-job", node: "node", status: "complete" }],
};
