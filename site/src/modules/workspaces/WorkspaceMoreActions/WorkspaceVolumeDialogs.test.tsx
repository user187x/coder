import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import {
	WorkspaceExtrasAPI,
	type WorkspaceVolume,
} from "#/api/workspaceVolumes";
import { MockWorkspace } from "#/testHelpers/entities";
import {
	MockVMWorkspaceVolume,
	MockWorkspaceVolume,
} from "#/testHelpers/workspaceVolumes";
import { BackupHomeDialog, ExpandDiskDialog } from "./WorkspaceVolumeDialogs";

const setup = (kind: "backup" | "expand", volume: WorkspaceVolume) => {
	vi.spyOn(WorkspaceExtrasAPI, "volume").mockResolvedValue(volume);
	const Component = kind === "backup" ? BackupHomeDialog : ExpandDiskDialog;
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<Component workspace={MockWorkspace} open onClose={vi.fn()} />
		</QueryClientProvider>,
	);
	return userEvent.setup();
};
afterEach(() => vi.restoreAllMocks());
it("does not submit expansion by click or Enter while a VM is running", async () => {
	const expand = vi
		.spyOn(WorkspaceExtrasAPI, "expand")
		.mockResolvedValue({ disk: 1 });
	const user = setup("expand", { ...MockVMWorkspaceVolume, running: true });
	const input = await screen.findByRole("spinbutton", {
		name: "New size (GB)",
	});
	await user.type(input, "40");
	await user.keyboard("{Enter}");
	await user.click(screen.getByRole("button", { name: "Expand to 40 GB" }));
	expect(expand).not.toHaveBeenCalled();
});
it("submits the reviewed size for a stopped VM", async () => {
	const expand = vi
		.spyOn(WorkspaceExtrasAPI, "expand")
		.mockResolvedValue({ disk: 1 });
	const user = setup("expand", MockVMWorkspaceVolume);
	await user.type(
		await screen.findByRole("spinbutton", { name: "New size (GB)" }),
		"40",
	);
	await user.click(screen.getByRole("button", { name: "Expand to 40 GB" }));
	await waitFor(() =>
		expect(expand).toHaveBeenCalledExactlyOnceWith(MockWorkspace.id, 40),
	);
});
it.each([true, false])(
	"backs up a VM only while stopped (running=%s)",
	async (running) => {
		const backup = vi
			.spyOn(WorkspaceExtrasAPI, "backup")
			.mockResolvedValue({ backup: 1 });
		const user = setup("backup", { ...MockVMWorkspaceVolume, running });
		await screen.findByTestId("backup-dialog");
		await user.click(screen.getByRole("button", { name: "Back up now" }));
		if (running) expect(backup).not.toHaveBeenCalled();
		else
			await waitFor(() =>
				expect(backup).toHaveBeenCalledExactlyOnceWith(
					MockWorkspace.id,
					"download",
				),
			);
	},
);
it("preserves native live backup behavior", async () => {
	const backup = vi
		.spyOn(WorkspaceExtrasAPI, "backup")
		.mockResolvedValue({ backup: 1 });
	const user = setup("backup", { ...MockWorkspaceVolume, running: true });
	await screen.findByTestId("backup-dialog");
	await user.click(screen.getByRole("button", { name: "Back up now" }));
	await waitFor(() =>
		expect(backup).toHaveBeenCalledExactlyOnceWith(
			MockWorkspace.id,
			"download",
		),
	);
});
