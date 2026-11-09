import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClusterNetworkAPI } from "#/api/clusterNetwork";
import { TooltipProvider } from "#/components/Tooltip/Tooltip";
import { MockNodeConfiguration } from "#/testHelpers/clusterNetwork";
import { MockHudNode } from "#/testHelpers/hud";
import { render } from "#/testHelpers/renderHelpers";
import { HudNodeStrip, ringLabels } from "./HudNodeStrip";

it("names each orb by what sets its node apart, short enough for its edge", () => {
	const names = [
		"k3d-coder-ef4f60f4-28ed-42bf-b78c-aea353a4ec86-0",
		"k3d-coder-ha-lab-agent-0",
		"k3d-coder-ha-lab-server-0",
	];
	const labels = ringLabels(names);
	expect(labels.get(names[1])).toBe("ha-lab-agent-0");
	expect(labels.get(names[2])).toBe("ha-lab-server-0");
	expect(labels.get(names[0])).toBe("ef4f60f4-28…53a4ec86-0");
	expect(labels.get(names[0])?.length).toBe(22);
});

it("keeps a lone node's own name", () => {
	expect(ringLabels(["worker-1"]).get("worker-1")).toBe("worker-1");
});

it("names each orb by its node and the state its health reports", () => {
	render(
		<TooltipProvider>
			<HudNodeStrip
				nodes={[
					{ ...MockHudNode, name: "node-ok" },
					{ ...MockHudNode, name: "node-pressure", health: "warning" },
					{ ...MockHudNode, name: "node-down", health: "down" },
				]}
			/>
		</TooltipProvider>,
	);
	expect(screen.getByRole("button", { name: "node-ok: Healthy" })).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "node-pressure: Degraded" }),
	).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "node-down: Not ready" }),
	).toBeTruthy();
});

it("counts the cluster's nodes in the strip's corner", () => {
	render(
		<TooltipProvider>
			<HudNodeStrip
				nodes={[
					{ ...MockHudNode, name: "a" },
					{ ...MockHudNode, name: "b" },
				]}
			/>
		</TooltipProvider>,
	);
	expect(screen.getByTestId("cluster-node-count")).toHaveTextContent(
		"Cluster Nodes 2",
	);
});

it("opens a node's details from its right-click menu", async () => {
	const user = userEvent.setup();
	render(
		<TooltipProvider>
			<HudNodeStrip nodes={[{ ...MockHudNode, name: "node-ok" }]} />
		</TooltipProvider>,
	);
	fireEvent.contextMenu(
		screen.getByRole("button", { name: "node-ok: Healthy" }),
	);
	expect(await screen.findByRole("menuitem", { name: "View" })).toBeTruthy();
	await user.click(screen.getByRole("menuitem", { name: "Details" }));
	expect(
		await screen.findByRole("dialog", { name: /node-ok/ }),
	).toHaveTextContent("Annotations");
});

it("drains a node from its right-click menu", async () => {
	const user = userEvent.setup();
	vi.spyOn(ClusterNetworkAPI, "nodeConfiguration").mockResolvedValue({
		...MockNodeConfiguration,
		name: "node-ok",
	});
	const drain = vi.spyOn(ClusterNetworkAPI, "drainNode").mockResolvedValue({
		cordoned: true,
		evicted: [],
		blocked: [],
		skipped: [],
		failed: [],
	});
	render(
		<TooltipProvider>
			<HudNodeStrip nodes={[{ ...MockHudNode, name: "node-ok" }]} />
		</TooltipProvider>,
	);
	fireEvent.contextMenu(
		screen.getByRole("button", { name: "node-ok: Healthy" }),
	);
	expect(await screen.findByRole("menuitem", { name: "Cordon" })).toBeTruthy();
	expect(screen.queryByRole("menuitem", { name: "Untaint" })).toBeNull();
	await user.click(screen.getByRole("menuitem", { name: "Drain" }));
	const dialog = await screen.findByRole("dialog", { name: /Drain node/ });
	await user.type(
		await within(dialog).findByRole("textbox", {
			name: "Type the node name to confirm",
		}),
		"node-ok",
	);
	await user.click(within(dialog).getByRole("button", { name: "Drain node" }));
	await waitFor(() =>
		expect(drain).toHaveBeenCalledWith({
			name: "node-ok",
			uid: "node-uid",
			confirmation: "node-ok",
		}),
	);
});

afterEach(() => vi.restoreAllMocks());
