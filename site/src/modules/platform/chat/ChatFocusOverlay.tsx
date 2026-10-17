import { MessageSquareIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { acknowledgeFocus, displayName, useChatSnapshot } from "./chatStore";

const keep = (event: Event) => event.preventDefault();

/**
 * A group chat's first message - an admin's, to the accounts they chose in
 * Admin > Accounts - in front of everything on every dashboard page, until the
 * member clicks it: then the page is theirs again and the conversation opens.
 * Once per thread; nothing after it takes the focus. Only the dashboard: their
 * workspaces and apps go on as they were.
 */
export const ChatFocusOverlay: React.FC = () => {
	const { focus } = useChatSnapshot();
	const item = focus[0];
	if (!item) {
		return null;
	}
	const from = item.message.fromDisplay || item.message.fromName;
	return (
		<DialogPrimitive.Root open>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-overlay" />
				<DialogPrimitive.Content
					className="fixed left-1/2 top-1/2 z-[1001] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 outline-none"
					onEscapeKeyDown={keep}
					onPointerDownOutside={keep}
					onInteractOutside={keep}
					data-testid="chat-focus"
				>
					<DialogPrimitive.Title className="sr-only">
						A message from {from}
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						Click the message to open the chat and go on.
					</DialogPrimitive.Description>
					<button
						type="button"
						onClick={() => void acknowledgeFocus(item)}
						className="flex w-full cursor-pointer flex-col gap-3 rounded-xl border border-solid border-border-primary bg-surface-primary p-6 text-left shadow-xl transition-colors hover:border-content-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link"
					>
						<span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-content-secondary">
							<MessageSquareIcon
								aria-hidden
								className="size-4 text-content-link"
							/>
							{from} · {displayName(item.group)}
						</span>
						<span className="whitespace-pre-wrap break-words text-base text-content-primary">
							{item.message.text ||
								(item.message.file ? item.message.file.name : "A picture")}
						</span>
						<span className="text-xs text-content-secondary">
							Click the message to open the chat
							{focus.length > 1 ? ` (${focus.length - 1} more)` : ""}.
						</span>
					</button>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};
