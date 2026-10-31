import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	MockTemplate,
	MockWorkspace,
	MockWorkspaceAgentReady,
	MockWorkspaceApp,
} from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { organizeAgentApps } from "./AgentApps/AgentApps";
import { AgentRow } from "./AgentRow";
import { useAgentLogs } from "./useAgentLogs";

vi.mock("./useAgentLogs", () => ({ useAgentLogs: vi.fn(() => []) }));

it("does not start embedded log streaming until the logs panel is opened", async () => {
	const user = userEvent.setup();
	renderWithAuth(
		<AgentRow
			agent={{
				...MockWorkspaceAgentReady,
				lifecycle_state: "start_error",
				logs_length: 1,
			}}
			workspace={MockWorkspace}
			template={MockTemplate}
			onUpdateAgent={() => {}}
			initiallyCollapsed
		/>,
	);
	const logs = await screen.findByRole("button", { name: "Logs" });
	expect(useAgentLogs).toHaveBeenLastCalledWith({
		agentId: MockWorkspaceAgentReady.id,
		enabled: false,
	});
	await user.click(logs);
	await waitFor(() =>
		expect(useAgentLogs).toHaveBeenLastCalledWith({
			agentId: MockWorkspaceAgentReady.id,
			enabled: true,
		}),
	);
});

describe("organizeAgentApps", () => {
	test("returns one ungrouped app", () => {
		const result = organizeAgentApps([{ ...MockWorkspaceApp }]);

		expect(result).toEqual([{ apps: [MockWorkspaceApp] }]);
	});

	test("handles ordering correctly", () => {
		const bugApp = { ...MockWorkspaceApp, slug: "bug", group: "creatures" };
		const birdApp = { ...MockWorkspaceApp, slug: "bird", group: "creatures" };
		const fishApp = { ...MockWorkspaceApp, slug: "fish", group: "creatures" };
		const riderApp = { ...MockWorkspaceApp, slug: "rider" };
		const zedApp = { ...MockWorkspaceApp, slug: "zed" };
		const result = organizeAgentApps([
			bugApp,
			riderApp,
			birdApp,
			zedApp,
			fishApp,
		]);

		expect(result).toEqual([
			{ group: "creatures", apps: [bugApp, birdApp, fishApp] },
			{ apps: [riderApp] },
			{ apps: [zedApp] },
		]);
	});
});
