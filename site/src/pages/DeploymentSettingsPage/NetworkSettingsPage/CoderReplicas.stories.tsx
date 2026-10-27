import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "react-query";
import { coderScaleKey } from "#/api/clusterNetwork";
import { CoderReplicas } from "./CoderReplicas";

const meta = {
	title: "pages/DeploymentSettingsPage/NetworkSettingsPage/CoderReplicas",
	component: CoderReplicas,
	decorators: [
		(Story) => {
			const client = new QueryClient({
				defaultOptions: { queries: { enabled: false } },
			});
			client.setQueryData(coderScaleKey, {
				desired: 2,
				ready: 2,
				resourceVersion: "4",
				automated: false,
			});
			return (
				<QueryClientProvider client={client}>
					<Story />
				</QueryClientProvider>
			);
		},
	],
} satisfies Meta<typeof CoderReplicas>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
