import { InboxIcon } from "lucide-react";
import { useId, useState } from "react";
import { useQuery } from "react-query";
import { inboxNotifications } from "#/api/queries/notifications";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { DockNotifications } from "#/modules/platform/chat/DockNotifications";

/** A compact view of the signed-in user's inbox inside the docked sidebar. */
export const SettingsInbox = () => {
	const id = useId();
	const [open, setOpen] = useState(false);
	const inbox = useQuery(inboxNotifications());
	const label = open ? "Collapse inbox" : "Expand inbox";
	return (
		<section aria-label="Inbox" className="my-2 min-w-0">
			<DropdownMenuItem
				aria-label={label}
				title={label}
				aria-controls={id}
				aria-expanded={open}
				className="h-5 min-h-0 justify-center rounded-full border border-solid border-border bg-surface-secondary p-0"
				onSelect={(event) => {
					event.preventDefault();
					setOpen((previous) => !previous);
				}}
			>
				<InboxIcon aria-hidden className="size-3" />
			</DropdownMenuItem>
			<div id={id} hidden={!open}>
				{open && (
					<div className="mt-1 flex max-h-64 flex-col overflow-hidden rounded-lg border border-solid border-border">
						<h3 className="m-0 flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
							Inbox
							{inbox.data && (
								<span className="ml-auto text-content-secondary">
									{inbox.data.unread_count} unread
								</span>
							)}
						</h3>
						<DockNotifications />
					</div>
				)}
			</div>
		</section>
	);
};
