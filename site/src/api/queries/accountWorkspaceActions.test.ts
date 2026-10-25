import { QueryClient } from "react-query";
import { API } from "#/api/api";
import { MockWorkspace } from "#/testHelpers/entities";
import { restartAccountWorkspaces } from "./accountWorkspaceActions";

afterEach(() => vi.restoreAllMocks());
it("restarts with the latest workspace build instead of the selected row's old version", async () => {
	const current = {
		...MockWorkspace,
		latest_build: {
			...MockWorkspace.latest_build,
			status: "running" as const,
			template_version_id: "current-version",
		},
	};
	vi.spyOn(API, "getWorkspace").mockResolvedValue(current);
	const restart = vi.spyOn(API, "restartWorkspace").mockResolvedValue();
	const result = await restartAccountWorkspaces(new QueryClient()).mutationFn([
		{
			...MockWorkspace,
			latest_build: {
				...MockWorkspace.latest_build,
				template_version_id: "old-version",
			},
		},
	]);
	expect(restart).toHaveBeenCalledExactlyOnceWith({ workspace: current });
	expect(result).toEqual([
		{
			id: MockWorkspace.id,
			name: `${MockWorkspace.owner_name}/${MockWorkspace.name}`,
		},
	]);
});
it("reports a cancelled restart instead of claiming success", async () => {
	vi.spyOn(API, "getWorkspace")
		.mockResolvedValueOnce(MockWorkspace)
		.mockResolvedValueOnce({
			...MockWorkspace,
			latest_build: { ...MockWorkspace.latest_build, status: "stopped" },
		});
	vi.spyOn(API, "restartWorkspace").mockResolvedValue();
	const result = await restartAccountWorkspaces(new QueryClient()).mutationFn([
		MockWorkspace,
	]);
	expect(result[0]?.error).toBe("Restart did not finish running (stopped).");
});
it("keeps other restart results when one provisioner fails", async () => {
	vi.spyOn(API, "getWorkspace").mockImplementation(async (id) => ({
		...MockWorkspace,
		id,
		latest_build: { ...MockWorkspace.latest_build, status: "running" },
	}));
	vi.spyOn(API, "restartWorkspace").mockImplementation(
		async ({ workspace }) => {
			if (workspace.id === "failed")
				throw { error: "Provisioner could not stop the workspace" };
		},
	);
	const result = await restartAccountWorkspaces(new QueryClient()).mutationFn([
		{ ...MockWorkspace, id: "failed" },
		{ ...MockWorkspace, id: "success" },
	]);
	expect(result.find((w) => w.id === "failed")?.error).toBe(
		"Provisioner could not stop the workspace",
	);
	expect(result.find((w) => w.id === "success")).toEqual({
		id: "success",
		name: `${MockWorkspace.owner_name}/${MockWorkspace.name}`,
	});
});
