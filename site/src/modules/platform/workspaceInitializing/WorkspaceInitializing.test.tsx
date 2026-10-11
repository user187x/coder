import { renderHook } from "@testing-library/react";
import { useStartProgress } from "./WorkspaceInitializing";

describe("useStartProgress", () => {
	it("moves on milestones and creeps toward the next one without reaching it", () => {
		const { result, rerender } = renderHook(
			({ done, now }) => useStartProgress(done, 4, now),
			{ initialProps: { done: 1, now: 0 } },
		);
		expect(result.current).toBe(0.25);
		rerender({ done: 1, now: 12_000 });
		expect(result.current).toBeGreaterThan(0.25);
		expect(result.current).toBeLessThan(0.5);
		rerender({ done: 1, now: 600_000 });
		expect(result.current).toBeLessThan(0.5); // never past the next milestone
		rerender({ done: 2, now: 600_000 });
		expect(result.current).toBe(0.5); // a new milestone: the creep starts over
		rerender({ done: 4, now: 600_500 });
		expect(result.current).toBe(1);
	});
});
