import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type WorkspaceNote } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { WorkspaceNotes } from "./WorkspaceNotes";

const note: WorkspaceNote = {
	id: "n1",
	workspaceId: MockWorkspace.id,
	text: "Push your branch before Friday",
	color: "yellow",
	x: 0.5,
	y: 0.2,
	tilt: 3,
	author: "admin",
	createdAt: "2026-10-11T00:00:00Z",
	updatedAt: "2026-10-11T00:00:00Z",
	dismissedAt: null,
};

const renderNotes = () =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<WorkspaceNotes workspace={MockWorkspace} />
		</QueryClientProvider>,
	);

describe("WorkspaceNotes", () => {
	afterEach(() => vi.restoreAllMocks());

	it("shows the owner the note, crooked and over the page, with only Dismiss", async () => {
		vi.spyOn(PlatformAPI, "getWorkspaceNotes").mockResolvedValue({
			notes: [note],
			canEdit: false,
		});
		const dismiss = vi
			.spyOn(PlatformAPI, "dismissWorkspaceNote")
			.mockResolvedValue({ note: { ...note, dismissedAt: "now" } });
		renderNotes();
		const el = await screen.findByTestId("workspace-note");
		expect(el).toHaveTextContent("Push your branch before Friday");
		expect(el.style.getPropertyValue("--note-tilt")).toBe("3deg");
		expect(screen.getByTestId("workspace-notes").parentElement).toBe(
			document.body,
		);
		expect(screen.queryByTestId("workspace-notes-add")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Delete the note" }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss the note" }));
		await waitFor(() => expect(dismiss).toHaveBeenCalledWith("n1"));
	});

	it("lets admins add, edit and delete notes", async () => {
		vi.spyOn(PlatformAPI, "getWorkspaceNotes").mockResolvedValue({
			notes: [note],
			canEdit: true,
		});
		const create = vi
			.spyOn(PlatformAPI, "createWorkspaceNote")
			.mockResolvedValue({ note: { ...note, id: "n2" } });
		renderNotes();
		await screen.findByTestId("workspace-note");
		expect(
			screen.getByRole("button", { name: "Edit the note" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Delete the note" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByTestId("workspace-notes-add"));
		fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
			target: { value: "Restart after the update" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "pink" }));
		fireEvent.click(screen.getByRole("button", { name: "Stick it" }));
		await waitFor(() =>
			expect(create).toHaveBeenCalledWith(
				MockWorkspace.id,
				expect.objectContaining({
					text: "Restart after the update",
					color: "pink",
				}),
			),
		);
	});
});
