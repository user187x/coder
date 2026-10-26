import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { AccountWorkspaceActions } from "./AccountWorkspaceActions";
import { AccountWorkspaceUpdate } from "./AccountWorkspaceUpdate";

afterEach(() => vi.restoreAllMocks());
it("terminates through the force-stop API and never deletes the workspace", async () => {
	vi.spyOn(PlatformAPI, "getWorkspacePowerHistory").mockResolvedValue({
		operations: [],
	});
	const start = vi
		.spyOn(PlatformAPI, "startWorkspacePower")
		.mockResolvedValue({ ...MockWorkspacePowerOperation, action: "terminate" });
	const remove = vi.spyOn(API, "deleteWorkspace");
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<AccountWorkspaceActions targets={[MockWorkspace]} compact />
		</QueryClientProvider>,
	);
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
		),
	);
	expect(remove).not.toHaveBeenCalled();
});

it("retries unavailable workspace power history", async () => {
	const history = vi
		.spyOn(PlatformAPI, "getWorkspacePowerHistory")
		.mockRejectedValueOnce(new Error("Power history unavailable"))
		.mockResolvedValue({ operations: [] });
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<AccountWorkspaceActions targets={[MockWorkspace]} compact />
		</QueryClientProvider>,
	);
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
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<AccountWorkspaceUpdate workspace={workspace} />
		</QueryClientProvider>,
	);
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
