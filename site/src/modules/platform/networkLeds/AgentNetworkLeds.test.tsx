import { act, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { PlatformAPI, type WorkspaceLockdown } from "#/api/platform";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AgentNetworkLeds, flashesFor } from "./AgentNetworkLeds";
import { publishAgentMetadata } from "./agentMetadataStore";

// the lights read the workspace's Lock Down (react-query)
const renderLeds = (node: React.ReactNode) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

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
		renderLeds(<AgentNetworkLeds agentId="a1" />);
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
		expect(
			screen.getByTestId("agent-network").getAttribute("aria-label"),
		).toMatch(/↓ 50 KB\/s received · ↑ 0 B\/s sent/);
	});

	it("flickers more the busier it is", () => {
		expect(flashesFor(0)).toBe(0);
		expect(flashesFor(100)).toBeGreaterThanOrEqual(1);
		expect(flashesFor(1e6)).toBeGreaterThan(flashesFor(1e3));
		expect(flashesFor(1e12)).toBe(5);
	});

	it("is dimmed, and says why, when the template does not report the network", () => {
		renderLeds(<AgentNetworkLeds agentId="a2" />);
		const leds = screen.getByTestId("agent-network");
		expect(leds.dataset.reporting).toBeUndefined();
		expect(leds.getAttribute("aria-label")).toMatch(/update this workspace/);
	});

	it("is red and still, and graphs no traffic, while Lock Down cuts the network", async () => {
		vi.useRealTimers(); // react-query and the graph's once-a-second reading, as they run
		const lock: WorkspaceLockdown = {
			locked: true,
			modes: ["network", "sudo"],
			by: "admin",
			at: null,
			running: true,
			inForce: true,
			canChange: false,
		};
		vi.spyOn(PlatformAPI, "getLockdown").mockResolvedValue(lock);
		renderLeds(<AgentNetworkLeds agentId="a3" workspaceId="w3" />);
		const leds = screen.getByTestId("agent-network");
		await vi.waitFor(() => expect(leds.dataset.locked).toBe("true"));
		// the workspace still reports traffic (Coder's own link): no flicker, the graph says none
		act(() =>
			publishAgentMetadata("a3", reading(1_000, 1_000, "2026-10-13T12:00:00Z")),
		);
		act(() =>
			publishAgentMetadata(
				"a3",
				reading(9_000_000, 5_000_000, "2026-10-13T12:00:01Z"),
			),
		);
		expect(screen.getByTestId("agent-network-rx").dataset.on).toBeUndefined();
		expect(screen.getByTestId("agent-network-tx").dataset.on).toBeUndefined();
		expect(leds).toHaveAccessibleName(/locked down/i);
		fireEvent.focus(leds);
		expect(await screen.findByTestId("network-histogram-locked")).toBeVisible();
		// only what was read since the lock: nothing before it
		const heights = [...document.querySelectorAll("rect[data-kind]")].map((r) =>
			Number(r.getAttribute("height")),
		);
		expect(heights.length).toBeGreaterThan(0);
		expect(heights.every((h) => h === 0)).toBe(true);
		expect(screen.getByText(/RX ↓ 0 B\/s/)).toBeInTheDocument();
	});
});
