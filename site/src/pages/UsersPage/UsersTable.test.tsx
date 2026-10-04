import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { API } from "#/api/api";
import {
	MockUserMember,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { UsersTable } from "./UsersTable";

const renderUsersTable = () => {
	const router = createMemoryRouter(
		[
			{
				path: "/deployment/users",
				element: (
					<UsersTable
						isLoading={false}
						users={[MockUserMember]}
						groupsByUserId={undefined}
						me={MockUserOwner.id}
						canEditUsers
						onAction={vi.fn()}
					/>
				),
			},
			{ path: "*", element: <div /> },
		],
		{ initialEntries: ["/deployment/users"] },
	);
	return renderWithRouter(router);
};

describe("UsersTable", () => {
	it("opens the user's workspace when they have exactly one", async () => {
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [{ ...MockWorkspace, owner_name: MockUserMember.username }],
			count: 1,
		});
		const { router } = renderUsersTable();

		await userEvent.click(await screen.findByText(MockUserMember.email));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/@${MockUserMember.username}/${MockWorkspace.name}`,
			),
		);
	});

	it("opens the user's workspaces list otherwise", async () => {
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [],
			count: 0,
		});
		const { router } = renderUsersTable();

		await userEvent.click(await screen.findByText(MockUserMember.email));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/workspaces"),
		);
		expect(router.state.location.search).toBe(
			`?filter=${encodeURIComponent(`owner:${MockUserMember.username}`)}`,
		);
	});

	it("leaves clicks on the row's menu to the menu", async () => {
		const getWorkspaces = vi.spyOn(API, "getWorkspaces");
		renderUsersTable();

		await userEvent.click(
			await screen.findByRole("button", { name: "Open menu" }),
		);

		expect(getWorkspaces).not.toHaveBeenCalled();
	});
});
