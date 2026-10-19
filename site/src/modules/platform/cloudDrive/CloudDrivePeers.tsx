import { cn } from "cn";
import {
	CheckIcon,
	CloudIcon,
	MessageCircleIcon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type CloudDrivePeers,
	type CloudDriveShare,
	PlatformAPI,
} from "#/api/platform";
import {
	cloudDriveConnections,
	cloudDrivePeers,
	cloudDrivePeersKey,
} from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Label } from "#/components/Label/Label";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import { userCloudDriveHref } from "#/modules/users/userPlaces";
import { createDayString } from "#/utils/createDayString";
import { openPath } from "./sharedWithYou";

const ACCESS_WORDS = { read: "read only", write: "read and write" } as const;

const STATE_WORDS: Record<CloudDriveShare["state"], string> = {
	asked: "waiting for its owner",
	approval: "waiting for an admin's approval",
	active: "shared",
	declined: "declined by its owner",
	denied: "not approved",
	ended: "ended",
};

const STATE_STYLE: Record<CloudDriveShare["state"], string> = {
	asked: "bg-surface-orange text-highlight-orange",
	approval: "bg-surface-orange text-highlight-orange",
	active: "bg-surface-green text-highlight-green",
	declined: "bg-surface-tertiary text-content-secondary",
	denied: "bg-surface-tertiary text-content-secondary",
	ended: "bg-surface-tertiary text-content-secondary",
};

const when = (seconds?: number | null) =>
	seconds ? createDayString(new Date(seconds * 1000).toISOString()) : "";

export const StateBadge: React.FC<{ share: CloudDriveShare }> = ({ share }) => (
	<span
		className={cn(
			"rounded px-1.5 py-px text-[11px] font-medium",
			STATE_STYLE[share.state],
		)}
		data-testid="cloud-drive-share-state"
		data-state={share.state}
	>
		{STATE_WORDS[share.state]}
	</span>
);

/** The share mutations, each refreshing the caller's shares (and the Cloud Drive's restart hints). */
export const useShareActions = () => {
	const queryClient = useQueryClient();
	const done = (out: CloudDrivePeers) => {
		queryClient.setQueryData(cloudDrivePeersKey, out);
		void queryClient.invalidateQueries({ queryKey: cloudDrivePeersKey });
	};
	const fail = (fallback: string) => (e: unknown) =>
		toast.error(getErrorMessage(e, fallback));
	return {
		answer: useMutation({
			mutationFn: (v: {
				id: string;
				accept: boolean;
				access?: "read" | "write";
			}) => PlatformAPI.answerCloudDriveShare(v.id, v.accept, v.access),
			onSuccess: (out) => {
				done(out);
				toast.success(
					out.share.state === "declined"
						? "Declined."
						: out.share.state === "approval"
							? `Shared with ${out.share.fromName} (${ACCESS_WORDS[out.share.access]}) once an admin approves it.`
							: `Shared with ${out.share.fromName} (${ACCESS_WORDS[out.share.access]}).`,
				);
			},
			onError: fail("Not answered."),
		}),
		approve: useMutation({
			mutationFn: (v: { id: string; approve: boolean }) =>
				PlatformAPI.approveCloudDriveShare(v.id, v.approve),
			onSuccess: (out) => {
				done(out);
				toast.success(
					out.share.state === "active" ? "Approved." : "Not approved.",
				);
			},
			onError: fail("Not changed."),
		}),
		end: useMutation({
			mutationFn: (id: string) => PlatformAPI.endCloudDriveShare(id),
			onSuccess: (out) => {
				done(out);
				toast.success("Ended: it leaves the workspaces at their next restart.");
			},
			onError: fail("Not ended."),
		}),
	};
};

/** The owner's answer to a request: read only, read and write (when asked for), or decline. */
export const AnswerButtons: React.FC<{ share: CloudDriveShare }> = ({
	share,
}) => {
	const { answer } = useShareActions();
	return (
		<span className="flex flex-wrap gap-1.5">
			<Button
				size="xs"
				disabled={answer.isPending}
				onClick={() =>
					answer.mutate({ id: share.id, accept: true, access: "read" })
				}
				data-testid="share-accept-read"
			>
				<CheckIcon />
				Share read only
			</Button>
			{share.asked === "write" && (
				<Button
					size="xs"
					variant="outline"
					disabled={answer.isPending}
					onClick={() =>
						answer.mutate({ id: share.id, accept: true, access: "write" })
					}
					data-testid="share-accept-write"
				>
					<CheckIcon />
					Share read and write
				</Button>
			)}
			<Button
				size="xs"
				variant="outline"
				disabled={answer.isPending}
				onClick={() => answer.mutate({ id: share.id, accept: false })}
				data-testid="share-decline"
			>
				<XIcon />
				Decline
			</Button>
		</span>
	);
};

