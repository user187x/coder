import { MessagesSquareIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
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
	const [optionsOpen, setOptionsOpen] = useState(false);
	const optionsId = useId();
	const toggleOptions = (event: React.SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setOptionsOpen((open) => !open);
	};
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
		<>
			<DropdownMenuItem
				className={className}
				aria-expanded={expanded}
				aria-controls={optionsOpen ? optionsId : undefined}
				title="Right-click for Chat options"
				onContextMenu={toggleOptions}
				onKeyDown={(event) => {
					if (
						event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10") ||
						event.key === "ArrowRight"
					)
						toggleOptions(event);
				}}
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
			{optionsOpen && (
				<div
					id={optionsId}
					role="group"
					className="order-last my-1 w-full min-w-0 rounded-md border border-solid border-border bg-surface-secondary p-1"
					aria-label="Chat options"
				>
					{onPin && (
						<DropdownMenuItem
							onSelect={(event) => {
								event.preventDefault();
								onPin();
							}}
						>
							Add quick link
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						disabled={save.isPending || preferences.isLoading}
						onSelect={(event) => {
							event.preventDefault();
							toggle();
						}}
					>
						{hidden ? "Show" : "Hide"}
					</DropdownMenuItem>
					{admin && (
						<DropdownMenuItem onSelect={() => navigate("/deployment/chat")}>
							Console
						</DropdownMenuItem>
					)}
				</div>
			)}
		</>
	);
};
