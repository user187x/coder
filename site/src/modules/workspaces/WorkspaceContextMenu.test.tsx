import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

it("copies the selected workspace URL from its context menu", async () => {
	const user = userEvent.setup();
	const write = vi.spyOn(navigator.clipboard, "writeText");
	render(
		<WorkspaceContextMenu workspace={MockWorkspace}>
			<span>{MockWorkspace.name}</span>
		</WorkspaceContextMenu>,
	);
	await user.pointer({
		keys: "[MouseRight]",
		target: screen.getByText(MockWorkspace.name),
	});
	await user.click(
		await screen.findByRole("menuitem", { name: "Copy workspace link" }),
	);
	await waitFor(() =>
		expect(write).toHaveBeenCalledWith(
			new URL(
				`/@${MockWorkspace.owner_name}/${MockWorkspace.name}`,
				location.origin,
			).href,
		),
	);
});
