import {
	ArrowDownToLineIcon,
	Maximize2Icon,
	Minimize2Icon,
	PanelRightIcon,
	PinIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { ChatOnSwitch } from "./ChatPanel";
import { closeConsoleOverlay, setDockMode, useChatSnapshot } from "./chatStore";

/** Show the dashboard's chat bar, including when saved preferences hide it. */
export function ShowChatBarButton({
	label = "Show chat bar",
	onShow,
}: {
	label?: string;
	onShow?: () => void;
}) {
	const preferences = useQuery(userUIPreferences());
	const client = useQueryClient();
	const save = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not show the chat bar.")),
	});
	const show = () => {
		closeConsoleOverlay();
		setDockMode("bar");
		onShow?.();
	};
	return (
		<Button
			variant="subtle"
			size="icon"
			aria-label={label}
			title={label}
			data-testid="chat-console-back-to-bar"
			disabled={preferences.isLoading || save.isPending}
			onClick={() => {
				if (preferences.data && !preferences.data.chat_hidden) {
					show();
				} else {
					save.mutate({ chat_hidden: false }, { onSuccess: show });
				}
			}}
		>
			<ArrowDownToLineIcon aria-hidden />
		</Button>
	);
}

/**
 * The chat bar's controls, in the chat console's header (the bar itself keeps only collapse, window and close): back
 * to the bottom chat bar, keep the chat open, taking chats (admins), attach to the right side, full screen, and hide the
 * bar.
 */
export const ChatBarControls: React.FC = () => {
	const state = useChatSnapshot();
	const client = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const save = useMutation(updateUserUIPreferences(client));
	const keepOpen = Boolean(preferences.data?.chat_keep_open);
	const leaveFor = (mode: Parameters<typeof setDockMode>[0]) => {
		closeConsoleOverlay();
		setDockMode(mode);
	};
	return (
		<>
			<ShowChatBarButton label="Back to the chat bar" />
			<Button
				variant="subtle"
				size="icon"
				aria-label="Keep chat open"
				title={
					keepOpen ? "Unpin chat" : "Keep chat open when clicking elsewhere"
				}
				aria-pressed={keepOpen}
				disabled={save.isPending}
				onClick={() => save.mutate({ chat_keep_open: !keepOpen })}
			>
				<PinIcon
					className={keepOpen ? "fill-current text-content-link" : undefined}
				/>
			</Button>
			{state.me?.admin && <ChatOnSwitch className="px-1.5" />}
			<Button
				variant="subtle"
				size="icon"
				aria-label="Attach to the right side"
				title="Attach to the right side"
				onClick={() => leaveFor("side")}
			>
				<PanelRightIcon />
			</Button>
			<Button
				variant="subtle"
				size="icon"
				aria-label="Full screen"
				title="Full screen"
				onClick={() => leaveFor("full")}
			>
				<Maximize2Icon />
			</Button>
			<Button
				variant="subtle"
				size="icon"
				aria-label="Hide chat bar"
				title="Hide chat bar"
				onClick={() => leaveFor("compact")}
			>
				<Minimize2Icon />
			</Button>
		</>
	);
};
