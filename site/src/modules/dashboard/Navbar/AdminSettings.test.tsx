import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter, useLocation } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockPermissions } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { AdminQuickLinksMenu } from "./AdminQuickLinksMenu";
import { AdminSettingsItems } from "./AdminSettings";
import { adminPagesFor } from "./adminQuickLinks";

afterEach(() => vi.restoreAllMocks());

describe("Admin menu", () => {
	it("puts an icon before every item", async () => {
		const pages = adminPagesFor({
			permissions: MockPermissions,
			oauth2Provider: true,
		});
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<DropdownMenu open>
						<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
						<DropdownMenuContent>
							<AdminSettingsItems
								permissions={{
									canViewHud: true,
									canViewOrganizations: true,
									canViewAuditLog: true,
									canViewConnectionLog: true,
								}}
								quickLinks={pages.slice(0, 4)}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
				</MemoryRouter>
			</QueryClientProvider>,
		);
		// the chat entry once the server says the deployment has chat
		await screen.findByRole("menuitem", { name: "Chat" });
		const items = screen.getAllByRole("menuitem");
		const labels = items.map((item) => item.textContent?.trim());
		expect(labels).toEqual([
			...pages.slice(0, 4).map((page) => page.label),
			// each with its trash can (hide under Controls) and move handle
			"Profile",
			"",
			"",
			"Organizations",
			"",
			"",
			"Audit logs",
			"",
			"",
			"Connection logs",
			"",
			"",
			"Controls",
		]);
		for (const item of items.filter(
			(item) => item.textContent !== "Controls",
		)) {
			expect(item.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		}
	});
});

it("hides an item under Controls and shows it again from there", async () => {
	const user = userEvent.setup();
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockResolvedValue({});
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({
		settings_menu_hidden: ["audit-logs"],
	});
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AdminSettingsItems
							permissions={{
								canViewOrganizations: true,
								canViewAuditLog: true,
							}}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await user.click(
		await screen.findByRole("menuitem", {
			name: "Hide Organizations under Controls",
		}),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			settings_menu_hidden: ["audit-logs", "organizations"],
		}),
	);
	await user.click(
		within(screen.getByRole("menuitem", { name: "Controls" })).getByTitle(
			"Controls",
		),
	);
	await user.click(
		await screen.findByRole("menuitem", {
			name: "Show Audit logs in the menu",
		}),
	);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ settings_menu_hidden: [] }),
	);
});

it("sets a quick link's page as the Default View from its right-click options", async () => {
	const user = userEvent.setup();
	const save = vi
		.spyOn(PlatformAPI, "setUserUIPreferences")
		.mockResolvedValue({ settings_default_view: "/deployment/security" });
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	const pages = adminPagesFor({
		permissions: MockPermissions,
		oauth2Provider: true,
	});
	const security = pages.find((page) => page.id === "security");
	if (!security) throw new Error("the Security page is missing");
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AdminSettingsItems permissions={{}} quickLinks={[security]} />
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await user.pointer({
		target: screen.getByRole("menuitem", { name: "Security" }),
		keys: "[MouseRight]",
	});
	await user.click(
		within(screen.getByRole("group", { name: "Security options" })).getByRole(
			"menuitem",
			{ name: "Set Default View" },
		),
	);
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith({
			settings_default_view: "/deployment/security",
		}),
	);
});

