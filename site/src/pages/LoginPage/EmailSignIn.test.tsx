import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { render } from "#/testHelpers/renderHelpers";
import { EmailSignIn } from "./EmailSignIn";

it("requests a token for the mailbox and verifies the submitted token", async () => {
	const request = vi.spyOn(API, "requestEmailLogin").mockResolvedValue();
	const verify = vi
		.spyOn(API, "verifyEmailLogin")
		.mockRejectedValue(new Error("Expired token"));
	const user = userEvent.setup();
	render(<EmailSignIn />);
	await user.click(screen.getByRole("button", { name: "Sign in by email" }));
	await user.type(screen.getByLabelText("Email address"), "alice@example.com");
	await user.click(
		screen.getByRole("button", { name: "Email me a sign-in token" }),
	);
	expect(request).toHaveBeenCalledWith("alice@example.com");
	await user.type(
		await screen.findByLabelText("Sign-in token"),
		"one-time-token",
	);
	await user.click(screen.getByRole("button", { name: "Sign in with token" }));
	await waitFor(() =>
		expect(verify).toHaveBeenCalledWith("alice@example.com", "one-time-token"),
	);
});
