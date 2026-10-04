import { cn } from "cn";
import {
	CameraIcon,
	ChevronUpIcon,
	EllipsisVerticalIcon,
	LockIcon,
	MinusIcon,
	SendIcon,
	TrashIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ChatAvatar } from "./ChatAvatar";
import {
	type ChatWindowState,
	closeWindow,
	deleteConversation,
	displayName,
	isBlocked,
	markRead,
	messageSide,
	reportTyping,
	sendChatMessage,
	setFocusedWindow,
	setMinimized,
	useChatSnapshot,
} from "./chatStore";
import { takeScreenshot } from "./screenshot";

const HEIGHT_KEY = "coder-ui-chat-height";
const DEFAULT_HEIGHT = 380;
const MIN_HEIGHT = 160;
const MAX_TEXT = 4000;
const TLS_NOTE =
	"Encrypted in transit: this chat travels over HTTPS (TLS) to Coder, where messages are kept for 30 days.";

const preferredHeight = () => {
	try {
		return Number(localStorage.getItem(HEIGHT_KEY)) || DEFAULT_HEIGHT;
	} catch {
		return DEFAULT_HEIGHT;
	}
};

const rememberHeight = (height: number | null) => {
	try {
		if (height === null) {
			localStorage.removeItem(HEIGHT_KEY);
		} else {
			localStorage.setItem(HEIGHT_KEY, String(Math.round(height)));
		}
	} catch {
		// Not kept for the next window.
	}
};

const formatWhen = (iso: string) => {
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

type ChatWindowProps = {
	window: ChatWindowState;
	/** The dock, left out of screenshots. */
	dock: React.RefObject<HTMLElement | null>;
};

/**
 * One conversation, Gmail style. It can be minimized to its title bar or
 * closed (a closed conversation comes back when a new message arrives), and
 * resized from its top edge within the room the dock has.
 */
export const ChatWindow: React.FC<ChatWindowProps> = ({ window: w, dock }) => {
	const state = useChatSnapshot();
	const me = state.me;
	const peer = w.peer;
	const name = displayName(peer);
	const unread = state.conversations.get(peer.id)?.unread ?? 0;
	const blocked = isBlocked(state, peer.id);
	const selfOff = Boolean(me?.admin && !me.chatOn);
	const typing = state.typing.has(peer.id);

	const [height, setHeight] = useState(preferredHeight);
	const [text, setText] = useState("");
	const [shot, setShot] = useState<Screenshot | null>(null);
	const [shooting, setShooting] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const logRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const followRef = useRef(true);

	useEffect(() => {
		if (w.focusRequest) {
			inputRef.current?.focus();
		}
	}, [w.focusRequest]);

	// Keep the newest message in view while the reader is at the bottom.
	const messageCount = w.messages.length;
	useLayoutEffect(() => {
		const log = logRef.current;
		if (log && followRef.current && messageCount >= 0) {
			log.scrollTop = log.scrollHeight;
		}
	}, [messageCount, typing, w.minimized]);

	const send = async () => {
		const trimmed = text.trim();
		if ((!trimmed && !shot) || sending) {
			return;
		}
		setSending(true);
		setError(null);
		try {
			await sendChatMessage(peer.id, trimmed, shot ?? undefined);
			setText("");
			setShot(null);
			followRef.current = true;
		} catch (err) {
			setError(
				`Not sent: ${err instanceof Error ? err.message : "unknown error"}`,
			);
		} finally {
			setSending(false);
			inputRef.current?.focus();
		}
	};

	const screenshot = async () => {
		setError(null);
		setShooting(true);
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
		}
	};

	const toggle = () => setMinimized(peer.id, !w.minimized);

	return (
		<section
			role="dialog"
			aria-label={`Chat with ${name}`}
			className={cn(
				"relative flex flex-col rounded-lg border border-solid border-border bg-surface-primary shadow-[0_8px_28px_rgb(0_0_0/.35)]",
				w.minimized
					? "w-[min(240px,calc(100vw-32px))]"
					: "w-[min(328px,calc(100vw-32px))]",
			)}
			onPointerDown={() => {
				if (!w.minimized) {
					markRead(peer.id, true);
				}
			}}
			onFocus={() => setFocusedWindow(peer.id)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					setFocusedWindow(null);
				}
			}}
		>
			{!w.minimized && (
				<ResizeGrip
					height={height}
					onResize={setHeight}
					bodyRef={bodyRef}
					onReset={() => {
						setHeight(DEFAULT_HEIGHT);
						rememberHeight(null);
					}}
				/>
			)}
			<header
				className={cn(
					"flex items-center gap-0.5 py-1 pr-1 border-0 border-solid border-border",
					w.minimized ? "rounded-lg" : "rounded-t-lg border-b",
					unread ? "bg-surface-sky" : "bg-surface-secondary",
				)}
			>
				<button
					type="button"
					aria-expanded={!w.minimized}
					onClick={toggle}
					title={`${name} (@${peer.username})`}
					className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1 text-left font-semibold text-inherit"
				>
					<ChatAvatar peer={peer} />
					<span className="min-w-0 flex-1 truncate">{name}</span>
					{unread > 0 && <CountBadge count={unread} />}
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="subtle" size="icon" aria-label="More" title="More">
							<EllipsisVerticalIcon />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="z-[70] w-[236px]">
						<DropdownMenuItem
							disabled={blocked || shooting}
							onSelect={() => {
								if (w.minimized) {
									setMinimized(peer.id, false);
								}
								void screenshot();
							}}
						>
							<CameraIcon />
							Screenshot
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-content-destructive"
							onSelect={() => {
								if (w.minimized) {
									setMinimized(peer.id, false);
								}
								setConfirmingDelete(true);
							}}
						>
							<TrashIcon />
							Delete conversation
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					variant="subtle"
					size="icon"
					onClick={toggle}
					aria-label={w.minimized ? "Expand" : "Minimize"}
					title={w.minimized ? "Expand" : "Minimize"}
				>
					{w.minimized ? <ChevronUpIcon /> : <MinusIcon />}
				</Button>
				<Button
					variant="subtle"
					size="icon"
					onClick={() => closeWindow(peer.id)}
					aria-label="Close"
					title="Close"
				>
					<XIcon />
				</Button>
			</header>

			{!w.minimized && (
				<div
					ref={bodyRef}
					className="flex flex-col overflow-hidden rounded-b-lg"
					style={{
						height: `clamp(${MIN_HEIGHT}px, ${height}px, calc(var(--chat-room, 600px) - 44px))`,
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
							}}
						>
							<MessageLog window={w} meId={me?.id ?? ""} name={name} />
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
									void send();
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setMinimized(peer.id, true);
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
			)}
		</section>
	);
};

