import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "#/components/Tooltip/Tooltip";
import { MockHudNode } from "#/testHelpers/hud";
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
