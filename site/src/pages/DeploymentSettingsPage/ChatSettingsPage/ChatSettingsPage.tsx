import { MessageSquareIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { ChatPeer, ChatSettings } from "#/api/platform";
import {
	chatPairs,
	chatSettings,
	purgeChats,
	saveChatSettings,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { ChatConsoleCard } from "#/modules/platform/chat/ChatConsoleCard";
import { ChatPeople, PresenceAvatar } from "#/modules/platform/chat/ChatPeople";
import { displayName, openChatWith } from "#/modules/platform/chat/chatStore";
import { formatBytes } from "#/modules/platform/images";
import { pageTitle } from "#/utils/page";
import { OnlineUsersCard } from "../OnlineUsersPage/OnlineUsersPage";

const when = (iso: string | null) =>
	iso
		? new Date(iso).toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			})
		: "never";

const card =
	"flex flex-col gap-3 rounded-lg border border-solid border-border p-6";

/**
 * Controls › Settings › Chat: admins' chat console (the first card: out of the
 * dashboard's way, popped out into a window of its own when wanted), Online
 * Users (once a category of its own), peer-to-peer chat (developers writing to
 * each other, from the People list of who is online or active today), how long
 * chats are kept and purging them, which developers talk to each other (never
 * what they wrote), and who is around now, the invisible too.
 */
