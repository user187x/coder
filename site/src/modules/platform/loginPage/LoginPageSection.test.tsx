import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LOGIN_PAGE_DEFAULT, PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
import { LoginPageSection } from "./LoginPageSection";

afterEach(() => vi.restoreAllMocks());
it("saves the compact effect selection and both messages in one request", async () => {
	vi.spyOn(PlatformAPI, "getLoginPage").mockResolvedValue(LOGIN_PAGE_DEFAULT);
	const save = vi
		.spyOn(PlatformAPI, "updateLoginPage")
		.mockResolvedValue(LOGIN_PAGE_DEFAULT);
	render(<LoginPageSection />);
	await userEvent.click(await screen.findByLabelText("Text effect"));
	await userEvent.click(screen.getByRole("option", { name: "Plain" }));
	await userEvent.type(screen.getByLabelText("Sign-in message"), "Welcome");
	await userEvent.type(screen.getByLabelText("Sign-out message"), "Goodbye");
	expect(save).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				effect: "plain",
				message: "Welcome",
				signedOutMessage: "Goodbye",
			}),
		),
	);
});
