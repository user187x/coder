import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
import { MockStoppedWorkspace, MockTemplate } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { MockWorkspaceLockdown } from "#/testHelpers/workspaceLockdown";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import { WorkspaceTopbar } from "./WorkspaceTopbar";

afterEach(() => vi.restoreAllMocks());
it("does not start or update a quarantined workspace through the topbar", async () => {
	const quarantine = vi
		.spyOn(WorkspaceQuarantineAPI, "get")
		.mockResolvedValue(MockWorkspaceQuarantine);
	vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(MockWorkspaceLockdown);
	const onStart = vi.fn();
	const onUpdate = vi.fn();
	renderWithAuth(
		<WorkspaceTopbar
			workspace={{ ...MockStoppedWorkspace, outdated: true }}
			template={MockTemplate}
			isUpdating={false}
			isRestarting={false}
			permissions={{
				readWorkspace: true,
				shareWorkspace: true,
				updateWorkspace: true,
				updateWorkspaceVersion: true,
				deleteFailedWorkspace: true,
			}}
			handleStart={onStart}
			handleUpdate={onUpdate}
			handleStop={vi.fn()}
			handleRestart={vi.fn()}
			handleCancel={vi.fn()}
			handleDormantActivate={vi.fn()}
			handleRetry={vi.fn()}
			handleDebug={vi.fn()}
		/>,
	);
	await waitFor(() => expect(quarantine).toHaveBeenCalled());
	const user = userEvent.setup({ pointerEventsCheck: 0 });
	await user.click(
		await screen.findByRole("button", {
			name: "Start",
			hidden: true,
		}),
	);
	await user.click(
		screen.getByRole("button", { name: /Update and start/i, hidden: true }),
	);
	expect(onStart).not.toHaveBeenCalled();
	expect(onUpdate).not.toHaveBeenCalled();
});
