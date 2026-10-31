import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import { AccountWorkspaceActions } from "./AccountWorkspaceActions";
import { AccountWorkspaceManagement } from "./AccountWorkspaceManagement";
import { AccountWorkspaceUpdate } from "./AccountWorkspaceUpdate";

afterEach(() => vi.restoreAllMocks());
it("allows quarantined workspace cleanup without allowing restart", async () => {
	vi.spyOn(WorkspaceQuarantineAPI, "get").mockResolvedValue(
		MockWorkspaceQuarantine,
	);
	vi.spyOn(PlatformAPI, "getWorkspacePowerHistory").mockResolvedValue({
		operations: [],
	});
	const start = vi
		.spyOn(PlatformAPI, "startWorkspacePower")
		.mockResolvedValue(MockWorkspacePowerOperation);
	const remove = vi
		.spyOn(API, "deleteWorkspace")
		.mockResolvedValue(MockWorkspace.latest_build);
	render(<AccountWorkspaceManagement workspace={MockWorkspace} />);
	const user = userEvent.setup();
	await waitFor(() => expect(WorkspaceQuarantineAPI.get).toHaveBeenCalled());
	await user.click(
		screen.getByRole("button", { name: `Restart ${MockWorkspace.name}` }),
	);
	expect(start).not.toHaveBeenCalled();
	await user.click(
		screen.getByRole("button", { name: `Terminate ${MockWorkspace.name}` }),
	);
	const terminate = within(screen.getByRole("dialog"));
	await user.type(
		terminate.getByLabelText("Type terminate to confirm"),
		"terminate",
	);
	await user.click(terminate.getByRole("button", { name: "Terminate" }));
	await waitFor(() =>
		expect(start).toHaveBeenCalledWith(
			MockWorkspace.organization_id,
			"terminate",
			[MockWorkspace.id],
			false,
		),
	);
	await user.click(
		screen.getByRole("button", { name: `Delete ${MockWorkspace.name}` }),
	);
	const deletion = within(
		screen.getByRole("dialog", { name: "Delete Workspace" }),
	);
	await user.type(
		deletion.getByLabelText("Workspace name"),
		MockWorkspace.name,
	);
	expect(remove).not.toHaveBeenCalled();
	await user.click(deletion.getByRole("button", { name: "Delete" }));
	await waitFor(() =>
		expect(remove).toHaveBeenCalledWith(MockWorkspace.id, { orphan: false }),
	);
});
it("terminates through the force-stop API and never deletes the workspace", async () => {
	vi.spyOn(PlatformAPI, "getWorkspacePowerHistory").mockResolvedValue({
		operations: [],
	});
	const start = vi
		.spyOn(PlatformAPI, "startWorkspacePower")
		.mockResolvedValue({ ...MockWorkspacePowerOperation, action: "terminate" });
	const remove = vi.spyOn(API, "deleteWorkspace");
	render(<AccountWorkspaceActions targets={[MockWorkspace]} compact />);
	await userEvent.click(
		screen.getByRole("button", { name: `Terminate ${MockWorkspace.name}` }),
	);
	const dialog = within(screen.getByRole("dialog"));
	await userEvent.type(
		dialog.getByLabelText("Type terminate to confirm"),
		"terminate",
	);
	await userEvent.click(dialog.getByRole("button", { name: "Terminate" }));
	await waitFor(() =>
		expect(start).toHaveBeenCalledWith(
			MockWorkspace.organization_id,
			"terminate",
			[MockWorkspace.id],
			false,
		),
	);
	expect(remove).not.toHaveBeenCalled();
});

it("retries unavailable workspace power history", async () => {
	const history = vi
		.spyOn(PlatformAPI, "getWorkspacePowerHistory")
		.mockRejectedValueOnce(new Error("Power history unavailable"))
		.mockResolvedValue({ operations: [] });
	render(<AccountWorkspaceActions targets={[MockWorkspace]} compact />);
	await userEvent.click(
		await screen.findByRole("button", {
			name: "Retry workspace power history",
		}),
	);
	await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
});

it("updates another account's workspace only after review", async () => {
	const workspace = { ...MockWorkspace, outdated: true };
	const update = vi
		.spyOn(API, "updateWorkspace")
		.mockResolvedValue(workspace.latest_build);
	render(<AccountWorkspaceUpdate workspace={workspace} />);
	const user = userEvent.setup();
	await user.click(
		screen.getByRole("button", { name: `Update ${workspace.name}` }),
	);
	expect(update).not.toHaveBeenCalled();
	await user.click(
		within(screen.getByRole("dialog", { name: "Update workspace" })).getByRole(
			"button",
			{ name: "Update" },
		),
	);
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(workspace, undefined),
	);
});
