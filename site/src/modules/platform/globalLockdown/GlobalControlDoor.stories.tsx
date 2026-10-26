import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { GlobalControlsAPI } from "#/api/globalLockdown";
import { globalControlsKey } from "#/api/queries/globalLockdown";
import { Button } from "#/components/Button/Button";
import {
	MockGlobalControlGrant,
	MockGlobalControlStatus,
	MockGlobalLockdownState,
} from "#/testHelpers/globalLockdown";
import { GlobalControlDoor } from "./GlobalControlDoor";
import { GlobalLockdownCardView } from "./GlobalLockdown";

const meta: Meta<typeof GlobalControlDoor> = {
	title: "modules/platform/GlobalControlDoor",
	component: GlobalControlDoor,
	args: {
		onUnlock: fn(),
		children: (
			<>
				<Button>Lock</Button>
				<Button>Shut Down</Button>
				<Button variant="destructive">Terminate</Button>
			</>
		),
	},
	parameters: {
		queries: [{ key: globalControlsKey, data: MockGlobalControlStatus }],
	},
	beforeEach: () => {
		spyOn(GlobalControlsAPI, "get").mockResolvedValue(MockGlobalControlStatus);
		spyOn(GlobalControlsAPI, "unlock").mockResolvedValue(
			MockGlobalControlGrant,
		);
		spyOn(GlobalControlsAPI, "configure").mockResolvedValue(
			MockGlobalControlGrant,
		);
		spyOn(GlobalControlsAPI, "close").mockResolvedValue(
			MockGlobalControlStatus,
		);
	},
};
export default meta;
type Story = StoryObj<typeof GlobalControlDoor>;
export const Closed: Story = {};
export const Setup: Story = {
	parameters: {
		queries: [
			{
				key: globalControlsKey,
				data: { ...MockGlobalControlStatus, configured: false },
			},
		],
	},
	beforeEach: () => {
		spyOn(GlobalControlsAPI, "get").mockResolvedValue({
			...MockGlobalControlStatus,
			configured: false,
		});
	},
};
export const Opened: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("Six-digit admin PIN"),
			"482619",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Unlock controls" }),
		);
	},
};
export const IncorrectPIN: Story = {
	beforeEach: () => {
		spyOn(GlobalControlsAPI, "unlock").mockRejectedValue(
			new Error("Incorrect admin PIN."),
		);
	},
	play: Opened.play,
};
export const CompleteCard: Story = {
	render: (args) => (
		<GlobalLockdownCardView
			state={MockGlobalLockdownState}
			onChange={fn()}
			renderActionPanel={(actions) => (
				<GlobalControlDoor {...args}>{actions}</GlobalControlDoor>
			)}
		/>
	),
};
