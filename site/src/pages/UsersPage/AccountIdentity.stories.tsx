import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Button } from "#/components/Button/Button";
import { MockUserMember, MockUserOwner } from "#/testHelpers/entities";
import { AccountIdentity } from "./AccountIdentity";

const meta: Meta<typeof AccountIdentity> = {
	title: "pages/UsersPage/AccountIdentity",
	component: AccountIdentity,
	args: {
		user: MockUserOwner,
		expanded: false,
		panelId: "workspace-preview",
		onToggle: fn(),
	},
};
export default meta;
type Story = StoryObj<typeof AccountIdentity>;

export const MixedAccountActions: Story = {
	render: (args) => (
		<div className="flex w-[520px] max-w-full flex-col gap-4">
			<AccountIdentity {...args} />
			<AccountIdentity
				{...args}
				user={MockUserMember}
				panelId="member-workspaces"
			>
				<Button size="sm" variant="outline" onClick={fn()}>
					Chat
				</Button>
			</AccountIdentity>
			<AccountIdentity
				{...args}
				user={{
					...MockUserMember,
					username: "developer-with-a-long-account-name",
					email: "developer-with-a-long-account-name@engineering.example.com",
				}}
				panelId="long-name-workspaces"
			>
				<Button size="sm" variant="outline" onClick={fn()}>
					Chat
				</Button>
			</AccountIdentity>
		</div>
	),
};
