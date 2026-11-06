import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserSessionShutterView } from "./BrowserSessionShutter";

const renderView = (
	status: { configured: boolean; locked: boolean; retryAfter: number },
	setup = false,
) => {
	const actions = {
		onCancelSetup: vi.fn(),
		onSetAndLock: vi.fn(),
		onUnlock: vi.fn(),
	};
	render(
		<BrowserSessionShutterView
			status={status}
			setup={setup}
			busy={false}
			error={null}
			{...actions}
		>
			<iframe title="Browser" />
		</BrowserSessionShutterView>,
	);
	return actions;
};

it("sets the first PIN once it is confirmed", async () => {
	const user = userEvent.setup();
	const actions = renderView(
		{ configured: false, locked: false, retryAfter: 0 },
		true,
	);
	await user.type(screen.getByLabelText("New PIN, 6 to 12 digits"), "1234567");
	await user.type(screen.getByLabelText("Confirm PIN"), "1234567");
	await user.click(screen.getByRole("button", { name: "Set PIN and lock" }));
	expect(actions.onSetAndLock).toHaveBeenCalledWith("1234567");
});

it("refuses a confirmation that does not match", async () => {
	const user = userEvent.setup();
	const actions = renderView(
		{ configured: false, locked: false, retryAfter: 0 },
		true,
	);
	await user.type(screen.getByLabelText("New PIN, 6 to 12 digits"), "123456");
	await user.type(screen.getByLabelText("Confirm PIN"), "654321");
	await user.click(screen.getByRole("button", { name: "Set PIN and lock" }));
	expect(actions.onSetAndLock).not.toHaveBeenCalled();
});

it("cancels setting a PIN", async () => {
	const user = userEvent.setup();
	const actions = renderView(
		{ configured: false, locked: false, retryAfter: 0 },
		true,
	);
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(actions.onCancelSetup).toHaveBeenCalledOnce();
});

it("sends the PIN to unlock a locked browser", async () => {
	const user = userEvent.setup();
	const actions = renderView({ configured: true, locked: true, retryAfter: 0 });
	await user.type(screen.getByLabelText("Browser PIN"), "123456{Enter}");
	expect(actions.onUnlock).toHaveBeenCalledWith("123456");
});

it("does not submit while the gateway is rate limiting attempts", async () => {
	const user = userEvent.setup();
	const actions = renderView({
		configured: true,
		locked: true,
		retryAfter: 30,
	});
	await user.type(screen.getByLabelText("Browser PIN"), "123456{Enter}");
	expect(actions.onUnlock).not.toHaveBeenCalled();
});
