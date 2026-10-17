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
	it("puts the last minute across the pill, received up and sent down, to the peak", () => {
		const t0 = 1_000_000;
		const bars = pillBars([
			{ from: t0 - 70_000, t: t0 - 65_000, rx: 9e9, tx: 9e9 }, // older than a minute: left out
			{ from: t0 - 10_000, t: t0 - 5_000, rx: 4096, tx: 0 },
			{ from: t0 - 5_000, t: t0, rx: 2048, tx: 4096 },
		]);
		expect(bars).toHaveLength(2);
		expect(bars[0].up).toBeCloseTo(7.5); // the peak: the half height
		expect(bars[1].up).toBeCloseTo(3.75);
		expect(bars[1].down).toBeCloseTo(7.5);
		expect(bars[1].x).toBeGreaterThan(bars[0].x);
	});

	it("keeps an idle workspace near the line", () => {
		const bars = pillBars([{ from: 0, t: 5_000, rx: 10, tx: 10 }]);
		expect(bars[0].up).toBeLessThan(0.1);
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
