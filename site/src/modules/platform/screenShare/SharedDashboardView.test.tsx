import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "#/testHelpers/renderHelpers";
import * as media from "./media";
import { SharedDashboardView } from "./SharedDashboardView";

afterEach(() => {
	act(() => media.stopMedia());
	vi.restoreAllMocks();
});

it("requires the control connection and an admin click, forwards input, and releases focus with Escape", async () => {
	const send = vi
		.spyOn(media, "sendDashboardInput")
		.mockImplementation(() => {});
	vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
		100,
	);
	vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
		100,
	);
	vi.spyOn(HTMLVideoElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 100, 100),
	);
	media.updateMedia({ id: "dashboard", dashboard: true, controlReady: false });
	render(<SharedDashboardView stream={null} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Control dashboard" }));
	expect(send).not.toHaveBeenCalled();
	act(() => media.updateMedia({ controlReady: true }));
	await user.click(screen.getByRole("button", { name: "Control dashboard" }));
	await user.pointer({
		target: screen.getByRole("application", {
			name: "Remote dashboard keyboard and mouse",
		}),
		keys: "[MouseLeft]",
		coords: { x: 25, y: 50 },
	});
	expect(send).toHaveBeenLastCalledWith({
		type: "click",
		x: 0.25,
		y: 0.5,
		button: 0,
		count: 1,
	});
	await user.keyboard("a");
	expect(send).toHaveBeenLastCalledWith({
		type: "key",
		key: "a",
		ctrl: false,
		alt: false,
		meta: false,
		shift: false,
	});
	const sent = send.mock.calls.length;
	await user.keyboard("{Escape}b");
	expect(send).toHaveBeenCalledTimes(sent);
	await user.keyboard("{Enter}");
	await user.keyboard("c");
	expect(send).toHaveBeenLastCalledWith({
		type: "key",
		key: "c",
		ctrl: false,
		alt: false,
		meta: false,
		shift: false,
	});
});

it("sends at most one normalized pointer move per frame while in control", async () => {
	const send = vi
		.spyOn(media, "sendDashboardInput")
		.mockImplementation(() => {});
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(
		200,
	);
	vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(
		100,
	);
	vi.spyOn(HTMLVideoElement.prototype, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 200, 200),
	);
	media.updateMedia({ id: "dashboard", dashboard: true, controlReady: true });
	render(<SharedDashboardView stream={null} />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Control dashboard" }));
	const surface = screen.getByRole("application", {
		name: "Remote dashboard keyboard and mouse",
	});
	await user.pointer([
		{ target: surface, coords: { x: 20, y: 60 } },
		{ target: surface, coords: { x: 50, y: 100 } },
	]);
	expect(frames).toHaveLength(1);
	expect(send).not.toHaveBeenCalledWith(
		expect.objectContaining({ type: "move" }),
	);
	act(() => frames[0]?.(0));
	// The 200x100 stream is letterboxed 50px from the top of the 200px box.
	expect(send).toHaveBeenLastCalledWith({ type: "move", x: 0.25, y: 0.5 });
	expect(send).toHaveBeenCalledTimes(1);
});

it("shows the live view's latency on the control button", () => {
	media.updateMedia({
		id: "dashboard",
		dashboard: true,
		controlReady: true,
		latency: 42,
	});
	render(<SharedDashboardView stream={null} />);
	expect(
		screen.getByRole("button", { name: /Control dashboard.*42 milliseconds/ }),
	).toBeEnabled();
});

it("measures latency from the connection's selected candidate pair", async () => {
	const reports = new Map<string, Record<string, unknown>>([
		["T1", { id: "T1", type: "transport", selectedCandidatePairId: "P2" }],
		["P1", { id: "P1", type: "candidate-pair", currentRoundTripTime: 0.5 }],
		["P2", { id: "P2", type: "candidate-pair", currentRoundTripTime: 0.0374 }],
	]);
	expect(await media.measureLatency({ getStats: async () => reports })).toBe(
		37,
	);
});
