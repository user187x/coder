import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn, userEvent, within } from "storybook/test";
import {
	MockUserMember,
	MockUserOwner,
	SuspendedMockUser,
} from "#/testHelpers/entities";
import { withToaster } from "#/testHelpers/storybook";
import { UserActionDialogs, type UserAdminAction } from "./UserActionDialogs";
import { UserMoreActions } from "./UserMoreActions";

const UserMoreActionsWithDialogs: React.FC<
	React.ComponentProps<typeof UserMoreActions>
> = ({ onAction, ...props }) => {
	const [action, setAction] = useState<UserAdminAction>();

	return (
		<>
			<UserMoreActions
				{...props}
				onAction={(next) => {
					onAction(next);
					setAction(next);
				}}
			/>
			<UserActionDialogs action={action} onClose={() => setAction(undefined)} />
		</>
	);
};

const meta: Meta<typeof UserMoreActions> = {
	title: "modules/users/UserMoreActions",
	component: UserMoreActions,
	decorators: [withToaster],
	args: {
		user: MockUserMember,
		me: MockUserOwner.id,
		canViewActivity: true,
		onAction: fn(),
	},
};

export default meta;
type Story = StoryObj<typeof UserMoreActions>;

const openMenu: NonNullable<Story["play"]> = async ({ canvasElement }) => {
	await userEvent.click(
		within(canvasElement).getByRole("button", { name: /open menu/i }),
	);
};
export const OpenMenu: Story = { play: openMenu };
export const WithoutActivity: Story = {
	args: { canViewActivity: false },
	play: openMenu,
};
export const Suspended: Story = {
	args: { user: SuspendedMockUser },
	play: openMenu,
};
export const CannotDeleteSelf: Story = {
	args: { user: MockUserOwner, me: MockUserOwner.id },
	play: openMenu,
};
export const OidcRoleSync: Story = {
	args: {
		user: { ...MockUserMember, login_type: "oidc" },
		oidcRoleSyncEnabled: true,
	},
	render: (args) => <UserMoreActionsWithDialogs {...args} />,
	play: async (context) => {
		await openMenu(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", { name: "Edit" }),
		);
	},
};
