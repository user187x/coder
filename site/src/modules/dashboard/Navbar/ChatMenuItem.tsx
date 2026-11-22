import {
	ArrowUpFromLineIcon,
	EyeIcon,
	EyeOffIcon,
	MessagesSquareIcon,
	PinIcon,
	SquareTerminalIcon,
} from "lucide-react";
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
	closeConsoleOverlay,
	setDockMode,
	unreadTotal,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";
import { CHAT_CONSOLE_PAGE } from "#/modules/platform/chat/consolePlaces";
import { useChatEnabled } from "#/modules/platform/chat/useChatEnabled";
import { InlineMenuPanel, useInlineMenu } from "./InlineMenu";

/** The navbar's recovery control for a hidden chat dock. */
const ChatMenuItemBody = ({
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
	const menu = useInlineMenu({ arrowRight: true });
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
			{ chat_hidden: false, chat_position: null },
			{ onSuccess: () => setDockMode("bar") },
		);
	};
	const setVisible = (visible: boolean, resetPosition = false) => {
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
		save.mutate(
			{ chat_hidden: !visible, ...(resetPosition && { chat_position: null }) },
			{
				onSuccess: () => {
					closeConsoleOverlay();
					if (expanded) onToggle?.();
					setDockMode("bar");
				},
			},
		);
	};
	return (
		<>
			<DropdownMenuItem
				className={className}
				{...menu.trigger}
				aria-expanded={menu.open || Boolean(onToggle && expanded)}
				title="Right-click for Chat options"
				onSelect={(event) => {
					if (onToggle) {
						event.preventDefault();
						onToggle();
					} else if (admin) {
						navigate(CHAT_CONSOLE_PAGE);
					} else show();
				}}
			>
				<MessagesSquareIcon aria-hidden />
				<span className="flex-1">Chat</span>
				{total > 0 && <CountBadge count={total} />}
			</DropdownMenuItem>
			{menu.open && (
				<InlineMenuPanel
					id={menu.id}
					className="order-last"
					label="Chat options"
					quickLinkMenu={menu}
				>
					{onPin && (
						<DropdownMenuItem
							onSelect={(event) => {
								event.preventDefault();
								onPin();
							}}
						>
							<PinIcon aria-hidden />
							Add quick link
						</DropdownMenuItem>
					)}
					{hidden && (
						<DropdownMenuItem
							disabled={save.isPending}
							onSelect={(event) => {
								event.preventDefault();
								setVisible(true, true);
							}}
						>
							<EyeIcon aria-hidden />
							Show
						</DropdownMenuItem>
					)}
					{admin && (
						<DropdownMenuItem onSelect={() => navigate(CHAT_CONSOLE_PAGE)}>
							<SquareTerminalIcon aria-hidden />
							Console
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						disabled={save.isPending || preferences.isLoading}
						onSelect={(event) => {
							event.preventDefault();
							setVisible(true);
						}}
					>
						<ArrowUpFromLineIcon aria-hidden />
						Panel
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={
							save.isPending || preferences.isLoading || (hidden && !expanded)
						}
						onSelect={(event) => {
							event.preventDefault();
							setVisible(false);
						}}
					>
						<EyeOffIcon aria-hidden />
						Hide
					</DropdownMenuItem>
				</InlineMenuPanel>
			)}
		</>
	);
};

/** The Settings menu's Chat entry; nothing at all while chat is turned off for the deployment. */
export const ChatMenuItem = (
	props: React.ComponentProps<typeof ChatMenuItemBody>,
) => (useChatEnabled() ? <ChatMenuItemBody {...props} /> : null);
