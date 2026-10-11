import type {
	WorkspaceAgent,
	WorkspaceBuild,
	WorkspaceStatus,
} from "#/api/typesGenerated";
import { MockWorkspace, MockWorkspaceAgent } from "#/testHelpers/entities";
import { agentBorderState } from "./agentBorderState";

const workspace = (
	status: WorkspaceStatus,
	transition: WorkspaceBuild["transition"] = "start",
) => ({
	...MockWorkspace,
	latest_build: { ...MockWorkspace.latest_build, status, transition },
});
const agent = (
	status: WorkspaceAgent["status"],
	lifecycle_state: WorkspaceAgent["lifecycle_state"],
): WorkspaceAgent => ({ ...MockWorkspaceAgent, status, lifecycle_state });
const none = { scriptIssues: false, otherIssues: false };

describe("agentBorderState", () => {
	it("is ready once started, connected and its scripts are done", () => {
		expect(
			agentBorderState(workspace("running"), agent("connected", "ready"), none),
		).toBe("ready");
	});

	it("is initializing while the workspace starts and the agent comes up", () => {
		expect(
			agentBorderState(
				workspace("starting"),
				agent("connecting", "created"),
				none,
			),
		).toBe("initializing");
		expect(
			agentBorderState(
				workspace("running"),
				agent("connecting", "created"),
				none,
			),
		).toBe("initializing");
		expect(
			agentBorderState(
				workspace("running"),
				agent("connected", "starting"),
				none,
			),
		).toBe("initializing");
	});

	it("is pending (orange) when queued or when something failed without stopping it", () => {
		expect(
			agentBorderState(
				workspace("pending"),
				agent("connecting", "created"),
				none,
			),
		).toBe("pending");
		expect(
			agentBorderState(
				workspace("running"),
				agent("connected", "start_error"),
				none,
			),
		).toBe("pending");
		expect(
			agentBorderState(workspace("running"), agent("timeout", "created"), none),
		).toBe("pending");
		expect(
			agentBorderState(workspace("running"), agent("connected", "ready"), {
				scriptIssues: true,
				otherIssues: false,
			}),
		).toBe("pending");
	});

	it("is failed (red) when the build failed or a running agent is lost", () => {
		expect(
			agentBorderState(workspace("failed"), agent("disconnected", "off"), none),
		).toBe("failed");
		expect(
			agentBorderState(
				workspace("running"),
				agent("disconnected", "ready"),
				none,
			),
		).toBe("failed");
	});

	it("leaves Coder's own border when stopping, stopped or deleted", () => {
		for (const status of ["stopping", "stopped", "deleted"] as const) {
			expect(
				agentBorderState(
					workspace(status, status === "deleted" ? "delete" : "stop"),
					agent("disconnected", "off"),
					none,
				),
			).toBeNull();
		}
	});
});
