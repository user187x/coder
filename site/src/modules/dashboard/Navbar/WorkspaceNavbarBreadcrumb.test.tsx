import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { MockUserOwner, MockWorkspace } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { NavbarStartTarget } from "./NavbarAction";
import { ProxyMenu } from "./ProxyMenu";
import { WorkspaceNavbarBreadcrumb } from "./WorkspaceNavbarBreadcrumb";

afterEach(() => vi.restoreAllMocks());

const InNavbar: React.FC = () => {
	const [start, setStart] = useState<HTMLDivElement | null>(null);
	return (
		<NavbarStartTarget.Provider value={start}>
			<div ref={setStart} data-testid="navbar-start" />
			<WorkspaceNavbarBreadcrumb workspaceName="browser" />
			<ProxyMenu
				breadcrumbOnly
				controls={{ permissions: { canViewHud: true } }}
				user={MockUserOwner}
				onSignOut={vi.fn()}
			/>
		</NavbarStartTarget.Provider>
	);
};

it("opens Settings from its Workspaces category", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	renderWithAuth(<InNavbar />);
	const crumb = within(
		await screen.findByRole("navigation", { name: "Workspace breadcrumb" }),
	);
	await userEvent.click(
		await crumb.findByRole("button", { name: "Workspaces" }),
	);
	expect(
		await screen.findByTestId("navbar-latency-controls-menu"),
	).toBeVisible();
});

it("searches the signed-in user's workspaces and opens the selected result", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	const getWorkspaces = vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: [
			{ ...MockWorkspace, id: "browser-id", name: "browser" },
			{ ...MockWorkspace, name: "dev" },
		],
		count: 2,
	});
	const destination = `/@${MockWorkspace.owner_name}/dev`;
	const { router } = renderWithAuth(<InNavbar />, {
		extraRoutes: [{ path: destination, element: <div /> }],
	});
	await user.click(
		await screen.findByRole("button", {
			name: "Switch workspace from browser",
		}),
	);
	await screen.findByRole("option", { name: "browser" });
	await user.type(
		screen.getByRole("combobox", { name: "Search workspaces" }),
		"dev",
	);
	await user.keyboard("{Enter}");
	expect(router.state.location.pathname).toBe(destination);
	expect(getWorkspaces).toHaveBeenCalledWith({ q: "owner:me" });
});

it("opens workspace creation from the footer when there are no matches", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: [],
		count: 0,
	});
	const { router } = renderWithAuth(<InNavbar />, {
		extraRoutes: [{ path: "/workspaces", element: <div /> }],
	});
	await user.click(
		await screen.findByRole("button", {
			name: "Switch workspace from browser",
		}),
	);
	await user.click(screen.getByRole("link", { name: "Create Workspace" }));
	expect(router.state.location.pathname).toBe("/workspaces");
	expect(router.state.location.search).toBe("?create-workspace=1");
});
