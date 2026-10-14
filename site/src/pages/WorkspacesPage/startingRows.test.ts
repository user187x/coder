import type {
	Workspace,
	WorkspaceAgentLifecycle,
	WorkspaceApp,
	WorkspaceBuild,
} from "#/api/typesGenerated";
import {
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceApp,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { isStartingUp, markRestarting } from "./startingRows";

const withBuild = (
	build: Partial<WorkspaceBuild>,
	lifecycle: WorkspaceAgentLifecycle = "ready",
	appHealth: WorkspaceApp["health"] = "healthy",
): Workspace => ({
	...MockWorkspace,
	latest_build: {
		...MockWorkspace.latest_build,
		...build,
		resources: [
			{
				...MockWorkspaceResource,
				agents: [
					{
						...MockWorkspaceAgent,
						status: "connected",
						lifecycle_state: lifecycle,
						apps: [{ ...MockWorkspaceApp, health: appHealth, hidden: false }],
					},
				],
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

	it("lasts until every app has answered its health check (the row's app icons wait for that)", () => {
		expect(
			isStartingUp(
				withBuild(
					{ transition: "start", status: "running" },
					"ready",
					"initializing",
				),
			),
		).toBe(true);
		expect(
			isStartingUp(
				withBuild(
					{ transition: "start", status: "running" },
					"ready",
					"healthy",
				),
			),
		).toBe(false);
		expect(
			isStartingUp(
				withBuild(
					{ transition: "start", status: "running" },
					"ready",
					"disabled",
				),
			),
		).toBe(false);
	});

	it("is not held back by an app that fails its checks", () => {
		expect(
			isStartingUp(
				withBuild(
					{ transition: "start", status: "running" },
					"ready",
					"unhealthy",
				),
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
