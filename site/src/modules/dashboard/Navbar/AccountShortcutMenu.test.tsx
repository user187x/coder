import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import {
	closeAvatarDialog,
	useAvatarDialogOpen,
} from "#/modules/platform/avatar/avatarDialogStore";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { AccountShortcutMenu } from "./AccountShortcutMenu";

afterEach(() => act(() => closeAvatarDialog()));

it.each([
	["View account", "/settings/account"],
	["Set password", "/settings/security"],
	["Set user name", "/settings/account?edit=username"],
])("opens %s in the existing account editor", async (name, destination) => {
	const user = userEvent.setup();
	const router = createMemoryRouter([
		{
			path: "*",
			element: (
				<AccountShortcutMenu onSignOut={vi.fn()}>
					<button type="button">Account</button>
				</AccountShortcutMenu>
			),
		},
	]);
	renderWithRouter(router);
	await user.pointer({
		target: screen.getByRole("button", { name: "Account" }),
		keys: "[MouseRight]",
	});
	await user.click(screen.getByRole("menuitem", { name }));
	expect(router.state.location.pathname + router.state.location.search).toBe(
		destination,
	);
});

it("opens the picture editor from the keyboard context menu", async () => {
	let pictureOpen = false;
	const Observe = () => {
		pictureOpen = useAvatarDialogOpen();
		return null;
	};
	const user = userEvent.setup();
	renderWithRouter(
		createMemoryRouter([
			{
				path: "/",
				element: (
					<>
						<Observe />
						<AccountShortcutMenu onSignOut={vi.fn()}>
							<button type="button">Account</button>
						</AccountShortcutMenu>
					</>
				),
			},
		]),
	);
	screen.getByRole("button", { name: "Account" }).focus();
	await user.keyboard("{Shift>}{F10}{/Shift}");
	await user.click(screen.getByRole("menuitem", { name: "Set picture" }));
	expect(pictureOpen).toBe(true);
});

it("signs out once from Account actions", async () => {
	const onSignOut = vi.fn();
	const user = userEvent.setup();
	renderWithRouter(
		createMemoryRouter([
			{
				path: "/",
				element: (
					<AccountShortcutMenu onSignOut={onSignOut}>
						<button type="button">Account</button>
					</AccountShortcutMenu>
				),
			},
		]),
	);
	await user.pointer({
		target: screen.getByRole("button", { name: "Account" }),
		keys: "[MouseRight]",
	});
	await user.click(screen.getByRole("menuitem", { name: "Sign Out" }));
	expect(onSignOut).toHaveBeenCalledOnce();
});
