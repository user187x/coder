import { cn } from "cn";
import {
	CheckCheckIcon,
	RefreshCwIcon,
	SettingsIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
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

const CLEAR_ARMED_MS = 3000;

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
	// Platform: Clear all deletes, so it asks twice - the first click arms it for a few seconds.
	const [clearArmed, setClearArmed] = useState(false);
	useEffect(() => {
		if (!clearArmed) {
			return;
		}
		const timer = window.setTimeout(() => setClearArmed(false), CLEAR_ARMED_MS);
		return () => window.clearTimeout(timer);
	}, [clearArmed]);
	const hasNotifications = Boolean(notifications && notifications.length > 0);

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
				 * data-radix-scroll-area-viewport is used to set the max-height of the ScrollArea
				 * https://github.com/shadcn-ui/ui/issues/542#issuecomment-2339361283
				 */}
				<ScrollArea
					className={cn([
						"[--bottom-offset:48px]",
						"[--max-height:calc(var(--radix-popover-content-available-height)-var(--bottom-offset))]",
						"[&>[data-radix-scroll-area-viewport]]:max-h-(--max-height)",
					])}
				>
					<div
						className={cn([
							"flex items-center justify-between p-3 border-0 border-b border-solid border-border",
							"sticky top-0 bg-surface-primary z-10 rounded-t",
						])}
					>
						<div className="flex items-center gap-2">
							<span className="text-xl font-semibold">Inbox</span>
							{unreadCount > 0 && <UnreadBadge count={unreadCount} />}
						</div>

						<div className="flex justify-end gap-1">
							{onClearAll && (
								<Button
									variant={clearArmed ? "destructive" : "outline"}
									size="icon"
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
									<span className="sr-only">
										{clearArmed
											? "Click again to clear all notifications"
											: "Clear all"}
									</span>
								</Button>
							)}
							<Button
								variant="outline"
								size="icon"
								disabled={!hasNotifications}
								title="Mark all as read"
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

					{notifications ? (
						notifications.length > 0 ? (
							<div
								className={cn([
									"[&>[role=menuitem]]:border-0 [&>[role=menuitem]:not(:last-child)]:border-b",
									"[&>[role=menuitem]]:border-solid [&>[role=menuitem]]:border-border",
								])}
							>
								{notifications.map((notification) => (
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
										<Spinner loading={isLoadingMoreNotifications} size="sm" />
										Load more
									</Button>
								)}
							</div>
						) : (
							<div className="p-6 flex items-center justify-center min-h-48">
								<div className="text-sm text-center flex flex-col">
									<span className="font-medium">No notifications</span>
									<span className="text-xs text-content-secondary">
										New notifications will be displayed here.
									</span>
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
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
};
