import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";
import { TunnelPortSettings } from "./TunnelPortSettings";

const meta: Meta<typeof TunnelPortSettings> = {
	title: "modules/platform/TunnelPortSettings",
	component: TunnelPortSettings,
	args: {
		tunnel: {
			...MockWorkspaceTunnel,
			revision: 5,
			port_settings_supported: true,
			ports: [{ protocol: "tcp", port: 27182 }],
		},
	},
};
export default meta;
type Story = StoryObj<typeof TunnelPortSettings>;
export const SpecificPorts: Story = {};
export const AllPorts: Story = {
	args: {
		tunnel: {
			...MockWorkspaceTunnel,
			revision: 5,
			port_settings_supported: true,
			ports: null,
		},
	},
};
export const UpgradeRequired: Story = {
	args: {
		tunnel: {
			...MockWorkspaceTunnel,
			revision: 5,
			port_settings_supported: false,
			ports: null,
		},
	},
};
