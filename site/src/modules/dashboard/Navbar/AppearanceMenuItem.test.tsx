import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { render } from "#/testHelpers/renderHelpers";
import { AppearanceMenuItem } from "./AppearanceMenuItem";

it.each(["pointer", "keyboard"])(
	"navigates to deployment appearance using the %s context action",
	async (input) => {
		const { router } = render(
			<DropdownMenu defaultOpen>
				<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
				<DropdownMenuContent>
					<AppearanceMenuItem />
				</DropdownMenuContent>
			</DropdownMenu>,
		);
		const user = userEvent.setup();
		const item = screen.getByRole("menuitem", { name: "Appearance" });
		if (input === "pointer")
			await user.pointer({ target: item, keys: "[MouseRight]" });
		else {
			item.focus();
			await user.keyboard("{Shift>}{F10}{/Shift}");
		}
		expect(router.state.location.pathname).toBe("/deployment/customize");
	},
);
