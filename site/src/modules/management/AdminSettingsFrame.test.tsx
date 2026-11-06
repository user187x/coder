import { screen } from "@testing-library/react";
import { API } from "#/api/api";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { AdminSettingsFrame } from "./AdminSettingsFrame";

const renderAt = (route: string) =>
	renderWithAuth(<AdminSettingsFrame />, {
		path: "/workspaces",
		route,
		children: [{ index: true, element: <h1>Workspaces list</h1> }],
	});

describe("AdminSettingsFrame", () => {
	it("frames the page with the settings menu and breadcrumb for admins", async () => {
		renderAt("/workspaces");
		await screen.findByRole("heading", { name: "Workspaces list" });
		expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute(
			"href",
			"/templates",
		);
		expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("button", { name: "Workspaces" })).toBeDefined();
	});

	it("shows the page alone to non-admins", async () => {
		vi.spyOn(API, "checkAuthorization").mockImplementation(async ({ checks }) =>
			Object.fromEntries(Object.keys(checks).map((key) => [key, false])),
		);
		renderAt("/workspaces");
		await screen.findByRole("heading", { name: "Workspaces list" });
		expect(screen.queryByRole("link", { name: "Templates" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Workspaces" })).toBeNull();
	});
});
