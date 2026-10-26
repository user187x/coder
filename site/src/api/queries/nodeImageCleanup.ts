import { ImagesAPI, type NodeImageCleanupPlan } from "#/api/images";

export const onNodesKey = ["platform", "images", "on-nodes"] as const;
export const nodeImages = () => ({
	queryKey: onNodesKey,
	queryFn: ImagesAPI.onNodes,
	refetchInterval: 60_000,
});
export const previewNodeImageCleanup = () => ({
	mutationFn: (images: string[]) => ImagesAPI.previewNodeImageCleanup(images),
});
export const purgeNodeImages = () => ({
	mutationFn: (plan: NodeImageCleanupPlan) => ImagesAPI.purgeNodeImages(plan),
});
export const nodeImageCleanup = (id: string) => ({
	queryKey: [...onNodesKey, "cleanup", id],
	queryFn: () => ImagesAPI.nodeImageCleanup(id),
	enabled: Boolean(id),
	refetchInterval: (query: { state: { data?: { status: string } } }) =>
		query.state.data?.status === "running" ? 2_000 : (false as const),
});
