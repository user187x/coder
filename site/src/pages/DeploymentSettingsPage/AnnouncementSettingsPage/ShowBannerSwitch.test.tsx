import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlatformAPI } from "#/api/platform";
import {
	MockAnnouncementReport,
	MockBanner,
	MockBannerState,
} from "#/testHelpers/platform";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import AnnouncementSettingsPage from "./AnnouncementSettingsPage";

// Platform: the Show banner switch from an empty banner (the chart's defaults, or after a reset) - it used to refuse
// with a line at the bottom of the page, so it looked as if it could not be turned on.
describe("the Show banner switch", () => {
	const empty = {
		...MockBannerState,
		banner: {
			...MockBanner,
			enabled: false,
			message: "",
			picture: "",
			countdown: "",
		},
	};

	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getBannerState").mockResolvedValue(empty);
		vi.spyOn(PlatformAPI, "getAnnouncementReport").mockResolvedValue(
			MockAnnouncementReport,
		);
	});

	it("says beside it that there is nothing to show yet, and publishes nothing", async () => {
		const publish = vi.spyOn(PlatformAPI, "publishBanner");
		renderWithAuth(<AnnouncementSettingsPage />);
		const sw = await screen.findByRole("switch", { name: "Show banner" });
		fireEvent.click(sw);
		expect(
			await screen.findByTestId("announcement-visibility-state"),
		).toHaveTextContent(/Nothing to show yet: write a message below/);
		expect(publish).not.toHaveBeenCalled();
	});

	it("publishes the message written, showing, when turned on", async () => {
		const publish = vi
			.spyOn(PlatformAPI, "publishBanner")
			.mockImplementation(async (fields) => ({
				...empty,
				banner: { ...empty.banner, ...fields },
			}));
		renderWithAuth(<AnnouncementSettingsPage />);
		const message = await screen.findByPlaceholderText(
			"What do developers need to know?",
		);
		fireEvent.change(message, { target: { value: "Maintenance at 22:00" } });
		expect(
			screen.getByTestId("announcement-visibility-state"),
		).toHaveTextContent("Off: turn it on to publish your message and show it");
		fireEvent.click(screen.getByRole("switch", { name: "Show banner" }));
		await waitFor(() =>
			expect(publish).toHaveBeenCalledWith(
				expect.objectContaining({
					enabled: true,
					message: "Maintenance at 22:00",
				}),
			),
		);
	});
});

it("retains edits through preview and publishes only on request", async () => {
	vi.spyOn(PlatformAPI, "getBannerState").mockResolvedValue(MockBannerState);
	vi.spyOn(PlatformAPI, "getAnnouncementReport").mockResolvedValue(
		MockAnnouncementReport,
	);
	const publish = vi
		.spyOn(PlatformAPI, "publishBanner")
		.mockResolvedValue(MockBannerState);
	const user = userEvent.setup();
	renderWithAuth(<AnnouncementSettingsPage />);
	const message = await screen.findByRole("textbox", { name: "Text" });
	await user.clear(message);
	await user.type(message, "Scheduled maintenance tonight.");
	await user.click(screen.getByRole("button", { name: "Preview" }));
	expect(publish).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Edit message" }));
	await user.type(
		screen.getByRole("textbox", { name: "Text" }),
		" Please save your work.",
	);
	await user.click(screen.getByRole("button", { name: "Publish changes" }));
	await waitFor(() =>
		expect(publish).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Scheduled maintenance tonight. Please save your work.",
			}),
		),
	);
});
