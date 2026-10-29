import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type {
	WorkspaceAgentMetadataDescription,
	WorkspaceAgentMetadataResult,
} from "#/api/typesGenerated";
import {
	MockWorkspaceInfrastructureMetrics,
	MockWorkspaceMetricMetadata,
} from "#/testHelpers/workspaceMetrics";
import { AgentMetadataView } from "./AgentMetadata";

const meta: Meta<typeof AgentMetadataView> = {
	title: "modules/resources/AgentMetadataView",
	component: AgentMetadataView,
};

export default meta;
type Story = StoryObj<typeof AgentMetadataView>;

const resultDefaults: WorkspaceAgentMetadataResult = {
	collected_at: "2021-05-05T00:00:00Z",
	error: "",
	value: "defvalue",
	age: 5,
};

const descriptionDefaults: WorkspaceAgentMetadataDescription = {
	display_name: "DisPlay",
	key: "defkey",
	interval: 10,
	timeout: 10,
	script: "some command",
};

const Example: Story = {
	args: {
		metadata: [
			{
				result: {
					...resultDefaults,
					value: "110%",
				},
				description: {
					...descriptionDefaults,
					display_name: "CPU",
					key: "CPU",
				},
			},
			{
				result: {
					...resultDefaults,
					value: "50GB",
				},
				description: {
					...descriptionDefaults,
					display_name: "Memory",
					key: "Memory",
				},
			},
			{
				result: {
					...resultDefaults,
					value: "stale value",
					age: 300,
				},
				description: {
					...descriptionDefaults,
					interval: 5,
					display_name: "Stale",
					key: "stale",
				},
			},
			{
				result: {
					...resultDefaults,
					value: "oops",
					error: "fatal error",
				},
				description: {
					...descriptionDefaults,
					display_name: "Error",
					key: "error",
				},
			},
			{
				result: {
					...resultDefaults,
					value: "",
					collected_at: "0001-01-01T00:00:00Z",
					age: 1000000,
				},
				description: {
					...descriptionDefaults,
					display_name: "Never loads",
					key: "nloads",
				},
			},
			{
				result: {
					...resultDefaults,
					value: "r".repeat(1000),
				},
				description: {
					...descriptionDefaults,
					display_name: "Really, really big",
					key: "big",
				},
			},
		],
	},
};

export { Example as AgentMetadata };

export const WorkspaceAndNode: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		scope: "node",
		onScopeChange: fn(),
		historyScope: "story-node",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};
export const WorkspaceAndCluster: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		scope: "cluster",
		onScopeChange: fn(),
		historyScope: "story-cluster",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};
export const InfrastructureLoading: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructureLoading: true,
		onScopeChange: fn(),
		historyScope: "story-loading",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};
export const InfrastructureUnavailable: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructureError: new Error("Workspace node could not be located"),
		onScopeChange: fn(),
		historyScope: "story-error",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};
export const InfrastructureRefetchError: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		infrastructureError: new Error(
			"Node metrics refresh failed; showing previous readings",
		),
		onScopeChange: fn(),
		historyScope: "story-refetch",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};

export const NoWorkspaceReadings: Story = {
	args: {
		metadata: [],
		workspaceName: "my-workspace",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		scope: "node",
		onScopeChange: fn(),
		historyScope: "story-empty",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};

export const CompactCapacities: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructure: {
			...MockWorkspaceInfrastructureMetrics,
			allocation: {
				...MockWorkspaceInfrastructureMetrics.allocation,
				cpu: 0.25,
				memory: 6 * 1024 ** 3,
				disk: 20000000000,
				diskEnforced: false,
				source: {
					cpu: "container-limit",
					memory: "container-limit",
					disk: "pvc-capacity",
				},
			},
			node: {
				...MockWorkspaceInfrastructureMetrics.node,
				cpu: { ...MockWorkspaceInfrastructureMetrics.node.cpu, total: 7.5 },
				memory: {
					...MockWorkspaceInfrastructureMetrics.node.memory,
					total: 20171026432,
				},
				disk: {
					...MockWorkspaceInfrastructureMetrics.node.disk,
					total: 1003736440832,
				},
			},
		},
		scope: "node",
		onScopeChange: fn(),
		historyScope: "story-compact",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};

export const NarrowWorkspaceMetrics: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "long-workspace-name-to-check-container-sizing",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		scope: "node",
		onScopeChange: fn(),
		historyScope: "story-narrow",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
	decorators: [
		(Story) => (
			<div className="w-[320px] max-w-full">
				<Story />
			</div>
		),
	],
};
export const ConstrainedWorkspaceMetrics: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		scope: "cluster",
		onScopeChange: fn(),
		historyScope: "story-constrained",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
	decorators: [
		(Story) => (
			<div className="w-[560px] max-w-full">
				<Story />
			</div>
		),
	],
};

export const RestrictedInfrastructure: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "my-workspace",
		infrastructure: {
			...MockWorkspaceInfrastructureMetrics,
			infrastructureRestricted: true,
			nodeName: null,
			node: null,
			cluster: null,
			nodeCount: null,
		},
		historyScope: "story-restricted",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};

export const VMWorkspaceAllocation: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "isolated-vm",
		infrastructure: {
			...MockWorkspaceInfrastructureMetrics,
			infrastructureRestricted: true,
			nodeName: null,
			node: null,
			cluster: null,
			nodeCount: null,
			allocation: {
				cpu: 2,
				memory: 2147483648,
				memoryReserved: 268435456,
				memoryUsable: 1879048192,
				disk: 20000000000,
				diskEnforced: true,
				source: {
					cpu: "vm-topology",
					memory: "vm-memory",
					disk: "guest-block-capacity",
				},
			},
		},
		historyScope: "story-vm-assignment",
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
	},
};

export const SharedHistory: Story = {
	args: {
		metadata: MockWorkspaceMetricMetadata,
		workspaceName: "dataflow",
		infrastructure: MockWorkspaceInfrastructureMetrics,
		now: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		pausedAt: Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt),
		persistedHistory: Object.fromEntries(
			MockWorkspaceMetricMetadata.map((metric) => [
				metric.description.key,
				Array.from({ length: 40 }, (_, index) => {
					const t =
						Date.parse(MockWorkspaceInfrastructureMetrics.generatedAt) -
						(39 - index) * 1000;
					return {
						at: new Date(t).toISOString(),
						t,
						value: 20 + (index % 10),
						text: `${20 + (index % 10)}%`,
					};
				}),
			]),
		),
	},
};
