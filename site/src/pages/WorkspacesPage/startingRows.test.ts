import type {
	Workspace,
	WorkspaceAgentLifecycle,
	WorkspaceBuild,
} from "#/api/typesGenerated";
import {
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { isStartingUp, markRestarting } from "./startingRows";

const withBuild = (
	build: Partial<WorkspaceBuild>,
	lifecycle: WorkspaceAgentLifecycle = "ready",
): Workspace => ({
	...MockWorkspace,
	latest_build: {
		...MockWorkspace.latest_build,
		...build,
		resources: [
			{
				...MockWorkspaceResource,
				agents: [{ ...MockWorkspaceAgent, lifecycle_state: lifecycle }],
			},
		],
	},
});

describe("isStartingUp", () => {
	it("is a start (or update) queued or running", () => {
		expect(
			isStartingUp(withBuild({ transition: "start", status: "pending" })),
		).toBe(true);
		expect(
			isStartingUp(withBuild({ transition: "start", status: "starting" })),
		).toBe(true);
	});

	it("lasts until every agent is ready", () => {
		expect(
			isStartingUp(
				withBuild({ transition: "start", status: "running" }, "starting"),
			),
		).toBe(true);
		expect(
			isStartingUp(
				withBuild({ transition: "start", status: "running" }, "created"),
			),
		).toBe(true);
		expect(
			isStartingUp(
				withBuild({ transition: "start", status: "running" }, "ready"),
			),
		).toBe(false);
	});

	it("ends when the start fails", () => {
		expect(
			isStartingUp(withBuild({ transition: "start", status: "failed" })),
		).toBe(false);
		expect(
			isStartingUp(
				withBuild({ transition: "start", status: "running" }, "start_error"),
			),
		).toBe(false);
		expect(
			isStartingUp(
				withBuild({ transition: "start", status: "running" }, "start_timeout"),
			),
		).toBe(false);
	});

	it("is not a plain stop or delete", () => {
		expect(
			isStartingUp(withBuild({ transition: "stop", status: "stopping" })),
		).toBe(false);
		expect(
			isStartingUp(withBuild({ transition: "stop", status: "pending" })),
		).toBe(false);
		expect(
			isStartingUp(withBuild({ transition: "delete", status: "deleting" })),
		).toBe(false);
	});

	it("covers a restart's stop too", () => {
		expect(
			isStartingUp(withBuild({ transition: "stop", status: "stopping" }), true),
		).toBe(true);
		expect(
			isStartingUp(withBuild({ transition: "stop", status: "stopped" }), true),
		).toBe(true);
		expect(
			isStartingUp(withBuild({ transition: "stop", status: "failed" }), true),
		).toBe(false);
	});

	it("tracks restarts per workspace", () => {
		markRestarting("w1", true);
		markRestarting("w1", false);
		expect(
			isStartingUp(withBuild({ transition: "stop", status: "stopping" })),
		).toBe(false);
	});
});