export const CountBadge: React.FC<{ count: number }> = ({ count }) => (
	<span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-red px-1 text-[11px] leading-none font-semibold text-highlight-red">
		{count > 99 ? "99+" : count}
	</span>
);

type MessageLogProps = {
	window: ChatWindowState;
	meId: string;
	name: string;
};

const MessageLog: React.FC<MessageLogProps> = ({ window: w, meId, name }) => {
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

type ResizeGripProps = {
	height: number;
	bodyRef: React.RefObject<HTMLDivElement | null>;
	onResize: (height: number) => void;
	onReset: () => void;
};

/** The window's top edge: drag up for a taller window (or arrow keys). */
const ResizeGrip: React.FC<ResizeGripProps> = ({
	height,
	bodyRef,
	onResize,
	onReset,
}) => {
	const drag = useRef<{ startY: number; startHeight: number } | null>(null);
	const shown = () => bodyRef.current?.getBoundingClientRect().height ?? height;

	return (
		<div
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize the chat (drag, or arrow keys; double-click resets)"
			aria-valuenow={Math.round(height)}
			tabIndex={0}
			title="Drag to resize"
			className="group absolute -top-[3px] right-0 left-0 z-[2] h-[9px] cursor-ns-resize touch-none outline-hidden"
			onPointerDown={(event) => {
				if (event.button !== 0) {
					return;
				}
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = { startY: event.clientY, startHeight: shown() };
			}}
			onPointerMove={(event) => {
				if (!drag.current) {
					return;
				}
				onResize(
					Math.max(
						MIN_HEIGHT,
						drag.current.startHeight + drag.current.startY - event.clientY,
					),
				);
			}}
			onPointerUp={(event) => {
				if (!drag.current) {
					return;
				}
				event.currentTarget.releasePointerCapture(event.pointerId);
				drag.current = null;
				rememberHeight(shown());
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onDoubleClick={onReset}
			onKeyDown={(event) => {
				const step =
					event.key === "ArrowUp" ? 20 : event.key === "ArrowDown" ? -20 : 0;
				if (!step) {
					return;
				}
				event.preventDefault();
				const next = Math.max(MIN_HEIGHT, shown() + step);
				onResize(next);
				rememberHeight(next);
			}}
		>
			<span className="absolute top-[5px] left-1/2 -ml-[18px] h-1 w-9 rounded-sm bg-content-secondary opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
		</div>
	);
};
