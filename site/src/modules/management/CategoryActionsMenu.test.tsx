import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoxIcon, UserPlusIcon } from "lucide-react";
import { MemoryRouter, Route, Routes } from "react-router";
import { NavbarAction } from "#/modules/dashboard/Navbar/NavbarAction";
import { CategoryActionsMenu } from "./CategoryActionsMenu";

it("offers the page's navbar action items from the category's caret", async () => {
	const onCreate = vi.fn();
	render(
		<MemoryRouter initialEntries={["/images"]}>
			<Routes>
				<Route
					path="/images"
					element={
						<>
							<CategoryActionsMenu label="Images" />
							<NavbarAction
								menu={[
									{ label: "New Image", icon: BoxIcon, onSelect: onCreate },
									{ label: "New account", icon: UserPlusIcon, to: "/created" },
								]}
							>
								<button type="button">New Image</button>
							</NavbarAction>
						</>
					}
				/>
				<Route path="/created" element={<p>created page</p>} />
			</Routes>
		</MemoryRouter>,
	);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "Images actions" }));
	await user.click(screen.getByRole("menuitem", { name: "New Image" }));
	expect(onCreate).toHaveBeenCalledOnce();

	await user.click(screen.getByRole("button", { name: "Images actions" }));
	await user.click(screen.getByRole("menuitem", { name: "New account" }));
	expect(screen.getByText("created page")).toBeTruthy();
});
