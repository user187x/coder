import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockPermissions } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { AdminQuickLinksDialog } from "./AdminQuickLinksDialog";
import { adminPagesFor, resolveAdminQuickLinks } from "./adminQuickLinks";

const pages = adminPagesFor({
	permissions: MockPermissions,
	oauth2Provider: false,
	canViewAISettings: true,
});

const renderDialog = (chosen: string[]) => {
	const onSave = vi.fn();
	render(
		<AdminQuickLinksDialog
			pages={pages}
			current={resolveAdminQuickLinks(chosen, pages)}
			isSaving={false}
			error={undefined}
			onSave={onSave}
			onClose={vi.fn()}
		/>,
	);
	return { onSave };
};

const choose = async (slot: string, page: string) => {
	const user = userEvent.setup();
	await user.click(screen.getByRole("combobox", { name: slot }));
	await user.click(await screen.findByRole("option", { name: page }));
};

describe("AdminQuickLinksDialog", () => {
	it("saves the pages chosen for each quick link", async () => {
		const { onSave } = renderDialog([]);
		await choose("Quick link 1", "Network");
		await choose("Quick link 2", "Notifications");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledWith(["network", "notifications"]);
	});

	it("swaps the quick links when a page is chosen that the other one has", async () => {
		const { onSave } = renderDialog(["network", "customize"]);
		await choose("Quick link 1", "Customize");
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledWith(["customize", "network"]);
	});

	it("restores Accounts and Health", async () => {
		const { onSave } = renderDialog(["network", "customize"]);
		await userEvent.click(
			screen.getByRole("button", { name: "Restore defaults" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledWith(["accounts", "health"]);
	});
});
