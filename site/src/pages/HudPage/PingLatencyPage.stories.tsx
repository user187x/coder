import type { Meta, StoryObj } from "@storybook/react-vite";
import { clusterMeshKey } from "#/api/clusterNetwork";
import { coderHeartbeat } from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import { MockMeshReport } from "#/testHelpers/clusterNetwork";
import {
	MockPermissions,
	MockUserOwner,
	MockWorkspace,
} from "#/testHelpers/entities";
import { withAuthProvider } from "#/testHelpers/storybook";
import { workspaceLatencyPageSize } from "./LatencyConnections";
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
			{ key: clusterMeshKey, data: MockMeshReport },
			{
				key: workspaces({ limit: workspaceLatencyPageSize, offset: 0 })
					.queryKey,
				data: { workspaces: [MockWorkspace], count: 1 },
			},
		],
	},
};

export default meta;
export const Live: StoryObj<typeof PingLatencyPage> = {};
