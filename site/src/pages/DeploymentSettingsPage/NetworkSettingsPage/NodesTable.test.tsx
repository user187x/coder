import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClusterNetworkAPI, networkNodePods } from "#/api/clusterNetwork";
import {
	MockClusterNetworkReport,
	MockNodePod,
	MockPodDetails,
} from "#/testHelpers/clusterNetwork";
import { render } from "#/testHelpers/renderHelpers";
import { EntityProvider } from "./EntityDetails";
import { NodesTable } from "./NodesTable";

afterEach(() => vi.restoreAllMocks());
it("loads pods across namespaces when a node expands and opens the selected pod", async () => {
	const user = userEvent.setup();
	const pods = vi
		.spyOn(ClusterNetworkAPI, "nodePods")
		.mockResolvedValue({ node: null, pods: [MockNodePod] });
	const details = vi
		.spyOn(ClusterNetworkAPI, "entity")
		.mockResolvedValue(MockPodDetails);
	render(
		<EntityProvider>
			<NodesTable report={MockClusterNetworkReport} />
		</EntityProvider>,
	);
	expect(pods).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Pods on node-a" }));
	await user.click(
		await screen.findByRole("button", { name: MockNodePod.name }),
	);
	await waitFor(() =>
		expect(details).toHaveBeenCalledWith({
			type: "pod",
			namespace: "kube-system",
			name: MockNodePod.name,
		}),
	);
});
it("opens newly scheduled pods after the live view refreshes", async () => {
	const user = userEvent.setup();
	vi.spyOn(ClusterNetworkAPI, "nodePods").mockResolvedValue({
		node: null,
		pods: [MockNodePod],
	});
	const details = vi
		.spyOn(ClusterNetworkAPI, "entity")
		.mockResolvedValue(MockPodDetails);
	const { queryClient } = render(
		<EntityProvider>
			<NodesTable report={MockClusterNetworkReport} />
		</EntityProvider>,
	);
	await user.click(screen.getByRole("button", { name: "Live view" }));
	await screen.findByRole("button", { name: /metrics-server/ });
	vi.mocked(ClusterNetworkAPI.nodePods).mockResolvedValue({
		node: null,
		pods: [{ ...MockNodePod, name: "new-pod", uid: "new-uid" }],
	});
	await queryClient.invalidateQueries({ queryKey: networkNodePods().queryKey });
	await user.click(await screen.findByRole("button", { name: /new-pod/ }));
	await waitFor(() =>
		expect(details).toHaveBeenCalledWith({
			type: "pod",
			namespace: "kube-system",
			name: "new-pod",
		}),
	);
});
