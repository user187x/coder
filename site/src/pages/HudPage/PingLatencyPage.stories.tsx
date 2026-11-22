import type { Meta, StoryObj } from "@storybook/react-vite";
import { coderHeartbeat } from "#/api/queries/platform";
import { MockPermissions, MockUserOwner } from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import PingLatencyPage from "./PingLatencyPage";

const meta: Meta<typeof PingLatencyPage> = {
	title: "pages/PingLatencyPage",
	component: PingLatencyPage,
	decorators: [withAuthProvider],
	parameters: {
		user: MockUserOwner,
		permissions: MockPermissions,
		queries: [
			{ key: coderHeartbeat().queryKey, data: { latency: 89, previous: 108 } },
		],
	},
};

export default meta;
export const Live: StoryObj<typeof PingLatencyPage> = {};
