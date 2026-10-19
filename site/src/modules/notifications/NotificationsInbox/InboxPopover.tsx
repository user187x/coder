import { cn } from "cn";
import {
	CheckCheckIcon,
	RefreshCwIcon,
	SearchIcon,
	SettingsIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import type { InboxNotification } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { ScrollArea } from "#/components/ScrollArea/ScrollArea";
import { Spinner } from "#/components/Spinner/Spinner";
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
	onMarkNotificationAsRead: (notificationId: string) => void;
	onLoadMoreNotifications: () => void;
	defaultOpen?: boolean;
};

export const InboxPopover: React.FC<InboxPopoverProps> = ({
	defaultOpen,
	unreadCount,
	notifications,
	error,
	isLoadingMoreNotifications,
	hasMoreNotifications,
	onRetry,
	onMarkAllAsRead,
	onClearAll,
	isClearing,
	onMarkNotificationAsRead,
	onLoadMoreNotifications,
}) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
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

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<InboxButton unreadCount={unreadCount} />
			</PopoverTrigger>
			<PopoverContent
				className="w-(--radix-popper-available-width) max-w-[466px]"
				align="end"
			>
				{/*
				 * Platform: the header stays put above the list (it no longer scrolls with it, covering its first entry),
				 * and the list scrolls in its own container, with room around its entries. The popover's height is the
				 * room below the navbar: the list takes what the header leaves.
				 */}
				<div className="flex max-h-(--radix-popover-content-available-height) flex-col">
					<div className="flex shrink-0 items-center gap-2 p-3 border-0 border-b border-solid border-border">
						<div className="flex shrink-0 items-center gap-2">
							<span className="text-xl font-semibold">Inbox</span>
							{unreadCount > 0 && <UnreadBadge count={unreadCount} />}
						</div>

						<label
							className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-solid border-border bg-surface-primary px-2"
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

						<div className="flex shrink-0 justify-end gap-1">
							{onClearAll && (
								<Button
									variant={clearArmed ? "destructive" : "outline"}
									size={clearArmed ? "sm" : "icon"}
									disabled={!hasNotifications || isClearing}
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
								title={
									unreadCount === 0 ? "Nothing unread" : "Mark all as read"
								}
								onClick={onMarkAllAsRead}
							>
								<CheckCheckIcon />
								<span className="sr-only">Mark all as read</span>
							</Button>
							<Button variant="outline" size="icon" asChild>
								<RouterLink
									to="/settings/notifications"
									onClick={() => setIsOpen(false)}
								>
									<SettingsIcon />
									<span className="sr-only">Notification settings</span>
								</RouterLink>
							</Button>
						</div>
					</div>

					<ScrollArea className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:max-h-[calc(var(--radix-popover-content-available-height)-4.5rem)]">
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
												<Spinner
													loading={isLoadingMoreNotifications}
													size="sm"
												/>
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
										<span className="font-medium">
											Error loading notifications
										</span>
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
				</div>
			</PopoverContent>
		</Popover>
	);
};
