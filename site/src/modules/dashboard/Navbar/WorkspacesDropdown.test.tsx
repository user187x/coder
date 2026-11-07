import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { WorkspacesDropdown } from "./WorkspacesDropdown";

it.each([
	["Dashboard", "/dashboard"],
	["Workspaces", "/workspaces"],
])("opens %s from the Resources menu", async (label, path) => {
	const user = userEvent.setup();
	const router = createMemoryRouter([
		{ path: "*", element: <WorkspacesDropdown /> },
	]);
	renderComponent(<RouterProvider router={router} />);
	await user.click(screen.getByRole("button", { name: /Resources/ }));
	await user.click(await screen.findByRole("menuitem", { name: label }));
	expect(router.state.location.pathname).toBe(path);
});
