import { useImperativeHandle, useState } from "react";
import { useMutation, useQuery } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { ChatPeer } from "#/api/platform";
import { chatAdmins, chatPeople } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { ChatAvatar } from "./ChatAvatar";
import { CountBadge } from "./ChatWindow";
import {
	deleteConversations,
	displayName,
	openChatWith,
	useChatSnapshot,
} from "./chatStore";
import type { DockListActions } from "./dockActions";

/** Removing a directory entry hides it locally; deleting a conversation uses the participant-authorized API. */
export const DockPeople: React.FC<{
	actionsRef?: React.Ref<DockListActions>;
}> = ({ actionsRef }) => {
	const state = useChatSnapshot();
	const people = useQuery({
		...chatPeople(state.availVersion, state.presenceVersion),
		enabled: Boolean(
			state.me && (state.peers || state.discoverAll || state.me.admin),
		),
	});
	const admins = useQuery({
		...chatAdmins(state.availVersion),
		enabled: Boolean(state.me && !state.me.admin),
	});
	const [search, setSearch] = useState("");
	const [hidden, setHidden] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [deleting, setDeleting] = useState<string[] | null>(null);
	const remove = useMutation({
		mutationFn: deleteConversations,
		onSuccess: ({ deleted, failed }) => {
			setSelected(
				(old) => new Set([...old].filter((id) => !deleted.includes(id))),
			);
			setDeleting(null);
			if (failed.length)
				toast.error(
					getErrorMessage(
						failed[0].error,
						"Some conversations could not be deleted.",
					),
				);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "Unable to delete conversations.")),
	});
	const all = new Map<string, ChatPeer>();
	for (const c of state.conversations.values()) all.set(c.peer.id, c.peer);
	for (const p of [...(people.data?.people ?? []), ...(admins.data ?? [])])
		if (!all.has(p.id)) all.set(p.id, p);
	const needle = search.toLowerCase().trim();
	const entries = [...all.values()].filter(
		(p) =>
			!hidden.has(p.id) &&
			(!needle || `${p.username} ${p.name}`.toLowerCase().includes(needle)),
	);
	const chosen = entries.filter((p) => selected.has(p.id)).map((p) => p.id);
	const hide = (ids: string[]) => {
		setHidden((old) => new Set([...old, ...ids]));
		setSelected(new Set());
	};
	useImperativeHandle(actionsRef, () => ({
		selectAll: () => setSelected(new Set(entries.map((p) => p.id))),
		clearSelection: () => setSelected(new Set()),
		clearAll: () => hide(entries.map((p) => p.id)),
	}));
	return (
		<section
			aria-label="People directory"
			className="flex min-h-0 flex-1 flex-col"
		>
			<Input
				aria-label="Find people"
				placeholder="Find people"
				value={search}
				onChange={(e) => setSearch(e.target.value)}
			/>
			<div className="flex flex-wrap justify-center gap-1 p-2 text-xs">
				<span>{chosen.length} selected</span>
				<Button
					size="sm"
					variant="subtle"
					onClick={() => setSelected(new Set(entries.map((p) => p.id)))}
				>
					Select all
				</Button>
				<Button
					size="sm"
					variant="subtle"
					onClick={() => setSelected(new Set())}
				>
					Clear selection
				</Button>
				<Button
					size="sm"
					variant="subtle"
					disabled={!chosen.length}
					onClick={() => hide(chosen)}
				>
					Remove selected
				</Button>
				<Button
					size="sm"
					variant="subtle"
					onClick={() => hide(entries.map((p) => p.id))}
					disabled={!entries.length}
				>
					Clear all
				</Button>
				<Button
					size="sm"
					variant="subtle"
					disabled={!chosen.some((id) => state.conversations.has(id))}
					onClick={() =>
						setDeleting(chosen.filter((id) => state.conversations.has(id)))
					}
				>
					Delete chats
				</Button>
				{hidden.size > 0 && (
					<Button
						size="sm"
						variant="subtle"
						onClick={() => setHidden(new Set())}
					>
						Show removed people
					</Button>
				)}
			</div>
			{people.isError && (
				<>
					<ErrorAlert error={people.error} />
					<Button variant="outline" onClick={() => void people.refetch()}>
						Retry
					</Button>
				</>
			)}
			<nav
				aria-label="Recent chats"
				className="min-h-0 flex-1 overflow-y-auto p-1.5"
			>
				{people.isLoading && <p>Loading people...</p>}
				{!entries.length && !people.isLoading && (
					<p className="p-2 text-sm text-content-secondary">
						No people to show.
					</p>
				)}
				{entries.map((peer) => {
					const c = state.conversations.get(peer.id);
					return (
						<ContextMenu key={peer.id}>
							<ContextMenuTrigger asChild>
								<div className="flex items-center rounded-md hover:bg-surface-secondary">
									<Checkbox
										aria-label={`Select ${displayName(peer)}`}
										checked={selected.has(peer.id)}
										onCheckedChange={(checked) =>
											setSelected((old) => {
												const next = new Set(old);
												if (checked) next.add(peer.id);
												else next.delete(peer.id);
												return next;
											})
										}
									/>
									<button
										type="button"
										className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-2 text-left text-inherit"
										onClick={() => void openChatWith(peer)}
									>
										<ChatAvatar peer={peer} />
										<span className="min-w-0 flex-1">
											<span className="block truncate font-semibold">
												{displayName(peer)}
											</span>
											<span className="block truncate text-xs text-content-secondary">
												{c
													? `${c.last.from === state.me?.id ? "You: " : ""}${c.last.text || "Attachment"}`
													: `@${peer.username}`}
											</span>
										</span>
										{Boolean(c?.unread) && (
											<CountBadge count={c?.unread ?? 0} />
										)}
									</button>
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent className="z-[110]">
								<ContextMenuItem onSelect={() => void openChatWith(peer)}>
									Open chat
								</ContextMenuItem>
								<ContextMenuItem
									onSelect={() =>
										setSelected((old) => new Set([...old, peer.id]))
									}
								>
									Select
								</ContextMenuItem>
								<ContextMenuItem onSelect={() => hide([peer.id])}>
									Remove from People
								</ContextMenuItem>
								<ContextMenuItem
									disabled={!c}
									onSelect={() => setDeleting([peer.id])}
								>
									Delete conversation
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					);
				})}
			</nav>
			<ConfirmDialog
				contentClassName="z-[120]"
				overlayClassName="z-[119] backdrop-blur-sm"
				open={deleting !== null}
				onClose={() => setDeleting(null)}
				title="Delete conversations?"
				description="Delete all messages in the selected conversations for everyone in them. This cannot be undone. Removing someone from People does not delete their account."
				confirmText="Delete"
				confirmLoading={remove.isPending}
				onConfirm={() => {
					if (deleting) remove.mutate(deleting);
				}}
			/>
		</section>
	);
};
