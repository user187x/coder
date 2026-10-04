import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { SerpentGroup } from "#/api/typesGenerated";
import { docs } from "#/utils/docs";
import { UserAuthSettingsPageView } from "./UserAuthSettingsPageView";

const oidcGroup: SerpentGroup = {
	name: "OIDC",
	description: "",
};

const meta: Meta<typeof UserAuthSettingsPageView> = {
	title: "pages/DeploymentSettingsPage/UserAuthSettingsPageView",
	component: UserAuthSettingsPageView,
	args: {
		options: [
			{
				name: "OIDC Client ID",
				description: "Client ID to use for Login with OIDC.",
				value: "1234",
				group: oidcGroup,
				flag: "oidc",
				flag_shorthand: "o",
				hidden: false,
			},
			{
				name: "OIDC Client Secret",
				description: "Client secret to use for Login with OIDC.",
				value: "",
				value_source: "env",
				env: "CODER_OIDC_CLIENT_SECRET",
				group: oidcGroup,
				flag: "oidc-client-secret",
				annotations: { secret: "true" },
				hidden: false,
			},
			{
				name: "OIDC Allow Signups",
				description: "Whether new users can sign up with OIDC.",
				value: true,
				group: oidcGroup,
				flag: "oidc",
				flag_shorthand: "o",
				hidden: false,
			},
			{
				name: "OIDC Email Domain",
				description:
					"Email domains that clients logging in with OIDC must match.",
				value: "@coder.com",
				group: oidcGroup,
				flag: "oidc",
				flag_shorthand: "o",
				hidden: false,
			},
			{
				name: "OIDC Issuer URL",
				description: "Issuer URL to use for Login with OIDC.",
				value: "https://coder.com",
				group: oidcGroup,
				flag: "oidc",
				flag_shorthand: "o",
				hidden: false,
			},
			{
				name: "OIDC Scopes",
				description: "Scopes to grant when authenticating with OIDC.",
				value: ["idk"],
				group: oidcGroup,
				flag: "oidc",
				flag_shorthand: "o",
				hidden: false,
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof UserAuthSettingsPageView>;

export const Page: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const docsLinks = canvas.getAllByRole("link", { name: /View docs/ });
		await expect(docsLinks).toHaveLength(1);
		await expect(docsLinks[0]).toHaveAttribute(
			"href",
			docs("/admin/users/oidc-auth"),
		);
	},
};
