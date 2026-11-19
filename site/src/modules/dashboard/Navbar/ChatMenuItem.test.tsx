import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { PlatformAPI } from "#/api/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { CHAT_CONSOLE_PAGE } from "#/modules/platform/chat/consolePlaces";
import { render, renderWithRouter } from "#/testHelpers/renderHelpers";
import { ChatMenuItem } from "./ChatMenuItem";

afterEach(() => vi.restoreAllMocks());
it.each([
	[true, true],
	[false, true],
	[true, false],
	[false, false],
])(
	"toggles the hidden preference from the navbar context menu (hidden %s, admin %s)",
	async (hidden, admin) => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
			chat_hidden: hidden,
		});
		const save = vi
			.spyOn(PlatformAPI, "setUserUIPreferences")
			.mockImplementation(async (change) => change);
		const arrange = vi.fn();
		render(
			<div onContextMenu={arrange}>
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<ChatMenuItem admin={admin} />
					</DropdownMenuContent>
				</DropdownMenu>
			</div>,
		);
		const user = userEvent.setup();
		await user.pointer({
			target: await screen.findByRole("menuitem", {
				name: "Chat",
			}),
			keys: "[MouseRight]",
		});
		expect(arrange).not.toHaveBeenCalled();
		await user.click(
			await screen.findByRole("menuitem", {
				name: hidden ? "Show" : "Hide",
			}),
		);
		await waitFor(() =>
			expect(save).toHaveBeenCalledWith(
				hidden
					? { chat_hidden: false, chat_position: null }
					: { chat_hidden: true },
			),
		);
	},
);

it.each(["left click", "context menu"])(
	"opens the admin Chat console from %s",
	async (action) => {
		vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
		const toggleDock = vi.fn();
		const router = createMemoryRouter([
			{
				path: "/",
				element: (
					<DropdownMenu defaultOpen>
						<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
						<DropdownMenuContent>
							<ChatMenuItem
								admin
								onToggle={action === "context menu" ? toggleDock : undefined}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
				),
			},
			{ path: CHAT_CONSOLE_PAGE, element: <div>Chat settings</div> },
		]);
		renderWithRouter(router);
		const user = userEvent.setup();
		const chat = await screen.findByRole("menuitem", { name: "Chat" });
		if (action === "context menu") {
			await user.pointer({ target: chat, keys: "[MouseRight]" });
			await user.click(
				await screen.findByRole("menuitem", { name: "Console" }),
			);
		} else {
			await user.click(chat);
		}
		await waitFor(() =>
			expect(router.state.location.pathname).toBe(CHAT_CONSOLE_PAGE),
		);
		expect(toggleDock).not.toHaveBeenCalled();
	},
);