it("adds a setting from the inline picker without navigating", async () => {
	const onChange = vi.fn();
	const pages = adminPagesFor({
		permissions: MockPermissions,
		oauth2Provider: true,
	});
	const QuickLinks = () => {
		const [ids, setIds] = useState<string[]>([]);
		return (
			<AdminQuickLinksMenu
				links={pages.filter((page) => ids.includes(page.id))}
				addable={pages.filter((page) => !ids.includes(page.id))}
				onChange={(next) => {
					setIds(next);
					onChange(next);
				}}
			/>
		);
	};
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Menu</DropdownMenuTrigger>
					<DropdownMenuContent>
						<QuickLinks />
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	await user.click(
		within(screen.getByRole("menuitem", { name: "Controls" })).getByTitle(
			"Controls",
		),
	);
	await user.pointer({
		target: screen.getByRole("menuitem", { name: "Chat" }),
		keys: "[MouseRight]",
	});
	await user.click(
		await screen.findByRole("menuitem", {
			name: "Add quick link",
		}),
	);
	expect(onChange).toHaveBeenLastCalledWith(["chat"]);
	const quickLinks = within(screen.getByTestId("quick-links-scroll"));
	expect(quickLinks.getByRole("menuitem", { name: "Chat" })).toBeVisible();
	expect(screen.getAllByRole("menuitem", { name: "Chat" })).toHaveLength(1);
	await user.click(
		quickLinks.getByRole("menuitem", {
			name: "Remove Chat from the quick links",
		}),
	);
	expect(quickLinks.queryByRole("menuitem", { name: "Chat" })).toBeNull();
	expect(screen.getByRole("menuitem", { name: "Chat" })).toBeVisible();
	await user.click(
		screen.getByRole("menuitem", { name: "Add Security to quick links" }),
	);
	expect(onChange).toHaveBeenCalledWith(["security"]);
});

describe("Admin menu right-click options", () => {
	const renderMenu = (onChange = vi.fn()) => {
		const pages = adminPagesFor({
			permissions: MockPermissions,
			oauth2Provider: true,
		});
		const security = pages.find((page) => page.id === "security");
		if (!security) {
			throw new Error("the Security page is missing");
		}
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<DropdownMenu open>
						<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
						<DropdownMenuContent>
							<AdminSettingsItems
								permissions={{ canViewAuditLog: true }}
								quickLinks={[security]}
								quickLinksEditor={{ addable: [], onChange }}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
				</MemoryRouter>
			</QueryClientProvider>,
		);
		return { onChange, user: userEvent.setup() };
	};

	it("offers Open, a link to the same page, on an entry with nothing else", async () => {
		const { user } = renderMenu();
		const entry = screen.getByRole("menuitem", { name: "Audit logs" });
		await user.pointer({ target: entry, keys: "[MouseRight]" });
		const options = screen.getByRole("group", { name: "Audit logs options" });
		const open = within(options).getByRole("menuitem", { name: "Open" });
		expect(open).toHaveAttribute("href", "/audit");
		expect(entry).toHaveAttribute("aria-expanded", "true");
	});

	it("opens the same options with the keyboard's context-menu key", async () => {
		const { user } = renderMenu();
		screen.getByRole("menuitem", { name: "Audit logs" }).focus();
		await user.keyboard("{Shift>}{F10}{/Shift}");
		expect(
			within(
				screen.getByRole("group", { name: "Audit logs options" }),
			).getByRole("menuitem", { name: "Open" }),
		).toHaveAttribute("href", "/audit");
	});

	it("removes a quick link from its options", async () => {
		const { onChange, user } = renderMenu();
		await user.pointer({
			target: screen.getByRole("menuitem", { name: "Security" }),
			keys: "[MouseRight]",
		});
		const options = screen.getByRole("group", { name: "Security options" });
		expect(
			within(options).getByRole("menuitem", { name: "Open" }),
		).toHaveAttribute("href", "/deployment/security");
		await user.click(
			within(options).getByRole("menuitem", {
				name: "Remove from quick links",
			}),
		);
		expect(onChange).toHaveBeenCalledWith([]);
	});

	it("opens Controls from its options as a click does", async () => {
		const { user } = renderMenu();
		const controls = screen.getByRole("menuitem", { name: "Controls" });
		await user.pointer({ target: controls, keys: "[MouseRight]" });
		await user.click(
			within(screen.getByRole("group", { name: "Controls options" })).getByRole(
				"menuitem",
				{ name: "Open" },
			),
		);
		expect(controls).toHaveAttribute("aria-expanded", "true");
	});
});

