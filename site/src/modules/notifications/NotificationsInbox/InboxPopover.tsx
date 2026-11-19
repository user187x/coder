import { cn } from "cn";
import {
	CheckCheckIcon,
	ListChecksIcon,
	RefreshCwIcon,
	SearchIcon,
	SettingsIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import type { InboxNotification } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { ScrollArea } from "#/components/ScrollArea/ScrollArea";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	BreadcrumbMenuPanel,
	breadcrumbMenuClass,
} from "#/modules/dashboard/Navbar/BreadcrumbMenu";
import { InboxButton } from "./InboxButton";
import { InboxItem } from "./InboxItem";
import { UnreadBadge } from "./UnreadBadge";

const CLEAR_ARMED_MS = 4000;

/** Platform: the notifications whose title or text holds every word searched for (case aside). */
export const searchNotifications = (
	notifications: readonly InboxNotification[],
	query: string,
): readonly InboxNotification[] => {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return notifications;
	}
	return notifications.filter((n) => {
		const text = `${n.title}\n${n.content}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
};

type InboxPopoverProps = {
	notifications: readonly InboxNotification[] | undefined;
	unreadCount: number;
	error: unknown;
	isLoadingMoreNotifications: boolean;
	hasMoreNotifications: boolean;
	onRetry: () => void;
	onMarkAllAsRead: () => void;
	/** Platform: delete every notification (the Inbox's Clear all); none, no button. */
	onClearAll?: () => void;
	isClearing?: boolean;
	onDeleteSelected?: (ids: string[], onSuccess: () => void) => void;
	isDeletingSelected?: boolean;
	onMarkNotificationAsRead: (notificationId: string) => void;
	onLoadMoreNotifications: () => void;
	defaultOpen?: boolean;
	trigger?: React.ReactElement;
};

/** The inbox itself: its header (count, search, bulk actions on their hazard-striped surface) and its notifications,
 * newest first. The navbar's popover shows it, and the Notifications page's Inbox tab, bigger. */
export const InboxPanel: React.FC<
	Omit<InboxPopoverProps, "defaultOpen" | "trigger"> & {
		/** Leaving for the notification settings (the popover closes). */
		onNavigate?: () => void;
	}
> = ({
	unreadCount,
	notifications,
	error,
	isLoadingMoreNotifications,
	hasMoreNotifications,
	onRetry,
	onMarkAllAsRead,
	onClearAll,
	isClearing,
	onDeleteSelected,
	isDeletingSelected,
	onMarkNotificationAsRead,
	onLoadMoreNotifications,
	onNavigate,
}) => {
	// Platform: Clear all deletes, so it asks twice: the first click opens it into a labelled "Clear all?" for a few
	// seconds, the second clears.
	const [clearArmed, setClearArmed] = useState(false);
	useEffect(() => {
		if (!clearArmed) {
			return;
		}
		const timer = window.setTimeout(() => setClearArmed(false), CLEAR_ARMED_MS);
		return () => window.clearTimeout(timer);
	}, [clearArmed]);
	const hasNotifications = Boolean(notifications && notifications.length > 0);
	// Platform: the search box (between the count and the buttons) narrows the loaded notifications.
	const [query, setQuery] = useState("");
	const shown = useMemo(
		() =>
			notifications ? searchNotifications(notifications, query) : undefined,
		[notifications, query],
	);

	const selectShownId = useId();
	const selectionToggle = useRef<HTMLButtonElement>(null);
	const [selecting, setSelecting] = useState(false);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [confirmIds, setConfirmIds] = useState<string[]>();
	const selection =
		notifications?.filter((item) => selected.has(item.id)) ?? [];
	const shownIds = shown?.map((item) => item.id) ?? [];
	const allShownSelected =
		shownIds.length > 0 && shownIds.every((id) => selected.has(id));
	const someShownSelected = shownIds.some((id) => selected.has(id));
	const select = (ids: readonly string[], checked: boolean) =>
		setSelected((previous) => {
			const next = new Set(previous);
			for (const id of ids) {
				if (checked) next.add(id);
				else next.delete(id);
			}
			return next;
		});

	return (
		<div className="flex min-h-0 max-h-[calc(var(--radix-popover-content-available-height)/var(--app-zoom,1))] flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 p-3 border-0 border-b border-solid border-border">
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xl font-semibold">Inbox</span>
					{unreadCount > 0 && <UnreadBadge count={unreadCount} />}
				</div>

				<label
					className="flex h-8 min-w-28 flex-1 items-center gap-1.5 rounded-md border border-solid border-border bg-surface-primary px-2 focus-within:border-content-link"
					data-testid="inbox-search"
				>
					<SearchIcon className="size-3.5 shrink-0 text-content-secondary" />
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape" && query) {
								event.stopPropagation();
								setQuery("");
							}
						}}
						placeholder="Search"
						aria-label="Search notifications"
						className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-inherit outline-hidden"
					/>
				</label>

				<div className="bulk-action-surface ml-auto flex shrink-0 justify-end gap-1 rounded-md p-1">
					{onDeleteSelected && (
						<Button
							variant="outline"
							size="icon"
							disabled={!hasNotifications && !selecting}
							ref={selectionToggle}
							aria-label="Select notifications"
							aria-pressed={selecting}
							title="Select notifications"
							onClick={() => {
								setSelecting(!selecting);
								setSelected(new Set());
								setClearArmed(false);
							}}
						>
							<ListChecksIcon />
						</Button>
					)}
					{onClearAll && (
						<Button
							variant={clearArmed ? "destructive" : "outline"}
							size={clearArmed ? "sm" : "icon"}
							disabled={
								!hasNotifications ||
								isClearing ||
								isDeletingSelected ||
								selecting
							}
							title={
								clearArmed
									? "Click again to clear all notifications"
									: "Clear all"
							}
							data-testid="inbox-clear-all"
							data-armed={clearArmed || undefined}
							onClick={() => {
								if (clearArmed) {
									setClearArmed(false);
									onClearAll();
								} else {
									setClearArmed(true);
								}
							}}
						>
							<Spinner loading={isClearing}>
								<Trash2Icon />
							</Spinner>
							{clearArmed ? (
								<span>Clear all?</span>
							) : (
								<span className="sr-only">Clear all</span>
							)}
						</Button>
					)}
					<Button
						variant="outline"
						size="icon"
						disabled={unreadCount === 0}
						title={unreadCount === 0 ? "Nothing unread" : "Mark all as read"}
						onClick={onMarkAllAsRead}
					>
						<CheckCheckIcon />
						<span className="sr-only">Mark all as read</span>
					</Button>
					<Button variant="outline" size="icon" asChild>
						<RouterLink to="/settings/notifications" onClick={onNavigate}>
							<SettingsIcon />
							<span className="sr-only">Notification settings</span>
						</RouterLink>
					</Button>
				</div>
			</div>

			{selecting && (
				<div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-3 py-2 text-xs">
					<label className="flex items-center gap-2" htmlFor={selectShownId}>
						<Checkbox
							id={selectShownId}
							checked={
								allShownSelected || (someShownSelected && "indeterminate")
							}
							disabled={shownIds.length === 0}
							onCheckedChange={(checked) => select(shownIds, checked === true)}
						/>
						Select shown
					</label>
					<span role="status">{selection.length} selected</span>
					<Button
						variant="outline"
						size="sm"
						className="ml-auto"
						disabled={selection.length === 0 || isDeletingSelected}
						onClick={() => setConfirmIds(selection.map((item) => item.id))}
					>
						Delete selected
					</Button>
				</div>
			)}
			<ScrollArea className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:max-h-[calc(var(--radix-popover-content-available-height)/var(--app-zoom,1)-4.5rem)]">
				<div className="p-2" data-testid="inbox-list">
					{shown ? (
						shown.length > 0 ? (
							<div
								className={cn([
									"flex flex-col gap-1",
									"[&>[role=menuitem]]:rounded-md [&>[role=menuitem]]:border [&>[role=menuitem]]:border-solid [&>[role=menuitem]]:border-border",
								])}
							>
								{shown.map((notification) => (
									<InboxItem
										key={notification.id}
										notification={notification}
										onMarkNotificationAsRead={onMarkNotificationAsRead}
										selection={
											selecting
												? {
														checked: selected.has(notification.id),
														onChange: (checked) =>
															select([notification.id], checked),
													}
												: undefined
										}
									/>
								))}
								{hasMoreNotifications && (
									<Button
										variant="subtle"
										size="sm"
										disabled={isLoadingMoreNotifications}
										onClick={onLoadMoreNotifications}
										className="w-full"
									>
										<Spinner loading={isLoadingMoreNotifications} size="sm" />
										{query ? "Load more to search them too" : "Load more"}
									</Button>
								)}
							</div>
						) : (
							<div className="p-6 flex items-center justify-center min-h-48">
								<div className="text-sm text-center flex flex-col">
									<span className="font-medium">
										{query ? "Nothing matches" : "No notifications"}
									</span>
									<span className="text-xs text-content-secondary">
										{query
											? hasMoreNotifications
												? "Only the notifications loaded are searched: load more to search older ones."
												: "No notification holds those words."
											: "New notifications will be displayed here."}
									</span>
									{query && hasMoreNotifications && (
										<div className="mt-3">
											<Button
												size="sm"
												variant="outline"
												disabled={isLoadingMoreNotifications}
												onClick={onLoadMoreNotifications}
											>
												<Spinner
													loading={isLoadingMoreNotifications}
													size="sm"
												/>
												Load more
											</Button>
										</div>
									)}
								</div>
							</div>
						)
					) : error === undefined ? (
						<div className="p-6 flex items-center justify-center min-h-48">
							<Spinner loading />
							<span className="sr-only">Loading notifications...</span>
						</div>
					) : (
						<div className="p-6 flex items-center justify-center min-h-48">
							<div className="text-sm text-center flex flex-col">
								<span className="font-medium">Error loading notifications</span>
								<span className="text-xs text-content-secondary">
									Click on the button below to retry
								</span>
								<div className="mt-3">
									<Button size="sm" variant="outline" onClick={onRetry}>
										<RefreshCwIcon />
										Retry
									</Button>
								</div>
							</div>
						</div>
					)}
				</div>
			</ScrollArea>
			{onDeleteSelected && (
				<ConfirmDialog
					open={confirmIds !== undefined}
					onClose={() => setConfirmIds(undefined)}
					title="Delete selected notifications?"
					type="delete"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						selectionToggle.current?.focus();
					}}
					description={`Delete ${confirmIds?.length ?? 0} selected notifications from your inbox.`}
					confirmText="Delete"
					confirmLoading={isDeletingSelected}
					onConfirm={() => {
						if (confirmIds)
							onDeleteSelected(confirmIds, () => {
								select(confirmIds, false);
								setConfirmIds(undefined);
							});
					}}
				/>
			)}
		</div>
	);
};

export const InboxPopover: React.FC<InboxPopoverProps> = ({
	defaultOpen,
	trigger,
	...inbox
}) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				{trigger ?? <InboxButton unreadCount={inbox.unreadCount} />}
			</PopoverTrigger>
			<PopoverContent
				className={breadcrumbMenuClass}
				style={{
					width: "min(36rem, calc(100vw / var(--app-zoom, 1) - 2rem))",
					maxWidth:
						"calc(var(--radix-popper-available-width, 100vw) / var(--app-zoom, 1))",
				}}
				sideOffset={8}
				align="end"
				onKeyDown={(event) => event.stopPropagation()}
			>
				<BreadcrumbMenuPanel>
					<InboxPanel {...inbox} onNavigate={() => setIsOpen(false)} />
				</BreadcrumbMenuPanel>
			</PopoverContent>
		</Popover>
	);
};
