import { Share2Icon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type CloudDriveRecipient,
	cloudDriveConnections,
	cloudDrivePeers,
	cloudDrivePeople,
	enableCloudDriveSharing,
	revokeCloudDriveShare,
	shareCloudDriveItems,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Label } from "#/components/Label/Label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { Spinner } from "#/components/Spinner/Spinner";
import { baseName } from "./sharedWithYou";

const OPEN = ["asked", "approval", "active"];
const STATE_WORDS: Record<string, string> = {
	asked: "asked for",
	approval: "waiting for an admin",
	active: "shared",
};

/**
 * The owner shares their entire Cloud Drive (path ""), or a folder or a file of it, from its window: with whom, read
 * only or read and write - and sees whom it is shared with already, each to end. They have it at once in their Cloud
 * Drive window and in their workspaces from their next start (once an admin approves it, where admins approve shares).
 */
export const ShareDialog: React.FC<{
	path: string;
	kind: "drive" | "folder" | "file";
	onClose: () => void;
}> = ({ path, kind, onClose }) => {
	const queryClient = useQueryClient();
	const people = useQuery(cloudDrivePeople(true));
	const peers = useQuery(cloudDrivePeers());
	const enableSharing = useMutation(enableCloudDriveSharing(queryClient));
	const connections = useQuery(cloudDriveConnections());
	const workspaceChoices =
		kind === "drive" ? [] : (connections.data?.workspaceConnections ?? []);

	const [selected, setSelected] = useState<string[]>([]);
	const [failures, setFailures] = useState<string[]>([]);
	const [access, setAccess] = useState<"read" | "write">("read");
	const existing = (peers.data?.ofMine ?? []).filter(
		(s) => (s.path ?? "") === path && OPEN.includes(s.state),
	);
	const taken = new Set(
		existing.map((s) =>
			s.workspaceId ? `workspace:${s.workspaceId}` : `user:${s.from}`,
		),
	);
	const choices: CloudDriveRecipient[] = [
		...workspaceChoices.map((c) => ({
			key: `workspace:${c.workspaceId}`,
			label: `Workspace: ${c.recipientName}/${c.workspaceName}`,
			userId: c.recipientId,
			workspaceId: c.workspaceId,
		})),
		...(people.data?.people ?? []).map((p) => ({
			key: `user:${p.id}`,
			label: p.name ? `${p.name} (@${p.username})` : p.username,
			userId: p.id,
		})),
	].filter((c) => !taken.has(c.key));
	const recipients = choices.filter((c) => selected.includes(c.key));
	const share = useMutation(shareCloudDriveItems(queryClient));
	const end = useMutation(revokeCloudDriveShare(queryClient));
	const busy = share.isPending || end.isPending;
	const loading = people.isLoading || connections.isLoading || peers.isLoading;
	const loadError = people.error || connections.error || peers.error;
	const what =
		kind === "drive"
			? "your entire Cloud Drive"
			: `the ${kind} ${baseName(path)}`;
	const sharingOff = peers.data && !peers.data.settings.enabled;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="max-w-md"
				data-testid="cloud-drive-share-dialog"
			>
				<DialogHeader>
					<DialogTitle>
						Share {what}
						{kind !== "drive" && (
							<span className="block truncate text-sm font-normal text-content-secondary">
								{path}
							</span>
						)}
					</DialogTitle>
					<DialogDescription>
						Connecting a workspace shares nothing. Choose a file or folder and
						its recipients here. They open shared items in their Cloud Drive
						window, and workspace mounts become available at
						~/cloud-drive/Shared/ after their next start
						{peers.data?.settings.adminApproval
							? " - once an admin approves it."
							: "."}
					</DialogDescription>
				</DialogHeader>
				{sharingOff ? (
					<div className="flex flex-col gap-2">
						<p role="alert" className="m-0 text-sm text-content-warning">
							Sharing is disabled for this deployment. Enabling it permits
							explicit file and folder grants; connections alone expose nothing.
						</p>
						{peers.data?.admin && (
							<Button
								variant="outline"
								disabled={enableSharing.isPending}
								onClick={() =>
									enableSharing.mutate(undefined, {
										onError: (error) =>
											toast.error(
												getErrorMessage(error, "Sharing was not enabled."),
											),
									})
								}
							>
								Enable sharing
							</Button>
						)}
					</div>
				) : (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="share-to">With</Label>
							<Popover>
								<PopoverTrigger asChild>
									<Button
										id="share-to"
										variant="outline"
										disabled={busy || loading || Boolean(loadError)}
									>
										{loading
											? "Loading recipients…"
											: `${recipients.length ? `${recipients.length} selected` : "Choose recipients"}`}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-80" aria-label="Recipients">
									<div className="flex gap-2 border-0 border-b border-solid border-border pb-2">
										<Button
											size="sm"
											variant="outline"
											disabled={busy || choices.length === 0}
											onClick={() => setSelected(choices.map((c) => c.key))}
										>
											Select all
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={busy || selected.length === 0}
											onClick={() => setSelected([])}
										>
											Clear all
										</Button>
									</div>
									<div className="max-h-60 overflow-y-auto pt-2">
										{choices.length === 0 && (
											<p className="text-sm text-content-secondary">
												No additional recipients available.
											</p>
										)}
										{choices.map((c) => (
											<Label
												key={c.key}
												className="flex items-center gap-2 py-2"
											>
												<Checkbox
													checked={selected.includes(c.key)}
													disabled={busy}
													onCheckedChange={(checked) =>
														setSelected((current) =>
															checked === true
																? [
																		...current.filter((key) => key !== c.key),
																		c.key,
																	]
																: current.filter((key) => key !== c.key),
														)
													}
												/>
												<span className="min-w-0 break-words">{c.label}</span>
											</Label>
										))}
									</div>
								</PopoverContent>
							</Popover>
							{Boolean(loadError) && (
								<p role="alert" className="text-sm text-content-warning">
									Recipients could not be loaded. Close and reopen to retry.
								</p>
							)}
							{failures.map((message) => (
								<p
									key={message}
									role="alert"
									className="text-sm text-content-warning"
								>
									{message}
								</p>
							))}
						</div>
						<RadioGroup
							value={access}
							onValueChange={(v) => {
								if (v === "read" || v === "write") setAccess(v);
							}}
							disabled={busy}
							className="flex flex-col gap-2"
							aria-label="Access"
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem value="read" id="share-read" />
								<Label htmlFor="share-read">Read only: open and download</Label>
							</div>
							<div className="flex items-center gap-2">
								<RadioGroupItem value="write" id="share-write" />
								<Label htmlFor="share-write">
									Read and write: open, add, change and delete
								</Label>
							</div>
						</RadioGroup>
					</div>
				)}
				{existing.length > 0 && (
					<div className="flex flex-col gap-1">
						<p className="m-0 text-xs font-medium text-content-secondary">
							Shared with
						</p>
						<p className="m-0 text-xs text-content-secondary">
							Revoking removes browser access now. Restart workspaces that
							already mounted this item to remove their mounts. Other grants to
							the same item still apply.
						</p>
						<ul
							className="m-0 list-none p-0"
							data-testid="cloud-drive-share-dialog-existing"
						>
							{existing.map((s) => (
								<li
									key={s.id}
									className="flex items-center gap-2 border-0 border-b border-solid border-border py-1.5 text-sm last:border-b-0"
								>
									<span className="min-w-0 flex-1 truncate">
										<span className="font-medium">
											{s.fromName}
											{s.workspaceName ? `/${s.workspaceName}` : " (account)"}
										</span>
										<span className="text-content-secondary">
											{" "}
											· {s.access === "write" ? "read and write" : "read only"}{" "}
											· {STATE_WORDS[s.state]}
										</span>
									</span>
									<Button
										size="xs"
										variant="outline"
										disabled={busy}
										onClick={() =>
											end.mutate(s.id, {
												onSuccess: () =>
													toast.success(
														"Share revoked. Restart any workspace that already mounted this item to remove its mount.",
													),
												onError: (error) =>
													toast.error(
														getErrorMessage(error, "Share was not revoked."),
													),
											})
										}
									>
										{s.state === "active" ? "Revoke" : "Withdraw"}
									</Button>
								</li>
							))}
						</ul>
					</div>
				)}
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
					<Button
						disabled={
							recipients.length === 0 ||
							busy ||
							loading ||
							Boolean(loadError) ||
							Boolean(sharingOff)
						}
						onClick={() =>
							share.mutate(
								{ recipients, path, access },
								{
									onSuccess: ({ failed, succeeded }) => {
										setSelected(failed.map(({ recipient }) => recipient.key));
										setFailures(
											failed.map(
												({ recipient, error }) =>
													`${recipient.label}: ${getErrorMessage(error, "Not shared.")}`,
											),
										);
										if (succeeded)
											toast.success(
												`Shared with ${succeeded} recipient${succeeded === 1 ? "" : "s"}. Approval may be required.`,
											);
									},
									onError: (error) =>
										toast.error(getErrorMessage(error, "Sharing failed.")),
								},
							)
						}
						data-testid="share-send"
					>
						<Spinner loading={share.isPending}>
							<Share2Icon />
						</Spinner>
						Share
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
