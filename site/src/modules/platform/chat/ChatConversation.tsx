import { cn } from "cn";
import { LockIcon, SendIcon, XIcon } from "lucide-react";
import {
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { ChatMessage } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	type ChatWindowState,
	deleteConversation,
	displayName,
	isBlocked,
	loadOlderMessages,
	markRead,
	messageSide,
	reportTyping,
	sendChatMessage,
	setFocusedWindow,
	useChatSnapshot,
} from "./chatStore";
import { takeScreenshot } from "./screenshot";

const MAX_TEXT = 4000;
const TLS_NOTE =
	"Encrypted in transit: this chat travels over HTTPS (TLS) to Coder, where messages are kept for 30 days.";

export const formatWhen = (iso: string) => {
	const date = new Date(iso);
	const today = new Date().toDateString() === date.toDateString();
	return today
		? date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
		: date.toLocaleString("en-US", {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
};

type Screenshot = { dataURL: string; page: string };

/** What the window's or the console's header menu asks of the conversation. */
export type ConversationActions = {
	screenshot: () => void;
	askDelete: () => void;
	focus: () => void;
};

type ChatConversationProps = {
	view: ChatWindowState;
	/** The dock, left out of screenshots. */
	dock: React.RefObject<HTMLElement | null>;
	ref?: React.Ref<ConversationActions>;
	className?: string;
	style?: React.CSSProperties;
	/** Escape in the message box (the window: minimize). */
	onEscape?: () => void;
	/** After a message went out (the console: on to the next waiting chat). */
	onSent?: () => void;
	/** Reports whether a screenshot is being taken (to disable the menu item). */
	onShootingChange?: (shooting: boolean) => void;
};

/**
 * One conversation: the messages (earlier ones on request), who is typing,
 * the notices, and the message box with an optional screenshot. Shown in a
 * docked window (ChatWindow) and in the admins' console (ChatConsole).
 */
export const ChatConversation: React.FC<ChatConversationProps> = ({
	view: w,
	dock,
	ref,
	className,
	style,
	onEscape,
	onSent,
	onShootingChange,
}) => {
	const state = useChatSnapshot();
	const me = state.me;
	const peer = w.peer;
	const name = displayName(peer);
	const blocked = isBlocked(state, peer.id);
	const selfOff = Boolean(me?.admin && !me.chatOn);
	const typing = state.typing.has(peer.id);
	const [text, setText] = useState("");
	const [shot, setShot] = useState<Screenshot | null>(null);
	const [shooting, setShooting] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const logRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const followRef = useRef(true);
	// Two Enters in one frame both see `sending` false: this does not.
	const sendingRef = useRef(false);
	// Prepending older messages keeps the reader where they were.
	const anchorRef = useRef<{ height: number; top: number } | null>(null);

	useEffect(() => {
		if (w.focusRequest) {
			inputRef.current?.focus();
		}
	}, [w.focusRequest]);

	// Each conversation starts fresh: its own draft, at its newest message.
	useEffect(() => {
		setText("");
		setShot(null);
		setError(null);
		setConfirmingDelete(false);
		followRef.current = true;
	}, [peer.id]);

	// Keep the newest message in view while the reader is at the bottom.
	const messageCount = w.messages.length;
	useLayoutEffect(() => {
		const log = logRef.current;
		if (!log || messageCount < 0) {
			return;
		}
		if (anchorRef.current) {
			log.scrollTop =
				log.scrollHeight - anchorRef.current.height + anchorRef.current.top;
			anchorRef.current = null;
		} else if (followRef.current) {
			log.scrollTop = log.scrollHeight;
		}
	}, [messageCount, typing, w.minimized, peer.id]);

	const send = async () => {
		const trimmed = text.trim();
		if ((!trimmed && !shot) || sendingRef.current) {
			return;
		}
		sendingRef.current = true;
		setSending(true);
		setError(null);
		try {
			await sendChatMessage(peer.id, trimmed, shot ?? undefined);
			setText("");
			setShot(null);
			followRef.current = true;
			onSent?.();
		} catch (err) {
			setError(
				`Not sent: ${err instanceof Error ? err.message : "unknown error"}`,
			);
		} finally {
			sendingRef.current = false;
			setSending(false);
			inputRef.current?.focus();
		}
	};

	const screenshot = async () => {
		setError(null);
		setShooting(true);
		onShootingChange?.(true);
		try {
			setShot(await takeScreenshot(dock.current));
			inputRef.current?.focus();
		} catch (err) {
			setShot(null);
			setError(
				`No screenshot: ${err instanceof Error ? err.message : "unknown error"}`,
			);
		} finally {
			setShooting(false);
			onShootingChange?.(false);
		}
	};

	useImperativeHandle(ref, () => ({
		screenshot: () => void screenshot(),
		askDelete: () => setConfirmingDelete(true),
		focus: () => inputRef.current?.focus(),
	}));

	const older = () => {
		const log = logRef.current;
		if (log) {
			anchorRef.current = { height: log.scrollHeight, top: log.scrollTop };
		}
		void loadOlderMessages(peer.id);
	};

	return (
		<div
			className={cn("flex flex-col overflow-hidden", className)}
			style={style}
			onFocus={() => setFocusedWindow(peer.id)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					setFocusedWindow(null);
				}
			}}
		>
			<div className="relative flex min-h-0 flex-1 flex-col">
				<div
					ref={logRef}
					role="log"
					aria-live="polite"
					aria-label={`Messages with ${name}`}
					className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 py-2.5"
					onScroll={(event) => {
						const log = event.currentTarget;
						followRef.current =
							log.scrollHeight - log.scrollTop - log.clientHeight < 60;
						if (log.scrollTop < 40 && !w.olderDone && !w.loadingOlder) {
							older();
						}
					}}
				>
					{!w.loading && !w.olderDone && w.messages.length > 0 && (
						<button
							type="button"
							onClick={older}
							disabled={w.loadingOlder}
							className="mb-1 self-center cursor-pointer rounded-full border border-solid border-border bg-surface-secondary px-2.5 py-0.5 text-[11px] text-content-secondary hover:text-content-primary disabled:cursor-wait"
						>
							{w.loadingOlder ? "Loading…" : "Earlier messages"}
						</button>
					)}
					<MessageLog view={w} meId={me?.id ?? ""} name={name} />
				</div>
				{location.protocol === "https:" && (
					<span
						role="img"
						aria-label={TLS_NOTE}
						title={TLS_NOTE}
						className="absolute top-2.5 right-[18px] z-[1] flex size-6 items-center justify-center rounded-full border border-solid border-border bg-surface-primary/80 text-content-secondary shadow-sm backdrop-blur-sm"
					>
						<LockIcon className="size-3" />
					</span>
				)}
			</div>

			{typing && (
				<div className="flex items-center gap-1.5 px-3 pb-1.5 text-xs text-content-secondary">
					<span>{name} is typing</span>
					<span aria-hidden className="inline-flex gap-[3px]">
						{[0, 150, 300].map((delay) => (
							<i
								key={delay}
								className="size-[5px] rounded-full bg-current animate-bounce motion-reduce:animate-none"
								style={{ animationDelay: `${delay}ms` }}
							/>
						))}
					</span>
				</div>
			)}

			{(blocked || selfOff) && (
				<p
					role="status"
					className="m-0 border-0 border-t border-solid border-border bg-surface-secondary px-3 py-1.5 text-xs text-content-secondary"
				>
					{blocked
						? `${name} isn't taking chats right now. Try again later or message another admin.`
						: "Your chat is off: developers can't write to you. Turn it on in the Chats panel."}
				</p>
			)}

			{confirmingDelete && (
				<div className="flex flex-col gap-2 border-0 border-t border-solid border-border px-3 py-2">
					<p className="m-0 text-xs text-content-secondary">
						Delete every message with {name}, for both of you? This can't be
						undone.
					</p>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="outline"
							className="flex-1"
							disabled={deleting}
							onClick={() => {
								setConfirmingDelete(false);
								inputRef.current?.focus();
							}}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="destructive"
							className="flex-1"
							disabled={deleting}
							onClick={async () => {
								setDeleting(true);
								try {
									await deleteConversation(peer.id);
								} catch (err) {
									setError(
										`Not deleted: ${err instanceof Error ? err.message : "unknown error"}`,
									);
								} finally {
									setDeleting(false);
									setConfirmingDelete(false);
								}
							}}
						>
							Delete
						</Button>
					</div>
				</div>
			)}

			{(error || w.loadError) && (
				<p
					role="alert"
					className="m-0 px-3 py-1 text-xs text-content-destructive"
				>
					{error ?? w.loadError}
				</p>
			)}

			{(shot || shooting) && (
				<div className="flex items-center gap-2 border-0 border-t border-solid border-border px-2 pt-2">
					{shot ? (
						<>
							<a
								href={shot.dataURL}
								target="_blank"
								rel="noopener noreferrer"
								title="Open full size"
								className="block h-[46px] w-[72px] shrink-0 overflow-hidden rounded border border-solid border-border"
							>
								<img
									src={shot.dataURL}
									alt="Screenshot to send"
									className="block size-full object-cover"
								/>
							</a>
							<span className="min-w-0 flex-1 text-xs leading-snug text-content-secondary [overflow-wrap:anywhere]">
								<strong className="font-semibold text-content-primary">
									Screenshot
								</strong>{" "}
								of {shot.page}. Add a note and send, or remove it.
							</span>
							<Button
								variant="subtle"
								size="icon"
								aria-label="Remove the screenshot"
								title="Remove the screenshot"
								onClick={() => {
									setShot(null);
									inputRef.current?.focus();
								}}
							>
								<XIcon />
							</Button>
						</>
					) : (
						<span className="text-xs text-content-secondary">
							Taking a screenshot…
						</span>
					)}
				</div>
			)}

			<form
				className={cn(
					"flex items-end gap-1.5 p-2 border-0 border-solid border-border",
					!(shot || shooting) && "border-t",
					blocked && "opacity-55",
				)}
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
			>
				<textarea
					ref={inputRef}
					rows={1}
					value={text}
					maxLength={MAX_TEXT}
					disabled={blocked}
					placeholder={blocked ? `${name} has turned chat off` : "Message"}
					aria-label={`Message ${name}`}
					className="max-h-[120px] min-h-9 flex-1 resize-none rounded-[18px] border border-solid border-border bg-surface-primary px-2.5 py-2 text-sm leading-snug text-inherit field-sizing-content disabled:cursor-not-allowed"
					onFocus={() => markRead(peer.id, true)}
					onChange={(event) => {
						setText(event.target.value);
						if (event.target.value.trim()) {
							reportTyping(peer.id);
						}
					}}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							if (!event.repeat) {
								void send();
							}
						}
						if (event.key === "Escape" && onEscape) {
							event.preventDefault();
							onEscape();
						}
					}}
				/>
				<Button
					type="submit"
					size="icon"
					disabled={blocked || sending}
					aria-label="Send"
					title="Send (Enter)"
					className="rounded-full"
				>
					<SendIcon />
				</Button>
			</form>
		</div>
	);
};

