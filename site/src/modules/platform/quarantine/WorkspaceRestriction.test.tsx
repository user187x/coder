import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI, type WorkspaceLockdown } from "#/api/platform";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { MockWorkspaceLockdown } from "#/testHelpers/workspaceLockdown";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import { useWorkspaceRestricted } from "./WorkspaceRestriction";

const Probe: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
	const restricted = useWorkspaceRestricted(MockWorkspace);
	return (
		<button type="button" disabled={restricted} onClick={onOpen}>
			Open workspace app
		</button>
	);
};
afterEach(() => vi.restoreAllMocks());
it.each<{ modes: WorkspaceLockdown["modes"] }>([
	{ modes: ["network", "sudo"] },
	{ modes: ["freeze"] },
])("blocks app actions for full lockdown %j", async ({ modes }) => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue({
		...MockWorkspaceLockdown,
		locked: true,
		modes,
		inForce: true,
	});
	const quarantine = vi.spyOn(WorkspaceQuarantineAPI, "get").mockResolvedValue({
		...MockWorkspaceQuarantine,
		enabled: false,
		manual_start_required: false,
	});
	const onOpen = vi.fn();
	render(<Probe onOpen={onOpen} />);
	await waitFor(() => expect(quarantine).toHaveBeenCalled());
	await userEvent.click(
		screen.getByRole("button", { name: "Open workspace app" }),
	);
	expect(onOpen).not.toHaveBeenCalled();
});
it("blocks app actions while quarantine enforcement is still pending", async () => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(MockWorkspaceLockdown);
	const quarantine = vi
		.spyOn(WorkspaceQuarantineAPI, "get")
		.mockResolvedValue(MockWorkspaceQuarantine);
	const onOpen = vi.fn();
	render(<Probe onOpen={onOpen} />);
	await waitFor(() => expect(quarantine).toHaveBeenCalled());
	await userEvent.click(
		screen.getByRole("button", { name: "Open workspace app" }),
	);
	expect(onOpen).not.toHaveBeenCalled();
});

it("retains app access for a privilege-only restriction", async () => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue({
		...MockWorkspaceLockdown,
		locked: true,
		modes: ["sudo"],
	});
	const quarantine = vi
		.spyOn(WorkspaceQuarantineAPI, "get")
		.mockResolvedValue({
			...MockWorkspaceQuarantine,
			enabled: false,
			manual_start_required: false,
		});
	const onOpen = vi.fn();
	render(<Probe onOpen={onOpen} />);
	await waitFor(() => expect(quarantine).toHaveBeenCalled());
	await userEvent.click(
		screen.getByRole("button", { name: "Open workspace app" }),
	);
	expect(onOpen).toHaveBeenCalledOnce();
});
