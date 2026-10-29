import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownAZIcon, GripVerticalIcon } from "lucide-react";
import { useImperativeHandle, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { ChatPeer } from "#/api/platform";
import {
	chatAdmins,
	chatPeople,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
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
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const savePreferences = useMutation(updateUserUIPreferences(client));
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

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
	for (const c of state.conversations.values())
		if (!c.peer.group) all.set(c.peer.id, c.peer);
	for (const p of [...(people.data?.people ?? []), ...(admins.data ?? [])])
		if (!all.has(p.id)) all.set(p.id, p);
	const needle = search.toLowerCase().trim();
	const ordered = [...all.values()].sort((a, b) => {
		const order = preferences.data?.people_order ?? [];
		if (preferences.data?.people_sort !== "name") {
			const ai = order.indexOf(a.id);
			const bi = order.indexOf(b.id);
			const rank = (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
			if (rank) return rank;
		}
		return (
			displayName(a).localeCompare(displayName(b), "en", {
				sensitivity: "base",
			}) || a.id.localeCompare(b.id, "en")
		);
	});
	const entries = ordered.filter(
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
			<div className="flex items-center gap-1">
				<Input
					aria-label="Find people"
					placeholder="Find people"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button
					variant="subtle"
					size="icon"
					aria-label="List people alphabetically"
					title="List people alphabetically; drag a handle for manual order"
					disabled={
						preferences.isPending ||
						preferences.isError ||
						savePreferences.isPending ||
						preferences.data?.people_sort === "name"
					}
					onClick={() => savePreferences.mutate({ people_sort: "name" })}
				>
					<ArrowDownAZIcon className="size-4" />
				</Button>
			</div>
			<details className="text-xs">
				<summary className="cursor-pointer p-2">
					Bulk actions · {chosen.length} selected
				</summary>
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
			</details>
			{preferences.isError && <ErrorAlert error={preferences.error} />}
			{savePreferences.isError && <ErrorAlert error={savePreferences.error} />}
			{people.isError && (
				<>
					<ErrorAlert error={people.error} />
					<Button variant="outline" onClick={() => void people.refetch()}>
						Retry
					</Button>
				</>
			)}
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={({ active, over }) => {
					if (
						preferences.isPending ||
						preferences.isError ||
						savePreferences.isPending ||
						!over ||
						active.id === over.id
					)
						return;
					const ids = ordered.map((person) => person.id);
					const from = ids.indexOf(String(active.id));
					const to = ids.indexOf(String(over.id));
					if (from >= 0 && to >= 0)
						savePreferences.mutate({
							people_sort: "manual",
							people_order: arrayMove(ids, from, to),
						});
				}}
			>
				<SortableContext
					items={entries.map((person) => person.id)}
					strategy={verticalListSortingStrategy}
				>
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
								<SortablePerson
									key={peer.id}
									id={peer.id}
									name={displayName(peer)}
								>
									<ContextMenu>
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
								</SortablePerson>
							);
						})}
					</nav>
				</SortableContext>
			</DndContext>
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

const SortablePerson: React.FC<{
	id: string;
	name: string;
	children: React.ReactNode;
}> = ({ id, name, children }) => {
	const { attributes, listeners, setNodeRef, transform, transition } =
		useSortable({ id });
	return (
		<div
			ref={setNodeRef}
			className="flex items-center gap-1 [&>div]:min-w-0 [&>div]:flex-1"
			style={{ transform: CSS.Transform.toString(transform), transition }}
		>
			{children}
			<button
				type="button"
				{...attributes}
				{...listeners}
				aria-label={`Reorder ${name}`}
				className="flex shrink-0 touch-none cursor-grab items-center border-0 bg-transparent p-2 text-content-secondary"
			>
				<GripVerticalIcon className="size-4" />
			</button>
		</div>
	);
};
