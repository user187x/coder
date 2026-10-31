import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import * as terminalConnector from "#/modules/platform/announcement/terminalConnector";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";

afterEach(() => vi.restoreAllMocks());

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

it("connects the selected workspace directly to the announcement terminal", async () => {
	const connect = vi
		.spyOn(terminalConnector, "connectBannerTerminal")
		.mockReturnValue(true);
	const user = userEvent.setup();
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
		await screen.findByRole("menuitem", { name: "Connect terminal" }),
	);
	expect(connect).toHaveBeenCalledExactlyOnceWith(MockWorkspace);
});

it("explains when no announcement banner is available", async () => {
	vi.spyOn(terminalConnector, "connectBannerTerminal").mockReturnValue(false);
	const error = vi.spyOn(toast, "error");
	const user = userEvent.setup();
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
		await screen.findByRole("menuitem", { name: "Connect terminal" }),
	);
	expect(error).toHaveBeenCalledWith(
		"Show the announcement banner to connect a terminal.",
	);
});
