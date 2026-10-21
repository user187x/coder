import { fireEvent, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import { API } from "#/api/api";
import { getPreferredProxy } from "#/contexts/ProxyContext";
import {
	MockPrimaryWorkspaceProxy,
	MockProxyLatencies,
	MockUserMember,
	MockUserOwner,
} from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import type { AdminSettingsPermissions } from "./AdminSettings";
import { NavbarView } from "./NavbarView";

const proxyContextValue = {
	latenciesLoaded: true,
	proxyLatencies: MockProxyLatencies,
	proxy: getPreferredProxy([MockPrimaryWorkspaceProxy], undefined),
	proxies: [MockPrimaryWorkspaceProxy],
	isLoading: false,
	isFetched: true,
	setProxy: vi.fn(),
	clearProxy: vi.fn(),
	refetchProxyLatencies: () => new Date(),
};

const renderNavbar = (
	adminPermissions: AdminSettingsPermissions,
	user = MockUserOwner,
) =>
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<NavbarView
					user={user}
					supportLinks={[]}
					onSignOut={vi.fn()}
					adminPermissions={adminPermissions}
					proxyContextValue={proxyContextValue}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);

const menuButtons = () =>
	screen
		.getAllByRole("button")
		.filter((button) => button.getAttribute("aria-haspopup") === "menu");

describe("NavbarView", () => {
	beforeEach(() => {
		vi.spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [],
			count: 0,
		});
		vi.spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [],
			unread_count: 0,
		});
	});
	afterEach(() => vi.restoreAllMocks());

	it("has no Controls button of its own: the Controls are in the latency menu", async () => {
		renderNavbar({ canViewDeployment: true, canViewAuditLog: true });
		const withControls = menuButtons().filter((button) =>
			button.textContent?.includes("Controls"),
		);
		const trigger = screen.getByTestId("navbar-latency-controls");
		expect(withControls).toEqual([trigger]);
		expect(screen.getByTestId("navbar-hud-latency")).toContainElement(trigger);
		fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
		const menu = await screen.findByTestId("navbar-latency-controls-menu");
		expect(
			within(menu).getByRole("menuitem", { name: "Settings" }),
		).toBeInTheDocument();
		expect(
			within(menu).getByRole("menuitem", { name: "Audit logs" }),
		).toBeInTheDocument();
	});

	it("gives an auditor the Controls in the latency menu, without the HUD", async () => {
		renderNavbar({ canViewAuditLog: true }, MockUserMember);
		expect(screen.queryByTestId("navbar-hud-latency")).toBeNull();
		const trigger = screen.getByTestId("navbar-latency-controls");
		expect(trigger).toHaveTextContent("Controls");
		fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
		const menu = await screen.findByTestId("navbar-latency-controls-menu");
		expect(
			within(menu).getByRole("menuitem", { name: "Audit logs" }),
		).toBeInTheDocument();
		expect(
			within(menu).queryByRole("menuitem", { name: "Settings" }),
		).toBeNull();
	});

	it("gives a member the latency menu, without Controls", () => {
		renderNavbar({}, MockUserMember);
		expect(screen.getByTestId("navbar-latency-controls")).not.toHaveTextContent(
			"Controls",
		);
	});

	it("puts the logo in the same tile as the user's avatar", () => {
		renderNavbar({});
		const logo = screen.getByTestId("navbar-logo");
		const userMenu = screen.getByRole("button", { name: "User menu" });
		// the same trigger round the same tile (an Avatar of size lg)
		expect(new Set(logo.classList)).toEqual(new Set(userMenu.classList));
		const tile = screen.getByTestId("navbar-logo-tile");
		const avatar = userMenu.firstElementChild as HTMLElement;
		// inset as an uploaded (or the default) avatar is: this user has none here
		const without = (el: HTMLElement) =>
			new Set([...el.classList].filter((c) => c !== "p-0.5"));
		expect(without(tile)).toEqual(without(avatar));
		expect(tile).toHaveClass("p-0.5");
	});
});
