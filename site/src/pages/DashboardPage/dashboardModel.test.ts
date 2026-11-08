import { niceTop } from "./dashboardCharts";
import { networkSeries } from "./dashboardModel";

const agent = (samples: [t: number, rx: number, tx: number][]) => ({
	samples: samples.map(([t, rx, tx]) => ({ from: t - 5_000, t, rx, tx })),
});

describe("networkSeries", () => {
	it("adds up every workspace's agents, now and over time", () => {
		const end = 1_000_000;
		const series = networkSeries([
			{
				a: agent([
					[end - 60_000, 100, 10],
					[end, 300, 30],
				]),
			},
			{
				b: agent([
					[end - 60_000, 50, 5],
					[end - 4_000, 200, 20],
				]),
				c: agent([[end - 2_000, 1_000, 100]]),
			},
		]);
		expect(series?.rx.latest).toBe(1_500);
		expect(series?.tx.latest).toBe(150);
		expect(series?.rx.points.at(-1)).toBe(1_500);
		expect(series?.rx.points.at(-3)).toBe(150);
	});

	it("leaves out an agent whose newest reading is older than two buckets", () => {
		const end = 1_000_000;
		const series = networkSeries([
			{ a: agent([[end, 300, 30]]) },
			{ b: agent([[end - 120_000, 900, 90]]) },
		]);
		expect(series?.rx.latest).toBe(300);
	});

	it("has nothing before a workspace's traffic arrives", () => {
		expect(networkSeries([undefined])).toBeNull();
	});
});

describe("niceTop", () => {
	it("rounds a graph's top up to 1, 2, 2.5 or 5 times a power of ten", () => {
		expect(niceTop(17.6)).toBe(20);
		expect(niceTop(9.2)).toBe(10);
		expect(niceTop(2_100)).toBe(2_500);
		expect(niceTop(0.42)).toBe(0.5);
		expect(niceTop(0)).toBe(1);
	});
});