/**
 * A share's card in a chat message (ChatConversation): who asks for whose Cloud Drive, its state now, and - for its
 * owner while it waits for them - the answer buttons; for admins while it waits for one (the "Approve Cloud Drive
 * share" message) Approve and Deny at once, and both people's names leading to their Cloud Drive (read only: the
 * owner's at what is shared) to look before approving.
 */
export const CloudDriveShareCard: React.FC<{
	shareId: string;
	meId: string;
}> = ({ shareId, meId }) => {
	const query = useQuery(cloudDrivePeers());
	const data = query.data;
	const share = [
		...(data?.asked ?? []),
		...(data?.ofMine ?? []),
		...(data?.all ?? []),
	].find((s) => s.id === shareId);
	if (!share) {
		return null;
	}
	const mineToAnswer = share.owner === meId && share.state === "asked";
	const admin = Boolean(data?.admin);
	const toApprove = admin && share.state === "approval";
	// Admins: a name leads to that person's Cloud Drive (the owner's at what is shared), to look before approving.
	const person = (id: string, username: string, path = "") =>
		admin && id !== meId ? (
			<RouterLink
				to={userCloudDriveHref({ id, username }, path)}
				className="font-semibold text-content-link underline-offset-2 hover:underline"
				title={`Open ${username}'s Cloud Drive (read only)`}
				data-testid={`cloud-drive-share-card-user-${username}`}
			>
				{username}
			</RouterLink>
		) : (
			username
		);
	return (
		<div
			className="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-solid border-border bg-surface-primary p-2 text-xs"
			data-testid="cloud-drive-share-card"
		>
			<span className="flex items-center gap-1.5 font-medium">
				<CloudIcon aria-hidden className="size-3.5 text-content-link" />
				{share.owner === meId ? (
					"Your"
				) : (
					<>
						{person(
							share.owner,
							share.ownerName,
							share.kind === "drive" ? "" : openPath(share),
						)}
						's
					</>
				)}{" "}
				{sharedThing(share)} for{" "}
				{share.from === meId ? "you" : person(share.from, share.fromName)}
				<span className="text-content-secondary">
					({ACCESS_WORDS[share.access]})
				</span>
			</span>
			<span>
				<StateBadge share={share} />
			</span>
			{mineToAnswer && <AnswerButtons share={share} />}
			{toApprove && <ApproveButtons share={share} />}
		</div>
	);
};

/** An admin's answer to a share waiting for one: approve or deny it, here in the chat. */
const ApproveButtons: React.FC<{ share: CloudDriveShare }> = ({ share }) => {
	const { approve } = useShareActions();
	return (
		<span className="flex flex-wrap gap-1.5">
			<Button
				size="xs"
				disabled={approve.isPending}
				onClick={() => approve.mutate({ id: share.id, approve: true })}
				data-testid="share-card-approve"
			>
				<CheckIcon />
				Approve
			</Button>
			<Button
				size="xs"
				variant="outline"
				disabled={approve.isPending}
				onClick={() => approve.mutate({ id: share.id, approve: false })}
				data-testid="share-card-deny"
			>
				<XIcon />
				Deny
			</Button>
		</span>
	);
};

