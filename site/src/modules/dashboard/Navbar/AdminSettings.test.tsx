import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
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
			"Controls",
			// each with its button to hide it under Controls
			"Organizations",
			"",
			"Audit logs",
			"",
			"Connection logs",
			"",
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
	await user.click(screen.getByRole("menuitem", { name: "Controls" }));
	await user.click(
		await screen.findByRole("menuitem", {
			name: "Show Audit logs in the menu",
		}),
	);
	await waitFor(() =>
		expect(save).toHaveBeenLastCalledWith({ settings_menu_hidden: [] }),
	);
});

it("adds a setting from the inline picker without navigating", async () => {
	const onChange = vi.fn();
	const pages = adminPagesFor({
		permissions: MockPermissions,
		oauth2Provider: true,
	});
	renderComponent(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<DropdownMenu open>
					<DropdownMenuTrigger>Menu</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AdminQuickLinksMenu
							links={[]}
							addable={pages}
							onChange={onChange}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("menuitem", { name: "Controls" }));
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
