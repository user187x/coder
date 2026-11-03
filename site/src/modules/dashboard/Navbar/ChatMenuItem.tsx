import { MessagesSquareIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { CountBadge } from "#/modules/platform/chat/ChatWindow";
import {
	setDockMode,
	unreadTotal,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";

/** The navbar's recovery control for a hidden chat dock. */
export const ChatMenuItem = ({
	admin = false,
	className,
	expanded,
	onToggle,
	onPin,
}: {
	admin?: boolean;
	className?: string;
	expanded?: boolean;
	onToggle?: () => void;
	onPin?: () => void;
}) => {
	const total = unreadTotal(useChatSnapshot());
	const navigate = useNavigate();
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const hidden = Boolean(preferences.data?.chat_hidden);
	const save = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save chat visibility.")),
	});
	const show = () => {
		save.mutate(
			{ chat_hidden: false },
			{ onSuccess: () => setDockMode("bar") },
		);
	};
	const toggle = () => {
		if (preferences.isError && !preferences.data) {
			toast.error(
				getErrorMessage(
					preferences.error,
					"Could not load chat visibility. Try again.",
				),
			);
			void preferences.refetch();
			return;
		}
		if (hidden) show();
		else save.mutate({ chat_hidden: true });
	};
	return (
		<ContextMenu>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				<DropdownMenuItem
					className={className}
					aria-expanded={expanded}
					onSelect={(event) => {
						if (onToggle) {
							event.preventDefault();
							onToggle();
						} else if (admin) navigate("/deployment/chat");
						else show();
					}}
				>
					<MessagesSquareIcon aria-hidden />
					<span className="flex-1">Chat</span>
					{total > 0 && <CountBadge count={total} />}
				</DropdownMenuItem>
			</ContextMenuTrigger>
			<ContextMenuContent className="z-[80]" aria-label="Chat options">
				{onPin && (
					<ContextMenuItem onSelect={onPin}>Add quick link</ContextMenuItem>
				)}
				<ContextMenuItem
					disabled={save.isPending || preferences.isLoading}
					onSelect={toggle}
				>
					{hidden ? "Show" : "Hide"}
				</ContextMenuItem>
				{admin && (
					<ContextMenuItem onSelect={() => navigate("/deployment/chat")}>
						Settings
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
};
