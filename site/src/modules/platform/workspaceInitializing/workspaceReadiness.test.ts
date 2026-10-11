import type {
	WorkspaceAgent,
	WorkspaceAgentScript,
	WorkspaceStatus,
} from "#/api/typesGenerated";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import {
	agentAppsReady,
	agentInitializing,
	initializingStep,
} from "./workspaceReadiness";

const workspace = (status: WorkspaceStatus) => ({
	...MockWorkspace,
	latest_build: {
		...MockWorkspace.latest_build,
		status,
		transition: "start" as const,
	},
});
const agent = (
	status: WorkspaceAgent["status"],
	lifecycle_state: WorkspaceAgent["lifecycle_state"],
	scripts: WorkspaceAgentScript[] = [],
): WorkspaceAgent => ({
	...MockWorkspaceAgent,
	status,
	lifecycle_state,
	scripts,
});
const script = (
	display_name: string,
	status?: WorkspaceAgentScript["status"],
): WorkspaceAgentScript => ({
	id: display_name,
	log_source_id: display_name,
	log_path: "",
	script: "",
	cron: "",
	run_on_stop: false,
	start_blocks_login: false,
	timeout: 0,
	display_name,
	run_on_start: true,
	status,
});

describe("agentAppsReady", () => {
	it("opens the apps once the agent is connected and started", () => {
		expect(agentAppsReady(agent("connected", "ready"))).toBe(true);
		expect(agentAppsReady(agent("connected", "start_error"))).toBe(true);
		expect(agentAppsReady(agent("connected", "start_timeout"))).toBe(true);
	});

	it("keeps them shut while the agent connects or starts", () => {
		expect(agentAppsReady(agent("connecting", "created"))).toBe(false);
		expect(agentAppsReady(agent("connected", "created"))).toBe(false);
		expect(agentAppsReady(agent("connected", "starting"))).toBe(false);
		expect(agentAppsReady(agent("disconnected", "ready"))).toBe(false);
	});
});

describe("agentInitializing", () => {
	it("is true while a starting workspace's agent comes up", () => {
		expect(
			agentInitializing(workspace("starting"), agent("connecting", "created")),
		).toBe(true);
		expect(
			agentInitializing(workspace("running"), agent("connected", "starting")),
		).toBe(true);
	});

	it("is false once ready, or when the workspace is not starting", () => {
		expect(
			agentInitializing(workspace("running"), agent("connected", "ready")),
		).toBe(false);
		expect(
			agentInitializing(workspace("stopping"), agent("connecting", "created")),
		).toBe(false);
		expect(
			agentInitializing(workspace("running"), agent("timeout", "created")),
		).toBe(false);
	});
});

describe("initializingStep", () => {
	it("says what the start is doing", () => {
		expect(initializingStep(agent("connecting", "created")).step).toMatch(
			/connect/,
		);
		expect(
			initializingStep(
				agent("connected", "starting", [
					script("tmux", "ok"),
					script("code-server"),
					script("desktop"),
				]),
			),
		).toEqual({
			step: "Running the startup scripts",
			scripts: { done: 1, total: 3, running: ["code-server", "desktop"] },
		});
	});
});
