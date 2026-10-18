import type {
	WorkspaceAgent,
	WorkspaceAgentScript,
	WorkspaceStatus,
} from "#/api/typesGenerated";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import {
	agentAppsReady,
	agentInitializing,
	initializingMilestones,
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

describe("apps still starting", () => {
	const withApps = (health: WorkspaceAgent["apps"][number]["health"]) => ({
		...agent("connected", "ready"),
		apps: [
			{
				...MockWorkspaceAgent.apps[0],
				slug: "notebook",
				display_name: "notebook",
				hidden: false,
				health,
			},
		],
	});

	it("keep the apps shut and the panel up until each answers its health check", () => {
		expect(agentAppsReady(withApps("initializing"))).toBe(false);
		expect(
			agentInitializing(workspace("running"), withApps("initializing")),
		).toBe(true);
		expect(initializingStep(withApps("initializing"))).toEqual({
			step: "Starting the apps",
			progress: { of: "apps", done: 0, total: 1, pending: ["notebook"] },
		});
	});

	it("do not hold the others back once healthy or unhealthy", () => {
		expect(agentAppsReady(withApps("healthy"))).toBe(true);
		expect(agentAppsReady(withApps("unhealthy"))).toBe(true);
		expect(agentInitializing(workspace("running"), withApps("healthy"))).toBe(
			false,
		);
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
			progress: {
				of: "scripts",
				done: 1,
				total: 3,
				pending: ["code-server", "desktop"],
			},
		});
	});
});

describe("initializingMilestones", () => {
	const app = (health: WorkspaceAgent["apps"][number]["health"]) => ({
		...MockWorkspaceAgent.apps[0],
		hidden: false,
		health,
	});

	it("counts the agent, each startup script and each checked app", () => {
		const starting = {
			...agent("connected", "starting", [script("tmux", "ok"), script("main")]),
			apps: [app("healthy"), app("initializing"), app("disabled")],
		};
		expect(initializingMilestones(starting)).toEqual({ done: 3, total: 5 });
		expect(
			initializingMilestones({ ...agent("connecting", "created"), apps: [] }),
		).toEqual({ done: 0, total: 1 });
	});
});