type MessageLogProps = {
	view: ChatWindowState;
	meId: string;
	name: string;
};

const MessageLog: React.FC<MessageLogProps> = ({ view: w, meId, name }) => {
	if (w.loading) {
		return null;
	}
	if (w.clearedByPeer && !w.messages.length) {
		return (
			<p className="m-auto text-sm text-content-secondary">
				{name} deleted this conversation.
			</p>
		);
	}
	if (!w.messages.length) {
		return (
			<p className="m-auto text-sm text-content-secondary">
				Say hello to {name}.
			</p>
		);
	}

	let lastShown = 0;
	let previousFrom: string | null = null;
	return w.messages.map((m) => {
		const at = new Date(m.at).getTime();
		const gap = !lastShown || at - lastShown > 10 * 60_000;
		lastShown = at;
		const grouped = !gap && previousFrom === m.from;
		previousFrom = m.from;
		const side = messageSide(m, meId);
		const mine = m.from === meId;
		return (
			<div key={m.id} className="contents">
				{gap && (
					<div className="mt-2.5 mb-0.5 self-center text-[11px] text-content-secondary">
						{formatWhen(m.at)}
					</div>
				)}
				{!grouped && (
					<div
						className={cn(
							"mx-1 mt-2 mb-0.5 text-[11px] font-semibold text-content-secondary",
							side === "dev" && "self-end",
						)}
					>
						{mine ? "You" : m.fromDisplay || m.fromName}
					</div>
				)}
				<MessageBubble message={m} side={side} />
			</div>
		);
	});
};

