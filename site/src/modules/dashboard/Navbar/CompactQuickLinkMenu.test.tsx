import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { MockPermissions } from "#/testHelpers/entities";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { adminPagesFor } from "./adminQuickLinks";
import { CompactQuickLinks } from "./CompactQuickLinkMenu";

const pages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: true,
});
const [first, second, third] = pages;

const renderStrip = (onChange = vi.fn()) => {
	if (!first || !second || !third) throw new Error("too few admin pages");
	renderComponent(
		<MemoryRouter>
			<DropdownMenu open>
				<DropdownMenuTrigger>Settings</DropdownMenuTrigger>
				<DropdownMenuContent>
					<CompactQuickLinks
						links={[first, second]}
						pages={pages}
						onChange={onChange}
						onChat={vi.fn()}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</MemoryRouter>,
	);
	return { onChange, first, second, third };
};

it("removes a quick link from the thin strip's right-click menu", async () => {
	const user = userEvent.setup();
	const { onChange, first, second } = renderStrip();
	fireEvent.contextMenu(screen.getByRole("menuitem", { name: first.label }));
	await user.click(
		await screen.findByRole("menuitem", { name: "Remove from quick links" }),
	);
	expect(onChange).toHaveBeenCalledWith([second.id]);
});

it("puts another page in a quick link's place from its right-click menu", async () => {
	const user = userEvent.setup();
	const { onChange, first, second, third } = renderStrip();
	fireEvent.contextMenu(screen.getByRole("menuitem", { name: first.label }));
	await user.click(await screen.findByRole("menuitem", { name: third.label }));
	expect(onChange).toHaveBeenCalledWith([third.id, second.id]);
});
