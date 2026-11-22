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

it("opens overview actions on click and lets the user collapse or request fullscreen", async () => {
	const user = userEvent.setup();
	const onToggleFullscreen = vi.fn();
	renderWithAuth(
		<AgentRow
			agent={MockWorkspaceAgentReady}
			workspace={MockWorkspace}
			template={MockTemplate}
			onUpdateAgent={() => {}}
			onToggleFullscreen={onToggleFullscreen}
			topbar={<header>Workspace test overview</header>}
		/>,
	);
	const trigger = await screen.findByRole("button", {
		name: "Workspace overview options",
	});
	await user.click(trigger);
	const collapse = screen.getByRole("button", {
		name: "Collapse workspace overview",
	});
	expect(collapse).toBe(trigger);
	await user.click(collapse);
	expect(screen.getByText("Workspace test overview")).not.toBeVisible();
	await user.click(trigger);
	const expand = screen.getByRole("button", {
		name: "Expand workspace overview",
	});
	await user.tab();
	expect(
		screen.getByRole("button", { name: "Enter fullscreen" }),
	).toHaveFocus();
	await user.keyboard("{Escape}");
	expect(trigger).toHaveFocus();
	expect(trigger).toHaveAccessibleName("Workspace overview options");
	await user.click(trigger);
	await user.click(expand);
	expect(screen.getByText("Workspace test overview")).toBeVisible();
	await user.click(trigger);
	await user.click(screen.getByRole("button", { name: "Enter fullscreen" }));
	expect(onToggleFullscreen).toHaveBeenCalledOnce();
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
