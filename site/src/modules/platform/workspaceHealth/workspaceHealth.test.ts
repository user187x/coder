import {
	MockFailedWorkspace,
	MockWorkspace,
	MockWorkspaceAgent,
	MockWorkspaceResource,
} from "#/testHelpers/entities";
import { findUnhealthyWorkspaces } from "./workspaceHealth";

describe("findUnhealthyWorkspaces", () => {
	it("leaves healthy workspaces out", () => {
		expect(findUnhealthyWorkspaces([MockWorkspace])).toEqual([]);
	});

	it("lists failed builds first, then unhealthy agents", () => {
		const disconnected = {
			...MockWorkspace,
			id: "disconnected",
			owner_name: "alice",
			latest_build: {
				...MockWorkspace.latest_build,
				status: "running" as const,
				resources: [
					{
						...MockWorkspaceResource,
						agents: [
							{ ...MockWorkspaceAgent, status: "disconnected" as const },
						],
					},
				],
			},
		};
		const result = findUnhealthyWorkspaces([disconnected, MockFailedWorkspace]);
		expect(result.map((w) => [w.id, w.severity])).toEqual([
			[MockFailedWorkspace.id, "error"],
			["disconnected", "warning"],
		]);
		expect(result[1].problems).toEqual([
			{
				kind: "unhealthy",
				text: `agent ${MockWorkspaceAgent.name}: disconnected`,
			},
		]);
	});
});
