import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { TooltipProvider } from "#/components/Tooltip/Tooltip";
import { WorkspaceNav, type WorkspaceNavOption } from "./WorkspaceNav";

const Harness = () => {
	const [value, setValue] = useState<string | undefined>();
	return (
		<TooltipProvider>
			<div data-testid="outside">elsewhere</div>
			<WorkspaceNav
				value={value}
				onToggle={(o: WorkspaceNavOption) =>
					setValue((v) => (v === o ? undefined : o))
				}
				onClose={() => setValue(undefined)}
				panels={{
					resources: <div>the resources</div>,
					history: <div>the builds</div>,
				}}
			/>
		</TooltipProvider>
	);
};

describe("WorkspaceNav", () => {
	it("Resources and History drop from the pill, one at a time; again, Escape or a click elsewhere closes", () => {
		render(<Harness />);
		expect(screen.queryByTestId("workspace-nav-panel")).toBeNull();
		fireEvent.click(screen.getByTestId("workspace-nav-resources"));
		expect(screen.getByTestId("workspace-nav-panel")).toHaveTextContent(
			"the resources",
		);
		expect(screen.getByTestId("workspace-nav-resources")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		fireEvent.click(screen.getByTestId("workspace-nav-history"));
		expect(screen.getByTestId("workspace-nav-panel")).toHaveTextContent(
			"the builds",
		);
		fireEvent.click(screen.getByTestId("workspace-nav-history"));
		expect(screen.queryByTestId("workspace-nav-panel")).toBeNull();

		fireEvent.click(screen.getByTestId("workspace-nav-history"));
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByTestId("workspace-nav-panel")).toBeNull();

		fireEvent.click(screen.getByTestId("workspace-nav-resources"));
		fireEvent.pointerDown(screen.getByTestId("outside"));
		expect(screen.queryByTestId("workspace-nav-panel")).toBeNull();
	});
});
