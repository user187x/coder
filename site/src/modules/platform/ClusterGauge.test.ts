import { formatRate, graphTop, historyX, usageShares } from "./ClusterGauge";

describe("formatRate", () => {
	it("shows bytes per second from B/s to GB/s", () => {
		expect(formatRate(0)).toBe("0 B/s");
		expect(formatRate(512)).toBe("512 B/s");
		expect(formatRate(1_500)).toBe("1.5 kB/s");
		expect(formatRate(245_000)).toBe("245 kB/s");
		expect(formatRate(2_400_000)).toBe("2.4 MB/s");
		expect(formatRate(3_000_000_000)).toBe("3.0 GB/s");
	});
});

describe("usageShares", () => {
	const points = [
		{ t: 1, cpu: 0.75, cpuTotal: 7.5, memory: 4, memoryTotal: 16 },
		{ t: 2, cpu: 9, cpuTotal: 7.5, memory: 0, memoryTotal: 0 },
	];

	it("gives each round's CPU in use as a share of the allocatable", () => {
		expect(usageShares(points, "cpu")).toEqual([
			{ t: 1, used: 0.75, total: 7.5, percent: 10 },
			// more than allocatable (requests over-committed): the graph's full height
			{ t: 2, used: 9, total: 7.5, percent: 100 },
		]);
	});

	it("gives memory the same way, and nothing allocatable as 0%", () => {
		expect(usageShares(points, "memory").map((s) => s.percent)).toEqual([
			25, 0,
		]);
	});
});

describe("graphTop", () => {
	it("rounds the window's peak up so that low usage still shows", () => {
		expect(graphTop(0)).toBe(10);
		expect(graphTop(9.4)).toBe(10);
		expect(graphTop(10.1)).toBe(25);
		expect(graphTop(38)).toBe(50);
		expect(graphTop(51)).toBe(100);
		expect(graphTop(100)).toBe(100);
	});
});

describe("historyX", () => {
	it("places sparse samples across elapsed time instead of packing them at the right", () => {
		expect(historyX(15, 900, 15)).toBeCloseTo(0);
		expect(historyX(450, 900, 15)).toBeCloseTo(48.333333);
		expect(historyX(900, 900, 15)).toBeCloseTo(98.333333);
	});
});
