import { render, screen } from "@testing-library/react";
import { MockStoppedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceStatusIndicator } from "./WorkspaceStatusIndicator";

describe("WorkspaceStatusIndicator", () => {
	it("shows the animated light for a running workspace when asked", () => {
		render(<WorkspaceStatusIndicator workspace={MockWorkspace} runningLight />);
		expect(screen.getByTestId("workspace-running-light")).toHaveAttribute(
			"src",
			"/workspace-running.gif",
		);
		expect(screen.getByText("Running")).toBeInTheDocument();
	});

	it("keeps the dot elsewhere, and for a workspace that is not running", () => {
		const { rerender } = render(
			<WorkspaceStatusIndicator workspace={MockWorkspace} />,
		);
		expect(screen.queryByTestId("workspace-running-light")).toBeNull();
		rerender(
			<WorkspaceStatusIndicator
				workspace={MockStoppedWorkspace}
				runningLight
			/>,
		);
		expect(screen.queryByTestId("workspace-running-light")).toBeNull();
	});
});
