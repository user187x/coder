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

	it("publishes a blank banner, showing, when turned on with nothing written", async () => {
		const publish = vi
			.spyOn(PlatformAPI, "publishBanner")
			.mockImplementation(async (fields) => ({
				...empty,
				banner: { ...empty.banner, ...fields },
			}));
		renderWithAuth(<AnnouncementSettingsPage />);
		fireEvent.click(await screen.findByRole("switch", { name: "Show banner" }));
		await waitFor(() =>
			expect(publish).toHaveBeenCalledWith(
				expect.objectContaining({
					enabled: true,
					message: "",
					picture: "",
					countdown: "",
				}),
			),
		);
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
	await user.paste("Scheduled maintenance tonight.");
	await user.click(screen.getByRole("button", { name: "Preview" }));
	expect(publish).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Edit message" }));
	await user.click(screen.getByRole("textbox", { name: "Text" }));
	await user.keyboard("{Control>}{End}{/Control}");
	await user.paste(" Please save your work.");
	await user.click(screen.getByRole("button", { name: "Publish changes" }));
	await waitFor(() =>
		expect(publish).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Scheduled maintenance tonight. Please save your work.",
			}),
		),
	);
});

describe("announcement recording", () => {
	it("saves the toggle without publishing the message draft, then preserves it on publish", async () => {
		let state = {
			...MockBannerState,
			banner: {
				...MockBanner,
				message: "Published message",
				markdown: false,
				receipts: true,
			},
		};
		vi.spyOn(PlatformAPI, "getBannerState").mockImplementation(
			async () => state,
		);
		vi.spyOn(PlatformAPI, "getAnnouncementReport").mockResolvedValue(
			MockAnnouncementReport,
		);
		const publish = vi
			.spyOn(PlatformAPI, "publishBanner")
			.mockImplementation(async (fields) => {
				state = {
					...state,
					banner: {
						...state.banner,
						...fields,
						markdown: fields.markdown ?? false,
						receipts: fields.receipts ?? true,
					},
				};
				return state;
			});
		renderWithAuth(<AnnouncementSettingsPage />);
		const message = await screen.findByPlaceholderText(
			"What do developers need to know?",
		);
		await userEvent.clear(message);
		await userEvent.type(message, "Unpublished changes");
		await userEvent.click(
			screen.getByRole("switch", { name: "Record views and confirmations" }),
		);
		await waitFor(() =>
			expect(publish).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Published message",
					receipts: false,
				}),
			),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Publish changes" }),
		);
		await waitFor(() =>
			expect(publish).toHaveBeenLastCalledWith(
				expect.objectContaining({
					message: "Unpublished changes",
					receipts: false,
				}),
			),
		);
	});
});

describe("clearing fields", () => {
	const withEverything = {
		...MockBannerState,
		banner: {
			...MockBanner,
			message: "",
			picture: "/pictures/usa.gif",
			countdown: "2030-01-01T00:00:00Z",
			markdown: false,
		},
	};

	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getBannerState").mockResolvedValue(withEverything);
		vi.spyOn(PlatformAPI, "getAnnouncementReport").mockResolvedValue(
			MockAnnouncementReport,
		);
	});

	it("publishes the cleared picture of a picture-only banner as a blank banner", async () => {
		const publish = vi
			.spyOn(PlatformAPI, "publishBanner")
			.mockResolvedValue(withEverything);
		const user = userEvent.setup();
		renderWithAuth(<AnnouncementSettingsPage />);
		await user.click(
			await screen.findByRole("button", {
				name: "Remove the background image",
			}),
		);
		await user.click(screen.getByRole("button", { name: "Publish changes" }));
		await waitFor(() =>
			expect(publish).toHaveBeenCalledWith(
				expect.objectContaining({
					enabled: true,
					message: "",
					picture: "",
					countdown: "2030-01-01T00:00:00Z",
				}),
			),
		);
	});
});
