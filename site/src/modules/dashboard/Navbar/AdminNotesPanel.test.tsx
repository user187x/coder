import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { AdminNotesAPI } from "#/api/adminNotes";
import { API } from "#/api/api";
import { adminNotesKey } from "#/api/queries/adminNotes";
import { MockAdminNote, MockUnreadAdminNote } from "#/testHelpers/adminNotes";
import { MockOrganization } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AdminNotesPanel } from "./AdminNotesPanel";

beforeEach(() => {
	vi.spyOn(API, "getOrganizations").mockResolvedValue([MockOrganization]);
	vi.spyOn(AdminNotesAPI, "list").mockResolvedValue({ notes: [MockAdminNote] });
});
afterEach(() => vi.restoreAllMocks());
const renderNotes = () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	renderComponent(
		<QueryClientProvider client={client}>
			<AdminNotesPanel enabled onClose={vi.fn()} />
		</QueryClientProvider>,
	);
	return client;
};
it("creates a private note, shares an edit, and deletes with its revision", async () => {
	const user = userEvent.setup();
	const save = vi
		.spyOn(AdminNotesAPI, "change")
		.mockResolvedValue({ notes: [MockAdminNote] });
	renderNotes();
	await user.click(await screen.findByRole("button", { name: /^Edit note:/ }));
	await user.type(screen.getByRole("textbox", { name: "Title" }), "Handover");
	await user.clear(screen.getByRole("textbox", { name: "Note" }));
	await user.type(
		screen.getByRole("textbox", { name: "Note" }),
		"Updated handover",
	);
	await user.click(screen.getByRole("combobox", { name: "Visibility" }));
	await user.click(screen.getByRole("option", { name: "Admins" }));
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith(MockOrganization.id, {
			action: "update",
			id: MockAdminNote.id,
			revision: 1,
			title: "Handover",
			text: "Updated handover",
			shared: true,
		}),
	);
	await user.click(screen.getByRole("combobox", { name: "Visibility" }));
	await user.click(screen.getByRole("option", { name: "Self" }));
	await user.click(await screen.findByRole("button", { name: "New note" }));
	await user.type(
		screen.getByRole("textbox", { name: "Note" }),
		"Private reminder",
	);
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith(MockOrganization.id, {
			action: "create",
			title: "",
			text: "Private reminder",
			shared: false,
		}),
	);
	await user.click(await screen.findByRole("button", { name: "Delete note" }));
	await user.click(screen.getByRole("button", { name: "Confirm delete" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith(MockOrganization.id, {
			action: "delete",
			id: MockAdminNote.id,
			revision: 1,
		}),
	);
});
it("keeps a draft after refetch and failed save, and discard does not submit", async () => {
	const user = userEvent.setup();
	const save = vi
		.spyOn(AdminNotesAPI, "change")
		.mockRejectedValueOnce(new Error("Conflict"))
		.mockResolvedValue({ notes: [MockAdminNote] });
	const client = renderNotes();
	await user.click(await screen.findByRole("button", { name: "Edit note" }));
	await user.clear(screen.getByRole("textbox", { name: "Note" }));
	await user.type(screen.getByRole("textbox", { name: "Note" }), "My draft");
	screen.getByRole("button", { name: "Resize notes panel" }).focus();
	await user.keyboard("{ArrowDown}{Home}");
	act(() =>
		client.setQueryData(adminNotesKey(MockOrganization.id), {
			notes: [{ ...MockAdminNote, revision: 2, text: "Other edit" }],
		}),
	);
	await user.click(screen.getByRole("button", { name: "Save" }));
	await screen.findByRole("alert");
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith(MockOrganization.id, {
			action: "update",
			id: MockAdminNote.id,
			revision: 1,
			title: "",
			text: "My draft",
			shared: false,
		}),
	);
	await user.click(await screen.findByRole("button", { name: "Edit note" }));
	await user.click(screen.getByRole("button", { name: "Discard" }));
	expect(save).toHaveBeenCalledTimes(2);
});

