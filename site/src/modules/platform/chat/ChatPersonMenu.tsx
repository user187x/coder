import {
	CrosshairIcon,
	MessageSquareIcon,
	MonitorUpIcon,
	PaperclipIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { ChatPeer } from "#/api/platform";
import { screenShareKey, updateScreenShare } from "#/api/queries/screenShare";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { displayName, useChatSnapshot } from "./chatStore";
import { ForcedFocusDialog } from "./ForcedFocusDialog";

/** Person actions keep file drafts in the existing conversation composer. */
export const ChatPersonMenu = ({
	peer,
	disabled,
	onOpen,
	onSendFile,
	children,
}: {
	peer: ChatPeer;
	disabled?: boolean;
	onOpen: (peer: ChatPeer) => void;
	onSendFile: (peer: ChatPeer) => void;
	children: React.ReactElement;
}) => {
	const { me } = useChatSnapshot();
	const [forcing, setForcing] = useState(false);
	const client = useQueryClient();
	const request = useMutation({
		...updateScreenShare(),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: screenShareKey });
			toast.success(`Screen share requested from ${displayName(peer)}.`);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not request screen sharing.")),
	});
	return (
		<>
			<ContextMenu modal={false}>
				<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
				<ContextMenuContent
					aria-label={`Actions for ${displayName(peer)}`}
					className="z-[2147483647]"
					onContextMenu={(event) => event.stopPropagation()}
				>
					{me?.admin && (
						<ContextMenuItem
							disabled={disabled || request.isPending}
							onSelect={(event) => {
								event.preventDefault();
								request.mutate({
									action: "request_peer",
									peer: peer.id,
									mode: "dashboard",
								});
							}}
						>
							<MonitorUpIcon />
							{request.isPending ? "Requesting control…" : "Request Control"}
						</ContextMenuItem>
					)}
					<ContextMenuItem
						disabled={disabled}
						onSelect={() => onSendFile(peer)}
					>
						<PaperclipIcon />
						Send file
					</ContextMenuItem>
					<ContextMenuItem disabled={disabled} onSelect={() => onOpen(peer)}>
						<MessageSquareIcon />
						Chat
					</ContextMenuItem>
					{me?.admin && (
						<ContextMenuItem
							disabled={disabled}
							onSelect={(event) => {
								event.preventDefault();
								setForcing(true);
							}}
						>
							<CrosshairIcon />
							Force focus
						</ContextMenuItem>
					)}
				</ContextMenuContent>
			</ContextMenu>
			{forcing && (
				<ForcedFocusDialog peer={peer} onClose={() => setForcing(false)} />
			)}
		</>
	);
};
