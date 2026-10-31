import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { PlatformAPI } from "#/api/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
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
			expect(save).toHaveBeenCalledWith({ chat_hidden: !hidden }),
		);
	},
);

it("opens Chat administration from the admin context menu", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const router = createMemoryRouter([
		{
			path: "/",
			element: (
				<DropdownMenu defaultOpen>
					<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
					<DropdownMenuContent>
						<ChatMenuItem admin />
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
		{ path: "/deployment/chat", element: <div>Chat settings</div> },
	]);
	renderWithRouter(router);
	const user = userEvent.setup();
	await user.pointer({
		target: await screen.findByRole("menuitem", { name: "Chat" }),
		keys: "[MouseRight]",
	});
	await user.click(await screen.findByRole("menuitem", { name: "Settings" }));
	await waitFor(() =>
		expect(router.state.location.pathname).toBe("/deployment/chat"),
	);
});
