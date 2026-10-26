import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import {
	MockUserMember,
	MockUserOwner,
	MockWorkspacesResponse,
} from "#/testHelpers/entities";
import { renderComponent, renderWithAuth } from "#/testHelpers/renderHelpers";
import { UserMoreActions } from "./UserMoreActions";

it.each([false, true])(
	"opens the combined editor with synchronized roles protected: %s",
	async (synchronized) => {
		const onAction = vi.fn();
		const account = { ...MockUserMember, login_type: "oidc" as const };
		renderComponent(
			<MemoryRouter>
				<UserMoreActions
					user={account}
					me={MockUserOwner.id}
					onAction={onAction}
					oidcRoleSyncEnabled={synchronized}
				/>
			</MemoryRouter>,
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: "Open menu" }));
		await user.click(screen.getByRole("menuitem", { name: "Edit" }));
		expect(onAction).toHaveBeenCalledExactlyOnceWith({
			type: "edit",
			user: account,
			rolesReadOnly: synchronized,
		});
	},
);

it("retains self deletion protection", async () => {
	const onAction = vi.fn();
	renderComponent(
		<MemoryRouter>
			<UserMoreActions
				user={MockUserOwner}
				me={MockUserOwner.id}
				onAction={onAction}
			/>
		</MemoryRouter>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Open menu" }));
	await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
	expect(onAction).not.toHaveBeenCalled();
});

it("opens account lockdown review without changing workspace access", async () => {
	const workspaces = vi
		.spyOn(API, "getWorkspaces")
		.mockResolvedValue({ ...MockWorkspacesResponse, workspaces: [], count: 0 });
	const lock = vi.spyOn(PlatformAPI, "setLockdown");
	renderWithAuth(
		<UserMoreActions
			user={MockUserMember}
			me={MockUserOwner.id}
			onAction={vi.fn()}
		/>,
	);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Open menu" }));
	await user.click(screen.getByRole("menuitem", { name: "Lock Down" }));
	await waitFor(() =>
		expect(workspaces).toHaveBeenCalledWith({
			q: `owner:${MockUserMember.username}`,
			limit: 0,
		}),
	);
	expect(lock).not.toHaveBeenCalled();
});
