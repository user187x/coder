import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { MockWorkspace } from "#/testHelpers/entities";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { NavbarStartTarget } from "./NavbarAction";
import { useRegisterSettingsMenu } from "./settingsMenuHost";
import { WorkspaceNavbarBreadcrumb } from "./WorkspaceNavbarBreadcrumb";

afterEach(() => vi.restoreAllMocks());

const InNavbar: React.FC = () => {
	const [start, setStart] = useState<HTMLDivElement | null>(null);
	// The navbar's Settings menu, mounted to open from the breadcrumb's chevron.
	useRegisterSettingsMenu(true);
	return (
		<NavbarStartTarget.Provider value={start}>
			<div ref={setStart} data-testid="navbar-start" />
			<WorkspaceNavbarBreadcrumb workspaceName="browser" />
		</NavbarStartTarget.Provider>
	);
};

it("links its Workspaces crumb back to the workspace list", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	renderWithAuth(<InNavbar />);
	const crumb = within(
		await screen.findByRole("navigation", { name: "Workspace breadcrumb" }),
	);
	expect(crumb.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
		"href",
		"/workspaces",
	);
});

it("offers the signed-in user's workspaces from the last crumb", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	const getWorkspaces = vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: [{ ...MockWorkspace, name: "dev" }],
		count: 1,
	});
	renderWithAuth(<InNavbar />);
	await userEvent.click(
		await screen.findByRole("button", {
			name: "Switch workspace from browser",
		}),
	);
	expect(await screen.findByRole("menuitem", { name: "dev" })).toHaveAttribute(
		"href",
		`/@${MockWorkspace.owner_name}/dev`,
	);
	expect(
		within(screen.getByRole("menu")).getByRole("separator"),
	).toBeInTheDocument();
	expect(
		screen.getByRole("menuitem", { name: "Create Workspace" }),
	).toHaveAttribute("href", "/workspaces?create-workspace=1");
	expect(getWorkspaces).toHaveBeenCalledWith({ q: "owner:me" });
});

it("offers only Create Workspace when the user owns no workspaces", async () => {
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		admin_nav_in_navbar: true,
	});
	vi.spyOn(API, "getWorkspaces").mockResolvedValue({
		workspaces: [],
		count: 0,
	});
	renderWithAuth(<InNavbar />);
	await userEvent.click(
		await screen.findByRole("button", {
			name: "Switch workspace from browser",
		}),
	);
	const menu = within(await screen.findByRole("menu"));
	await menu.findByRole("menuitem", { name: "Create Workspace" });
	expect(menu.getAllByRole("menuitem")).toHaveLength(1);
	expect(menu.queryByRole("separator")).not.toBeInTheDocument();
});
