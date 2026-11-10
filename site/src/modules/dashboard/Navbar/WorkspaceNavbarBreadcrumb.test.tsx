import { screen, within } from "@testing-library/react";
import { useState } from "react";
import { PlatformAPI } from "#/api/platform";
import { render } from "#/testHelpers/renderHelpers";
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
	render(<InNavbar />);
	const crumb = within(
		await screen.findByRole("navigation", { name: "Workspace breadcrumb" }),
	);
	expect(crumb.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
		"href",
		"/workspaces",
	);
});
