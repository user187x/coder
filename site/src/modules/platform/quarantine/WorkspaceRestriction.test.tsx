import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI, type WorkspaceLockdown } from "#/api/platform";
import { workspaceQuarantineKey } from "#/api/queries/workspaceQuarantine";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
import { MockWorkspace } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { MockWorkspaceLockdown } from "#/testHelpers/workspaceLockdown";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import { useWorkspaceRestricted } from "./WorkspaceRestriction";

const Probe: React.FC<{ onOpen: () => void; actionLabel?: string }> = ({
	onOpen,
	actionLabel = "Open workspace app",
}) => {
	const restricted = useWorkspaceRestricted(MockWorkspace);
	return (
		<button type="button" disabled={restricted} onClick={onOpen}>
			{actionLabel}
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
	expect(onOpen).toHaveBeenCalledOnce();
});

it("allows a manual start after quarantine release without treating its start hold as a lock", async () => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(MockWorkspaceLockdown);
	const quarantine = vi.spyOn(WorkspaceQuarantineAPI, "get").mockResolvedValue({
		...MockWorkspaceQuarantine,
		enabled: false,
		manual_start_required: true,
	});
	const start = vi.fn();
	render(<Probe onOpen={start} actionLabel="Start workspace" />);
	await waitFor(() => expect(quarantine).toHaveBeenCalled());
	await userEvent.click(
		screen.getByRole("button", { name: "Start workspace" }),
	);
	expect(start).toHaveBeenCalledOnce();
});

it("unblocks an already mounted row when the release state enters the shared cache", async () => {
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(MockWorkspaceLockdown);
	const quarantine = vi
		.spyOn(WorkspaceQuarantineAPI, "get")
		.mockResolvedValue(MockWorkspaceQuarantine);
	const start = vi.fn();
	const { queryClient } = render(
		<Probe onOpen={start} actionLabel="Start workspace" />,
	);
	await waitFor(() => expect(quarantine).toHaveBeenCalled());
	await userEvent.click(
		screen.getByRole("button", { name: "Start workspace" }),
	);
	expect(start).not.toHaveBeenCalled();
	act(() =>
		queryClient.setQueryData(
			workspaceQuarantineKey(MockWorkspace.organization_id, MockWorkspace.id),
			{
				...MockWorkspaceQuarantine,
				enabled: false,
				manual_start_required: true,
			},
		),
	);
	await userEvent.click(
		screen.getByRole("button", { name: "Start workspace" }),
	);
	expect(start).toHaveBeenCalledOnce();
});
