import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { render } from "#/testHelpers/renderHelpers";
import { AppearanceMenuItem } from "./AppearanceMenuItem";

it.each(["right-click", "keyboard context menu", "Personalize"])(
	"navigates to deployment appearance using %s",
	async (input) => {
		const { router } = render(
			<DropdownMenu defaultOpen>
				<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
				<DropdownMenuContent>
					<AppearanceMenuItem to="/deployment/customize" />
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		const user = userEvent.setup();
		const item = screen.getByRole("menuitem", { name: "Appearance" });
		if (input === "Personalize") {
			await user.click(item);
			await user.click(screen.getByRole("menuitem", { name: "Personalize" }));
		} else if (input === "right-click")
			await user.pointer({ target: item, keys: "[MouseRight]" });
		else {
			item.focus();
			await user.keyboard("{Shift>}{F10}{/Shift}");
		}
		expect(router.state.location.pathname).toBe("/deployment/customize");
	},
);
