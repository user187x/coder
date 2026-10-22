import { screen } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { MockBuildInfo, MockPermissions } from "#/testHelpers/entities";
import { renderWithRouter } from "#/testHelpers/renderHelpers";
import { DeploymentSidebarView } from "./DeploymentSidebarView";

describe("DeploymentSidebarView", () => {
	it("shows each category's quick-link icon before its name", async () => {
		renderWithRouter(
			createMemoryRouter(
				[
					{
						path: "*",
						element: (
							<DeploymentSidebarView
								permissions={MockPermissions}
								buildInfo={{ ...MockBuildInfo, oauth2_provider: true }}
							/>
						),
					},
				],
				{ initialEntries: ["/deployment/network"] },
			),
		);

		const links = await screen.findAllByRole("link");
		// Online Users (a card of the Chat page) and Overview (its rows in Network) are gone; Quick Menu is new
		expect(links).toHaveLength(15);
		expect(
			links.find((link) => link.textContent?.includes("Quick Menu")),
		).toHaveAttribute("href", "/deployment/quick-menu");
		for (const link of links) {
			expect(link.querySelector("svg.lucide")).not.toBeNull();
		}
	});
});
