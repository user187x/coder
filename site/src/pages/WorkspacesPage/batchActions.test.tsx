import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import { API } from "#/api/api";
import { MockStoppedWorkspace, MockWorkspace } from "#/testHelpers/entities";
import { mapWithConcurrency, useBatchActions } from "./batchActions";

const wrapper = ({ children }: React.PropsWithChildren) => (
	<QueryClientProvider client={new QueryClient()}>
		{children}
	</QueryClientProvider>
);

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
		expect(restartSpy).toHaveBeenCalledWith({ workspace: running[0] });
		expect(restartSpy).toHaveBeenCalledWith({ workspace: running[1] });
		await waitFor(() => expect(onSuccess).toHaveBeenCalled());
	});
});

describe("mapWithConcurrency", () => {
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
