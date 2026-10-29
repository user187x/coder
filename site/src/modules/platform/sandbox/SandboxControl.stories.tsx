import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn } from "storybook/test";
import { API } from "#/api/api";
import {
	SandboxAPI,
	sandboxGroups,
	sandboxWorkspaces,
} from "#/api/queries/sandbox";
import { MockWorkspace } from "#/testHelpers/entities";
import { SandboxControl } from "./SandboxControl";

const meta: Meta<typeof SandboxControl> = {
	title: "modules/platform/SandboxControl",
	component: SandboxControl,
	args: { workspace: MockWorkspace },
	beforeEach: ({ parameters }) => {
		const request = spyOn(SandboxAPI, "groups").mockResolvedValue({
			groups: parameters.existing
				? [
						{
							id: "example-group",
							organization_id: MockWorkspace.organization_id,
							workspaces: [{ id: MockWorkspace.id, name: MockWorkspace.name }],
						},
					]
				: [],
		});
		if (parameters.unavailable)
			request.mockRejectedValue(
				new Error("Sandbox policy could not be loaded."),
			);
		if (parameters.loading)
			request.mockImplementation(() => new Promise(() => {}));
		const workspaces = spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: parameters.empty ? [] : [MockWorkspace],
			count: parameters.empty ? 0 : 1,
		});
		return () => {
			request.mockRestore();
			workspaces.mockRestore();
		};
	},
	decorators: [
		(Story) => (
			<div className="max-w-xl p-6">
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof SandboxControl>;
export const ChooseMembers: Story = {
	parameters: {
		queries: [
			{
				key: sandboxGroups(MockWorkspace.organization_id).queryKey,
				data: { groups: [] },
			},
			{
				key: sandboxWorkspaces(MockWorkspace.organization_name).queryKey,
				data: { workspaces: [MockWorkspace], count: 1 },
			},
		],
	},
};
export const ExistingGroup: Story = {
	parameters: {
		existing: true,
		queries: [
			{
				key: sandboxGroups(MockWorkspace.organization_id).queryKey,
				data: {
					groups: [
						{
							id: "example-group",
							organization_id: MockWorkspace.organization_id,
							workspaces: [{ id: MockWorkspace.id, name: MockWorkspace.name }],
						},
					],
				},
			},
			{
				key: sandboxWorkspaces(MockWorkspace.organization_name).queryKey,
				data: { workspaces: [MockWorkspace], count: 1 },
			},
		],
	},
};

export const Empty: Story = { parameters: { empty: true } };
export const Loading: Story = { parameters: { loading: true } };
export const Unavailable: Story = { parameters: { unavailable: true } };
