import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { mockApiError } from "#/testHelpers/entities";
import { AccountForm } from "./AccountForm";

const meta: Meta<typeof AccountForm> = {
	title: "pages/UserSettingsPage/AccountForm",
	component: AccountForm,
	args: {
		emailEditable: true,
		email: "test-user@org.com",
		isLoading: false,
		initialValues: {
			username: "test-user",
			name: "Test User",
			avatar_url: "",
		},
		updateProfileError: undefined,
	},
};

export default meta;
type Story = StoryObj<typeof AccountForm>;

export const Example: Story = {};

export const Loading: Story = {
	args: {
		isLoading: true,
	},
};

export const WithError: Story = {
	args: {
		updateProfileError: mockApiError({
			message: "Username is invalid",
			validations: [
				{
					field: "username",
					detail: "Username is too long.",
				},
			],
		}),
		initialTouched: {
			username: true,
		},
	},
};

export const Editable: Story = {
	args: {
		editable: true,
	},
};

export const ProviderManagedEmail: Story = {
	args: {
		emailEditable: false,
		providerAccountURL: "https://sso.example.test/realms/coder/account/",
	},
};

export const ChangingEmail: Story = {
	play: async ({ canvasElement }) => {
		const email = within(canvasElement).getByLabelText("Email");
		await userEvent.clear(email);
		await userEvent.type(email, "updated@example.test");
	},
};
