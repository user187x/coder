import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { AdminSettingsFrame } from "./AdminSettingsFrame";

const renderAt = (route: string) =>
	renderWithAuth(<AdminSettingsFrame />, {
		path: "/",
		route,
		children: [
			{ path: "workspaces", element: <h1>Workspaces list</h1> },
			{ path: "deployment/users", element: <h1>Accounts list</h1> },
		],
	});

describe("AdminSettingsFrame", () => {
	it("navigates from the Workspaces breadcrumb to another admin category", async () => {
		const user = userEvent.setup();
		const { router } = renderAt("/workspaces");
		await screen.findByRole("heading", { name: "Workspaces list" });
		await user.click(screen.getByRole("button", { name: "Workspaces" }));
		await user.click(await screen.findByRole("link", { name: "Accounts" }));
		expect(router.state.location.pathname).toBe("/deployment/users");
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
