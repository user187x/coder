import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { API } from "#/api/api";
import {
	assignableRole,
	MockAuditorRole,
	MockUserMember,
} from "#/testHelpers/entities";
import { EditAccountDialog } from "./EditAccountDialog";

const meta: Meta<typeof EditAccountDialog> = {
	title: "modules/users/EditAccountDialog",
	component: EditAccountDialog,
	args: { user: MockUserMember, onClose: fn() },
	beforeEach: () => {
		spyOn(API, "getRoles").mockResolvedValue([
			assignableRole(MockAuditorRole, true),
		]);
	},
};
export default meta;
type Story = StoryObj<typeof EditAccountDialog>;
export const Ready: Story = {};
export const SynchronizedRoles: Story = {
	args: {
		rolesReadOnly: true,
		user: { ...MockUserMember, login_type: "oidc" },
	},
};
export const PartialFailure: Story = {
	beforeEach: () => {
		spyOn(API, "updateProfile").mockResolvedValue({
			...MockUserMember,
			name: "Updated name",
		});
		spyOn(API, "updateUserRoles").mockRejectedValue(
			new Error("The last owner role cannot be removed."),
		);
	},
	play: async () => {
		const body = within(document.body);
		await userEvent.clear(body.getByLabelText("Name"));
		await userEvent.type(body.getByLabelText("Name"), "Updated name");
		await userEvent.click(
			await body.findByLabelText("Auditor", { exact: false }),
		);
		await userEvent.click(body.getByRole("button", { name: "Save" }));
	},
};
export const LoadingRoles: Story = {
	beforeEach: () => {
		spyOn(API, "getRoles").mockReturnValue(new Promise(() => {}));
	},
};
export const RolesUnavailable: Story = {
	beforeEach: () => {
		spyOn(API, "getRoles").mockRejectedValue(
			new Error("Could not load assignable roles."),
		);
	},
};
