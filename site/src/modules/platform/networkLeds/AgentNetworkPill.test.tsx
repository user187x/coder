import { act, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AgentNetworkPill, pillBars } from "./AgentNetworkPill";
import { publishAgentMetadata } from "./agentMetadataStore";

const reading = (
	rx: number,
	tx: number,
	at: string,
): WorkspaceAgentMetadata[] => [
	{
		description: {
			display_name: "Network",
			key: "8_net_io",
			script: "",
			interval: 1,
			timeout: 1,
		},
		result: { value: `${rx} ${tx}`, error: "", collected_at: at, age: 0 },
	},
];

describe("pillBars", () => {
	it("draws a thin bar a reading, as the metric graphs do, newest at the right", () => {
		const bars = pillBars([
			{ from: 0, t: 5_000, rx: 4096, tx: 0 },
			{ from: 5_000, t: 10_000, rx: 2048, tx: 4096 },
		]);
		const slot = 104 / 40;
		expect(bars).toHaveLength(2);
		expect(bars[1].x).toBeCloseTo(39 * slot + slot * 0.15); // the last slot
		expect(bars[0].width).toBeCloseTo(slot * 0.7);
		expect(bars[0].up).toBeCloseTo(7.5); // the busiest reading: the half height
		expect(bars[1].down).toBeCloseTo(7.5);
		expect(bars[1].latest).toBe(true);
	});

	it("keeps the latest 40 readings, and an idle workspace near the line", () => {
		const many = Array.from({ length: 55 }, (_, i) => ({
			from: i,
			t: i + 1,
			rx: 10,
			tx: 10,
		}));
		const bars = pillBars(many);
		expect(bars).toHaveLength(40);
		expect(bars[0].up).toBeLessThan(0.6);
	});
});

describe("AgentNetworkPill", () => {
	const renderPill = () =>
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<AgentNetworkPill agentId="pill-agent" />
			</QueryClientProvider>,
		);

	it("draws the readings as they come in", () => {
		renderPill();
		expect(screen.queryByTestId("agent-network-pill")).toBeNull(); // nothing reported yet
		act(() =>
			publishAgentMetadata(
				"pill-agent",
				reading(1000, 500, "2026-10-17T05:00:00Z"),
			),
		);
		act(() =>
			publishAgentMetadata(
				"pill-agent",
				reading(21000, 10500, "2026-10-17T05:00:05Z"),
			),
		);
		const pill = screen.getByTestId("agent-network-pill");
		expect(pill.querySelectorAll("rect")).toHaveLength(2);
		expect(pill).toHaveAttribute(
			"aria-label",
			expect.stringContaining("↓ 4.0 KB/s received"),
		);
	});
});
