import { render, screen } from "@testing-library/react";
import { MockStoppedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceStatusIndicator } from "./WorkspaceStatusIndicator";

describe("WorkspaceStatusIndicator", () => {
	it("shows the running light (HTML and CSS, no image) for a running workspace when asked", () => {
		render(<WorkspaceStatusIndicator workspace={MockWorkspace} runningLight />);
		const light = screen.getByTestId("workspace-running-light");
		expect(light).toHaveClass("ws-running-light");
		expect(light.querySelector("img")).toBeNull();
		expect(light.querySelectorAll(".ws-running-ring")).toHaveLength(3);
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
