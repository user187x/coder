import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import { InboxPanel } from "./InboxPopover";
import { useNotificationsInbox } from "./NotificationsInbox";

/**
 * Notifications › Inbox: the navbar's inbox as it is (header, search, bulk actions on their hazard-striped surface,
 * one list of notifications, newest first), only bigger, with older ones a page at a time (Load more).
 */
export const InboxView: React.FC = () => {
	const inbox = useNotificationsInbox({
		fetchNotifications: API.getInboxNotifications,
		markAllAsRead: API.markAllInboxNotificationsAsRead,
		clearAll: PlatformAPI.clearInbox,
		markNotificationAsRead: (id) =>
			API.updateInboxNotificationReadStatus(id, { is_read: true }),
	});
	return (
		<div
			data-testid="inbox-view"
			className="overflow-hidden rounded-lg border border-solid border-border bg-surface-primary"
			// The panel sizes its list from the popover's room; here, most of the window.
			style={
				{
					"--radix-popover-content-available-height":
						"max(24rem, calc(calc(100dvh/var(--app-zoom,1)) - 18rem))",
				} as React.CSSProperties
			}
		>
			<InboxPanel {...inbox} />
		</div>
	);
};
