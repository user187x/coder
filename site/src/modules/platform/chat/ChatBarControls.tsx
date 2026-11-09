import {
	ArrowDownToLineIcon,
	Maximize2Icon,
	Minimize2Icon,
	PanelRightIcon,
	PinIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { ChatOnSwitch } from "./ChatPanel";
import { closeConsoleOverlay, setDockMode, useChatSnapshot } from "./chatStore";

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
			<Button
				variant="subtle"
				size="icon"
				aria-label="Back to the chat bar"
				title="Back to the chat bar"
				data-testid="chat-console-back-to-bar"
				onClick={() => leaveFor("bar")}
			>
				<ArrowDownToLineIcon />
			</Button>
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
