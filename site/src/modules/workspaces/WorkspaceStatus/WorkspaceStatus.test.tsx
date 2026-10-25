import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { WorkspaceStatus } from "./WorkspaceStatus";

it.each([false, true])(
	"requests a reviewed restart from the keyboard without navigating (template update: %s)",
	async (outdated) => {
		const onUpdate = vi.fn();
		const router = createMemoryRouter([
			{
				path: "/",
				element: (
					<WorkspaceStatus
						workspace={{ ...MockWorkspace, outdated }}
						pill
						agentUpdateAvailable={!outdated}
						onUpdate={onUpdate}
					/>
				),
			},
		]);
		renderWithRouter(router);
		screen
			.getByRole("button", {
				name: `Running. Restart ${MockWorkspace.name}; update available`,
			})
			.focus();
		await userEvent.keyboard("{Enter}");
		expect(onUpdate).toHaveBeenCalledOnce();
		expect(router.state.location.pathname).toBe("/");
	},
);

it("does not request another restart while updates are busy", async () => {
	const onUpdate = vi.fn();
	const router = createMemoryRouter([
		{
			path: "/",
			element: (
				<WorkspaceStatus
					workspace={MockWorkspace}
					pill
					agentUpdateAvailable
					onUpdate={onUpdate}
					updateDisabled
				/>
			),
		},
	]);
	renderWithRouter(router);
	await userEvent.click(
		screen.getByRole("button", {
			name: `Running. Restart ${MockWorkspace.name}; update available`,
		}),
	);
	expect(onUpdate).not.toHaveBeenCalled();
});
