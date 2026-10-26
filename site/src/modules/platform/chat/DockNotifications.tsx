import { useImperativeHandle, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	deleteInboxNotifications,
	inboxNotifications,
	loadAllInboxNotifications,
	markInboxNotificationRead,
} from "#/api/queries/notifications";
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
import { InboxItem } from "#/modules/notifications/NotificationsInbox/InboxItem";
import { CloudDriveShareCard } from "../cloudDrive/CloudDrivePeers";
import { useChatSnapshot } from "./chatStore";
import type { DockListActions } from "./dockActions";

/** The dock and bell share the same inbox and unread cache. */
export const DockNotifications: React.FC<{
	actionsRef?: React.Ref<DockListActions>;
}> = ({ actionsRef }) => {
	const client = useQueryClient();
	const query = useQuery(inboxNotifications());
	const remove = useMutation(deleteInboxNotifications(client));
	const read = useMutation(markInboxNotificationRead(client));
	const all = useMutation(loadAllInboxNotifications(client));
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [deleting, setDeleting] = useState<string[] | null | undefined>();
	const state = useChatSnapshot();
	const items = query.data?.notifications ?? [];
	const ids = [...selected];
	const fail = (error: unknown) =>
		toast.error(getErrorMessage(error, "Unable to update notifications."));
	useImperativeHandle(actionsRef, () => ({
		selectAll: () =>
			all.mutate(undefined, {
				onSuccess: (result) =>
					setSelected(new Set(result.notifications.map((n) => n.id))),
				onError: fail,
			}),
		clearSelection: () => setSelected(new Set()),
		clearAll: () => setDeleting(null),
	}));
	return (
		<section
			aria-label="Notifications"
			className="flex min-h-0 flex-1 flex-col"
		>
			<div className="flex flex-wrap items-center justify-center gap-1 border-0 border-b border-solid border-border p-2 text-xs">
				<span>{ids.length} selected</span>
				<Button
					size="sm"
					variant="subtle"
					disabled={all.isPending}
					onClick={() =>
						all.mutate(undefined, {
							onSuccess: (result) =>
								setSelected(new Set(result.notifications.map((n) => n.id))),
							onError: fail,
						})
					}
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
					disabled={!ids.length || remove.isPending}
					onClick={() => setDeleting(ids)}
				>
					Delete selected
				</Button>
				<Button
					size="sm"
					variant="subtle"
					disabled={!items.length || remove.isPending}
					onClick={() => setDeleting(null)}
				>
					Clear all
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{query.isLoading ? (
					<p className="p-3">Loading notifications...</p>
				) : query.isError ? (
					<>
						<ErrorAlert error={query.error} />
						<Button variant="outline" onClick={() => void query.refetch()}>
							Retry
						</Button>
					</>
				) : !items.length ? (
					<p className="p-3 text-sm text-content-secondary">
						No notifications.
					</p>
				) : (
					items.map((item) => {
						const action = item.actions.find((a) =>
							a.url.startsWith("/workspaces?driveShare="),
						);
						const shareId = action
							? new URL(action.url, window.location.origin).searchParams.get(
									"driveShare",
								)
							: null;
						return (
							<ContextMenu key={item.id}>
								<ContextMenuTrigger asChild>
									<article
										aria-label={item.title}
										className="border-0 border-b border-solid border-border"
									>
										<label
											htmlFor={`select-notification-${item.id}`}
											className="flex items-center gap-2 px-3 pt-2 text-xs"
										>
											<Checkbox
												id={`select-notification-${item.id}`}
												checked={selected.has(item.id)}
												onCheckedChange={(checked) =>
													setSelected((previous) => {
														const next = new Set(previous);
														if (checked) next.add(item.id);
														else next.delete(item.id);
														return next;
													})
												}
											/>
											Select {item.title}
										</label>
										<InboxItem
											notification={item}
											onMarkNotificationAsRead={(id) =>
												read.mutate(id, { onError: fail })
											}
										/>
										{shareId && state.me && (
											<div className="p-2">
												<CloudDriveShareCard
													shareId={shareId}
													meId={state.me.id}
												/>
											</div>
										)}
									</article>
								</ContextMenuTrigger>
								<ContextMenuContent className="z-[110]">
									<ContextMenuItem
										onSelect={() => read.mutate(item.id, { onError: fail })}
									>
										Mark as read
									</ContextMenuItem>
									<ContextMenuItem
										onSelect={() =>
											setSelected((previous) => new Set([...previous, item.id]))
										}
									>
										Select
									</ContextMenuItem>
									<ContextMenuItem onSelect={() => setDeleting([item.id])}>
										Delete notification
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						);
					})
				)}
				{items.length >= 25 && (
					<p className="px-3 text-xs text-content-secondary">
						Showing the latest 25 notifications. Open the inbox to load older
						entries.
					</p>
				)}
			</div>
			<ConfirmDialog
				contentClassName="z-[120]"
				overlayClassName="z-[119] backdrop-blur-sm"
				open={deleting !== undefined}
				onClose={() => setDeleting(undefined)}
				title="Delete notifications?"
				description={
					deleting === null
						? "Delete every notification in your inbox. Approval requests remain available in their management pages."
						: `Delete ${deleting?.length ?? 0} selected notification(s) from your inbox.`
				}
				confirmText="Delete"
				confirmLoading={remove.isPending}
				onConfirm={() => {
					if (deleting !== undefined)
						remove.mutate(deleting, {
							onSuccess: () => {
								setDeleting(undefined);
								setSelected(new Set());
							},
							onError: fail,
						});
				}}
			/>
		</section>
	);
};
