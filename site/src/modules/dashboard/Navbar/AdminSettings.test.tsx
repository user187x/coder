import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { MemoryRouter } from "react-router";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockPermissions } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
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
									canViewDeployment: true,
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
			"Settings",
			...pages.slice(0, 4).map((page) => page.label),
			"Organizations",
			"Audit logs",
			"Connection logs",
		]);
		for (const item of items) {
			expect(item.firstElementChild?.tagName.toLowerCase()).toBe("svg");
		}
	});
});
