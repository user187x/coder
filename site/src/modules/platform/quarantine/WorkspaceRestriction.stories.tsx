import type { Meta, StoryObj } from "@storybook/react-vite";
import { workspaceQuarantineKey } from "#/api/queries/workspaceQuarantine";
import { Avatar } from "#/components/Avatar/Avatar";
import { Table, TableBody, TableCell } from "#/components/Table/Table";
import { MockWorkspace } from "#/testHelpers/entities";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import {
	RestrictedWorkspaceRow,
	WorkspaceRestrictionAvatar,
	WorkspaceRestrictionNotice,
} from "./WorkspaceRestriction";

const meta: Meta<typeof WorkspaceRestrictionNotice> = {
	title: "modules/platform/WorkspaceRestriction",
	component: WorkspaceRestrictionNotice,
	args: { name: MockWorkspace.name },
};
export default meta;
type Story = StoryObj<typeof WorkspaceRestrictionNotice>;
export const Announcement: Story = {};
export const WorkspaceRow: Story = {
	parameters: {
		queries: [
			{
				key: workspaceQuarantineKey(
					MockWorkspace.organization_id,
					MockWorkspace.id,
				),
				data: MockWorkspaceQuarantine,
			},
		],
	},
	render: () => (
		<Table aria-label="Workspaces">
			<TableBody>
				<RestrictedWorkspaceRow workspace={MockWorkspace}>
					<TableCell>
						<WorkspaceRestrictionAvatar workspace={MockWorkspace}>
							<Avatar fallback={MockWorkspace.owner_name} />
						</WorkspaceRestrictionAvatar>
					</TableCell>
					<TableCell>{MockWorkspace.name}</TableCell>
					<TableCell>Locked down or quarantined</TableCell>
				</RestrictedWorkspaceRow>
			</TableBody>
		</Table>
	),
};
