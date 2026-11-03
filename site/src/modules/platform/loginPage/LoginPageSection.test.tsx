import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LOGIN_PAGE_DEFAULT, PlatformAPI } from "#/api/platform";
import { backgroundsKey } from "#/api/queries/backgrounds";
import { loginPageKey } from "#/api/queries/platform";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { render } from "#/testHelpers/renderHelpers";
import { LoginPageSection } from "./LoginPageSection";

beforeEach(() =>
	vi.spyOn(PlatformAPI, "getBackgrounds").mockResolvedValue(MockBackgrounds),
);
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
	await userEvent.click(
		screen.getByRole("button", { name: "Save sign-in appearance" }),
	);
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
	await userEvent.click(
		screen.getByRole("button", { name: "Save sign-in appearance" }),
	);
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

it("saves a baked image-store reference without uploading its bytes", async () => {
	vi.spyOn(PlatformAPI, "getLoginPage").mockResolvedValue({
		...LOGIN_PAGE_DEFAULT,
		headingMode: "image",
	});
	vi.spyOn(PlatformAPI, "getImageStore").mockResolvedValue({
		images: [
			{
				name: "synthsun.gif",
				url: "/__coder-ui/image-store/synthsun.gif?v=1",
				thumb: "/__coder-ui/image-store/thumbs/synthsun.gif?v=1",
				type: "image/gif",
				source: "store",
			},
		],
	});
	const save = vi
		.spyOn(PlatformAPI, "updateLoginPage")
		.mockResolvedValue(LOGIN_PAGE_DEFAULT);
	render(<LoginPageSection />);
	await userEvent.click(
		(
			await screen.findAllByRole("button", {
				name: "Choose from the image store",
			})
		)[0],
	);
	await userEvent.click(
		await screen.findByRole("radio", { name: "synthsun.gif" }),
	);
	expect(save).not.toHaveBeenCalled();
	await userEvent.click(
		screen.getByRole("button", { name: "Save sign-in appearance" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				headingMode: "image",
				headingImage: "/__coder-ui/image-store/synthsun.gif",
			}),
		),
	);
});

it("saves no heading without discarding the existing title", async () => {
	vi.spyOn(PlatformAPI, "getLoginPage").mockResolvedValue({
		...LOGIN_PAGE_DEFAULT,
		title: "Welcome",
	});
	const save = vi
		.spyOn(PlatformAPI, "updateLoginPage")
		.mockResolvedValue(LOGIN_PAGE_DEFAULT);
	render(<LoginPageSection />);
	await userEvent.click(await screen.findByLabelText("Heading"));
	await userEvent.click(screen.getByRole("option", { name: "None" }));
	await userEvent.click(
		screen.getByRole("button", { name: "Save sign-in appearance" }),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ headingMode: "none", title: "Welcome" }),
		),
	);
});

it("retries the background after a partial save without resaving the text", async () => {
	vi.spyOn(PlatformAPI, "getLoginPage").mockResolvedValue(LOGIN_PAGE_DEFAULT);
	const text = vi
		.spyOn(PlatformAPI, "updateLoginPage")
		.mockImplementation(async (value) => value);
	const background = vi
		.spyOn(PlatformAPI, "saveBackground")
		.mockRejectedValueOnce(new Error("Temporary failure"))
		.mockResolvedValue({ ok: true, set: true });
	const user = userEvent.setup();
	const { queryClient } = render(<LoginPageSection />);
	await user.type(await screen.findByLabelText("Sign-in message"), "Welcome");
	await user.selectOptions(
		screen.getByRole("combobox", { name: "Fit" }),
		"tile",
	);
	await act(async () => {
		await queryClient.invalidateQueries({ queryKey: loginPageKey });
		await queryClient.invalidateQueries({ queryKey: backgroundsKey });
	});
	await user.click(
		screen.getByRole("button", { name: "Save sign-in appearance" }),
	);
	await waitFor(() => expect(background).toHaveBeenCalledTimes(1));
	await user.click(
		screen.getByRole("button", { name: "Save sign-in appearance" }),
	);
	await waitFor(() => expect(background).toHaveBeenCalledTimes(2));
	expect(text).toHaveBeenCalledTimes(1);
	expect(text).toHaveBeenCalledWith(
		expect.objectContaining({ message: "Welcome" }),
	);
	expect(background).toHaveBeenLastCalledWith(
		"login",
		expect.objectContaining({ fit: "tile" }),
	);
});
