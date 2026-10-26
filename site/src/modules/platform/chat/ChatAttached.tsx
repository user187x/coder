import { cn } from "cn";
import {
	Maximize2Icon,
	Minimize2Icon,
	MinusIcon,
	PictureInPicture2Icon,
} from "lucide-react";
import {
	ChatHeading,
	ChatOnSwitch,
	ConsoleButton,
	DockButton,
} from "./ChatPanel";
import { exitFullScreen, setDockMode, useChatSnapshot } from "./chatStore";
import { DockSections } from "./DockSections";

type AttachedProps = {
	/** The dock, left out of screenshots. */
	dock: React.RefObject<HTMLElement | null>;
};

/** From the navbar's bottom down to the bottom bars (ChatDock measures both). */
const BELOW_NAVBAR: React.CSSProperties = {
	top: "var(--chat-top, 0px)",
	bottom: "var(--chat-bottom, 0px)",
};

const headerClass =
	"flex h-11 shrink-0 items-center gap-2 border-0 border-b border-solid border-border pl-3.5 pr-1 text-[13px] font-semibold";

/**
 * The chat attached to the right side: a panel from the navbar's bottom down
 * to the bottom bars, which the page narrows beside on a wide screen
 * (chatDock.css). Its list, and the conversation picked from it, live in it
 * rather than in windows. It stays where it is - clicks elsewhere and Escape
 * leave it be - until it is detached (back to the raised window), goes full
 * screen or is minimized to the bar. It comes back attached on the next page
 * load (initialDockMode).
 */
export const ChatSidePanel: React.FC<AttachedProps> = ({ dock }) => {
	const state = useChatSnapshot();
	const me = state.me;
	if (!me) {
		return null;
	}
	const view = state.panelView;
	return (
		<section
			aria-label="Chats side panel"
			data-testid="chat-side-panel"
			// Platform: its top and the navbar beside it in chatDock.css (.chat-side-panel)
			className="chat-side-panel fixed right-0 flex w-[min(380px,100vw)] flex-col border-0 border-l border-solid border-border bg-surface-primary shadow-[-8px_0_28px_rgb(0_0_0/.12)] animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
		>
			<header className={headerClass}>
				<ChatHeading />
				{me.admin && <ChatOnSwitch className="px-1" />}
				{me.admin && <ConsoleButton peer={view?.peer} />}
				<DockButton
					label="Detach into a window"
					testId="chat-mode-detach"
					onClick={() => setDockMode("window")}
				>
					<PictureInPicture2Icon />
				</DockButton>
				<DockButton
					label="Full screen"
					testId="chat-mode-fullscreen"
					onClick={() => setDockMode("full")}
				>
					<Maximize2Icon />
				</DockButton>
				<DockButton
					label="Minimize"
					testId="chat-mode-minimize"
					onClick={() => setDockMode("bar")}
				>
					<MinusIcon />
				</DockButton>
			</header>
			<DockSections dock={dock} />
		</section>
	);
};

/**
 * The chat over the page below the navbar, like a messenger: the list on the
 * left, the conversation picked from it on the right (on a narrow screen one
 * at a time). Exit full screen, or Escape, goes back to the raised window or
 * the side panel, whichever it came from; so does going to another page
 * (ChatDock).
 */
export const ChatFullScreen: React.FC<AttachedProps> = ({ dock }) => {
	const state = useChatSnapshot();
	const me = state.me;
	if (!me) {
		return null;
	}
	const view = state.panelView;
	return (
		<section
			role="dialog"
			aria-label="Chats full screen"
			// The quick access wheel leaves Escape to an open dialog (RadialMenu's POPUPS): here it ends full screen.
			data-state="open"
			data-testid="chat-fullscreen"
			className="fixed inset-x-0 flex flex-col bg-surface-primary animate-in fade-in-0 duration-150 motion-reduce:animate-none"
			style={BELOW_NAVBAR}
		>
			<header className={cn(headerClass, "bg-surface-secondary pl-4")}>
				<ChatHeading />
				{me.admin && <ChatOnSwitch className="px-1" />}
				{me.admin && <ConsoleButton peer={view?.peer} />}
				<DockButton
					label="Exit full screen"
					title="Exit full screen (Escape)"
					testId="chat-mode-exit-fullscreen"
					onClick={exitFullScreen}
				>
					<Minimize2Icon />
				</DockButton>
			</header>
			<DockSections dock={dock} wide />
		</section>
	);
};
