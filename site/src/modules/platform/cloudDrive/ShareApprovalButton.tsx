import {
	ChevronDownIcon,
	CloudIcon,
	FolderSearchIcon,
	XIcon,
} from "lucide-react";
import { useQuery } from "react-query";
import { useNavigate } from "react-router";
import type { CloudDriveShare } from "#/api/platform";
import { cloudDrivePeers } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { userCloudDriveHref } from "#/modules/users/userPlaces";
import { sharedThing, useShareActions } from "./CloudDrivePeers";
import { openPath } from "./sharedWithYou";

/** "bob's Cloud Drive for ann (read only)". */
export const shareWords = (s: CloudDriveShare) =>
	`${s.ownerName}'s ${sharedThing(s)} for ${s.fromName} (${s.access === "write" ? "read and write" : "read only"})`;

/** Where an admin inspects what a share would give: the owner's Cloud Drive, at the shared folder (a file's folder). */
export const inspectShareHref = (s: CloudDriveShare) =>
	userCloudDriveHref(
		{ id: s.owner, username: s.ownerName },
		s.kind === "drive" ? "" : openPath(s),
	);

/**
 * Admin › Accounts: a Cloud Drive share involving this account (its owner's, or the one it is for) waits for an
 * admin - approved right from the row. One share: the button approves it (what it is, in its title); the arrow has
 * Deny and Inspect drive (the owner's files, read only, before approving). Several: the button lists them.
 */
export const ShareApprovalButton: React.FC<{
	user: { id: string; username: string };
}> = ({ user }) => {
	const navigate = useNavigate();
	const peers = useQuery({ ...cloudDrivePeers(), refetchInterval: 30_000 });
	const { approve } = useShareActions();
	const waiting = (peers.data?.waiting ?? []).filter(
		(s) => s.owner === user.id || s.from === user.id,
	);
	if (!peers.data?.admin || waiting.length === 0) {
		return null;
	}
	const [only] = waiting;
	const stop = (event: React.SyntheticEvent) => event.stopPropagation();
	const menu = (
		<DropdownMenuContent align="end" className="w-80" onClick={stop}>
			{waiting.map((s, i) => (
				<div key={s.id}>
					{i > 0 && <DropdownMenuSeparator />}
					<DropdownMenuLabel className="whitespace-normal text-xs font-normal text-content-secondary">
						{shareWords(s)}
					</DropdownMenuLabel>
					<DropdownMenuItem
						disabled={approve.isPending}
						onSelect={() => approve.mutate({ id: s.id, approve: true })}
						data-testid="share-approval-item-approve"
					>
						<CloudIcon />
						Approve
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={approve.isPending}
						onSelect={() => approve.mutate({ id: s.id, approve: false })}
						data-testid="share-approval-item-deny"
					>
						<XIcon />
						Deny
					</DropdownMenuItem>
					<DropdownMenuItem
						onSelect={() => navigate(inspectShareHref(s))}
						data-testid="share-approval-item-inspect"
					>
						<FolderSearchIcon />
						Inspect {s.ownerName}'s drive
					</DropdownMenuItem>
				</div>
			))}
		</DropdownMenuContent>
	);

	if (waiting.length > 1) {
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						onClick={stop}
						title={`${waiting.length} Cloud Drive shares wait for an admin`}
						data-testid={`share-approval-${user.username}`}
					>
						<CloudIcon />
						Approve ({waiting.length})
						<ChevronDownIcon />
					</Button>
				</DropdownMenuTrigger>
				{menu}
			</DropdownMenu>
		);
	}
	return (
		<span
			className="inline-flex"
			data-testid={`share-approval-${user.username}`}
		>
			<Button
				size="sm"
				className="rounded-r-none"
				disabled={approve.isPending}
				title={`Approve: ${shareWords(only)}`}
				onClick={(event) => {
					stop(event);
					approve.mutate({ id: only.id, approve: true });
				}}
				data-testid="share-approval-approve"
			>
				<CloudIcon />
				Approve
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						className="rounded-l-none border-0 border-l border-solid border-content-invert/30 px-1.5"
						aria-label={`More about ${shareWords(only)}`}
						onClick={stop}
						data-testid="share-approval-more"
					>
						<ChevronDownIcon />
					</Button>
				</DropdownMenuTrigger>
				{menu}
			</DropdownMenu>
		</span>
	);
};
