import {
	ChevronDownIcon,
	PencilIcon,
	PlusIcon,
	StickyNoteIcon,
} from "lucide-react";
import { useState } from "react";
import type { WorkspaceNote } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { TableCell } from "#/components/Table/Table";
import { AccountNotesDialog } from "./AccountNotesDialog";

/** Account notes use the same split-button layout as Chat. */
export const UserNotesCell: React.FC<{
	username: string;
	notes: readonly WorkspaceNote[] | undefined;
	className?: string;
}> = ({ username, notes, className }) => {
	const [mode, setMode] = useState<"view" | "create">();
	return (
		<TableCell className={className}>
			<span className="inline-flex h-7 shrink-0 items-stretch rounded-md border border-solid border-border-default bg-transparent focus-within:ring-2 focus-within:ring-content-link">
				<Button
					size="sm"
					variant="subtle"
					className="h-full min-w-0 rounded-r-none px-2"
					aria-label={`View notes for ${username}`}
					title={`${notes?.length ?? 0} active notes`}
					onClick={(event) => {
						event.stopPropagation();
						setMode("view");
					}}
				>
					Notes
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size="sm"
							variant="subtle"
							className="h-full w-6 min-w-0 rounded-l-none border-0 border-l border-solid border-border-default p-0"
							aria-label={`Notes options for ${username}`}
						>
							<ChevronDownIcon aria-hidden className="size-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => setMode("create")}>
							<PlusIcon aria-hidden />
							Create note
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => setMode("view")}>
							<StickyNoteIcon aria-hidden />
							View notes
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => setMode("view")}>
							<PencilIcon aria-hidden />
							Manage notes
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</span>
			{mode && (
				<AccountNotesDialog
					username={username}
					create={mode === "create"}
					onClose={() => setMode(undefined)}
				/>
			)}
		</TableCell>
	);
};
