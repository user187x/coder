import { render, screen } from "@testing-library/react";
import { WorkspaceSlotsBar } from "./WorkspaceCards";

const running = { label: "Running", value: 1, fill: "bg-highlight-green" };

describe("WorkspaceSlotsBar", () => {
	it("marks each workspace the limit allows: two allowed, one tick halfway", () => {
		render(<WorkspaceSlotsBar segments={[running]} limit={2} />);
		expect(screen.getByRole("meter")).toHaveAttribute(
			"aria-valuetext",
			"1 of 2 workspaces allowed",
		);
		const ticks = screen.getAllByTestId("workspace-slot-tick");
		expect(ticks.map((t) => t.style.left)).toEqual(["50%"]);
	});

	it("still counts the workspaces without a limit", () => {
		render(
			<WorkspaceSlotsBar
				segments={[running, { ...running, label: "Stopped", value: 2 }]}
				limit={null}
			/>,
		);
		expect(screen.getByRole("meter")).toHaveAttribute(
			"aria-valuetext",
			"3 workspaces, no limit",
		);
		// Three workspaces and the infinity sign's slot: a tick between each.
		expect(screen.getAllByTestId("workspace-slot-tick")).toHaveLength(3);
	});

	it("draws stopped workspaces' share as a dotted line", () => {
		render(
			<WorkspaceSlotsBar
				segments={[
					running,
					{ ...running, label: "Stopped", value: 1, offline: true },
				]}
				limit={3}
			/>,
		);
		expect(screen.getAllByTestId("bar-segment-offline")).toHaveLength(1);
		expect(screen.getByTestId("workspace-slots-left")).toHaveTextContent(
			"1 left",
		);
	});
});

it("rounds an offline share only where it stands alone", () => {
	const stopped = { ...running, label: "Stopped", offline: true };
	const { unmount } = render(
		<WorkspaceSlotsBar segments={[running, stopped]} limit={3} />,
	);
	expect(screen.getByTestId("bar-segment-offline")).toHaveAttribute(
		"data-continues",
	);
	unmount();
	render(<WorkspaceSlotsBar segments={[stopped]} limit={3} />);
	expect(screen.getByTestId("bar-segment-offline")).not.toHaveAttribute(
		"data-continues",
	);
});
