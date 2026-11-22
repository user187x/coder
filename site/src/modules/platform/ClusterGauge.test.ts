import { graphTop, usageShares } from "./ClusterGauge";
import { formatRate, historyX, networkTrace } from "./clusterMetricHistory";
import { metricTicks } from "./MetricYAxis";

describe("formatRate", () => {
	it("shows bytes per second from B/s to GB/s", () => {
		expect(formatRate(0)).toBe("0 B/s");
		expect(formatRate(512)).toBe("512 B/s");
		expect(formatRate(1_500)).toBe("1.5 KB/s");
		expect(formatRate(245_000)).toBe("245 KB/s");
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

describe("networkTrace", () => {
	const samples = [
		{ t: 15, x: 1, txY: 6, rxY: 24 },
		{ t: 30, x: 4, txY: 12, rxY: 35 },
		{ t: 60, x: 10, txY: 4, rxY: 28 },
		{ t: 75, x: 13, txY: 8, rxY: 20 },
	];

	it("joins TX and RX tips independently and breaks across missing rounds", () => {
		expect(networkTrace(samples, "txY", 15)).toBe(
			"M1,6 C2,6 3,12 4,12 M10,4 C11,4 12,8 13,8",
		);
		expect(networkTrace(samples, "rxY", 15)).toBe(
			"M1,24 C2,24 3,35 4,35 M10,28 C11,28 12,20 13,20",
		);
	});
});

describe("metricTicks", () => {
	it("reevaluates major and minor intervals for the current scale", () => {
		expect(metricTicks(0, 10).map(({ value }) => value)).toEqual([
			0, 1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75, 10,
		]);
		expect(metricTicks(0, 100).filter(({ major }) => major)).toEqual([
			{ value: 0, major: true },
			{ value: 25, major: true },
			{ value: 50, major: true },
			{ value: 75, major: true },
			{ value: 100, major: true },
		]);
	});

	it("keeps a major tick at the center of a signed Network scale", () => {
		const ticks = metricTicks(-2300, 2300);
		expect(ticks.find(({ value }) => value === 0)).toEqual({
			value: 0,
			major: true,
		});
		expect(ticks[0]?.value).toBe(-(ticks.at(-1)?.value ?? 0));
	});
});
