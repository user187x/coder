import { CheckIcon, CrosshairIcon, MessageSquareIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "#/components/Button/Button";
import { acknowledgeFocus, displayName, useChatSnapshot } from "./chatStore";

const keep = (event: Event) => event.preventDefault();

/**
 * In front of everything on every dashboard page until the user answers it:
 *  - a group chat's first message - an admin's, to the accounts they chose in Admin > Accounts - once per thread;
 *    clicking it opens the conversation;
 *  - a message an admin forced on them (Forced Focus in Admin > Accounts, Force Response in the chat console):
 *    Acknowledge lets go of the page, Reply also opens the conversation to answer.
 * Only the dashboard: their workspaces and apps go on as they were.
 */
export const ChatFocusOverlay: React.FC = () => {
	const { focus } = useChatSnapshot();
	const item = focus[0];
	if (!item) {
		return null;
	}
	const from = item.message.fromDisplay || item.message.fromName;
	const text =
		item.message.text ||
		(item.message.file ? item.message.file.name : "A picture");
	const more = focus.length > 1 ? ` (${focus.length - 1} more)` : "";
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
					data-forced={item.forced || undefined}
				>
					<DialogPrimitive.Title className="sr-only">
						A message from {from}
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						{item.forced
							? "Acknowledge the message, or reply to it, to go on."
							: "Click the message to open the chat and go on."}
					</DialogPrimitive.Description>
					{item.forced ? (
						<div className="flex w-full flex-col gap-3 rounded-xl border border-solid border-content-link bg-surface-primary p-6 text-left shadow-xl">
							<span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-content-link">
								<CrosshairIcon aria-hidden className="size-4" />
								{from} needs your response
								{item.group.group ? ` · ${displayName(item.group)}` : ""}
							</span>
							<span className="whitespace-pre-wrap break-words text-base text-content-primary">
								{text}
							</span>
							<span className="flex items-center justify-end gap-2">
								<span className="flex-1 text-xs text-content-secondary">
									{more && `${focus.length - 1} more after this.`}
								</span>
								<Button
									variant="outline"
									onClick={() => void acknowledgeFocus(item, false)}
									data-testid="chat-focus-acknowledge"
								>
									<CheckIcon />
									Acknowledge
								</Button>
								<Button
									autoFocus
									onClick={() => void acknowledgeFocus(item)}
									data-testid="chat-focus-reply"
								>
									<MessageSquareIcon />
									Reply
								</Button>
							</span>
						</div>
					) : (
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
								{text}
							</span>
							<span className="text-xs text-content-secondary">
								Click the message to open the chat{more}.
							</span>
						</button>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
};
