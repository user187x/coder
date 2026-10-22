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
 * The cloud disconnected: a cloud struck through (the project's cloud-disconnect.svg, in the current colour) - the
 * Workspaces table's connecting cloud (32px).
 */
export const CloudUnpluggedIcon: React.FC<{ className?: string }> = ({
	className,
}) => (
	<svg
		viewBox="0 0 24 24"
		fill="currentColor"
		aria-hidden
		data-testid="cloud-disconnect-icon"
		className={className}
	>
		<path d="M23.9388 15.5305C23.8976 13.572 22.5715 11.6399 20.2399 11.1301C20.6366 8.19441 18.6352 5.55606 16.1475 4.55683C14.7192 3.98314 13.0591 3.90634 11.4894 4.61884C10.6948 4.97952 9.95397 5.5283 9.29326 6.27428L10.7109 7.69191C11.2284 7.08364 11.7783 6.68412 12.3161 6.44C13.3264 5.98139 14.4137 6.01573 15.402 6.41272C17.4546 7.23718 18.7918 9.45194 18.0981 11.5493C17.8631 12.2598 18.3877 12.9816 19.1179 13.0017C20.991 13.0535 21.9134 14.3471 21.9392 15.5725C21.9522 16.1921 21.7361 16.7819 21.299 17.2166C21.1358 17.379 20.9304 17.5309 20.6759 17.6569L22.1332 19.1142C22.3412 18.9699 22.5336 18.8096 22.7096 18.6345C23.5704 17.7781 23.9622 16.6436 23.9388 15.5305Z" />
		<path d="M17.0547 20.0001L6.00002 20.0001C2.02368 20.0001 -0.0242121 16.4791 0.251925 13.4333C0.393448 11.8722 1.13583 10.3318 2.59153 9.33665C3.36385 8.80868 4.29719 8.46091 5.38235 8.32777L7.38131 10.3267C5.67248 10.1222 4.49222 10.46 3.72022 10.9877C2.82799 11.5977 2.33964 12.5562 2.24376 13.6138C2.04508 15.8053 3.49567 18.0001 6.00002 18.0001L15.0547 18.0001L17.0547 20.0001Z" />
		<path d="M2.0079 3.4221C1.61738 3.03158 1.61738 2.39841 2.0079 2.00789C2.39843 1.61737 3.03159 1.61737 3.42212 2.00789L22.0004 20.5862C22.391 20.9767 22.391 21.6099 22.0004 22.0004C21.6099 22.391 20.9768 22.391 20.5862 22.0004L2.0079 3.4221Z" />
	</svg>
);

/**
 * Beside a running workspace's status (the Workspaces table): an orange cloud struck through (disconnected), glowing
 * and pulsing, while the signed-in user's Cloud Drive is connected to the workspace but not attached in its container yet
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
