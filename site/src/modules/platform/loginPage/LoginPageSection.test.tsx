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

it("saves an uploaded image heading while preserving the text settings", async () => {
	vi.spyOn(PlatformAPI, "getLoginPage").mockResolvedValue({
		...LOGIN_PAGE_DEFAULT,
		title: "Welcome",
	});
	const save = vi
		.spyOn(PlatformAPI, "updateLoginPage")
		.mockResolvedValue(LOGIN_PAGE_DEFAULT);
	render(<LoginPageSection />);
	await userEvent.click(await screen.findByLabelText("Heading"));
	await userEvent.click(screen.getByRole("option", { name: "Image" }));
	await userEvent.upload(
		screen.getByLabelText("Upload heading image"),
		new File(["image"], "heading.png", { type: "image/png" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				headingMode: "image",
				headingImage: "data:image/png;base64,aW1hZ2U=",
				title: "Welcome",
				effect: "wireframe",
			}),
		),
	);
});
