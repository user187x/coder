import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { Button } from "#/components/Button/Button";
import { ChatConsole } from "./ChatConsole";
import { closeConsoleOverlay, useChatSnapshot } from "./chatStore";
import { CHAT_CONSOLE_PAGE } from "./consolePlaces";
import "./chatConsoleOverlay.css";

/**
 * Where the focus goes back when what opened the console is gone (the raised window lowered, full screen ended): the
 * dock's console button there now, the bar's or the side panel's.
 */
const BAR_CONSOLE_BUTTON =
	'[role="region"][aria-label="Chats"] [data-testid="chat-open-console"]';

/**
 * Platform: admins' chat console over whatever page is open - what the chat's own console buttons bring up (the
 * Chats bar's, the raised window's, the side panel's, full screen's). The console itself (ChatConsole) in a large
 * panel in the middle, everything else under a see-through Gaussian blur, opening and closing like the quick access
 * wheel (RadialMenu). A click off the panel, Escape or Close puts it away, the focus back on the button; Escape goes
 * no further (chatStore), so the wheel does not open on it. The arrow goes to the console's own page, Controls ›
 * Settings › Chat; the bell and Accounts' Chat still go there (openConsole). Meanwhile the dock's conversation
 * windows are hidden (ChatDock): the console has every conversation, so each shows once.
 */
export const ChatConsoleOverlay: React.FC = () => {
	const state = useChatSnapshot();
	const open = state.consoleOverlay && Boolean(state.me?.admin);
	const overlay = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLElement | null>(null);

	// What had the focus as it opened (the button), before the console takes it - not the console itself, which has
	// it when StrictMode runs this again.
	useLayoutEffect(() => {
		const active = document.activeElement;
		if (!open || (active && overlay.current?.contains(active))) {
			return;
		}
		opener.current =
			active instanceof HTMLElement && active !== document.body ? active : null;
	}, [open]);

	return (
		<DialogPrimitive.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					closeConsoleOverlay();
				}
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					ref={overlay}
					className="chat-console-overlay"
					data-testid="chat-console-overlay"
				>
					<DialogPrimitive.Content
						aria-modal="true"
						className="chat-console-overlay-panel flex h-[min(760px,86vh)] w-[min(1100px,92vw)] rounded-[14px] text-content-primary shadow-[0_24px_80px_rgb(0_0_0/.45),0_2px_8px_rgb(0_0_0/.2)] outline-none"
						data-testid="chat-console-overlay-panel"
						// No conversation to focus the message box of: the panel, not its first checkbox.
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							(event.target as HTMLElement | null)?.focus();
						}}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							const back = opener.current?.isConnected
								? opener.current
								: document.querySelector<HTMLElement>(BAR_CONSOLE_BUTTON);
							back?.focus();
						}}
					>
						<DialogPrimitive.Title className="sr-only">
							Chat console
						</DialogPrimitive.Title>
						<DialogPrimitive.Description className="sr-only">
							Over this page: Escape, a click outside it or Close puts it away.
						</DialogPrimitive.Description>
						<ChatConsole
							place="overlay"
							dock={overlay}
							className="h-full rounded-[14px]"
							actions={
								<>
									<Button asChild variant="subtle" size="icon">
										<Link
											to={CHAT_CONSOLE_PAGE}
											aria-label="Go to the console's page"
											title="Go to the console's page (Controls › Settings › Chat)"
											data-testid="chat-console-overlay-page"
											onClick={(event) => {
												// Not for a new tab or window (Ctrl, Shift): this one keeps it.
												if (
													!event.ctrlKey &&
													!event.metaKey &&
													!event.shiftKey &&
													!event.altKey
												) {
													closeConsoleOverlay();
												}
											}}
										>
											<ArrowUpRightIcon />
										</Link>
									</Button>
									<DialogPrimitive.Close asChild>
										<Button
											variant="subtle"
											size="icon"
											aria-label="Close"
											title="Close (Escape)"
											data-testid="chat-console-overlay-close"
										>
											<XIcon />
										</Button>
									</DialogPrimitive.Close>
								</>
							}
						/>
					</DialogPrimitive.Content>
				</DialogPrimitive.Overlay>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};
