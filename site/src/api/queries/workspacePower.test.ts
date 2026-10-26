import { QueryClient } from "react-query";
import { PlatformAPI } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { runWorkspacePower, workspacePowerHistory } from "./workspacePower";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});
it("submits all reviewed IDs including administrator-owned targets in batches of at most 100", async () => {
	const start = vi
		.spyOn(PlatformAPI, "startWorkspacePower")
		.mockResolvedValue(MockWorkspacePowerOperation);
	const targets = Array.from({ length: 101 }, (_, index) => ({
		...MockWorkspace,
		id: `workspace-${index}`,
		owner_name: index === 0 ? "admin" : "developer",
	}));
	await runWorkspacePower(new QueryClient()).mutationFn({
		action: "shutdown",
		targets,
	});
	expect(start).toHaveBeenCalledTimes(2);
	expect(start).toHaveBeenNthCalledWith(
		1,
		MockWorkspace.organization_id,
		"shutdown",
		targets.slice(0, 100).map((w) => w.id),
	);
	expect(start).toHaveBeenNthCalledWith(
		2,
		MockWorkspace.organization_id,
		"shutdown",
		["workspace-100"],
	);
});
it("waits for server completion before submitting the next batch", async () => {
	vi.useFakeTimers();
	const start = vi
		.spyOn(PlatformAPI, "startWorkspacePower")
		.mockResolvedValueOnce({
			...MockWorkspacePowerOperation,
			status: "running",
			completed: 0,
		})
		.mockResolvedValue(MockWorkspacePowerOperation);
	const get = vi
		.spyOn(PlatformAPI, "getWorkspacePowerOperation")
		.mockResolvedValue(MockWorkspacePowerOperation);
	const client = new QueryClient();
	const targets = Array.from({ length: 101 }, (_, index) => ({
		...MockWorkspace,
		id: `workspace-${index}`,
	}));
	const pending = runWorkspacePower(client).mutationFn({
		action: "terminate",
		targets,
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(start).toHaveBeenCalledTimes(1);
	expect(
		client.getQueryData(
			workspacePowerHistory(MockWorkspace.organization_id).queryKey,
		),
	).toEqual({ operations: [expect.objectContaining({ status: "running" })] });
	await vi.advanceTimersByTimeAsync(2000);
	const result = await pending;
	expect(get).toHaveBeenCalledExactlyOnceWith(
		MockWorkspace.organization_id,
		MockWorkspacePowerOperation.id,
	);
	expect(start).toHaveBeenCalledTimes(2);
	expect(result.operations).toHaveLength(2);
	client.clear();
});
it("reports a failed organization without discarding successful organizations", async () => {
	vi.spyOn(PlatformAPI, "startWorkspacePower").mockImplementation(
		async (org) => {
			if (org === "denied-org") throw new Error("Access denied");
			return MockWorkspacePowerOperation;
		},
	);
	const result = await runWorkspacePower(new QueryClient()).mutationFn({
		action: "shutdown",
		targets: [
			MockWorkspace,
			{
				...MockWorkspace,
				id: "denied-workspace",
				organization_id: "denied-org",
			},
		],
	});
	expect(result.operations).toEqual([MockWorkspacePowerOperation]);
	expect(result.errors).toEqual([
		{
			organization_id: "denied-org",
			workspace_ids: ["denied-workspace"],
			message: "Access denied",
		},
	]);
});

it("queues organizations beyond the four-operation service limit", async () => {
	let active = 0;
	let maximum = 0;
	const releases: (() => void)[] = [];
	const start = vi
		.spyOn(PlatformAPI, "startWorkspacePower")
		.mockImplementation((org) => {
			active++;
			maximum = Math.max(maximum, active);
			return new Promise((resolve) =>
				releases.push(() => {
					active--;
					resolve({
						...MockWorkspacePowerOperation,
						id: `operation-${org}`,
						organization_id: org,
					});
				}),
			);
		});
	const targets = Array.from({ length: 5 }, (_, index) => ({
		...MockWorkspace,
		id: `workspace-${index}`,
		organization_id: `organization-${index}`,
	}));
	const pending = runWorkspacePower(new QueryClient()).mutationFn({
		action: "shutdown",
		targets,
	});
	expect(start).toHaveBeenCalledTimes(4);
	for (const release of releases.slice()) release();
	await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(5));
	releases[4]?.();
	const result = await pending;
	expect(maximum).toBe(4);
	expect(result.operations).toHaveLength(5);
	expect(result.errors).toEqual([]);
});

it("uses the server-guarded route for global actions", async () => {
	const global = vi
		.spyOn(PlatformAPI, "startGlobalWorkspacePower")
		.mockResolvedValue(MockWorkspacePowerOperation);
	const regular = vi.spyOn(PlatformAPI, "startWorkspacePower");
	await runWorkspacePower(new QueryClient(), "test-global-token").mutationFn({
		action: "shutdown",
		targets: [MockWorkspace],
	});
	expect(global).toHaveBeenCalledWith(
		MockWorkspace.organization_id,
		"shutdown",
		[MockWorkspace.id],
		"test-global-token",
	);
	expect(regular).not.toHaveBeenCalled();
});
