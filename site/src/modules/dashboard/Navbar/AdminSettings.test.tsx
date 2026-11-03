import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
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

describe("Admin menu", () => {
	it("puts an icon before every item", () => {
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
		const items = screen.getAllByRole("menuitem");
		const labels = items.map((item) => item.textContent?.trim());
		expect(labels).toEqual([
			...pages.slice(0, 4).map((page) => page.label),
			"Controls",
			"Organizations",
			"Audit logs",
			"Connection logs",
		]);
		for (const item of items.filter(
			(item) => item.textContent !== "Controls",
		)) {
			expect(item.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		}
	});
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
	await user.click(screen.getByRole("menuitem", { name: "Security" }));
	expect(onChange).toHaveBeenCalledWith(["security"]);
});
