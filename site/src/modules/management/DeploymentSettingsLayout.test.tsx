import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import DeploymentSettingsLayout from "./DeploymentSettingsLayout";

it("hides and restores the category links without resetting the current page", async () => {
	const user = userEvent.setup();
	renderWithAuth(<DeploymentSettingsLayout />, {
		path: "/deployment",
		route: "/deployment/users",
		children: [
			{ path: "users", element: <input aria-label="Account search" /> },
		],
	});
	const search = await screen.findByRole("textbox", { name: "Account search" });
	await user.type(search, "demo");
	const category = screen.getByRole("button", { name: "Accounts" });
	await user.click(screen.getByTitle("Hide categories"));
	await user.click(screen.getByTitle("Show categories"));
	await user.click(category);
	expect(category).toHaveAttribute("aria-expanded", "true");
	await user.dblClick(category);
	expect(screen.queryByRole("link", { name: "Accounts" })).toBeNull();
	const toggle = screen.getByRole("button", { name: "Accounts" });
	expect(toggle).toHaveFocus();
	await user.keyboard("{Enter}");
	expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute(
		"href",
		"/deployment/users",
	);
	expect(search).toHaveValue("demo");
});