it("moves Profile among the quick links and saves the whole list's order", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	vi.spyOn(API, "getUserPreferenceSettings").mockResolvedValue({
		admin_sidebar_order: [],
	} as never);
	const save = vi
		.spyOn(API, "updateUserPreferenceSettings")
		.mockImplementation(async (changes) => changes as never);
	const onChange = vi.fn();
	const pages = adminPagesFor({
		permissions: MockPermissions,
		oauth2Provider: true,
	});
	const links = pages.slice(0, 2);
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AdminSettingsItems
							permissions={{}}
							quickLinks={links}
							quickLinksEditor={{ addable: [], onChange }}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	const handle = await screen.findByRole("menuitem", {
		name: "Reorder Profile",
	});
	handle.focus();
	await user.keyboard("{Enter}{ArrowUp}");
	await waitFor(() =>
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				admin_sidebar_order: [links[0].id, "profile", links[1].id],
			}),
		),
	);
	// The quick links themselves keep their order.
	expect(onChange).not.toHaveBeenCalled();
});

it("opens Controls from its icon only, not from the rest of its bar", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getUserUIPreferences").mockResolvedValue({});
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AdminSettingsItems permissions={{}} />
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	const bar = await screen.findByRole("menuitem", { name: "Controls" });
	await user.click(bar);
	expect(bar).toHaveAttribute("aria-expanded", "false");
	await user.click(within(bar).getByTitle("Controls"));
	expect(bar).toHaveAttribute("aria-expanded", "true");
});

it("offers only panel layout actions when Controls has no drawer entries", async () => {
	const user = userEvent.setup();
	vi.spyOn(PlatformAPI, "getChatEnabled").mockResolvedValue({ enabled: false });
	const toggleLayout = vi.fn();
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Admin</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AdminSettingsItems
							permissions={{}}
							topSection={{
								full: false,
								pinned: false,
								onToggle: toggleLayout,
								onPin: vi.fn(),
							}}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	const bar = await screen.findByRole("menuitem", { name: "Controls" });
	await waitFor(() => expect(bar).not.toHaveAttribute("aria-controls"));
	await user.click(within(bar).getByTitle("Controls"));
	expect(bar).not.toHaveAttribute("aria-expanded");
	await user.pointer({ target: bar, keys: "[MouseRight]" });
	const options = screen.getByRole("group", { name: "Controls options" });
	expect(
		within(options).queryByRole("menuitem", { name: /^Open$/ }),
	).toBeNull();
	await user.click(
		within(options).getByRole("menuitem", { name: "Expand to the bottom" }),
	);
	expect(toggleLayout).toHaveBeenCalledOnce();
});

it.each([
	["New account", "/dashboard", "/deployment/users/create"],
	["New Lease", "/deployment/users/create", "/deployment/users?create_lease=1"],
])(
	"opens %s from the Accounts submenu",
	async (label, initialPath, destination) => {
		const accounts = adminPagesFor({
			permissions: {
				...MockPermissions,
				createUser: true,
				editDeploymentConfig: true,
			},
			oauth2Provider: false,
		}).filter((page) => page.id === "accounts");
		const user = userEvent.setup();
		renderComponent(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter initialEntries={[initialPath]}>
					<DropdownMenu open>
						<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
						<DropdownMenuContent>
							<AdminQuickLinksMenu links={accounts} addable={[]} />
						</DropdownMenuContent>
					</DropdownMenu>
					<LocationProbe />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByRole("menuitem", { name: "Accounts" }),
		});
		const submenu = screen.getByRole("group", { name: "Accounts options" });
		await user.click(within(submenu).getByRole("menuitem", { name: label }));
		await screen.findByText(destination, { exact: true });
	},
);

function LocationProbe() {
	const { pathname, search } = useLocation();
	return (
		<output>
			{pathname}
			{search}
		</output>
	);
}
