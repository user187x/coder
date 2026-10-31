import { MonitorUpIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	screenShareKey,
	screenShares,
	updateScreenShare,
} from "#/api/queries/screenShare";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";

/** Admins request support from the peer; members offer their own screen. */
export const ChatScreenShareMenuItem = ({
	peer,
	disabled,
	admin,
}: {
	peer: string;
	disabled: boolean;
	admin: boolean;
}) => {
	const client = useQueryClient();
	const permissions = useQuery(screenShares());
	const create = useMutation({
		...updateScreenShare(),
		onSuccess: () => client.invalidateQueries({ queryKey: screenShareKey }),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not start screen sharing.")),
	});
	const unavailable =
		disabled || create.isPending || !permissions.data?.canShare;
	const reason = disabled
		? "This conversation is unavailable."
		: permissions.isError
			? "Could not load screen-sharing permissions. Select to retry."
			: permissions.isLoading
				? "Loading screen-sharing permissions."
				: "An administrator must enable user screen sharing in Chat settings.";
	return (
		<DropdownMenuItem
			aria-disabled={unavailable}
			title={
				unavailable
					? reason
					: admin
						? "Ask this user to allow dashboard mouse and keyboard control"
						: "Choose a screen or window to share"
			}
			onSelect={(event) => {
				if (unavailable) {
					event.preventDefault();
					if (permissions.isError) void permissions.refetch();
					toast.info(reason);
					return;
				}
				create.mutate(
					admin
						? { action: "request_peer", peer, mode: "dashboard" }
						: { action: "create", peer },
				);
			}}
		>
			<MonitorUpIcon />
			{admin ? "Request Control" : "Share screen"}
		</DropdownMenuItem>
	);
};
