import type { Workspace } from "#/api/typesGenerated";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { WorkspaceSettingsForm } from "./WorkspaceSettingsForm";

type WorkspaceSettingsPageViewProps = {
	error: unknown;
	workspace: Workspace;
	icon: string;
	onCancel: () => void;
	onSubmit: React.ComponentProps<typeof WorkspaceSettingsForm>["onSubmit"];
};

export const WorkspaceSettingsPageView: React.FC<
	WorkspaceSettingsPageViewProps
> = ({ onCancel, onSubmit, error, workspace, icon }) => {
	return (
		<div className="flex flex-col gap-12">
			<SettingsHeader>
				<SettingsHeaderTitle>General</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Update the name, icon and automatic update behavior for this
					workspace.
				</SettingsHeaderDescription>
			</SettingsHeader>

			<WorkspaceSettingsForm
				error={error}
				workspace={workspace}
				icon={icon}
				onCancel={onCancel}
				onSubmit={onSubmit}
			/>
		</div>
	);
};
