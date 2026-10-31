import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PromptCat, PromptEcho } from "./PromptEffects";

const meta: Meta<typeof PromptCat> = {
	title: "modules/platform/AnnouncementPromptEffects",
	component: PromptCat,
	args: { onDone: fn() },
	decorators: [
		(Story) => (
			<div className="relative w-[600px] max-w-full rounded-xl bg-surface-secondary p-4 font-mono text-content-primary">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof PromptCat>;
export const Cat: Story = {};
export const Echo: Story = { render: () => <PromptEcho /> };
