import { cn } from "cn";
import { PlugIcon, PlusIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	cloudDriveConnections,
	safe,
	setCloudDriveConnection,
} from "#/api/queries/platform";
import type { Workspace } from "#/api/typesGenerated";
import { pendingAttachments } from "./attachment";

/** The signed-in user's Cloud Drive and its connections: whether there is one, and which workspaces have it. */
export const useCloudDriveLinks = () => {
	const { data: summary } = useQuery(safe());
	const enabled = Boolean(summary?.enabled);
	const connections = useQuery(cloudDriveConnections(enabled));
	const data = connections.data;
	return {
		enabled,
		ready: Boolean(data),
		off: new Set(data?.disconnected ?? []),
		shared: new Set(data?.shared ?? []),
		older: new Set(data?.older ?? []),
		attaching: new Set(pendingAttachments(data)),
	};
};

/** A workspace of the user's own with their Cloud Drive (not disconnected, not shared with others). */
export const isLinked = (
	links: ReturnType<typeof useCloudDriveLinks>,
	workspaceId: string,
) =>
	links.ready && !links.off.has(workspaceId) && !links.shared.has(workspaceId);

const tile =
	"inline-flex size-9 items-center justify-center rounded-[10px] border border-solid p-0 transition-colors";

/**
 * Platform: the Workspaces table's Drive column - the row's socket for the Cloud Drive. The user's own workspace:
 * a plug while it has the drive (amber until the workspace has attached it), an empty socket while not; a click
 * plugs it in or pulls it out, as dragging a cable does. Someone else's, or one shared with others: an empty socket
 * that takes no plug (the Cloud Drive is its owner's alone).
 */
export const CloudDriveSocket: React.FC<{
	workspace: Workspace;
	links: ReturnType<typeof useCloudDriveLinks>;
	mine: boolean;
}> = ({ workspace, links, mine }) => {
	const queryClient = useQueryClient();
	const link = useMutation(setCloudDriveConnection(queryClient));
	if (!links.enabled) {
		return null;
	}
	const shared = links.shared.has(workspace.id);
	if (!mine || shared || !links.ready) {
		return (
			<span
				className={cn(
					tile,
					"border-dashed border-border text-content-disabled opacity-60",
				)}
				data-testid={`cloud-drive-socket-${workspace.id}`}
				data-state="none"
				data-hint={
					!links.ready
						? "Reading the Cloud Drive's connections…"
						: shared
							? "Shared with others: your Cloud Drive stays out of it"
							: `Only ${workspace.owner_name}'s own Cloud Drive plugs in here`
				}
			>
				<PlusIcon aria-hidden className="size-4" />
			</span>
		);
	}
	const on = !links.off.has(workspace.id);
	const attaching = on && links.attaching.has(workspace.id);
	const later = links.older.has(workspace.id)
		? " - once it is updated to its template's latest version"
		: "";
	const hint = attaching
		? `Cloud Drive plugged in, not attached in ${workspace.name} yet: click to unplug`
		: on
			? `Cloud Drive mounted at ~/cloud-drive: click to unmount${later}`
			: `No Cloud Drive: click to mount it at ~/cloud-drive${later}`;
	return (
		<button
			type="button"
			className={cn(
				tile,
				"cursor-pointer disabled:cursor-wait",
				attaching
					? "border-border-warning bg-surface-orange text-content-warning"
					: on
						? "border-[hsl(var(--content-link)/0.25)] bg-[hsl(var(--content-link)/0.1)] text-content-link hover:bg-[hsl(var(--content-link)/0.16)]"
						: "border-dashed border-border-secondary bg-transparent text-content-secondary hover:border-content-link hover:text-content-link",
			)}
			aria-label={hint}
			aria-pressed={on}
			data-testid={`cloud-drive-socket-${workspace.id}`}
			data-state={attaching ? "attaching" : on ? "on" : "off"}
			disabled={link.isPending}
			onClick={(e) => {
				e.stopPropagation();
				link.mutate(
					{ workspaceId: workspace.id, connected: !on },
					{
						onError: (err) => toast.error(getErrorMessage(err, "Not changed.")),
					},
				);
			}}
		>
			{on ? (
				<PlugIcon aria-hidden className="size-4" />
			) : (
				<PlusIcon aria-hidden className="size-4" />
			)}
		</button>
	);
};
