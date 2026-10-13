import { act, screen } from "@testing-library/react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AgentNetworkLeds, flashesFor } from "./AgentNetworkLeds";
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

describe("AgentNetworkLeds", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("lights RX when the workspace receives and TX when it sends, like activity LEDs", () => {
		renderComponent(<AgentNetworkLeds agentId="a1" />);
		const rx = screen.getByTestId("agent-network-rx");
		const tx = screen.getByTestId("agent-network-tx");
		act(() =>
			publishAgentMetadata("a1", reading(1000, 500, "2026-10-13T14:00:00Z")),
		);
		// a second later: 50 KB in, nothing out
		act(() =>
			publishAgentMetadata("a1", reading(51_000, 500, "2026-10-13T14:00:01Z")),
		);
		act(() => vi.advanceTimersByTime(1)); // the first flash starts at once (up to 40% into its slot)
		let rxLit = rx.dataset.on === "true";
		for (let i = 0; i < 20 && !rxLit; i++) {
			act(() => vi.advanceTimersByTime(10));
			rxLit = rxLit || rx.dataset.on === "true";
		}
		expect(rxLit).toBe(true);
		expect(tx.dataset.on).toBeUndefined();
		act(() => vi.advanceTimersByTime(1000));
		expect(rx.dataset.on).toBeUndefined(); // it goes out again
		expect(screen.getByTestId("agent-network").getAttribute("title")).toMatch(
			/↓ 50 KB\/s received · ↑ 0 B\/s sent/,
		);
	});

	it("flickers more the busier it is", () => {
		expect(flashesFor(0)).toBe(0);
		expect(flashesFor(100)).toBeGreaterThanOrEqual(1);
		expect(flashesFor(1e6)).toBeGreaterThan(flashesFor(1e3));
		expect(flashesFor(1e12)).toBe(5);
	});

	it("is dimmed, and says why, when the template does not report the network", () => {
		renderComponent(<AgentNetworkLeds agentId="a2" />);
		const leds = screen.getByTestId("agent-network");
		expect(leds.dataset.reporting).toBeUndefined();
		expect(leds.getAttribute("title")).toMatch(/update this workspace/);
	});
});
