import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloudDriveDragCable } from "./CloudDriveCable";

const meta: Meta<typeof CloudDriveDragCable> = {
	title: "modules/platform/CloudDriveCable",
	component: CloudDriveDragCable,
	args: { origin: { x: 250, y: 350 }, pointer: { x: 750, y: 80 } },
};
export default meta;
type Story = StoryObj<typeof CloudDriveDragCable>;
export const TerminalConnector: Story = {
	args: { connectorTarget: () => ({ x: 650, y: 25 }) },
};
export const CloudDrive: Story = {};
