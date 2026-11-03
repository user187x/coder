import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { AdminCategoryMenu } from "./AdminCategoryMenu";

it("opens Accounts from the Admin breadcrumb", async () => {
	const { router } = renderWithAuth(<AdminCategoryMenu />);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("link", { name: "Admin Settings" }));
	expect(router.state.location.pathname).toBe("/deployment/users");
});
it("navigates from the right-click category menu", async () => {
	const { router } = renderWithAuth(<AdminCategoryMenu />);
	const user = userEvent.setup();
	await user.pointer({
		target: await screen.findByRole("link", { name: "Admin Settings" }),
		keys: "[MouseRight]",
	});
	await user.click(await screen.findByRole("menuitem", { name: "Appearance" }));
	expect(router.state.location.pathname).toBe("/deployment/customize");
});
