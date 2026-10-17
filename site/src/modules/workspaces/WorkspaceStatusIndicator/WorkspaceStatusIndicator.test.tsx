import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { TooltipProvider } from "#/components/Tooltip/Tooltip";
import { MockStoppedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceStatusIndicator } from "./WorkspaceStatusIndicator";

// As in the app: tooltips need their provider.
const render = (ui: ReactElement) =>
	rtlRender(ui, {
		wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider>,
	});

describe("WorkspaceStatusIndicator", () => {
	it("shows the running light (HTML and CSS, no image) for a running workspace when asked", () => {
		render(<WorkspaceStatusIndicator workspace={MockWorkspace} runningLight />);
		const light = screen.getByTestId("workspace-running-light");
		expect(light).toHaveClass("ws-running-light");
		expect(light.querySelector("img")).toBeNull();
		expect(light.querySelectorAll(".ws-running-ring")).toHaveLength(3);
		expect(screen.getByText("Running")).toBeInTheDocument();
	});

	it("tells when the workspace started on hovering the light", async () => {
		const workspace = {
			...MockWorkspace,
			latest_build: {
				...MockWorkspace.latest_build,
				transition: "start" as const,
				status: "running" as const,
				job: {
					...MockWorkspace.latest_build.job,
					completed_at: "2026-10-17T01:02:15Z",
				},
			},
		};
		render(<WorkspaceStatusIndicator workspace={workspace} runningLight />);
		await userEvent.hover(
			screen.getByTestId("workspace-running-light-trigger"),
		);
		const started = new Date("2026-10-17T01:02:15Z").toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "medium",
		});
		expect(
			(await screen.findAllByText(`Started ${started}`)).length,
		).toBeGreaterThan(0);
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