const ChatSettingsPage: React.FC = () => {
	const settingsQuery = useQuery(chatSettings());
	// A link to one of its cards (#online-users, the quick link): there once the page is drawn.
	const loaded = Boolean(settingsQuery.data);
	useEffect(() => {
		const id = window.location.hash.slice(1);
		if (loaded && id) {
			document.getElementById(id)?.scrollIntoView({ block: "start" });
		}
	}, [loaded]);
	return (
		<>
			<title>{pageTitle("Chat")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Chat</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Answer chats in the console, see who is online, let developers chat
					with each other, decide how long chats are kept, and see who talks to
					whom.
				</SettingsHeaderDescription>
			</SettingsHeader>
			{settingsQuery.isLoading ? (
				<Loader />
			) : !settingsQuery.data ? (
				<ErrorAlert error={settingsQuery.error} />
			) : (
				<div className="flex flex-col gap-6">
					<ChatConsoleCard />
					<OnlineUsersCard />
					<PeersCard settings={settingsQuery.data} />
					<RetentionCard settings={settingsQuery.data} />
					<PairsCard />
					<section aria-labelledby="chat-people-now" className={card}>
						<h2 id="chat-people-now" className="m-0 text-base font-semibold">
							Who is around
						</h2>
						<p className="m-0 text-sm text-content-secondary">
							Everyone online now or active today, as developers see them, and
							those who chose to be invisible (only admins see them). Choose
							someone to message them.
						</p>
						<ChatPeople
							onOpen={(peer) => void openChatWith(peer)}
							className="max-h-96 overflow-y-auto rounded-md border border-solid border-border p-1"
						/>
					</section>
				</div>
			)}
		</>
	);
};

const PeersCard: React.FC<{ settings: ChatSettings }> = ({ settings }) => {
	const queryClient = useQueryClient();
	const save = useMutation(saveChatSettings(queryClient));
	return (
		<section aria-labelledby="chat-peers" className={card}>
			<div className="flex items-center gap-3">
				<Switch
					id="chat-peers-switch"
					checked={settings.peers}
					disabled={save.isPending}
					onCheckedChange={(peers) =>
						save.mutate(
							{ peers },
							{
								onSuccess: () =>
									toast.success(
										peers
											? "Peer-to-peer chat is on: developers can see who is around and chat with each other."
											: "Peer-to-peer chat is off: developers chat with admins only.",
									),
								onError: (error) =>
									toast.error(getErrorMessage(error, "Not saved.")),
							},
						)
					}
				/>
				<Label
					htmlFor="chat-peers-switch"
					id="chat-peers"
					className="text-base font-semibold"
				>
					Peer-to-peer chat
				</Label>
				<span className="text-sm text-content-secondary">
					{settings.peers ? "On" : "Off: developers chat with admins only"}
				</span>
			</div>
			<p className="m-0 text-sm text-content-secondary">
				On, every developer's Chats panel lists the People online now or active
				today, and they can message each other to work on a project together.
				Anyone can make themselves invisible there; admins still see them. Off,
				developers write to admins only, and conversations between developers
				can't go on (they stay readable until they expire).
			</p>
			{settings.updatedBy && settings.updatedAt && (
				<p className="m-0 text-xs text-content-secondary">
					Last changed by {settings.updatedBy}, {when(settings.updatedAt)}.
				</p>
			)}
		</section>
	);
};

const RetentionCard: React.FC<{ settings: ChatSettings }> = ({ settings }) => {
	const queryClient = useQueryClient();
	const save = useMutation(saveChatSettings(queryClient));
	const purge = useMutation(purgeChats(queryClient));
	const [days, setDays] = useState(String(settings.keepDays));
	const [confirming, setConfirming] = useState(false);
	const [lo, hi] = settings.keepRange;
	const value = Number.parseInt(days, 10);
	const valid = Number.isInteger(value) && value >= lo && value <= hi;
	const { stats } = settings;
	return (
		<section aria-labelledby="chat-retention" className={card}>
			<h2 id="chat-retention" className="m-0 text-base font-semibold">
				Keeping chats
			</h2>
			<div className="flex flex-wrap items-end gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="chat-keep-days">Keep chats for (days)</Label>
					<Input
						id="chat-keep-days"
						type="number"
						min={lo}
						max={hi}
						className="w-32"
						value={days}
						onChange={(event) => setDays(event.target.value)}
					/>
				</div>
				<Button
					disabled={!valid || value === settings.keepDays || save.isPending}
					onClick={() =>
						save.mutate(
							{ keepDays: value },
							{
								onSuccess: () =>
									toast.success(
										`Chats are kept ${value} ${value === 1 ? "day" : "days"}.`,
									),
								onError: (error) =>
									toast.error(getErrorMessage(error, "Not saved.")),
							},
						)
					}
				>
					<Spinner loading={save.isPending} />
					Save
				</Button>
				<span className="pb-2 text-xs text-content-secondary">
					{lo}–{hi} days; 30 by default.
				</span>
			</div>
			<p className="m-0 text-sm text-content-secondary">
				Messages, screenshots and files older than this are deleted every hour,
				and at once when you shorten it.
			</p>
			<p className="m-0 text-sm" data-testid="chat-stats">
				{stats.messages.toLocaleString()}{" "}
				{stats.messages === 1 ? "message" : "messages"} (
				{stats.peerMessages.toLocaleString()} between developers),{" "}
				{stats.screenshots}{" "}
				{stats.screenshots === 1 ? "screenshot" : "screenshots"},{" "}
				{stats.attachments !== undefined && (
					<>
						{stats.attachments.toLocaleString()}{" "}
						{stats.attachments === 1 ? "file" : "files"} (
						{formatBytes(stats.attachmentBytes ?? 0)}),{" "}
					</>
				)}
				{formatBytes(stats.bytes)}
				{stats.oldest ? `; the oldest from ${when(stats.oldest)}` : ""}.
				{stats.fileBytes !== null && (
					<span className="text-content-secondary">
						{" "}
						The platform service's file: {formatBytes(stats.fileBytes)}.
					</span>
				)}
			</p>
			<div>
				<Button
					variant="destructive"
					disabled={purge.isPending || stats.messages === 0}
					onClick={() => setConfirming(true)}
				>
					<Trash2Icon />
					Purge all chats
				</Button>
			</div>
			<ConfirmDialog
				type="delete"
				open={confirming}
				title="Purge all chats"
				description={`Delete every chat message, screenshot and file (${stats.messages.toLocaleString()}), for everyone, admins' conversations too? Open chat windows empty at once. This can't be undone.`}
				confirmText="Purge"
				confirmLoading={purge.isPending}
				onClose={() => setConfirming(false)}
				onConfirm={() =>
					purge.mutate(undefined, {
						onSuccess: ({ deleted }) => {
							setConfirming(false);
							toast.success(
								`Purged ${deleted.toLocaleString()} ${deleted === 1 ? "message" : "messages"}.`,
							);
						},
						onError: (error) =>
							toast.error(
								getErrorMessage(error, "The chats could not be purged."),
							),
					})
				}
			/>
		</section>
	);
};

const PairsCard: React.FC = () => {
	const pairsQuery = useQuery(chatPairs());
	const pairs = pairsQuery.data?.pairs ?? [];
	const person = (p: ChatPeer & { online: boolean }) => (
		<span className="flex items-center gap-2">
			<PresenceAvatar person={p} />
			<span className="flex min-w-0 flex-col">
				<span className="truncate font-medium">{displayName(p)}</span>
				<span className="truncate text-xs text-content-secondary">
					@{p.username}
				</span>
			</span>
		</span>
	);
	return (
		<section aria-labelledby="chat-pairs" className={card}>
			<h2 id="chat-pairs" className="m-0 text-base font-semibold">
				Who talks to whom
			</h2>
			<p className="m-0 text-sm text-content-secondary">
				Developers who have chatted with each other (not what they wrote): to
				find the right points of contact on a project, and join in.
			</p>
			{pairsQuery.isLoading ? (
				<Loader />
			) : pairsQuery.isError ? (
				<ErrorAlert error={pairsQuery.error} />
			) : pairs.length === 0 ? (
				<p className="m-0 text-sm text-content-secondary">
					No developers have chatted with each other yet.
				</p>
			) : (
				<Table aria-label="Developers who talk to each other">
					<TableHeader>
						<TableRow>
							<TableHead>Between</TableHead>
							<TableHead>And</TableHead>
							<TableHead>Messages</TableHead>
							<TableHead>Since</TableHead>
							<TableHead>Last</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{pairs.map((pair) => (
							<TableRow
								key={`${pair.a.id}:${pair.b.id}`}
								data-testid="chat-pair"
							>
								<TableCell>{person(pair.a)}</TableCell>
								<TableCell>{person(pair.b)}</TableCell>
								<TableCell className="tabular-nums">{pair.messages}</TableCell>
								<TableCell>{when(pair.first)}</TableCell>
								<TableCell>{when(pair.last)}</TableCell>
								<TableCell>
									<span className="flex justify-end gap-1">
										{[pair.a, pair.b].map((p) => (
											<Button
												key={p.id}
												size="sm"
												variant="outline"
												title={`Message ${displayName(p)}`}
												onClick={() => void openChatWith(p)}
											>
												<MessageSquareIcon />@{p.username}
											</Button>
										))}
									</span>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</section>
	);
};

export default ChatSettingsPage;
