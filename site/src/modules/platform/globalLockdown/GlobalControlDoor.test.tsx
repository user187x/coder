import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalControlsAPI } from "#/api/globalLockdown";
import {
	MockGlobalControlGrant,
	MockGlobalControlStatus,
} from "#/testHelpers/globalLockdown";
import { render } from "#/testHelpers/renderHelpers";
import { GlobalControlDoor } from "./GlobalControlDoor";

afterEach(() => vi.restoreAllMocks());
it("verifies the PIN on the server before exposing actions and revokes the grant when closed", async () => {
	vi.spyOn(GlobalControlsAPI, "get").mockResolvedValue(MockGlobalControlStatus);
	const unlock = vi
		.spyOn(GlobalControlsAPI, "unlock")
		.mockResolvedValue(MockGlobalControlGrant);
	const close = vi
		.spyOn(GlobalControlsAPI, "close")
		.mockResolvedValue(MockGlobalControlStatus);
	const onUnlock = vi.fn();
	const act = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalControlDoor onUnlock={onUnlock}>
			<button type="button" onClick={act}>
				Privileged action
			</button>
		</GlobalControlDoor>,
	);
	await user.type(
		await screen.findByLabelText("Six-digit admin PIN"),
		"938271",
	);
	expect(act).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Unlock controls" }));
	await waitFor(() => expect(unlock).toHaveBeenCalledWith({ pin: "938271" }));
	await user.click(
		await screen.findByRole("button", { name: "Privileged action" }),
	);
	expect(act).toHaveBeenCalledOnce();
	expect(onUnlock).toHaveBeenCalledWith(MockGlobalControlGrant);
	await user.click(screen.getByRole("button", { name: "Close Panel" }));
	await waitFor(() => expect(close).toHaveBeenCalledOnce());
	expect(onUnlock).toHaveBeenLastCalledWith(null);
});
it("requires matching PINs for first-time setup", async () => {
	vi.spyOn(GlobalControlsAPI, "get").mockResolvedValue({
		...MockGlobalControlStatus,
		configured: false,
	});
	const configure = vi
		.spyOn(GlobalControlsAPI, "configure")
		.mockResolvedValue(MockGlobalControlGrant);
	const onUnlock = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalControlDoor onUnlock={onUnlock}>
			<button type="button">Action</button>
		</GlobalControlDoor>,
	);
	await user.type(await screen.findByLabelText("New six-digit PIN"), "938271");
	await user.type(screen.getByLabelText("Confirm PIN"), "938270");
	await user.click(screen.getByRole("button", { name: "Save PIN and open" }));
	expect(configure).not.toHaveBeenCalled();
	await user.clear(screen.getByLabelText("Confirm PIN"));
	await user.type(screen.getByLabelText("Confirm PIN"), "938271");
	await user.click(screen.getByRole("button", { name: "Save PIN and open" }));
	await waitFor(() =>
		expect(configure).toHaveBeenCalledWith({ pin: "938271", current_pin: "" }),
	);
	expect(onUnlock).toHaveBeenCalledWith(MockGlobalControlGrant);
});
it("does not unlock on rejection and forgets expired grants", async () => {
	vi.spyOn(GlobalControlsAPI, "get").mockResolvedValue(MockGlobalControlStatus);
	const unlock = vi
		.spyOn(GlobalControlsAPI, "unlock")
		.mockRejectedValueOnce(new Error("Incorrect admin PIN."))
		.mockResolvedValue({
			...MockGlobalControlGrant,
			expires_at: "2000-01-01T00:00:00Z",
		});
	const onUnlock = vi.fn();
	const user = userEvent.setup();
	render(
		<GlobalControlDoor onUnlock={onUnlock}>
			<button type="button">Action</button>
		</GlobalControlDoor>,
	);
	await user.type(
		await screen.findByLabelText("Six-digit admin PIN"),
		"938271",
	);
	await user.click(screen.getByRole("button", { name: "Unlock controls" }));
	await waitFor(() => expect(unlock).toHaveBeenCalledOnce());
	expect(onUnlock).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Unlock controls" }));
	await waitFor(() => expect(onUnlock).toHaveBeenLastCalledWith(null));
});
