import { LockIcon } from "lucide-react";
import { useQuery } from "react-query";
import { cloudDriveConnections } from "#/api/queries/platform";
import { useAuthenticated } from "#/hooks/useAuthenticated";

/**
 * A workspace's icon with a small lock over it while the workspace is connected to its owner's Cloud Drive and that
 * drive is encrypted (S3 with the owner's key): every connected workspace reads and writes it encrypted. Only the
 * signed-in user's own workspaces (the drive is theirs alone); the icon as it is otherwise.
 */
export const CloudDriveLockBadge: React.FC<{
	workspaceId: string;
	ownerId: string;
	children: React.ReactNode;
}> = ({ workspaceId, ownerId, children }) => {
	const { user } = useAuthenticated();
	const mine = ownerId === user.id;
	const { data } = useQuery(cloudDriveConnections(mine));
	const locked =
		mine &&
		Boolean(data?.encrypted) &&
		!data?.source &&
		!data?.disconnected.includes(workspaceId) &&
		!data?.shared?.includes(workspaceId);
	if (!locked) {
		return <>{children}</>;
	}
	return (
		<span className="relative inline-flex" data-testid="cloud-drive-lock">
			{children}
			<span
				className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-solid border-border bg-surface-primary text-content-link shadow-sm"
				title="Its Cloud Drive is encrypted with your key"
			>
				<LockIcon aria-hidden className="size-2.5" />
				<span className="sr-only">Cloud Drive encrypted</span>
			</span>
		</span>
	);
};
