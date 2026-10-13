import { act, fireEvent, screen } from "@testing-library/react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AgentNetworkLeds } from "./AgentNetworkLeds";
import { publishAgentMetadata } from "./agentMetadataStore";
import {
	formatRate,
	NETWORK_WINDOW_MS,
	NetworkHistogram,
	type NetworkSample,
	scaleFor,
	withSample,
} from "./NetworkHistogram";

const reading = (
	rx: number,
	tx: number,
	at: number,
): WorkspaceAgentMetadata[] => [
	{
		description: {
			display_name: "Network",
			key: "8_net_io",
			script: "",
			interval: 1,
			timeout: 1,
		},
		result: {
			value: `${rx} ${tx}`,
			error: "",
			collected_at: new Date(at).toISOString(),
			age: 0,
		},
	},
];

describe("scaleFor: the Y axis in the unit the traffic needs", () => {
	it.each([
		[0, 1, "B/s", ["1 B/s", "0.5 B/s", "0 B/s"]],
		[730, 1000, "B/s", ["1000 B/s", "500 B/s", "0 B/s"]],
		[4_200, 5_000, "KB/s", ["5 KB/s", "2.5 KB/s", "0 KB/s"]],
		[37_000_000, 50_000_000, "MB/s", ["50 MB/s", "25 MB/s", "0 MB/s"]],
		[1_300_000_000, 2_000_000_000, "GB/s", ["2 GB/s", "1 GB/s", "0 GB/s"]],
	])("a peak of %d B/s: top %d, in %s", (peak, max, unit, labels) => {
		const s = scaleFor(peak);
		expect(s.max).toBe(max);
		expect(s.unit).toBe(unit);
		expect(s.ticks.map((t) => t.label)).toEqual(labels);
		expect(s.max).toBeGreaterThanOrEqual(peak);
	});

	it("formats a rate in its unit", () => {
		expect(formatRate(0)).toBe("0 B/s");
		expect(formatRate(50_000)).toBe("50 KB/s");
		expect(formatRate(46_200_000)).toBe("46 MB/s");
		expect(formatRate(1_500_000)).toBe("1.5 MB/s");
	});
});

describe("NetworkHistogram", () => {
	it("draws a green (received) and a blue (sent) bar each second, scaled to the busiest", () => {
		const samples: NetworkSample[] = Array.from({ length: 70 }, (_, i) => ({
			from: (i - 1) * 1000,
			t: i * 1000,
			rx: i === 69 ? 40_000_000 : 1_000_000,
			tx: 20_000_000,
		}));
		renderComponent(<NetworkHistogram samples={samples} />);
		// the last minute only
		expect(screen.getAllByTestId("network-histogram-slot")).toHaveLength(60);
		const rx = document.querySelectorAll("rect[data-kind=rx]");
		const tx = document.querySelectorAll("rect[data-kind=tx]");
		expect(rx[0].getAttribute("fill")).toBe("#22c55e");
		expect(tx[0].getAttribute("fill")).toBe("#3b82f6");
		// 50 MB/s top: the 40 MB/s second is the tallest bar, 1 MB/s the shortest
		expect(
			screen.getAllByTestId("network-histogram-tick").map((t) => t.textContent),
		).toEqual(["50 MB/s", "25 MB/s", "0 MB/s"]);
		const h = (el: Element) => Number(el.getAttribute("height"));
		expect(h(rx[rx.length - 1])).toBeGreaterThan(h(tx[tx.length - 1]));
		expect(h(tx[0])).toBeGreaterThan(h(rx[0]));
		expect(screen.getByText(/RX ↓ 40 MB\/s/)).toBeInTheDocument();
		expect(screen.getByText(/TX ↑ 20 MB\/s/)).toBeInTheDocument();
	});
});

describe("the graph's time axis", () => {
	it("keeps the last minute by the readings' times, however often they come", () => {
		let h: NetworkSample[] = [];
		for (let t = 5_000; t <= 120_000; t += 5_000) {
			h = withSample(h, { from: t - 5_000, t, rx: 1, tx: 1 });
		}
		expect(h).toHaveLength(NETWORK_WINDOW_MS / 5_000);
		expect(h[0].t).toBe(65_000);
	});

	it("spans each reading's bars across the time it covers, the newest at the right edge", () => {
		// a reading every 5 s: 12 in the minute, each bar pair a twelfth of the plot wide
		const samples: NetworkSample[] = Array.from({ length: 12 }, (_, i) => ({
			from: i * 5_000,
			t: (i + 1) * 5_000,
			rx: 1_000,
			tx: 1_000,
		}));
		renderComponent(<NetworkHistogram samples={samples} />);
		const rx = [...document.querySelectorAll("rect[data-kind=rx]")];
		const tx = [...document.querySelectorAll("rect[data-kind=tx]")];
		const n = (el: Element, a: string) => Number(el.getAttribute(a));
		const pair = n(tx[1], "x") + n(tx[1], "width") - n(rx[1], "x");
		expect(pair).toBeGreaterThan(17); // (300 - 54) / 12 = 20.5, less the gaps
		expect(pair).toBeLessThan(20.5);
		expect(n(tx[11], "x") + n(tx[11], "width")).toBeCloseTo(299, 0); // a 1 px gap
		expect(n(rx[0], "x")).toBeCloseTo(55, 0);
	});
});

describe("AgentNetworkLeds hover", () => {
	it("opens the live graph over the lights, and it grows with each reading", async () => {
		renderComponent(<AgentNetworkLeds agentId="hover" />);
		act(() => publishAgentMetadata("hover", reading(0, 0, 1_000)));
		act(() => publishAgentMetadata("hover", reading(5_000, 1_000, 2_000)));
		fireEvent.focus(screen.getByTestId("agent-network"));
		const graph = await screen.findByTestId("network-histogram");
		expect(graph).toBeVisible();
		expect(screen.getAllByTestId("network-histogram-slot")).toHaveLength(1);
		act(() => publishAgentMetadata("hover", reading(9_000, 3_000, 3_000)));
		expect(screen.getAllByTestId("network-histogram-slot")).toHaveLength(2);
	});
});
