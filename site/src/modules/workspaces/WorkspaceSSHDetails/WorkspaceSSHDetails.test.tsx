import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import {
	MockDeploymentSSH,
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { WorkspaceSSHDetails } from "./WorkspaceSSHDetails";

afterEach(() => vi.restoreAllMocks());
it("retrieves current agents on hover and copies the deployment's SSH route", async () => {
	const user = userEvent.setup();
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
	const agent = { ...MockWorkspaceAgent, name: "current-agent" };
	const get = vi.spyOn(API, "getWorkspace").mockResolvedValue({
		...MockWorkspace,
		latest_build: {
			...MockWorkspace.latest_build,
			resources: [{ ...MockWorkspaceResource, agents: [agent] }],
		},
	});
	vi.spyOn(API, "getDeploymentSSHConfig").mockResolvedValue({
		...MockDeploymentSSH,
		hostname_suffix: "coder.example.test",
	});
	render(
		<div>
			<a href="#workspace">Workspace</a>
			<WorkspaceSSHDetails workspace={MockWorkspace}>
				{(events) => (
					<button type="button" {...events} aria-label="Workspace avatar">
						Avatar
					</button>
				)}
			</WorkspaceSSHDetails>
		</div>,
	);
	expect(get).not.toHaveBeenCalled();
	await user.hover(screen.getByRole("button", { name: "Workspace avatar" }));
	await user.click(
		await screen.findByRole("button", {
			name: "Copy SSH command for current-agent",
		}),
	);
	await waitFor(() =>
		expect(copy).toHaveBeenCalledWith(
			`ssh current-agent.${MockWorkspace.name}.${MockWorkspace.owner_name}.coder.example.test`,
		),
	);
	expect(get).toHaveBeenCalledWith(MockWorkspace.id);
});
