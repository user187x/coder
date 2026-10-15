import { HardDriveIcon } from "lucide-react";
import { useState } from "react";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	ExpandDiskDialog,
	useWorkspaceVolume,
} from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceVolumeDialogs";

/** The template's parameter for the home disk's size (fixed once the workspace exists). */
export const HOME_DISK_PARAMETER = "home_disk_size";

type HomeDiskActionsProps = {
	workspace: Workspace;
};

/**
 * Platform: under Home disk size on the workspace's parameters. The parameter
 * is only the size the workspace was created with, so this shows the disk's
 * size now and grows it (Expand disk, as in the workspace's ⋮ menu): in place
 * where the storage class can expand volumes (Kubernetes volume expansion),
 * else copied onto a bigger volume.
 */
export const HomeDiskActions: React.FC<HomeDiskActionsProps> = ({
	workspace,
}) => {
	const [open, setOpen] = useState(false);
	const { data } = useWorkspaceVolume(workspace, true);
	const volume = data?.volume;

	return (
		<div
			className="-mt-6 flex flex-wrap items-center gap-3"
			data-testid="home-disk-actions"
		>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={!volume}
				onClick={() => setOpen(true)}
			>
				<HardDriveIcon aria-hidden />
				Expand disk&hellip;
			</Button>
			{volume && (
				<span className="text-xs text-content-secondary">
					Now{" "}
					<strong className="text-content-primary">{volume.sizeGB} GB</strong>{" "}
					on {volume.storageClass || "the default storage class"}:{" "}
					{volume.expandable
						? "it grows in place."
						: "it is copied onto a bigger disk."}
				</span>
			)}
			<ExpandDiskDialog
				workspace={workspace}
				open={open}
				onClose={() => setOpen(false)}
			/>
		</div>
	);
};
