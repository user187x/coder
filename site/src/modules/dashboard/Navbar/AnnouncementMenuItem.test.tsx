import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { PlatformAPI } from "#/api/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockBanner, MockBannerState } from "#/testHelpers/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AnnouncementMenuItem } from "./AnnouncementMenuItem";

it("publishes text with the latest audience and appearance, while cancel never publishes", async () => {
	const user = userEvent.setup();
	const current = {
		...MockBanner,
		audience: "selected" as const,
		audienceUserIds: ["recipient"],
		enabled: false,
	};
	vi.spyOn(PlatformAPI, "getBanner").mockResolvedValue(current);
	const save = vi
		.spyOn(PlatformAPI, "publishBanner")
		.mockResolvedValue(MockBannerState);
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AnnouncementMenuItem />
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await user.pointer({
		target: screen.getByRole("menuitem", { name: "Announcement" }),
		keys: "[MouseRight]",
	});
	await user.clear(
		await screen.findByRole("textbox", { name: "Announcement text" }),
	);
	await user.type(
		screen.getByRole("textbox", { name: "Announcement text" }),
		"Maintenance begins now",
	);
	await user.click(screen.getByRole("button", { name: "Submit" }));
	const { id: _id, ...fields } = current;
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			...fields,
			message: "Maintenance begins now",
			markdown: false,
			enabled: true,
		}),
	);
	screen.getByRole("menuitem", { name: "Announcement" }).focus();
	await user.keyboard("{Shift>}{F10}{/Shift}");
	const announcement = screen.getByRole("menuitem", { name: "Announcement" });
	await user.clear(screen.getByRole("textbox", { name: "Announcement text" }));
	await user.type(
		screen.getByRole("textbox", { name: "Announcement text" }),
		"Preserved while hidden",
	);
	await user.pointer({ target: announcement, keys: "[MouseRight]" });
	await user.pointer({ target: announcement, keys: "[MouseRight]" });
	await user.click(screen.getByRole("button", { name: "Submit" }));
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith(
			expect.objectContaining({ message: "Preserved while hidden" }),
		),
	);
	announcement.focus();
	await user.keyboard("{Shift>}{F10}{/Shift}");
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(save).toHaveBeenCalledTimes(2);
	vi.restoreAllMocks();
});
