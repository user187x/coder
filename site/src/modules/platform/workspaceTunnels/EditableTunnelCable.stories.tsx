import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { EditableTunnelCable } from "./EditableTunnelCable";
import type { TunnelRoute } from "./tunnelRouting";
import "./workspaceTunnels.css";

const meta: Meta<typeof EditableTunnelCable> = {
	title: "modules/platform/EditableTunnelCable",
	component: EditableTunnelCable,
	args: {
		from: { x: 40, y: 60 },
		to: { x: 300, y: 150 },
		defaultPath: "M40 60 C100 60 240 150 300 150",
		label: "Manage example tunnel",
		onOpen: () => {},
		route: { orthogonal: false, points: [] },
	},
	render: (args) => {
		const [route, setRoute] = useState<TunnelRoute>(args.route);
		return (
			<svg width="400" height="240" aria-label="Editable tunnel example">
				<EditableTunnelCable {...args} route={route} onChange={setRoute} />
			</svg>
		);
	},
};
export default meta;
type Story = StoryObj<typeof EditableTunnelCable>;
export const Curved: Story = {};
export const RightAngles: Story = {
	args: {
		route: {
			orthogonal: true,
			points: [
				{ id: "a", x: 70, y: 40 },
				{ id: "b", x: 150, y: 70 },
			],
		},
	},
};
export const Menu: Story = {
	play: async ({ canvasElement }) => {
		const { within, userEvent } = await import("storybook/test");
		await userEvent.pointer({
			keys: "[MouseRight]",
			target: within(canvasElement).getByRole("button", {
				name: "Manage example tunnel",
			}),
			coords: { clientX: 120, clientY: 100 },
		});
	},
};
