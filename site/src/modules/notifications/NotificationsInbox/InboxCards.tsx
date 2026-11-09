import { CheckCheckIcon, SquareCheckBigIcon, Trash2Icon } from "lucide-react";
import Markdown from "react-markdown";
import { Link as RouterLink } from "react-router";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import type { InboxNotification } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Link } from "#/components/Link/Link";
import { Loader } from "#/components/Loader/Loader";
import { relativeTime } from "#/utils/time";
import { InboxAvatar } from "./InboxAvatar";
import { useNotificationsInbox } from "./NotificationsInbox";

const InboxCard: React.FC<{
	notification: InboxNotification;
	onMarkAsRead: (id: string) => void;
}> = ({ notification, onMarkAsRead }) => {
	const unread = notification.read_at === null;
	return (
		<li
			aria-label={unread ? "Unread notification" : "Notification"}
			className="flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border bg-surface-secondary p-4 data-[unread]:border-highlight-sky"
			data-unread={unread || undefined}
		>
			<div className="flex items-start gap-3">
				<InboxAvatar icon={notification.icon} />
				<Markdown
					className="min-w-0 flex-1 text-sm font-medium text-content-secondary wrap-anywhere"
					components={{ a: ({ node, ...props }) => <Link {...props} /> }}
				>
					{notification.content}
				</Markdown>
				{unread && (
					<span className="mt-1 size-2.5 shrink-0 rounded-full bg-highlight-sky">
						<span className="sr-only">Unread</span>
					</span>
				)}
			</div>
			<div className="mt-auto flex flex-wrap items-center gap-2">
				{notification.actions.map((action) => (
					<Button variant="outline" size="sm" key={action.label} asChild>
						<RouterLink
							to={action.url}
							onClick={() => onMarkAsRead(notification.id)}
						>
							{action.label}
						</RouterLink>
					</Button>
				))}
				{unread && (
					<Button
						variant="subtle"
						size="sm"
						onClick={() => onMarkAsRead(notification.id)}
					>
						<SquareCheckBigIcon />
						Mark as read
					</Button>
				)}
				<span className="ml-auto text-xs font-medium whitespace-nowrap text-content-secondary">
					{relativeTime(new Date(notification.created_at))}
				</span>
			</div>
		</li>
	);
};

/**
 * The signed-in user's inbox as cards (Notifications › Inbox): every notification, newest first, with what the
 * popover offers - mark one or all as read, clear all, load older ones.
 */
export const InboxCards: React.FC = () => {
	const inbox = useNotificationsInbox({
		fetchNotifications: API.getInboxNotifications,
		markAllAsRead: API.markAllInboxNotificationsAsRead,
		clearAll: PlatformAPI.clearInbox,
		markNotificationAsRead: (id) =>
			API.updateInboxNotificationReadStatus(id, { is_read: true }),
	});
	if (inbox.error && !inbox.notifications) {
		return <ErrorAlert error={inbox.error} />;
	}
	if (!inbox.notifications) {
		return <Loader />;
	}
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm text-content-secondary">
					{inbox.notifications.length === 0
						? "No notifications."
						: `${inbox.unreadCount} unread`}
				</span>
				<span className="ml-auto flex gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={inbox.unreadCount === 0}
						onClick={inbox.onMarkAllAsRead}
					>
						<CheckCheckIcon />
						Mark all as read
					</Button>
					{inbox.onClearAll && (
						<Button
							variant="outline"
							size="sm"
							disabled={inbox.notifications.length === 0 || inbox.isClearing}
							onClick={inbox.onClearAll}
						>
							<Trash2Icon />
							Clear all
						</Button>
					)}
				</span>
			</div>
			{inbox.notifications.length > 0 && (
				<ul
					aria-label="Inbox notifications"
					className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3 p-0"
				>
					{inbox.notifications.map((n) => (
						<InboxCard
							key={n.id}
							notification={n}
							onMarkAsRead={inbox.onMarkNotificationAsRead}
						/>
					))}
				</ul>
			)}
			{inbox.hasMoreNotifications && (
				<Button
					variant="outline"
					className="self-center"
					disabled={inbox.isLoadingMoreNotifications}
					onClick={inbox.onLoadMoreNotifications}
				>
					Load older notifications
				</Button>
			)}
		</div>
	);
};
