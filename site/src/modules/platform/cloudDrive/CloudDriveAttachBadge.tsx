import { useEffect, useRef } from "react";
import { useQuery } from "react-query";
import { cloudDriveConnections } from "#/api/queries/platform";
import type { Workspace } from "#/api/typesGenerated";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { attachmentMessage, attachmentPending } from "./attachment";
import "./cloudDrive.css";

/**
 * A cloud with an unplugged plug in it: the plug, on its cord, pulled out of its socket - drawn large and bold enough
 * to read at the size it is shown (the Workspaces table: 32px).
 */
export const CloudUnpluggedIcon: React.FC<{ className?: string }> = ({
	className,
}) => (
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.6}
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden
		className={className}
	>
		<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
		{/* the plug: its cord, its body, its two prongs */}
		<path d="M3.9 14.4h2" strokeWidth={1.5} />
		<rect
			x="5.9"
			y="11.8"
			width="3.8"
			height="5.2"
			rx="0.9"
			strokeWidth={1.5}
			fill="currentColor"
			fillOpacity={0.25}
		/>
		<path d="M9.7 13.1h1.7M9.7 15.7h1.7" strokeWidth={1.4} />
		{/* the socket it came out of, apart: its two holes */}
		<path d="M14.4 11.8v5.2" strokeWidth={1.5} />
		<path d="M14.4 13.1h1.4M14.4 15.7h1.4" strokeWidth={1.3} />
	</svg>
);

/**
 * Beside a running workspace's status (the Workspaces table): an orange cloud with an unplugged plug in it, glowing and
 * pulsing, while the signed-in user's Cloud Drive is connected to the workspace but not attached in its container yet
 * (the workspace says so: its agent's metadata, the service's connections' attachment) - gone once it is. Its cable
 * stays red as long (CloudDriveRopes). Only the user's own workspaces (the drive is theirs alone); nothing for one whose
 * template does not report it. As one of them starts (its build, then each change of its status), the connections are
 * read again at once: read before it started, they hold no word of it, and nothing would be waited for (the next read
 * 30 seconds later) - read now, it is "starting", and they are read every two seconds until it is attached.
 */
export const CloudDriveAttachBadge: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const { user } = useAuthenticated();
	const mine = workspace.owner_id === user.id;
	const { data, refetch } = useQuery(cloudDriveConnections(mine));
	const starting =
		mine && workspace.latest_build.transition === "start"
			? `${workspace.latest_build.id}:${workspace.latest_build.status}`
			: "";
	const phase = useRef(starting);
	useEffect(() => {
		// not on the page's first look (every row would read them): when it changes
		if (starting && starting !== phase.current) {
			void refetch();
		}
		phase.current = starting;
	}, [starting, refetch]);
	const word =
		mine && workspace.latest_build.status === "running"
			? attachmentPending(data, workspace.id)
			: null;
	if (!word) {
		return null;
	}
	const message = attachmentMessage(word);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					aria-label={message}
					className="cd-attaching"
					data-testid="cloud-drive-attaching"
					data-attachment={word}
				>
					<CloudUnpluggedIcon className="size-8" />
				</span>
			</TooltipTrigger>
			<TooltipContent>{message}</TooltipContent>
		</Tooltip>
	);
};
