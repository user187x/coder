import { fireEvent, screen } from "@testing-library/react";
import { WorkspaceTimingsResponse } from "#/modules/workspaces/WorkspaceTiming/storybookData";
import { WorkspaceTimings } from "#/modules/workspaces/WorkspaceTiming/WorkspaceTimings";
import { renderComponent } from "#/testHelpers/renderHelpers";

const footer = (loaded = true) =>
	renderComponent(
		<WorkspaceTimings
			footer
			provisionerTimings={
				loaded ? WorkspaceTimingsResponse.provisioner_timings : undefined
			}
			agentScriptTimings={WorkspaceTimingsResponse.agent_script_timings}
			agentConnectionTimings={
				loaded ? WorkspaceTimingsResponse.agent_connection_timings : undefined
			}
		/>,
	);

describe("the Build timeline as the workspace card's footer", () => {
	it("starts collapsed and opens and closes with a click on its bar", () => {
		footer();
		const handle = screen.getByTestId("build-timeline-handle");
		expect(screen.getByTestId("build-timeline-footer")).toHaveClass(
			"build-footer",
		);
		expect(handle).toHaveAttribute("aria-expanded", "false");
		expect(handle).toHaveAccessibleName("Pull down to see the build timeline");
		fireEvent.click(handle);
		expect(handle).toHaveAttribute("aria-expanded", "true");
		expect(
			document.getElementById(handle.getAttribute("aria-controls") ?? ""),
		).toBeInTheDocument();
		fireEvent.click(handle);
		expect(handle).toHaveAttribute("aria-expanded", "false");
	});

	it("is pulled down open and pushed up closed by its grip", () => {
		footer();
		const handle = screen.getByTestId("build-timeline-handle");
		handle.setPointerCapture = () => {};
		fireEvent.pointerDown(handle, { button: 0, clientY: 100, pointerId: 1 });
		fireEvent.pointerMove(handle, { clientY: 106, pointerId: 1 });
		expect(handle).toHaveAttribute("aria-expanded", "false"); // not far enough yet
		fireEvent.pointerMove(handle, { clientY: 120, pointerId: 1 });
		expect(handle).toHaveAttribute("aria-expanded", "true");
		fireEvent.pointerUp(handle, { clientY: 120, pointerId: 1 });
		fireEvent.click(handle); // the click a pull ends with does not close it again
		expect(handle).toHaveAttribute("aria-expanded", "true");

		fireEvent.pointerDown(handle, { button: 0, clientY: 120, pointerId: 1 });
		fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 });
		expect(handle).toHaveAttribute("aria-expanded", "false");
	});

	it("waits for the timings before it opens", () => {
		footer(false);
		expect(screen.getByTestId("build-timeline-handle")).toBeDisabled();
	});
});
