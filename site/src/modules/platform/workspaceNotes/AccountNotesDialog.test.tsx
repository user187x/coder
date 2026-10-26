import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockWorkspaceNote } from "#/testHelpers/workspaceNotes";
import { AccountWorkspaceNotes } from "./AccountNotesDialog";

afterEach(() => vi.restoreAllMocks());
it("creates centered notes, edits them, and deletes only after confirmation", async () => {
	vi.spyOn(PlatformAPI, "getWorkspaceNotes").mockResolvedValue({
		canEdit: true,
		notes: [MockWorkspaceNote],
	});
	const create = vi
		.spyOn(PlatformAPI, "createWorkspaceNote")
		.mockResolvedValue({ note: MockWorkspaceNote });
	const update = vi
		.spyOn(PlatformAPI, "updateWorkspaceNote")
		.mockResolvedValue({ note: MockWorkspaceNote });
	const remove = vi
		.spyOn(PlatformAPI, "deleteWorkspaceNote")
		.mockResolvedValue({ ok: true });
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<AccountWorkspaceNotes workspaceId={MockWorkspace.id} />
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Create note" }));
	await user.type(
		screen.getByRole("textbox", { name: "Note" }),
		"Review the dashboard",
	);
	await user.click(screen.getByRole("button", { name: "Create note" }));
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith(MockWorkspace.id, {
			text: "Review the dashboard",
			color: "yellow",
			x: 0.5 - 110 / window.innerWidth,
			y: 0.5 - 85 / window.innerHeight,
		}),
	);
	await user.click(await screen.findByRole("button", { name: "Edit note" }));
	await user.clear(screen.getByRole("textbox", { name: "Note" }));
	await user.type(
		screen.getByRole("textbox", { name: "Note" }),
		"Updated guidance",
	);
	await user.click(screen.getByRole("button", { name: "Save note" }));
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(MockWorkspaceNote.id, {
			text: "Updated guidance",
			color: MockWorkspaceNote.color,
		}),
	);
	await user.click(screen.getByRole("button", { name: "Delete note" }));
	expect(remove).not.toHaveBeenCalled();
	await user.click(
		within(screen.getByRole("dialog", { name: "Delete note" })).getByRole(
			"button",
			{ name: "Delete" },
		),
	);
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(MockWorkspaceNote.id),
	);
});
