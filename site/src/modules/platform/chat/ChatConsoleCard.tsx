import { AppWindowIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/Button/Button";
import { ChatConsole } from "./ChatConsole";
import {
	attachConsole,
	closeConsole,
	useChatConnection,
	useChatSnapshot,
} from "./chatStore";
import {
	CHAT_CONSOLE_CHANNEL,
	CHAT_CONSOLE_PAGE,
	CHAT_CONSOLE_WINDOW,
	CHAT_CONSOLE_WINDOW_NAME,
} from "./consolePlaces";

/** The card's and the window's channel ("ping": is the window open? "out": it is; "in": pop back in). */
const channel = () =>
	typeof BroadcastChannel === "undefined"
		? null
		: new BroadcastChannel(CHAT_CONSOLE_CHANNEL);

/** The popped-out window, without loading it again (or null: a blank one opened instead is closed at once). */
const consoleWindow = (): Window | null => {
	const w = window.open("", CHAT_CONSOLE_WINDOW_NAME);
	if (w && w.location.href === "about:blank") {
		w.close();
		return null;
	}
	return w;
};

/**
 * Controls › Settings › Chat: admins' chat console, in a card at the top - out of the dashboard's way (the little
 * chat windows stay at the bottom right). Pop out puts it in a window of its own, full size; Pop back in (here, or
 * in that window) brings it back.
 */
export const ChatConsoleCard: React.FC = () => {
	const { me } = useChatSnapshot();
	const [poppedOut, setPoppedOut] = useState(false);
	const popup = useRef<Window | null>(null);

	// The window says when it opens and closes; asked on arrival, it says it is there.
	useEffect(() => {
		const ch = channel();
		if (!ch) {
			return;
		}
		ch.onmessage = (event) => {
			if (event.data === "out") {
				setPoppedOut(true);
			} else if (event.data === "in") {
				setPoppedOut(false);
				popup.current = null;
			}
		};
		ch.postMessage("ping");
		return () => ch.close();
	}, []);

	// Closed with its own window button: the console comes back here.
	useEffect(() => {
		if (!poppedOut) {
			return;
		}
		const timer = window.setInterval(() => {
			if (popup.current?.closed) {
				popup.current = null;
				setPoppedOut(false);
			}
		}, 1000);
		return () => window.clearInterval(timer);
	}, [poppedOut]);

	// On screen here: the console is open (new messages wait in it, not in windows that pop up).
	useEffect(() => {
		if (poppedOut || !me?.admin) {
			return;
		}
		attachConsole();
		return () => closeConsole();
	}, [poppedOut, me?.admin]);

	if (!me?.admin) {
		return null;
	}

	const popOut = () => {
		const w = window.open(
			CHAT_CONSOLE_WINDOW,
			CHAT_CONSOLE_WINDOW_NAME,
			`popup,width=${window.screen.availWidth},height=${window.screen.availHeight}`,
		);
		if (!w) {
			toast.error(
				"The browser kept the window from opening: allow pop-ups for this site.",
			);
			return;
		}
		popup.current = w;
		setPoppedOut(true);
		w.focus();
	};
	const popIn = () => {
		(popup.current ?? consoleWindow())?.close();
		popup.current = null;
		setPoppedOut(false);
	};

	return (
		<section
			aria-labelledby="chat-console-card"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
			data-testid="chat-console-card"
		>
			<h2 id="chat-console-card" className="m-0 text-base font-semibold">
				Chat console
			</h2>
			<p className="m-0 text-sm text-content-secondary">
				Every conversation in one place: what waits for an answer, what is
				unread, everything. Right-click a conversation for its person's
				workspace, Cloud Drive or Force Response; choose several people for one
				group chat.
			</p>
			{poppedOut ? (
				<div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-8 text-center text-sm text-content-secondary">
					<AppWindowIcon className="size-6 opacity-60" />
					The chat console is in a window of its own.
					<span className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => (popup.current ?? consoleWindow())?.focus()}
						>
							Show the window
						</Button>
						<Button onClick={popIn} data-testid="chat-console-pop-in">
							<Minimize2Icon />
							Pop back in
						</Button>
					</span>
				</div>
			) : (
				<ChatConsole
					place="card"
					className="h-[min(640px,75vh)]"
					actions={
						<Button
							variant="subtle"
							size="icon"
							onClick={popOut}
							aria-label="Pop out into a window of its own"
							title="Pop out into a window of its own, full size"
							data-testid="chat-console-pop-out"
						>
							<Maximize2Icon />
						</Button>
					}
				/>
			)}
		</section>
	);
};

/**
 * The console popped out (/chat-console): the whole window, no dashboard around it. Pop back in closes it, and the
 * console is on the Chat page again (the dashboard's tab goes there).
 */
export const ChatConsoleWindow: React.FC = () => {
	// No dashboard (and no dock) here: the window keeps its own connection.
	useChatConnection(true);
	const { me } = useChatSnapshot();

	useEffect(() => {
		if (!me?.admin) {
			return;
		}
		attachConsole();
		const ch = channel();
		if (ch) {
			ch.onmessage = (event) => {
				if (event.data === "ping") {
					ch.postMessage("out");
				}
			};
			ch.postMessage("out");
		}
		const leaving = () => ch?.postMessage("in");
		window.addEventListener("pagehide", leaving);
		return () => {
			window.removeEventListener("pagehide", leaving);
			leaving();
			ch?.close();
			closeConsole();
		};
	}, [me?.admin]);

	if (!me) {
		return null;
	}
	if (!me.admin) {
		return (
			<p className="m-6 text-sm text-content-secondary">
				The chat console is for admins.
			</p>
		);
	}
	const popIn = () => {
		const opener: Window | null = window.opener;
		if (opener && !opener.closed) {
			if (opener.location.pathname !== CHAT_CONSOLE_PAGE) {
				opener.location.assign(CHAT_CONSOLE_PAGE);
			}
			opener.focus();
		}
		window.close();
	};
	return (
		<div className="flex h-screen flex-col bg-surface-primary p-2">
			<ChatConsole
				place="window"
				className="flex-1"
				actions={
					<Button
						variant="subtle"
						size="icon"
						onClick={popIn}
						aria-label="Pop back in"
						title="Pop back in: the console on the Chat page again"
						data-testid="chat-console-window-pop-in"
					>
						<Minimize2Icon />
					</Button>
				}
			/>
		</div>
	);
};
