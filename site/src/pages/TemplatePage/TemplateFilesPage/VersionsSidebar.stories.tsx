import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { templateVersionsQueryKey } from "#/api/queries/templates";
import {
	MockTemplate,
	MockTemplateVersion,
	MockTemplateVersion2,
} from "#/testHelpers/entities";
import { VersionsSidebar } from "./VersionsSidebar";

const meta: Meta<typeof VersionsSidebar> = {
	title: "pages/TemplateFilesPage/VersionsSidebar",
	component: VersionsSidebar,
	args: {
		template: { ...MockTemplate, active_version_id: MockTemplateVersion.id },
		canUpdate: true,
		shownVersionName: MockTemplateVersion.name,
		onSelect: fn(),
	},
	decorators: [
		(Story) => (
			<div className="w-72">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof VersionsSidebar>;

export const SingleVersion: Story = {
	parameters: {
		queries: [
			{
				key: templateVersionsQueryKey(MockTemplate.id),
				data: [MockTemplateVersion],
			},
		],
	},
};

export const TwoVersions: Story = {
	parameters: {
		queries: [
			{
				key: templateVersionsQueryKey(MockTemplate.id),
				data: [MockTemplateVersion, MockTemplateVersion2],
			},
		],
	},
};

export const ConstrainedSidebar: Story = {
	decorators: [
		(Story) => (
			<div className="flex max-h-[360px] w-60 flex-col gap-3">
				<div className="min-h-0 max-h-[40vh] overflow-auto rounded border border-solid border-border">
					<div className="h-64 p-2 text-sm">Template files</div>
				</div>
				<Story />
			</div>
		),
	],
	parameters: {
		queries: [
			{
				key: templateVersionsQueryKey(MockTemplate.id),
				data: Array.from({ length: 20 }, (_, index) => ({
					...MockTemplateVersion,
					id: `version-${index}`,
					name: `version-${index}`,
				})),
			},
		],
	},
};
