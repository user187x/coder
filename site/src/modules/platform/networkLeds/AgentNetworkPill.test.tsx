import { act, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI } from "#/api/platform";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AgentNetworkPill, pillBars, spanText } from "./AgentNetworkPill";
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
	const slot = 104 / 40;
	it("draws the last 5 minutes in 40 slots of 7.5 s, newest at the right, as the metric graphs do", () => {
		const now = 300_000;
		const bars = pillBars(
			[
				{ from: 145_000, t: 150_000, rx: 0, tx: 4096 },
				{ from: 295_000, t: 299_000, rx: 4096, tx: 0 },
			],
			now,
		);
		expect(bars).toHaveLength(2);
		expect(bars[0].x).toBeCloseTo(20 * slot + slot * 0.15); // 150 s into the 5 minutes
		expect(bars[1].x).toBeCloseTo(39 * slot + slot * 0.15); // the last slot
		expect(bars[0].width).toBeCloseTo(slot * 0.7);
		expect(bars[0].down).toBeCloseTo(7.5); // the busiest reading: the half height
		expect(bars[1].up).toBeCloseTo(7.5);
		expect(bars[1].latest).toBe(true);
	});

	it("keeps each slot's busiest reading, leaves out what is older than 5 minutes, an idle workspace near the line", () => {
		const bars = pillBars(
			[
				{ from: 0, t: 1_000, rx: 99_999, tx: 99_999 }, // more than 5 minutes before
				{ from: 300_000, t: 301_000, rx: 10, tx: 10 },
				{ from: 301_000, t: 302_000, rx: 30, tx: 20 },
			],
			305_000,
		);
		expect(bars).toHaveLength(1);
		expect(bars[0].up).toBeLessThan(0.6);
	});
});

describe("AgentNetworkPill", () => {
	afterEach(() => vi.restoreAllMocks());
	const renderPill = (
		props: Partial<Parameters<typeof AgentNetworkPill>[0]> = {},
	) =>
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<AgentNetworkPill agentId="pill-agent" {...props} />
			</QueryClientProvider>,
		);
	const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

	it("draws the readings as they come in", () => {
		renderPill();
		expect(screen.queryByTestId("agent-network-pill")).toBeNull(); // nothing reported yet
		act(() =>
			publishAgentMetadata("pill-agent", reading(1000, 500, ago(6000))),
		);
		act(() =>
			publishAgentMetadata("pill-agent", reading(21000, 10500, ago(1000))),
		);
		const pill = screen.getByTestId("agent-network-pill");
		expect(pill.querySelectorAll("rect")).toHaveLength(2);
		expect(pill).toHaveAttribute(
			"aria-label",
			expect.stringContaining("↓ 4.0 KB/s received"),
		);
	});

	it("opens with the minutes before the page (the platform service's), then goes on from them", async () => {
		const now = Date.now();
		vi.spyOn(PlatformAPI, "getWorkspaceNetwork").mockResolvedValue({
			windowSeconds: 300,
			agents: {
				"seeded-agent": {
					samples: [
						{ from: now - 241_000, t: now - 240_000, rx: 5000, tx: 100 },
						{ from: now - 61_000, t: now - 60_000, rx: 100, tx: 5000 },
					],
					last: { at: now - 60_000, rx: 50_000, tx: 70_000 },
				},
			},
		});
		renderPill({ agentId: "seeded-agent", workspaceId: "ws" });
		const pill = await screen.findByTestId("agent-network-pill");
		await waitFor(() => expect(pill.querySelectorAll("rect")).toHaveLength(4));
		// the next live reading goes on from the service's last counters
		act(() =>
			publishAgentMetadata(
				"seeded-agent",
				reading(50_000 + 60_000, 70_000, new Date(now).toISOString()),
			),
		);
		expect(pill).toHaveAttribute(
			"aria-label",
			expect.stringContaining("↓ 1.0 KB/s received"),
		);
	});

	it("slides on its own, for as long as the page is open: with no new readings the bars move out of the 5 minutes, and the platform service is asked again", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: false });
		try {
			const network = vi
				.spyOn(PlatformAPI, "getWorkspaceNetwork")
				.mockResolvedValue({ windowSeconds: 300, agents: {} });
			renderPill({ agentId: "sliding-agent", workspaceId: "ws-slide" });
			act(() =>
				publishAgentMetadata("sliding-agent", reading(1000, 500, ago(2000))),
			);
			act(() =>
				publishAgentMetadata("sliding-agent", reading(21000, 10500, ago(0))),
			);
			const pill = screen.getByTestId("agent-network-pill");
			expect(pill.querySelectorAll("rect")).toHaveLength(2);
			const asked = network.mock.calls.length;
			// two minutes without a reading: still there, sliding left; the service asked again (a stall)
			await act(async () => {
				await vi.advanceTimersByTimeAsync(120_000);
			});
			expect(pill.querySelectorAll("rect")).toHaveLength(2);
			expect(network.mock.calls.length).toBeGreaterThan(asked);
			// past the 5 minutes: gone from the window
			await act(async () => {
				await vi.advanceTimersByTimeAsync(200_000);
			});
			expect(pill.querySelectorAll("rect")).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("is grey and still once the card stopped (no contact with Coder)", () => {
		renderPill({ stoppedAt: Date.now() });
		act(() => publishAgentMetadata("pill-agent", reading(1, 1, ago(2000))));
		const pill = screen.getByTestId("agent-network-pill");
		expect(pill).toHaveAttribute("data-stopped", "true");
		expect(pill).toHaveClass("grayscale");
	});
});

describe("spanText", () => {
	it("gives the graph's span, its first bar's time to its last's", () => {
		const to = new Date(2026, 9, 22, 8, 15, 12).getTime();
		const { short, long } = spanText(to - 300_000, to);
		expect(short).toBe("08:10–08:15");
		expect(long).toMatch(/22, 08:10:12 – 08:15:12$/);
	});
});
