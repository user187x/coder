import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import * as workspaceMetrics from "#/api/workspaceMetrics";
import {
	MockStoppedWorkspace,
	MockTemplate,
	MockWorkspace,
} from "#/testHelpers/entities";
import * as timers from "#/utils/delay";
import { mapWithConcurrency, useBatchActions } from "./batchActions";

const wrapper = ({ children }: React.PropsWithChildren) => (
	<QueryClientProvider client={new QueryClient()}>
		{children}
	</QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

describe("useBatchActions restart", () => {
	it("restarts only running workspaces and then calls onSuccess", async () => {
		const restartSpy = vi.spyOn(API, "restartWorkspace").mockResolvedValue();
		const onSuccess = vi.fn().mockResolvedValue(undefined);
		const running = [
			{ ...MockWorkspace, id: "a" },
			{ ...MockWorkspace, id: "b" },
		];

		const { result } = renderHook(() => useBatchActions({ onSuccess }), {
			wrapper,
		});
		await act(() =>
			result.current.restart([
				...running,
				{ ...MockStoppedWorkspace, id: "c" },
			]),
		);

		expect(restartSpy).toHaveBeenCalledTimes(2);
		expect(restartSpy).toHaveBeenCalledWith({
			workspace: running[0],
			beforeStart: expect.any(Function),
		});
		expect(restartSpy).toHaveBeenCalledWith({
			workspace: running[1],
			beforeStart: expect.any(Function),
		});
		await waitFor(() => expect(onSuccess).toHaveBeenCalled());
	});
});

it.each(["start", "restart", "agent", "template"] as const)(
	"waits for old pods before issuing the start for a batch %s",
	async (action) => {
		const workspace = action === "start" ? MockStoppedWorkspace : MockWorkspace;
		const stopped = MockStoppedWorkspace.latest_build;
		const stop = vi.spyOn(API, "stopWorkspace").mockResolvedValue(stopped);
		vi.spyOn(API, "waitForBuild").mockResolvedValue({
			...stopped.job,
			status: "succeeded",
		});
		vi.spyOn(API, "getTemplate").mockResolvedValue(MockTemplate);
		const start = vi
			.spyOn(API, "postWorkspaceBuild")
			.mockResolvedValue(workspace.latest_build);
		const check = vi
			.spyOn(workspaceMetrics, "getWorkspaceStartup")
			.mockResolvedValueOnce({ issue: null, hasWorkspacePods: true })
			.mockResolvedValue({ issue: null, hasWorkspacePods: false });
		const pause = Promise.withResolvers<undefined>();
		vi.spyOn(timers, "delay").mockReturnValue(pause.promise);
		const { result } = renderHook(
			() =>
				useBatchActions({ onSuccess: vi.fn().mockResolvedValue(undefined) }),
			{ wrapper },
		);
		let operation: Promise<unknown> | undefined;
		await act(async () => {
			if (action === "start" || action === "restart") {
				operation = result.current[action]([workspace]);
			} else {
				operation = new Promise<void>((complete) =>
					result.current.updateWorkspaces(
						[{ workspace, kind: action }],
						complete,
					),
				);
			}
		});
		await waitFor(() =>
			expect(check).toHaveBeenCalledExactlyOnceWith(
				workspace.organization_id,
				workspace.id,
			),
		);
		expect(start).not.toHaveBeenCalled();
		if (action !== "start")
			expect(stop).toHaveBeenCalledExactlyOnceWith(workspace.id);
		await act(async () => {
			pause.resolve(undefined);
			await operation;
		});
		expect(start).toHaveBeenCalledTimes(1);
		expect(start.mock.calls[0]?.[1].transition).toBe("start");
	},
);

describe("mapWithConcurrency", () => {
	it("finishes the remaining actions before reporting a partial failure", async () => {
		const pending = Promise.withResolvers<string>();
		const failure = new Error("Workspace shutdown timed out.");
		const run = vi.fn().mockRejectedValueOnce(failure);
		run.mockReturnValueOnce(pending.promise).mockResolvedValue("done");
		const done = mapWithConcurrency([1, 2, 3], 2, run);
		const settled = vi.fn();
		const handled = done.catch(settled);
		await waitFor(() => expect(run).toHaveBeenCalledTimes(3));
		expect(settled).not.toHaveBeenCalled();
		pending.resolve("done");
		await handled;
		expect(settled).toHaveBeenCalledExactlyOnceWith(failure);
	});

	it("never has more than the limit in flight", async () => {
		const pending: Array<() => void> = [];
		let inFlight = 0;
		let maxInFlight = 0;
		const started: number[] = [];

		const done = mapWithConcurrency([1, 2, 3, 4, 5], 2, (n) => {
			started.push(n);
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			return new Promise<number>((resolve) => {
				pending.push(() => {
					inFlight--;
					resolve(n);
				});
			});
		});

		expect(started).toEqual([1, 2]);
		for (let i = 0; i < 5; i++) {
			await waitFor(() => expect(pending.length).toBeGreaterThan(i));
			pending[i]();
		}
		expect(await done).toEqual([1, 2, 3, 4, 5]);
		expect(started).toEqual([1, 2, 3, 4, 5]);
		expect(maxInFlight).toBe(2);
	});
});
