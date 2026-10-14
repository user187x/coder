import { screen } from "@testing-library/react";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
	it("shows an icon before every page of the account view", async () => {
		renderWithAuth(<Sidebar />);
		await screen.findByRole("link", { name: "Account" });
		const links = screen.getAllByRole("link");
		expect(links.map((link) => link.textContent)).toEqual(
			expect.arrayContaining([
				"Account",
				"Security",
				"SSH Keys",
				"Tokens",
				"Secrets",
				"Certificates",
				"Notifications",
			]),
		);
		for (const link of links) {
			expect(link.querySelector("svg.lucide")).not.toBeNull();
		}
	});
});
