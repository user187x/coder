import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { MockUserMember } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import UsersPage from "./UsersPage";

it("paginates the account query, searches from the first match, and restores the regular limit on leaving focus", async () => {
	const getUsers = vi
		.spyOn(API, "getUsers")
		.mockImplementation(async (request) => {
			const offset = request?.offset ?? 0;
			const username = request?.q || `account-${offset + 1}`;
			return {
				users: [{ ...MockUserMember, username }],
				count: request?.q ? 1 : 125,
			};
		});
	try {
		const { router } = renderWithAuth(<UsersPage />, {
			path: "/deployment/users",
			route: "/deployment/users?page=2",
		});
		await screen.findByText("account-11");
		const user = userEvent.setup();
		await user.click(
			screen.getByRole("combobox", { name: "Accounts per page" }),
		);
		await user.click(screen.getByRole("option", { name: "25 per page" }));
		await waitFor(() => expect(router.state.location.search).toBe("?limit=25"));
		await screen.findByText("account-1");
		await user.click(screen.getByRole("button", { name: "Next page" }));
		await screen.findByText("account-26");
		await user.type(
			screen.getByRole("textbox", { name: "Filter" }),
			"account-125",
		);
		await screen.findByText("account-125");
		expect(getUsers).toHaveBeenCalledWith(
			{ q: "account-125", limit: 25, offset: 0 },
			expect.anything(),
		);
		await user.click(screen.getByRole("button", { name: "Focus" }));
		await waitFor(() =>
			expect(getUsers).toHaveBeenCalledWith(
				{ q: "account-125", limit: 100, offset: 0 },
				expect.anything(),
			),
		);
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(
				new URLSearchParams(router.state.location.search).has("focus"),
			).toBe(false),
		);
		await screen.findByRole("button", { name: "Focus" });
		expect(router.state.location.search).toContain("limit=25");
	} finally {
		getUsers.mockRestore();
	}
});

it("opens account and lease creation from a single trigger", async () => {
	const { router } = renderWithAuth(<UsersPage />, {
		path: "/deployment/users",
		route: "/deployment/users",
		extraRoutes: [{ path: "/deployment/users/create", element: <div /> }],
	});
	const user = userEvent.setup();
	const trigger = await screen.findByRole("button", { name: "New account" });
	await user.click(trigger);
	await user.click(
		await screen.findByRole("menuitem", { name: "Create Lease" }),
	);
	expect(
		await screen.findByRole("dialog", { name: "New short term lease" }),
	).toHaveAttribute("data-state", "open");
	await user.keyboard("{Escape}");
	await user.click(trigger);
	await user.click(
		await screen.findByRole("menuitem", { name: "New account" }),
	);
	expect(router.state.location.pathname).toBe("/deployment/users/create");
});
