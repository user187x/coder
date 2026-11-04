import type { Meta, StoryObj } from "@storybook/react-vite";
import { LOGIN_PAGE_DEFAULT } from "#/api/platform";
import { backgroundsKey } from "#/api/queries/backgrounds";
import {
	animationPolicy,
	loginPageKey,
	logoKey,
	navbarAppearance,
} from "#/api/queries/platform";
import { myAppearanceKey } from "#/api/queries/users";
import { DEFAULT_ANIMATION_POLICY } from "#/hooks/useAnimationSettings";
import { MockBackgrounds } from "#/testHelpers/appearance";
import { MockUserAppearanceSettings } from "#/testHelpers/entities";
import { MockLogo } from "#/testHelpers/platform";
import CustomizeSettingsPage from "./CustomizeSettingsPage";

const meta: Meta<typeof CustomizeSettingsPage> = {
	title: "pages/DeploymentSettingsPage/CustomizeSettingsPage/Page",
	component: CustomizeSettingsPage,
	render: () => (
		<div className="mx-auto max-w-6xl p-6">
			<CustomizeSettingsPage />
		</div>
	),
	parameters: {
		layout: "fullscreen",
		queries: [
			{ key: logoKey, data: MockLogo },
			{
				key: navbarAppearance().queryKey,
				data: { transparency: 45, scale: 110, wireframe: false },
			},
			{ key: animationPolicy().queryKey, data: DEFAULT_ANIMATION_POLICY },
			{
				key: loginPageKey,
				data: {
					...LOGIN_PAGE_DEFAULT,
					headingMode: "none",
					message: "Welcome to your workspace.",
				},
			},
			{
				key: backgroundsKey,
				data: {
					...MockBackgrounds,
					login: {
						...MockBackgrounds.login,
						url: "/pictures/destructed-cube.png",
						opacity: 0.7,
					},
				},
			},
			{ key: myAppearanceKey, data: MockUserAppearanceSettings },
		],
	},
};
export default meta;
type Story = StoryObj<typeof CustomizeSettingsPage>;
export const Default: Story = {};
export const Mobile: Story = { globals: { viewport: { value: "iphone12" } } };
