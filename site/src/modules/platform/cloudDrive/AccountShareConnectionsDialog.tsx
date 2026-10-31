import { PlugIcon, UnplugIcon } from "lucide-react";
import { useMutation, useQueryClient } from "react-query";
import type { CloudDriveShare } from "#/api/platform";
import { setCloudDriveShareConnection } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { sharedThing } from "./CloudDrivePeers";

/** Existing account grants retain their original access level when reconnected. */
export const AccountShareConnectionsDialog: React.FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shares: readonly CloudDriveShare[];
	shareId?: string;
	ownerId?: string;
	recipientId?: string;
	sharingEnabled: boolean;
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	accountName?: string;
}> = ({
	open,
	onOpenChange,
	shares,
	shareId,
	ownerId,
	recipientId,
	sharingEnabled,
	loading,
	error,
	onRetry,
	accountName,
}) => {
	const queryClient = useQueryClient();
	const change = useMutation(setCloudDriveShareConnection(queryClient));
	const connections = shares.filter(
		(share) =>
			(!shareId || share.id === shareId) &&
			(!ownerId || share.owner === ownerId) &&
			(!recipientId || share.from === recipientId) &&
			(share.state === "active" || share.reconnectable),
	);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Cloud Drive connections{accountName ? `: ${accountName}` : ""}
					</DialogTitle>
					<DialogDescription>
						Connect or disconnect existing shares between accounts. Reconnecting
						preserves the original files and access level. Workspace mounts may
						need a restart to reflect changes.
					</DialogDescription>
				</DialogHeader>
				{change.error ? <ErrorAlert error={change.error} /> : null}
				{error ? (
					<>
						<ErrorAlert error={error} />
						{onRetry && (
							<Button size="sm" variant="outline" onClick={onRetry}>
								Retry connections
							</Button>
						)}
					</>
				) : null}
				{!sharingEnabled && !loading && !error && (
					<p role="status" className="m-0 text-sm text-content-secondary">
						Sharing is disabled. Enable it in Cloud Drive settings before
						reconnecting a share.
					</p>
				)}
				{loading ? (
					<p role="status">Loading connections…</p>
				) : connections.length === 0 && !error ? (
					<p className="m-0 text-sm text-content-secondary">
						{ownerId && recipientId
							? "No existing share between these accounts. Create or approve the share in Cloud Drive before connecting it."
							: accountName
								? "No existing connections for this account."
								: "No existing connections on this page."}
					</p>
				) : (
					<ul className="m-0 flex list-none flex-col gap-3 p-0">
						{connections.map((share) => {
							const connected = share.state === "active";
							const description = `${share.ownerName}'s ${sharedThing(share)} for ${share.fromName}`;
							return (
								<li key={share.id} className="flex items-center gap-3">
									<div className="min-w-0 flex-1 text-sm">
										<p className="m-0 break-words font-medium">{description}</p>
										<p className="m-0 text-content-secondary">
											{share.access === "write"
												? "Read and write"
												: "Read only"}
											·{connected ? "Connected" : "Disconnected"}
										</p>
									</div>
									<Button
										size="sm"
										variant="outline"
										aria-label={`${connected ? "Disconnect" : "Connect"} ${description}`}
										disabled={
											change.isPending ||
											Boolean(error) ||
											(!connected && !sharingEnabled)
										}
										onClick={() =>
											change.mutate({ id: share.id, connected: !connected })
										}
									>
										{connected ? <UnplugIcon /> : <PlugIcon />}
										{connected ? "Disconnect" : "Connect"}
									</Button>
								</li>
							);
						})}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
};
