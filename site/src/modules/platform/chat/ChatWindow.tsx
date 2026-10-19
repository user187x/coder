import { cn } from "cn";
import {
	CameraIcon,
	ChevronUpIcon,
	CloudIcon,
	EllipsisVerticalIcon,
	MinusIcon,
	PanelsTopLeftIcon,
	TrashIcon,
	XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "react-query";
import { cloudDrivePeers } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { AskForCloudDriveDialog } from "#/modules/platform/cloudDrive/CloudDrivePeers";
import { ChatAvatar } from "./ChatAvatar";
import { ChatConversation, type ConversationActions } from "./ChatConversation";
import {
	type ChatWindowState,
	closeWindow,
	displayName,
	isBlocked,
	markRead,
	openConsole,
	setFocusedWindow,
	setMinimized,
	useChatSnapshot,
} from "./chatStore";

const HEIGHT_KEY = "coder-ui-chat-height";
const DEFAULT_HEIGHT = 380;
const MIN_HEIGHT = 160;

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
	const peer = w.peer;
	const name = displayName(peer);
	const unread = state.conversations.get(peer.id)?.unread ?? 0;
	const blocked = isBlocked(state, peer.id);

	const [height, setHeight] = useState(preferredHeight);
	const [shooting, setShooting] = useState(false);
	const actions = useRef<ConversationActions>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	// Cloud Drives shared between users: asked for from here, while admins have it on (read when the menu opens).
	const [menuOpen, setMenuOpen] = useState(false);
	const [asking, setAsking] = useState(false);
	const peers = useQuery({
		...cloudDrivePeers(menuOpen && !peer.group),
		refetchInterval: false,
	});
	const canAsk =
		!peer.group && peer.id !== state.me?.id && peers.data?.settings.enabled;

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
				<DropdownMenu onOpenChange={setMenuOpen}>
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
								// The conversation mounts when the window expands.
								window.setTimeout(() => actions.current?.screenshot());
							}}
						>
							<CameraIcon />
							Screenshot
						</DropdownMenuItem>
						{state.me?.admin && (
							<DropdownMenuItem
								onSelect={() => openConsole(peer)}
								data-testid="chat-window-open-console"
							>
								<PanelsTopLeftIcon />
								Open in the chat console
							</DropdownMenuItem>
						)}
						{canAsk && (
							<DropdownMenuItem
								onSelect={() => setAsking(true)}
								data-testid="chat-ask-cloud-drive"
							>
								<CloudIcon />
								Ask for their Cloud Drive
							</DropdownMenuItem>
						)}
						<DropdownMenuItem
							className="text-content-destructive"
							onSelect={() => {
								if (w.minimized) {
									setMinimized(peer.id, false);
								}
								window.setTimeout(() => actions.current?.askDelete());
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
				<div ref={bodyRef} className="flex flex-col rounded-b-lg">
					<ChatConversation
						ref={actions}
						view={w}
						dock={dock}
						className="rounded-b-lg"
						style={{
							height: `clamp(${MIN_HEIGHT}px, ${height}px, calc(var(--chat-room, 600px) - 44px))`,
						}}
						onEscape={() => setMinimized(peer.id, true)}
						onShootingChange={setShooting}
					/>
				</div>
			)}
			{asking && (
				<AskForCloudDriveDialog
					owner={{ id: peer.id, name }}
					onClose={() => setAsking(false)}
				/>
			)}
		</section>
	);
};

export const CountBadge: React.FC<{ count: number }> = ({ count }) => (
	<span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-red px-1 text-[11px] leading-none font-semibold text-highlight-red">
		{count > 99 ? "99+" : count}
	</span>
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
