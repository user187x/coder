import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent as render } from "#/testHelpers/renderHelpers";
import { GlobalWorkspaceActionsView } from "./GlobalWorkspaceActions";

it.each([
	["Shut Down", "shutdown"],
	["Terminate", "terminate"],
])("requires explicit review confirmation for %s", async (label, action) => {
	const onRun = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalWorkspaceActionsView workspaces={[MockWorkspace]} onRun={onRun} />,
	);
	await user.click(screen.getByRole("button", { name: label }));
	const dialog = within(screen.getByRole("dialog"));
	await user.click(dialog.getByRole("button", { name: label }));
	expect(onRun).not.toHaveBeenCalled();
	await user.type(dialog.getByLabelText(`Type ${action} to confirm`), action);
	await user.click(dialog.getByRole("button", { name: label }));
	expect(onRun).toHaveBeenCalledExactlyOnceWith(action, [MockWorkspace], true);
});
it("cancels without submitting a workspace power operation", async () => {
	const onRun = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalWorkspaceActionsView workspaces={[MockWorkspace]} onRun={onRun} />,
	);
	await user.click(screen.getByRole("button", { name: "Terminate" }));
	await user.type(
		screen.getByLabelText("Type terminate to confirm"),
		"terminate",
	);
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(onRun).not.toHaveBeenCalled();
});
it("keeps the reviewed workspace snapshot when the list refreshes", async () => {
	const onRun = vi.fn();
	const user = userEvent.setup();
	const { rerender } = render(
		<GlobalWorkspaceActionsView
			workspaces={[
				MockWorkspace,
				{ ...MockWorkspace, id: "system-prebuild", is_prebuild: true },
			]}
			onRun={onRun}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Shut Down" }));
	rerender(
		<GlobalWorkspaceActionsView
			workspaces={[
				MockWorkspace,
				{ ...MockWorkspace, id: "new-workspace", name: "new-workspace" },
			]}
			onRun={onRun}
		/>,
	);
	await user.type(
		screen.getByLabelText("Type shutdown to confirm"),
		"shutdown",
	);
	await user.click(
		within(screen.getByRole("dialog")).getByRole("button", {
			name: "Shut Down",
		}),
	);
	expect(onRun).toHaveBeenCalledExactlyOnceWith(
		"shutdown",
		[MockWorkspace],
		true,
	);
});

it.each([true, false])(
	"submits administrator exclusion %s with the reviewed targets",
	async (exclude) => {
		const onRun = vi.fn();
		const user = userEvent.setup();
		const administrator = {
			...MockWorkspace,
			id: "admin-workspace",
			owner_id: "admin-owner",
			owner_name: "admin",
		};
		render(
			<GlobalWorkspaceActionsView
				workspaces={[MockWorkspace, administrator]}
				administratorIds={[administrator.owner_id]}
				onRun={onRun}
			/>,
		);
		if (!exclude)
			await user.click(
				screen.getByRole("switch", {
					name: "Exclude administrator workspaces",
				}),
			);
		await user.click(screen.getByRole("button", { name: "Shut Down" }));
		await user.type(
			screen.getByLabelText("Type shutdown to confirm"),
			"shutdown",
		);
		await user.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Shut Down",
			}),
		);
		expect(onRun).toHaveBeenCalledExactlyOnceWith(
			"shutdown",
			exclude
				? [MockWorkspace]
				: expect.arrayContaining([MockWorkspace, administrator]),
			exclude,
		);
	},
);