/** Ask the person in a chat for their Cloud Drive: read only, or read and write. */
export const AskForCloudDriveDialog: React.FC<{
	owner: { id: string; name: string };
	onClose: () => void;
}> = ({ owner, onClose }) => {
	const queryClient = useQueryClient();
	const [access, setAccess] = useState<"read" | "write">("read");
	const ask = useMutation({
		mutationFn: () => PlatformAPI.requestCloudDrive(owner.id, access),
		onSuccess: (out) => {
			queryClient.setQueryData(cloudDrivePeersKey, out);
			toast.success(`Asked ${owner.name}: your request is in your chat.`);
			onClose();
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not asked.")),
	});
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-md" data-testid="ask-cloud-drive">
				<DialogHeader>
					<DialogTitle>Ask {owner.name} for their Cloud Drive</DialogTitle>
					<DialogDescription>
						A request goes into your chat with them. Once they share it (and an
						admin approves it, when admins approve shares), it is in your
						workspaces from their next start, at ~/cloud-drive-shared/.
					</DialogDescription>
				</DialogHeader>
				<RadioGroup
					value={access}
					onValueChange={(v) => setAccess(v as "read" | "write")}
					className="flex flex-col gap-2"
					aria-label="Access"
				>
					<div className="flex items-center gap-2">
						<RadioGroupItem value="read" id="ask-read" />
						<Label htmlFor="ask-read">Read only</Label>
					</div>
					<div className="flex items-center gap-2">
						<RadioGroupItem value="write" id="ask-write" />
						<Label htmlFor="ask-write">Read and write</Label>
					</div>
				</RadioGroup>
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={ask.isPending}
						onClick={() => ask.mutate()}
						data-testid="ask-cloud-drive-send"
					>
						<Spinner loading={ask.isPending}>
							<MessageCircleIcon />
						</Spinner>
						Ask in chat
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/** What of the owner's drive a share is: "Cloud Drive" (all of it), "folder docs", "file plan.md". */
export const sharedThing = (share: Pick<CloudDriveShare, "kind" | "path">) =>
	!share.kind || share.kind === "drive"
		? "Cloud Drive"
		: `${share.kind} ${share.path}`;

const ShareRow: React.FC<{
	share: CloudDriveShare;
	meId?: string;
	admin?: boolean;
	children?: React.ReactNode;
}> = ({ share, meId, admin, children }) => {
	const { end } = useShareActions();
	const open = ["asked", "approval", "active"].includes(share.state);
	const canEnd = open && (admin || share.owner === meId || share.from === meId);
	return (
		<li
			className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-0 border-b border-solid border-border px-1 py-2 text-sm last:border-b-0"
			data-testid={`cloud-drive-share-${share.id}`}
		>
			<span className="min-w-0 flex-1">
				<span className="font-medium">{share.ownerName}</span>
				<span className="text-content-secondary">
					's {sharedThing(share)} for{" "}
				</span>
				<span className="font-medium">{share.fromName}</span>
				<span className="text-content-secondary">
					{" "}
					· {ACCESS_WORDS[share.access]} ·{" "}
					{share.by === "owner" ? "shared" : "asked"} {when(share.askedAt)}
					{share.approvedBy && share.state === "active"
						? ` · approved by ${share.approvedBy}`
						: ""}
				</span>
			</span>
			<StateBadge share={share} />
			{children}
			{canEnd && (
				<Button
					size="xs"
					variant="outline"
					disabled={end.isPending}
					onClick={() => end.mutate(share.id)}
					data-testid="share-end"
				>
					{share.state === "active" ? "End" : "Withdraw"}
				</Button>
			)}
		</li>
	);
};

/**
 * The Cloud Drive window's Sharing: Cloud Drives shared between users. Everyone: the shares they asked for (others'
 * drives, mounted in their workspaces at ~/cloud-drive-shared/<owner> from their next start) and those of their own
 * drive, each to end at any time; requests to answer. Asking is done in chat (a conversation's menu: Ask for their
 * Cloud Drive). Admins: the feature on or off, whether they approve each share, the shares waiting for them, every
 * share.
 */
export const CloudDrivePeersView: React.FC = () => {
	const queryClient = useQueryClient();
	const query = useQuery(cloudDrivePeers());
	const { approve } = useShareActions();
	const settings = useMutation({
		mutationFn: PlatformAPI.saveCloudDrivePeerSettings,
		onSuccess: (out) => {
			queryClient.setQueryData(cloudDrivePeersKey, out);
			toast.success("Saved.");
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not saved.")),
	});
	const data = query.data;
	if (!data) {
		return (
			<p
				role={query.error ? "alert" : undefined}
				className={cn(
					"m-0 px-6 py-8 text-center text-sm",
					query.error ? "text-content-destructive" : "text-content-secondary",
				)}
			>
				{query.error
					? getErrorMessage(query.error, "The shares could not be read.")
					: "Reading…"}
			</p>
		);
	}
	const meId = data.me;
	const toAnswer = data.ofMine.filter((s) => s.state === "asked");
	return (
		<div
			className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto px-6 py-5"
			data-testid="cloud-drive-peers"
		>
			{data.admin && (
				<section className="flex flex-col gap-3 rounded-lg border border-solid border-border p-4">
					<h3 className="m-0 text-sm font-semibold">
						Sharing between users (admins)
					</h3>
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="peers-enabled" className="flex flex-col gap-0.5">
							<span>Users may share their Cloud Drives with each other</span>
							<span className="text-xs font-normal text-content-secondary">
								Off: no requests, and no share is mounted (they are kept for
								when it is back on).
							</span>
						</Label>
						<Switch
							id="peers-enabled"
							checked={data.settings.enabled}
							disabled={settings.isPending}
							onCheckedChange={(enabled) => settings.mutate({ enabled })}
							data-testid="peers-enabled"
						/>
					</div>
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor="peers-approval" className="flex flex-col gap-0.5">
							<span>Admins approve each share</span>
							<span className="text-xs font-normal text-content-secondary">
								After its owner accepts, an admin approves it before it is
								mounted.
							</span>
						</Label>
						<Switch
							id="peers-approval"
							checked={data.settings.adminApproval}
							disabled={settings.isPending}
							onCheckedChange={(adminApproval) =>
								settings.mutate({ adminApproval })
							}
							data-testid="peers-approval"
						/>
					</div>
					{(data.waiting ?? []).length > 0 && (
						<div className="flex flex-col gap-1">
							<span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
								Waiting for an admin
							</span>
							<ul className="m-0 list-none p-0">
								{(data.waiting ?? []).map((s) => (
									<ShareRow key={s.id} share={s} meId={meId} admin>
										<Button
											size="xs"
											disabled={approve.isPending}
											onClick={() =>
												approve.mutate({ id: s.id, approve: true })
											}
											data-testid="share-approve"
										>
											<CheckIcon />
											Approve
										</Button>
										<Button
											size="xs"
											variant="outline"
											disabled={approve.isPending}
											onClick={() =>
												approve.mutate({ id: s.id, approve: false })
											}
											data-testid="share-deny"
										>
											<XIcon />
											Deny
										</Button>
									</ShareRow>
								))}
							</ul>
						</div>
					)}
				</section>
			)}
			{!data.settings.enabled ? (
				<Alert severity="info">
					<AlertTitle>Sharing between users is off</AlertTitle>
					<AlertDescription>
						{data.admin
							? "Turn it on above: users then ask each other in chat."
							: "An admin turns it on."}
					</AlertDescription>
				</Alert>
			) : (
				<p className="m-0 flex items-start gap-2 text-sm text-content-secondary">
					<UsersIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
					To use someone's Cloud Drive, ask them in chat: open your conversation
					with them, then its menu's "Ask for their Cloud Drive". Shared drives
					are in your workspaces at ~/cloud-drive-shared/ from their next start.
				</p>
			)}
			{toAnswer.length > 0 && (
				<section className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold">Asked of you</h3>
					<ul className="m-0 list-none p-0">
						{toAnswer.map((s) => (
							<ShareRow key={s.id} share={s} meId={meId}>
								<AnswerButtons share={s} />
							</ShareRow>
						))}
					</ul>
				</section>
			)}
			<ShareList
				title="Shared with you"
				empty="No one's Cloud Drive is shared with you."
				shares={data.asked}
				meId={meId}
			/>
			{data.asked.some((s) => s.state === "active") && <SharedNowHint />}
			<ShareList
				title="Your Cloud Drive, shared"
				empty="Your Cloud Drive is yours alone."
				shares={data.ofMine.filter((s) => s.state !== "asked")}
				meId={meId}
			/>
			{data.admin && (data.all ?? []).length > 0 && (
				<ShareList
					title="Every share (admins)"
					empty=""
					shares={data.all ?? []}
					meId={meId}
					admin
				/>
			)}
		</div>
	);
};

const ShareList: React.FC<{
	title: string;
	empty: string;
	shares: CloudDriveShare[];
	meId: string;
	admin?: boolean;
}> = ({ title, empty, shares, meId, admin }) => (
	<section className="flex flex-col gap-1">
		<h3 className="m-0 text-sm font-semibold">{title}</h3>
		{shares.length === 0 ? (
			<p className="m-0 text-sm text-content-secondary">{empty}</p>
		) : (
			<ul className="m-0 list-none p-0">
				{shares.map((s) => (
					<ShareRow key={s.id} share={s} meId={meId} admin={admin} />
				))}
			</ul>
		)}
	</section>
);

/**
 * Under the drives shared with the user: open at once in Files (its drive switcher); in their workspaces from their
 * next start - the running ones that do not have the shares as they are now, by name.
 */
const SharedNowHint: React.FC = () => {
	const connections = useQuery(cloudDriveConnections());
	const list = useQuery(workspaces({ q: "owner:me" }));
	const restart = new Set(connections.data?.restart ?? []);
	const names = (list.data?.workspaces ?? [])
		.filter((w) => restart.has(w.id))
		.map((w) => w.name);
	return (
		<p
			className="-mt-3 m-0 flex items-start gap-2 text-xs text-content-secondary"
			data-testid="shared-now-hint"
		>
			<CloudIcon aria-hidden className="mt-px size-3.5 shrink-0" />
			<span>
				Open them now in Files: pick the drive above its list. Your workspaces
				have them at ~/cloud-drive-shared/ from their next start
				{names.length > 0 &&
					` - restart ${names.join(", ")} to have the shares as they are now`}
				.
			</span>
		</p>
	);
};
