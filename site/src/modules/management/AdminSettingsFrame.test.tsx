import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
	it("opens the searchable workspace picker from the admin breadcrumb", async () => {
		renderAt("/workspaces");
		await screen.findByRole("heading", { name: "Workspaces list" });
		await userEvent.click(screen.getByRole("button", { name: "Workspaces" }));
		expect(
			await screen.findByRole("link", { name: "Create Workspace" }),
		).toHaveAttribute("href", expect.stringContaining("/workspaces"));
		await userEvent.type(
			screen.getByRole("combobox", { name: "Search workspaces" }),
			"missing workspace",
		);
		expect(
			screen.getByRole("link", { name: "Create Workspace" }),
		).toHaveAttribute("href", expect.stringContaining("create-workspace=1"));
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
