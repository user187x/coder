import { useQuery } from "react-query";
import { cloudDrivePeers } from "#/api/queries/platform";
import type { User } from "#/api/typesGenerated";
import { AccountShareConnectionsDialog } from "./AccountShareConnectionsDialog";

/** Reviews incoming and outgoing grants for the selected account. */
export const AccountCloudDriveConnections = ({
	user,
	open,
	onOpenChange,
}: {
	user: Pick<User, "id" | "username">;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) => {
	const peers = useQuery(cloudDrivePeers(open));
	return (
		<AccountShareConnectionsDialog
			open={open}
			onOpenChange={onOpenChange}
			accountName={user.username}
			shares={
				peers.data?.admin
					? (peers.data.all ?? []).filter(
							(share) => share.owner === user.id || share.from === user.id,
						)
					: []
			}
			sharingEnabled={peers.data?.admin === true && peers.data.settings.enabled}
			loading={peers.isLoading}
			error={
				peers.error ||
				(peers.data && !peers.data.admin
					? new Error("Only administrators can manage account connections.")
					: undefined)
			}
			onRetry={() => void peers.refetch()}
		/>
	);
};
