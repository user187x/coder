import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { DashboardContext } from "#/modules/dashboard/DashboardProvider";
import {
	MockAppearanceConfig,
	MockBuildInfo,
	MockDefaultOrganization,
	MockEntitlements,
	MockUserMember,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { UsersTable, type UsersTableProps } from "./UsersTable";

const renderUsersTable = (props: Partial<UsersTableProps> = {}) => {
	const router = createMemoryRouter(
		[
			{
				path: "/deployment/users",
				element: (
					<DashboardContext.Provider
						value={{
							appearance: MockAppearanceConfig,
							buildInfo: MockBuildInfo,
							entitlements: MockEntitlements,
							experiments: [],
							organizations: [MockDefaultOrganization],
							showOrganizations: false,
							canViewOrganizationSettings: true,
						}}
					>
						<UsersTable
							isLoading={false}
							users={[MockUserMember]}
							groupsByUserId={undefined}
							me={MockUserOwner.id}
							canEditUsers
							onAction={vi.fn()}
							{...props}
						/>
					</DashboardContext.Provider>
				),
			},
			{ path: "*", element: <div /> },
		],
		{ initialEntries: ["/deployment/users"] },
	);
	return renderWithRouter(router);
};

describe("UsersTable", () => {
	beforeEach(() => {
		vi.spyOn(PlatformAPI, "getNotesByUser").mockResolvedValue({ users: {} });
		vi.spyOn(PlatformAPI, "getWorkspacePowerHistory").mockResolvedValue({
			operations: [],
		});
	});
	afterEach(() => vi.restoreAllMocks());
	it("expands in place and navigates only through an explicit workspace dashboard link", async () => {
		const getWorkspaces = vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [{ ...MockWorkspace, owner_name: MockUserMember.username }],
			count: 1,
		});
		const { router } = renderUsersTable();
		await userEvent.click(await screen.findByText(MockUserMember.email));
		await waitFor(() =>
			expect(getWorkspaces).toHaveBeenCalledWith({
				q: `owner:${MockUserMember.username}`,
				limit: 0,
			}),
		);
		expect(router.state.location.pathname).toBe("/deployment/users");
		await userEvent.click(
			await screen.findByRole("link", {
				name: `Open dashboard for ${MockWorkspace.name}`,
			}),
		);
		expect(router.state.location.pathname).toBe(
			`/@${MockUserMember.username}/${MockWorkspace.name}`,
		);
	});
	it("loads an empty workspace panel through the keyboard disclosure without navigating", async () => {
		const getWorkspaces = vi
			.spyOn(API, "getWorkspaces")
			.mockResolvedValue({ workspaces: [], count: 0 });
		const { router } = renderUsersTable();
		const button = await screen.findByRole("button", {
			name: `Expand workspaces for ${MockUserMember.username}`,
		});
		button.focus();
		await userEvent.keyboard("{Enter}");
		await waitFor(() =>
			expect(getWorkspaces).toHaveBeenCalledWith({
				q: `owner:${MockUserMember.username}`,
				limit: 0,
			}),
		);
		expect(router.state.location.pathname).toBe("/deployment/users");
	});
	it("keeps workspace bulk selection separate from account selection across users", async () => {
		const accountSelect = vi.fn();
		const alpha = {
			...MockWorkspace,
			id: "alpha",
			name: "alpha",
			owner_name: MockUserOwner.username,
			owner_id: MockUserOwner.id,
		};
		const beta = {
			...MockWorkspace,
			id: "beta",
			name: "beta",
			owner_name: MockUserMember.username,
			owner_id: MockUserMember.id,
		};
		vi.spyOn(API, "getWorkspaces").mockImplementation(async (request) => ({
			workspaces:
				request?.q === `owner:${MockUserOwner.username}` ? [alpha] : [beta],
			count: 1,
		}));
		const start = vi
			.spyOn(PlatformAPI, "startWorkspacePower")
			.mockResolvedValue(MockWorkspacePowerOperation);
		renderUsersTable({
			users: [MockUserOwner, MockUserMember],
			canManageWorkspaces: true,
			selected: new Set(),
			onSelect: accountSelect,
		});
		await userEvent.click(
			await screen.findByRole("button", {
				name: `Expand workspaces for ${MockUserOwner.username}`,
			}),
		);
		await userEvent.click(
			await screen.findByRole("checkbox", {
				name: `Choose workspace ${MockUserOwner.username}/alpha`,
			}),
		);
		await userEvent.click(
			screen.getByRole("button", {
				name: `Expand workspaces for ${MockUserMember.username}`,
			}),
		);
		await userEvent.click(
			await screen.findByRole("checkbox", {
				name: `Choose workspace ${MockUserMember.username}/beta`,
			}),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Stop selected workspaces" }),
		);
		await userEvent.type(screen.getByLabelText("Type stop to confirm"), "stop");
		await userEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", { name: "Stop" }),
		);
		await waitFor(() =>
			expect(start).toHaveBeenCalledWith(
				MockWorkspace.organization_id,
				"shutdown",
				["alpha", "beta"],
			),
		);
		expect(accountSelect).not.toHaveBeenCalled();
	});

	it("retries a failed workspace list from the expanded account panel", async () => {
		const getWorkspaces = vi
			.spyOn(API, "getWorkspaces")
			.mockRejectedValueOnce(new Error("Workspace list unavailable"))
			.mockResolvedValue({ workspaces: [], count: 0 });
		renderUsersTable();
		await userEvent.click(
			await screen.findByRole("button", {
				name: `Expand workspaces for ${MockUserMember.username}`,
			}),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Retry workspace list" }),
		);
		await waitFor(() => expect(getWorkspaces).toHaveBeenCalledTimes(2));
	});

	it("leaves clicks on the row's menu to the menu", async () => {
		const getWorkspaces = vi.spyOn(API, "getWorkspaces");
		renderUsersTable();

		await userEvent.click(
			await screen.findByRole("button", { name: "Open menu" }),
		);

		expect(getWorkspaces).not.toHaveBeenCalled();
	});

	it("shows each user's latency and activity over the last seven days", async () => {
		vi.spyOn(API, "getInsightsUserLatency").mockResolvedValue({
			report: {
				start_time: "",
				end_time: "",
				template_ids: [],
				users: [
					{
						user_id: MockUserMember.id,
						username: MockUserMember.username,
						avatar_url: "",
						template_ids: [],
						latency_ms: { p50: 42.4, p95: 120 },
					},
				],
			},
		});
		vi.spyOn(API, "getInsightsUserActivity").mockResolvedValue({
			report: {
				start_time: "",
				end_time: "",
				template_ids: [],
				users: [
					{
						user_id: MockUserMember.id,
						username: MockUserMember.username,
						avatar_url: "",
						template_ids: [],
						seconds: 3 * 3600 + 5 * 60,
					},
				],
			},
		});
		renderUsersTable();
		expect(await screen.findByTestId("user-latency")).toHaveTextContent(
			"42 ms",
		);
		expect(screen.getByTestId("user-activity")).toHaveTextContent("3h 05m");
		expect(
			screen.getByRole("columnheader", { name: /Latency/ }),
		).toBeInTheDocument();
	});

	it("leaves the columns out when the insights are refused", async () => {
		const refused = Object.assign(new Error("Forbidden"), {
			isAxiosError: true,
			response: { status: 403, data: { message: "Forbidden" } },
		});
		const latency = vi
			.spyOn(API, "getInsightsUserLatency")
			.mockRejectedValue(refused);
		vi.spyOn(API, "getInsightsUserActivity").mockRejectedValue(refused);
		renderUsersTable();
		await waitFor(() => expect(latency).toHaveBeenCalled());
		await waitFor(() =>
			expect(
				screen.queryByRole("columnheader", { name: /Latency/ }),
			).toBeNull(),
		);
		expect(screen.queryByTestId("user-latency")).toBeNull();
	});
});