type MessageBubbleProps = {
	message: ChatMessage;
	side: "admin" | "dev";
};

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, side }) => (
	<div
		className={cn("flex", side === "dev" && "justify-end")}
		title={formatWhen(message.at)}
	>
		<div
			className={cn(
				"max-w-[80%] rounded-[14px] border border-solid px-2.5 py-1.5 leading-snug whitespace-pre-wrap [overflow-wrap:anywhere] text-content-primary",
				side === "admin"
					? "rounded-bl bg-surface-sky border-border-sky"
					: "rounded-br bg-surface-tertiary border-border",
			)}
		>
			{message.image && (
				<>
					<a
						href={message.image}
						target="_blank"
						rel="noopener noreferrer"
						title="Open full size"
						className="-mx-1.5 -mt-0.5 mb-1 block"
					>
						<img
							src={message.image}
							alt={`Screenshot${message.page ? ` of ${message.page}` : ""}`}
							className="block max-h-[180px] max-w-full rounded-[10px]"
						/>
					</a>
					{message.page && (
						<div className="mb-0.5 text-[11px] text-content-secondary [overflow-wrap:anywhere]">
							Screenshot of {message.page}
						</div>
					)}
				</>
			)}
			{message.text && <div>{message.text}</div>}
		</div>
	</div>
);