it("marks only the clicked shared revision read and preserves unread state after failure", async () => {
	const user = userEvent.setup();
	vi.mocked(AdminNotesAPI.list).mockResolvedValue({
		notes: [MockUnreadAdminNote],
	});
	const change = vi
		.spyOn(AdminNotesAPI, "change")
		.mockRejectedValueOnce(new Error("Unavailable"));
	const client = renderNotes();
	const note = await screen.findByRole("button", { name: "Expand note" });
	expect(change).not.toHaveBeenCalled();
	await user.click(note);
	await screen.findByRole("alert");
	expect(client.getQueryData(adminNotesKey(MockOrganization.id))).toEqual({
		notes: [MockUnreadAdminNote],
	});
	const readNote = { ...MockUnreadAdminNote, unread: false };
	vi.mocked(AdminNotesAPI.list).mockResolvedValue({ notes: [readNote] });
	change.mockResolvedValue({ notes: [readNote] });
	await user.click(screen.getByRole("button", { name: "Collapse note" }));
	expect(change).toHaveBeenCalledTimes(1);
	await user.click(note);
	await waitFor(() =>
		expect(client.getQueryData(adminNotesKey(MockOrganization.id))).toEqual({
			notes: [readNote],
		}),
	);
	expect(change).toHaveBeenLastCalledWith(MockOrganization.id, {
		action: "read",
		id: MockUnreadAdminNote.id,
		revision: 1,
	});
});

it("allows confirming deletion of a shared note from another author", async () => {
	const user = userEvent.setup();
	vi.mocked(AdminNotesAPI.list).mockResolvedValue({
		notes: [{ ...MockUnreadAdminNote, can_edit: false }],
	});
	const change = vi
		.spyOn(AdminNotesAPI, "change")
		.mockResolvedValue({ notes: [] });
	renderNotes();
	await user.click(await screen.findByRole("button", { name: "Delete note" }));
	expect(change).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Confirm delete" }));
	await waitFor(() =>
		expect(change).toHaveBeenCalledWith(MockOrganization.id, {
			action: "delete",
			id: MockUnreadAdminNote.id,
			revision: MockUnreadAdminNote.revision,
		}),
	);
});

it("selects notes across visibility filters and deletes them in one confirmed action", async () => {
	const user = userEvent.setup();
	const privateNote = { ...MockAdminNote, revision: 3 };
	const sharedNote = { ...MockUnreadAdminNote, can_edit: false };
	const notes = [privateNote, sharedNote];
	vi.mocked(AdminNotesAPI.list).mockResolvedValue({ notes });
	const change = vi
		.spyOn(AdminNotesAPI, "change")
		.mockImplementation(async () => {
			vi.mocked(AdminNotesAPI.list).mockResolvedValue({ notes: [] });
			return { notes: [] };
		});
	renderNotes();

	const table = await screen.findByRole("table", { name: "Admin notes" });
	const openMenu = () => user.pointer({ target: table, keys: "[MouseRight]" });
	await openMenu();
	await user.click(await screen.findByRole("menuitem", { name: "Select all" }));
	expect(screen.getByText("2 selected")).toBeVisible();
	expect(
		screen.getByRole("checkbox", { name: "Select all admin notes" }),
	).toBeChecked();

	await openMenu();
	await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
	expect(screen.getByText("Delete all 2 selected notes?")).toBeVisible();
	expect(change).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.getByText("2 selected")).toBeVisible();

	await user.click(screen.getByRole("button", { name: "Delete selected" }));
	await user.click(screen.getByRole("button", { name: "Confirm delete" }));
	await waitFor(() =>
		expect(change).toHaveBeenCalledExactlyOnceWith(MockOrganization.id, {
			action: "delete_many",
			notes: notes.map(({ id, revision }) => ({ id, revision })),
		}),
	);
	expect(
		await screen.findByText("No notes with this visibility yet."),
	).toBeVisible();
});
