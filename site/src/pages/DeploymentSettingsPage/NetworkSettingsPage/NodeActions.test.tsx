import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClusterNetworkAPI } from "#/api/clusterNetwork";
import { platformRequest } from "#/api/platform";
import {
	MockNodeConfiguration,
	MockNodeOperator,
} from "#/testHelpers/clusterNetwork";
import { MockDefaultOrganization } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { NodeActions } from "./NodeActions";

vi.mock("#/modules/dashboard/useDashboard", () => ({
	useDashboard: () => ({ organizations: [MockDefaultOrganization] }),
}));
beforeEach(() => {
	vi.spyOn(ClusterNetworkAPI, "nodeConfiguration").mockResolvedValue(
		MockNodeConfiguration,
	);
});
afterEach(() => vi.restoreAllMocks());

it("confirms and sends an optimistic cordon update", async () => {
	const user = userEvent.setup();
	const edit = vi
		.spyOn(ClusterNetworkAPI, "editNode")
		.mockResolvedValue({ saved: true });
	render(<NodeActions name="node-a" action="cordon-node" />);
	await user.click(await screen.findByRole("button", { name: "Cordon node" }));
	expect(edit).not.toHaveBeenCalled();
	await user.type(
		screen.getByRole("textbox", { name: "Type the node name to confirm" }),
		"node-a",
	);
	await user.click(screen.getByRole("button", { name: "Cordon node" }));
	await waitFor(() =>
		expect(edit).toHaveBeenCalledWith({
			name: "node-a",
			uid: "node-uid",
			resourceVersion: "42",
			changes: { unschedulable: true },
		}),
	);
});

it("preserves a metadata draft when the query refreshes and submits its original version", async () => {
	const user = userEvent.setup();
	const edit = vi
		.spyOn(ClusterNetworkAPI, "editNode")
		.mockResolvedValue({ saved: true });
	const { queryClient } = render(
		<NodeActions name="node-a" action="edit-node" />,
	);
	const labels = await screen.findByRole("textbox", { name: "Labels" });
	await user.clear(labels);
	await user.paste('{"zone":"west"}');
	vi.mocked(ClusterNetworkAPI.nodeConfiguration).mockResolvedValue({
		...MockNodeConfiguration,
		resourceVersion: "43",
		labels: { zone: "north" },
	});
	await queryClient.invalidateQueries();
	await user.type(
		screen.getByRole("textbox", { name: "Type the node name to confirm" }),
		"node-a",
	);
	await user.click(screen.getByRole("button", { name: "Save node settings" }));
	await waitFor(() =>
		expect(edit).toHaveBeenCalledWith({
			name: "node-a",
			uid: "node-uid",
			resourceVersion: "42",
			changes: { labels: { zone: "west" }, annotations: {} },
		}),
	);
});

it("submits an enrolled node restart with confirmation and node identity", async () => {
	const user = userEvent.setup();
	vi.spyOn(platformRequest, "get").mockResolvedValue(MockNodeOperator);
	const post = vi
		.spyOn(platformRequest, "post")
		.mockResolvedValue({ id: "op", phase: "queued" });
	render(<NodeActions name="node-a" action="restart-node" />);
	await screen.findByRole("option", { name: "Local cluster" });
	await user.type(
		screen.getByRole("textbox", { name: "Type the node name to confirm" }),
		"node-a",
	);
	await user.click(screen.getByRole("button", { name: "Restart node" }));
	await waitFor(() =>
		expect(post).toHaveBeenCalledWith(
			`/__coder-ui/api/organizations/${MockDefaultOrganization.id}/node-provisioning`,
			{
				id: expect.any(String),
				previous: null,
				profile: "local",
				action: "restart-node",
				node: "node-a",
				uid: "node-uid",
				confirmation: "node-a",
			},
		),
	);
});
