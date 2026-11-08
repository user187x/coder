import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceSlotsBar } from "./WorkspaceCards";

const running = { label: "Running", value: 1, fill: "bg-highlight-green" };
const stopped = { label: "Stopped", value: 1, fill: "bg-content-secondary" };

const meta: Meta<typeof WorkspaceSlotsBar> = {
	title: "pages/DashboardPage/WorkspaceSlotsBar",
	component: WorkspaceSlotsBar,
	decorators: [
		(Story) => (
			<div className="w-80 p-4">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof WorkspaceSlotsBar>;

export const TwoAllowedOneUsed: Story = {
	args: { segments: [running], limit: 2 },
};

export const FiveAllowedTwoUsed: Story = {
	args: { segments: [running, stopped], limit: 5 },
};

export const AllUsed: Story = {
	args: { segments: [running, stopped], limit: 2 },
};

export const Unbounded: Story = {
	args: { segments: [running, stopped], limit: null },
};
