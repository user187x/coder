import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { PlatformAPI } from "#/api/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { CHAT_CONSOLE_PAGE } from "#/modules/platform/chat/consolePlaces";
import { MockPermissions } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { adminPagesFor } from "./adminQuickLinks";
import { CompactQuickLinks } from "./CompactQuickLinkMenu";

const pages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
});
const [first, second, third] = pages;

const renderStrip = (onChange = vi.fn()) => {
	if (!first || !second || !third) throw new Error("too few admin pages");
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<CompactQuickLinks
							links={[first, second]}
							pages={pages}
							onChange={onChange}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	return { onChange, first, second, third };
};

it.each([false, true])(
	"updates the default home from a thin-strip quick link (already default: %s)",
	async (isDefault) => {
		const user = userEvent.setup();
		if (!first) throw new Error("Missing first quick link");
		const read = vi
			.spyOn(PlatformAPI, "getUserUIPreferences")
			.mockResolvedValue(
				isDefault ? { settings_default_view: first.path } : {},
			);
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (changes) => changes);
		try {
			const { first, onChange } = renderStrip();
			fireEvent.contextMenu(
				screen.getByRole("menuitem", { name: first.label }),
			);
			await user.click(
				await screen.findByRole("menuitem", {
					name: isDefault ? "Clear Default" : "Set Default",
				}),
			);
			await waitFor(() =>
				expect(save).toHaveBeenCalledExactlyOnceWith({
					settings_default_view: isDefault ? null : first.path,
				}),
			);
			expect(onChange).not.toHaveBeenCalled();
		} finally {
			read.mockRestore();
			save.mockRestore();
		}
	},
);

it("removes a quick link from the thin strip's right-click menu", async () => {
	const user = userEvent.setup();
	const { onChange, first, second } = renderStrip();
	await user.pointer({
		target: screen.getByRole("menuitem", { name: first.label }),
		keys: "[MouseRight]",
	});
	await user.click(
		await screen.findByRole("menuitem", { name: "Remove from quick links" }),
	);
	expect(onChange).toHaveBeenCalledWith([second.id]);
});

it("puts another page in a quick link's place from its right-click menu", async () => {
	const user = userEvent.setup();
	const { onChange, first, second, third } = renderStrip();
	fireEvent.contextMenu(screen.getByRole("menuitem", { name: first.label }));
	await user.click(await screen.findByRole("menuitem", { name: third.label }));
	expect(onChange).toHaveBeenCalledWith([third.id, second.id]);
});

it("inserts a new quick link after the selected link without replacing it", async () => {
	const user = userEvent.setup();
	const { onChange, first, second, third } = renderStrip();
	fireEvent.contextMenu(screen.getByRole("menuitem", { name: first.label }));
	const add = await screen.findByRole("menuitem", { name: "Add" });
	add.focus();
	await user.keyboard("{ArrowRight}");
	const submenu = await screen.findByRole("menu", { name: "Add" });
	await user.click(
		within(submenu).getByRole("menuitem", { name: third.label }),
	);
	expect(onChange).toHaveBeenCalledExactlyOnceWith([
		first.id,
		third.id,
		second.id,
	]);
});

it("opens the Chat console from the thin strip on a single click", async () => {
	const chat = pages.find(({ id }) => id === "chat");
	if (!chat) throw new Error("Chat is not available to the test admin");
	const router = createMemoryRouter([
		{
			path: "/",
			element: (
				<DropdownMenu open>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<CompactQuickLinks
							links={[chat]}
							pages={pages}
							onChange={vi.fn()}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
		{ path: CHAT_CONSOLE_PAGE, element: null },
	]);
	renderComponent(<RouterProvider router={router} />);

	await userEvent.click(await screen.findByRole("menuitem", { name: "Chat" }));
	await waitFor(() =>
		expect(router.state.location.pathname).toBe(CHAT_CONSOLE_PAGE),
	);
});
