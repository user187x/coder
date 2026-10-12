import { StickyNoteIcon } from "lucide-react";
import { Link } from "react-router";
import type { NoteColor, WorkspaceNote } from "#/api/platform";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { TableCell } from "#/components/Table/Table";

// The paper colours of the notes themselves (workspaceNotes.css).
const PAPER: Record<NoteColor, string> = {
	yellow: "#fff475",
	pink: "#ffc6e0",
	green: "#c5f7c0",
	blue: "#c4e4ff",
	orange: "#ffd8a8",
};

/**
 * Admin settings > Users, column "Notes": a sticky-note icon when admins have
 * notes up on the user's workspaces that the user has not dismissed yet. A
 * click shows them: what each says, on which workspace, by whom.
 */
export const UserNotesCell: React.FC<{
	username: string;
	notes: readonly WorkspaceNote[] | undefined;
}> = ({ username, notes }) => {
	if (!notes || notes.length === 0) {
		return (
			<TableCell>
				<span className="text-content-disabled">
					<span aria-hidden>–</span>
					<span className="sr-only">No notes</span>
				</span>
			</TableCell>
		);
	}
	return (
		<TableCell>
			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						data-testid="user-notes"
						className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 leading-none text-inherit"
						aria-label={`View ${notes.length} note${notes.length !== 1 ? "s" : ""} on ${username}'s workspaces`}
					>
						<StickyNoteIcon className="size-4 text-amber-400" />
						<span className="text-sm">{notes.length}</span>
					</button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					sideOffset={8}
					className="w-80 max-h-[420px] overflow-y-auto p-2"
				>
					<ul className="m-0 flex list-none flex-col gap-2 p-0">
						{notes.map((note) => (
							<li
								key={note.id}
								className="rounded-sm px-3 py-2 text-[#2b2600] shadow-sm"
								style={{ background: PAPER[note.color] ?? PAPER.yellow }}
							>
								<p className="m-0 whitespace-pre-wrap break-words text-sm leading-snug">
									{note.text}
								</p>
								<p className="m-0 mt-1.5 text-xs opacity-70">
									{note.workspaceName ? (
										<Link
											to={`/@${encodeURIComponent(note.ownerName || username)}/${encodeURIComponent(note.workspaceName)}`}
											className="font-semibold text-inherit"
										>
											{note.workspaceName}
										</Link>
									) : (
										"a workspace"
									)}
									{note.author ? ` · ${note.author}` : ""}
									{note.createdAt
										? ` · ${new Date(note.createdAt).toLocaleDateString()}`
										: ""}
								</p>
							</li>
						))}
					</ul>
				</PopoverContent>
			</Popover>
		</TableCell>
	);
};
