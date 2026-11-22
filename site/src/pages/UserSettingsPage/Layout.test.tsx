import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { API } from "#/api/api";
import { NavbarActionTarget } from "#/modules/dashboard/Navbar/NavbarAction";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import Layout from "./Layout";

function WithNavbarAction() {
	const [target, setTarget] = useState<HTMLDivElement | null>(null);
	return (
		<NavbarActionTarget.Provider value={target}>
			<nav aria-label="Navbar action">
				<div ref={setTarget} />
			</nav>
			<Layout />
		</NavbarActionTarget.Provider>
	);
}

it("opens the User Settings menu from Action and navigates to its sections", async () => {
	const user = userEvent.setup();
	const { router } = renderWithAuth(<WithNavbarAction />, {
		path: "/settings",
		route: "/settings/account",
		children: [
			{ path: "account", element: <h1>Account</h1> },
			{ path: "ssh-keys", element: <h1>SSH Keys</h1> },
		],
	});
	const navbar = within(
		await screen.findByRole("navigation", { name: "Navbar action" }),
	);
	const action = await navbar.findByRole("button", {
		name: "User Settings actions",
	});
	expect(action).toHaveTextContent("User Settings");
	await user.click(action);
	await user.click(await screen.findByRole("menuitem", { name: "SSH Keys" }));
	await screen.findByRole("heading", { name: "SSH Keys" });
	expect(router.state.location.pathname).toBe("/settings/ssh-keys");
});

it("signs out from the User Settings Action menu", async () => {
	const logout = vi.spyOn(API, "logout").mockResolvedValue(undefined);
	const user = userEvent.setup();
	renderWithAuth(<WithNavbarAction />, {
		path: "/settings",
		route: "/settings/account",
		children: [{ path: "account", element: <h1>Account</h1> }],
	});
	await user.click(
		await screen.findByRole("button", { name: "User Settings actions" }),
	);
	await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
	await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
});
