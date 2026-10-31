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
