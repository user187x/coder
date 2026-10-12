import { screen } from "@testing-library/react";
import { PlatformAPI } from "#/api/platform";
import { MockUserOwner, MockWorkspace } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { WorkspaceNotesButton } from "./WorkspaceNotesButton";

describe("WorkspaceNotesButton", () => {
	afterEach(() => vi.restoreAllMocks());

	it("shows admins the sticky-note button on another user's workspace", async () => {
		vi.spyOn(PlatformAPI, "getWorkspaceNotes").mockResolvedValue({
			notes: [],
			canEdit: true,
		});
		renderWithAuth(
			<WorkspaceNotesButton
				workspace={{ ...MockWorkspace, owner_id: "someone-else" }}
			/>,
		);
		const button = await screen.findByTestId("workspace-notes-add");
		expect(button.querySelector(".lucide-sticky-note")).not.toBeNull();
	});

	it("is not shown on the admin's own workspace", async () => {
		const get = vi.spyOn(PlatformAPI, "getWorkspaceNotes").mockResolvedValue({
			notes: [],
			canEdit: true,
		});
		renderWithAuth(
			<WorkspaceNotesButton
				workspace={{ ...MockWorkspace, owner_id: MockUserOwner.id }}
			/>,
		);
		await vi.waitFor(() => expect(get).toHaveBeenCalled());
		expect(screen.queryByTestId("workspace-notes-add")).toBeNull();
	});
});
