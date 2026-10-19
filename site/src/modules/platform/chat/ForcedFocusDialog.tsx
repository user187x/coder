import { CrosshairIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { ChatPeer } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Spinner } from "#/components/Spinner/Spinner";
import { displayName, sendChatMessage } from "./chatStore";

/**
 * Admins' Forced Focus (Admin › Accounts' Chat menu): a chat message that comes up in front of everything on the
 * user's dashboard - every member's, for a group chat - until they acknowledge it (ChatFocusOverlay). It is an
 * ordinary message of the conversation besides.
 */
export const ForcedFocusDialog: React.FC<{
	peer: ChatPeer;
	onClose: () => void;
}> = ({ peer, onClose }) => {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const name = displayName(peer);
	const send = async () => {
		setSending(true);
		try {
			await sendChatMessage(peer.id, text.trim(), undefined, undefined, {
				focus: true,
			});
			toast.success(
				`Sent: it stays in front of ${name}'s dashboard until they acknowledge it.`,
			);
			onClose();
		} catch (error) {
			toast.error(getErrorMessage(error, "The message was not sent."));
		} finally {
			setSending(false);
		}
	};
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="forced-focus-dialog">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<CrosshairIcon className="size-5 text-content-link" />
						Forced Focus: {name}
					</DialogTitle>
					<DialogDescription>
						Your message comes up in front of everything on their dashboard
						until they acknowledge it, and stays in your conversation.
					</DialogDescription>
				</DialogHeader>
				<textarea
					autoFocus
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							(event.ctrlKey || event.metaKey) &&
							text.trim()
						) {
							event.preventDefault();
							void send();
						}
					}}
					rows={4}
					maxLength={4000}
					placeholder="What they must see and answer"
					aria-label="Message"
					className="w-full resize-y rounded-md border border-solid border-border bg-surface-primary p-2 text-sm text-content-primary"
					data-testid="forced-focus-text"
				/>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!text.trim() || sending}
						onClick={() => void send()}
						data-testid="forced-focus-send"
					>
						<Spinner loading={sending}>
							<CrosshairIcon />
						</Spinner>
						Send with Forced Focus
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
