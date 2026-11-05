import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { render } from "#/testHelpers/renderHelpers";
import { AppearanceMenuItem } from "./AppearanceMenuItem";

it.each(["click", "right-click", "keyboard context menu"])(
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
		if (input === "click") {
			await user.click(item);
		} else if (input === "right-click")
			await user.pointer({ target: item, keys: "[MouseRight]" });
		else {
			item.focus();
			await user.keyboard("{Shift>}{F10}{/Shift}");
		}
		if (input !== "click")
			await user.click(screen.getByRole("menuitem", { name: "Personalize" }));
		expect(router.state.location.pathname).toBe("/deployment/customize");
	},
);
