import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserSessionShutterView } from "./BrowserSessionShutter";

const handlers = () => ({
	onReset: vi.fn(),
	onSetAndLock: vi.fn(),
	onLock: vi.fn(),
	onUnlock: vi.fn(),
});

const renderView = (
	status: { configured: boolean; locked: boolean; retryAfter: number },
	actions = handlers(),
) => {
	const result = render(
		<BrowserSessionShutterView
			status={status}
			busy={false}
			error={null}
			{...actions}
		>
			<iframe title="Browser" />
		</BrowserSessionShutterView>,
	);
	return { ...result, actions };
};

it("asks for a new PIN before the first lock and locks once it is confirmed", async () => {
	const user = userEvent.setup();
	const { actions } = renderView({
		configured: false,
		locked: false,
		retryAfter: 0,
	});
	await user.click(screen.getByRole("button", { name: "Lock browser" }));
	expect(actions.onLock).not.toHaveBeenCalled();
	await user.type(screen.getByLabelText("New PIN, 6 to 12 digits"), "1234567");
	await user.type(screen.getByLabelText("Confirm PIN"), "1234567");
	await user.click(screen.getByRole("button", { name: "Set PIN and lock" }));
	expect(actions.onSetAndLock).toHaveBeenCalledWith(
		"1234567",
		expect.any(Function),
	);
});

it("refuses a confirmation that does not match", async () => {
	const user = userEvent.setup();
	const { actions } = renderView({
		configured: false,
		locked: false,
		retryAfter: 0,
	});
	await user.click(screen.getByRole("button", { name: "Lock browser" }));
	await user.type(screen.getByLabelText("New PIN, 6 to 12 digits"), "123456");
	await user.type(screen.getByLabelText("Confirm PIN"), "654321");
	await user.click(screen.getByRole("button", { name: "Set PIN and lock" }));
	expect(actions.onSetAndLock).not.toHaveBeenCalled();
});

it("locks at once when a PIN is already set", async () => {
	const user = userEvent.setup();
	const { actions } = renderView({
		configured: true,
		locked: false,
		retryAfter: 0,
	});
	await user.click(screen.getByRole("button", { name: "Lock browser" }));
	expect(actions.onLock).toHaveBeenCalledOnce();
});

it("sends the PIN to unlock a locked browser", async () => {
	const user = userEvent.setup();
	const { actions } = renderView({
		configured: true,
		locked: true,
		retryAfter: 0,
	});
	await user.type(screen.getByLabelText("Browser PIN"), "123456{Enter}");
	expect(actions.onUnlock).toHaveBeenCalledWith("123456");
});

it("does not submit while the gateway is rate limiting attempts", async () => {
	const user = userEvent.setup();
	const { actions } = renderView({
		configured: true,
		locked: true,
		retryAfter: 30,
	});
	await user.type(screen.getByLabelText("Browser PIN"), "123456{Enter}");
	expect(actions.onUnlock).not.toHaveBeenCalled();
});
