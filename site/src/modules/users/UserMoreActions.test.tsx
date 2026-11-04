import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { QuotaRequestsAPI } from "#/api/quotaRequests";
import {
	MockAccountCloudDrivePeers,
	MockAccountCloudDriveShare,
} from "#/testHelpers/cloudDriveShares";
import {
	MockUserMember,
	MockUserOwner,
	MockWorkspacesResponse,
} from "#/testHelpers/entities";
import { MockQuotaRequest } from "#/testHelpers/quotaRequests";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { UserMoreActions } from "./UserMoreActions";

afterEach(() => vi.restoreAllMocks());

it("opens all workspaces filtered to the selected account", async () => {
	const { router } = renderWithAuth(
		<UserMoreActions
			user={MockUserMember}
			me={MockUserOwner.id}
			onAction={vi.fn()}
		/>,
		{ extraRoutes: [{ path: "/workspaces", element: <div /> }] },
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Open menu" }),
	);
	await userEvent.click(
		screen.getByRole("menuitem", { name: "All workspaces" }),
	);
	expect(router.state.location.pathname).toBe("/workspaces");
	expect(new URLSearchParams(router.state.location.search).get("filter")).toBe(
		`owner:${MockUserMember.username}`,
	);
});

it("reviews quota requests from the account menu after it closes", async () => {
	vi.spyOn(QuotaRequestsAPI, "list").mockResolvedValue({
		requests: [MockQuotaRequest],
	});
	const decide = vi.spyOn(QuotaRequestsAPI, "decide").mockResolvedValue({
		request: { ...MockQuotaRequest, status: "approved" },
	});
	renderWithAuth(
		<UserMoreActions
			user={MockUserMember}
			me={MockUserOwner.id}
			canManageWorkspaces
			onAction={vi.fn()}
		/>,
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Open menu" }),
	);
	await userEvent.click(
		screen.getByRole("menuitem", { name: "Quota Requests" }),
	);
	await userEvent.click(
		await screen.findByRole("button", {
			name: `Approve request by ${MockUserMember.username}`,
		}),
	);
	await waitFor(() =>
		expect(decide).toHaveBeenCalledExactlyOnceWith({
			request: MockQuotaRequest,
			action: "approve",
			reason: "",
		}),
	);
});

it("manages incoming and outgoing Cloud Drive connections for only the selected account", async () => {
	const share = {
		...MockAccountCloudDriveShare,
		from: MockUserMember.id,
		fromName: MockUserMember.username,
	};
	vi.spyOn(PlatformAPI, "getCloudDrivePeers").mockResolvedValue({
		...MockAccountCloudDrivePeers,
		all: [share, { ...MockAccountCloudDriveShare, id: "unrelated" }],
	});
	const disconnect = vi
		.spyOn(PlatformAPI, "setCloudDriveShareConnection")
		.mockResolvedValue({
			...MockAccountCloudDrivePeers,
			share: { ...share, state: "ended" },
		});
	renderWithAuth(
		<UserMoreActions
			user={MockUserMember}
			me={MockUserOwner.id}
			canManageWorkspaces
			onAction={vi.fn()}
		/>,
	);
	await userEvent.click(
		await screen.findByRole("button", { name: "Open menu" }),
	);
	await userEvent.click(screen.getByRole("menuitem", { name: "Cloud Drive" }));
	await userEvent.click(
		await screen.findByRole("button", { name: /^Disconnect ann's/ }),
	);
	await waitFor(() =>
		expect(disconnect).toHaveBeenCalledExactlyOnceWith(share.id, false),
	);
});

it.each([false, true])(
	"opens the combined editor with synchronized roles protected: %s",
	async (synchronized) => {
		const onAction = vi.fn();
		const account = { ...MockUserMember, login_type: "oidc" as const };
		renderWithAuth(
			<UserMoreActions
				user={account}
				me={MockUserOwner.id}
				onAction={onAction}
				oidcRoleSyncEnabled={synchronized}
			/>,
		);
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Open menu" }));
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
	renderWithAuth(
		<UserMoreActions
			user={MockUserOwner}
			me={MockUserOwner.id}
			onAction={onAction}
		/>,
	);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("button", { name: "Open menu" }));
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
