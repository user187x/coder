import { fireEvent, screen } from "@testing-library/react";
import {
	DropdownMenu,
	DropdownMenuContent,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockUserOwner } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { UserSettingsShortcut } from "./UserSettingsShortcut";

it("lists User Settings' sections in the Account button's right-click menu", async () => {
	render(
		<DropdownMenu open>
			<DropdownMenuContent>
				<UserSettingsShortcut user={MockUserOwner} />
			</DropdownMenuContent>
		</DropdownMenu>,
	);
	fireEvent.contextMenu(
		screen.getByRole("menuitem", { name: "Account: User Settings" }),
	);
	const menu = await screen.findByRole("menu", {
		name: "User Settings sections",
	});
	expect(menu).toHaveTextContent("Certificates");
	expect(menu).toHaveTextContent("Secrets");
	expect(menu).toHaveTextContent("SSH Keys");
	expect(menu).not.toHaveTextContent("Appearance");
});
