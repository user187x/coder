import { Share2Icon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import {
	cloudDrivePeers,
	cloudDrivePeersKey,
	cloudDrivePeople,
} from "#/api/queries/platform";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
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
	const [to, setTo] = useState("");
	const [access, setAccess] = useState<"read" | "write">("read");
	const existing = (peers.data?.ofMine ?? []).filter(
		(s) => (s.path ?? "") === path && OPEN.includes(s.state),
	);
	const taken = new Set(existing.map((s) => s.from));
	const choices = (people.data?.people ?? []).filter((p) => !taken.has(p.id));
	const what =
		kind === "drive"
			? "your entire Cloud Drive"
			: `the ${kind} ${baseName(path)}`;
	const share = useMutation({
		mutationFn: () => PlatformAPI.shareCloudDrive(to, path, access),
		onSuccess: (out) => {
			queryClient.setQueryData(cloudDrivePeersKey, out);
			const who = choices.find((p) => p.id === to)?.username ?? "them";
			toast.success(
				out.share.state === "approval"
					? `Shared with ${who} once an admin approves it.`
					: `Shared with ${who}: they have it now.`,
			);
			setTo("");
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not shared.")),
	});
	const end = useMutation({
		mutationFn: PlatformAPI.endCloudDriveShare,
		onSuccess: (out) => queryClient.setQueryData(cloudDrivePeersKey, out),
		onError: (e) => toast.error(getErrorMessage(e, "Not ended.")),
	});
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
						They open it at once in their Cloud Drive window, and their
						workspaces have it at ~/cloud-drive-shared/ from their next start
						{peers.data?.settings.adminApproval
							? " - once an admin approves it."
							: "."}
					</DialogDescription>
				</DialogHeader>
				{sharingOff ? (
					<p role="alert" className="m-0 text-sm text-content-warning">
						Sharing between users is off: an admin turns it on (Cloud Drive &gt;
						Sharing).
					</p>
				) : (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="share-to">With</Label>
							<Select value={to} onValueChange={setTo}>
								<SelectTrigger id="share-to" data-testid="share-to">
									<SelectValue
										placeholder={
											people.isLoading ? "Reading the users…" : "Choose a user"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									{choices.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name ? `${p.name} (@${p.username})` : p.username}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<RadioGroup
							value={access}
							onValueChange={(v) => setAccess(v as "read" | "write")}
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
										<span className="font-medium">{s.fromName}</span>
										<span className="text-content-secondary">
											{" "}
											· {s.access === "write" ? "read and write" : "read only"}{" "}
											· {STATE_WORDS[s.state]}
										</span>
									</span>
									<Button
										size="xs"
										variant="outline"
										disabled={end.isPending}
										onClick={() => end.mutate(s.id)}
									>
										{s.state === "active" ? "End" : "Withdraw"}
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
						disabled={!to || share.isPending || Boolean(sharingOff)}
						onClick={() => share.mutate()}
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
