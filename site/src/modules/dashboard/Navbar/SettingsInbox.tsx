import { InboxIcon } from "lucide-react";
import { useQuery } from "react-query";
import { inboxNotifications } from "#/api/queries/notifications";
import { DockNotifications } from "#/modules/platform/chat/DockNotifications";

/** A compact view of the signed-in user's inbox inside the docked sidebar. */
export const SettingsInbox = () => {
	const inbox = useQuery(inboxNotifications());
	return (
		<section
			aria-label="Inbox"
			className="my-2 flex max-h-64 min-h-28 flex-1 flex-col overflow-hidden rounded-lg border border-solid border-border"
		>
			<h3 className="m-0 flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
				<InboxIcon aria-hidden className="size-4" />
				Inbox
				{inbox.data && (
					<span className="ml-auto text-content-secondary">
						{inbox.data.unread_count} unread
					</span>
				)}
			</h3>
			<DockNotifications />
		</section>
	);
};
