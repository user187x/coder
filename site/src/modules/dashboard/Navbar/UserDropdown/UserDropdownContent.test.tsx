import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { API } from "#/api/api";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import {
	MockUserAppearanceSettings,
	MockUserOwner,
} from "#/testHelpers/entities";
import { render, waitForLoaderToBeRemoved } from "#/testHelpers/renderHelpers";
import { UserDropdownContent } from "./UserDropdownContent";

const renderUserDropdownContent = (props: {
	onSignOut: () => void;
	profileExtra?: React.ReactNode;
}) => {
	return render(
		<DropdownMenu defaultOpen>
			<DropdownMenuTrigger>Open</DropdownMenuTrigger>
			<DropdownMenuContent>
				<UserDropdownContent
					user={MockUserOwner}
					onSignOut={props.onSignOut}
					profileExtra={props.profileExtra}
					supportLinks={[]}
				/>
			</DropdownMenuContent>
		</DropdownMenu>,
	);
};

describe("UserDropdownContent", () => {
	it("has the correct link for the account item", async () => {
		renderUserDropdownContent({ onSignOut: vi.fn() });
		await waitForLoaderToBeRemoved();

		const link = screen.getByText("Account").closest("a");
		if (!link) {
			throw new Error("Anchor tag not found for the account menu item");
		}

		expect(link.getAttribute("href")).toBe("/settings/account");
	});

	it("calls the onSignOut function", async () => {
		const onSignOut = vi.fn();
		renderUserDropdownContent({ onSignOut });
		await waitForLoaderToBeRemoved();
		screen.getByText("Sign Out").click();
		expect(onSignOut).toBeCalledTimes(1);
	});

	it("renders the profile extra content when provided", async () => {
		renderUserDropdownContent({
			onSignOut: vi.fn(),
			profileExtra: <div>AI spend - $819 / $1,200 USD</div>,
		});
		await waitForLoaderToBeRemoved();

		expect(
			screen.getByText("AI spend - $819 / $1,200 USD"),
		).toBeInTheDocument();
	});

	it("switches between the dark and light themes from Dark Mode", async () => {
		const update = vi.spyOn(API, "updateAppearanceSettings").mockResolvedValue({
			...MockUserAppearanceSettings,
			theme_preference: "light",
		});
		renderUserDropdownContent({ onSignOut: vi.fn() });
		await waitForLoaderToBeRemoved();

		await userEvent.click(
			screen.getByRole("menuitemcheckbox", { name: "Dark Mode" }),
		);

		await waitFor(() =>
			expect(update).toHaveBeenCalledWith(
				expect.objectContaining({
					theme_preference: "light",
					theme_mode: "single",
				}),
			),
		);
	});

	it("has no Avatar item (the avatar is changed in Settings > Account)", async () => {
		renderUserDropdownContent({ onSignOut: vi.fn() });
		await waitForLoaderToBeRemoved();

		expect(
			screen.queryByRole("menuitem", { name: "Avatar" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("menuitem", { name: "Account" }),
		).toBeInTheDocument();
	});
});
