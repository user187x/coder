import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { NOTE_COLORS, type NoteColor } from "#/api/platform";
import {
	deleteAccountNote,
	saveAccountNote,
	workspaceNotes,
} from "#/api/queries/workspaceNotes";
import { workspaces } from "#/api/queries/workspaces";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";

export const AccountNotesDialog: React.FC<{
	username: string;
	onClose: () => void;
	create?: boolean;
}> = ({ username, onClose, create }) => {
	const [selected, setSelected] = useState("");
	const query = useQuery(workspaces({ q: `owner:${username}`, limit: 0 }));
	const available =
		query.data?.workspaces.filter(
			(w) => !w.is_prebuild && w.latest_build.status !== "deleted",
		) ?? [];
	const workspace = available.find((w) => w.id === selected) ?? available[0];
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto"
				overlayClassName="backdrop-blur-md"
			>
				<DialogTitle>Notes for {username}</DialogTitle>
				{query.isLoading && <Spinner loading />}
				{query.error && (
					<>
						<ErrorAlert error={query.error} />
						<Button onClick={() => void query.refetch()}>
							Retry workspaces
						</Button>
					</>
				)}
				{workspace ? (
					<>
						<Label htmlFor="account-notes-workspace">Workspace</Label>
						<Select value={workspace.id} onValueChange={setSelected}>
							<SelectTrigger id="account-notes-workspace">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{available.map((w) => (
									<SelectItem key={w.id} value={w.id}>
										{w.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<AccountWorkspaceNotes
							key={workspace.id}
							workspaceId={workspace.id}
							create={create}
						/>
					</>
				) : (
					!query.isLoading && !query.error && <p>No workspaces available.</p>
				)}
			</DialogContent>
		</Dialog>
	);
};

/** Keeps note drafts local while the server list refreshes. */
export const AccountWorkspaceNotes: React.FC<{
	workspaceId: string;
	create?: boolean;
}> = ({ workspaceId, create = false }) => {
	const client = useQueryClient();
	const query = useQuery(workspaceNotes(workspaceId));
	const save = useMutation(saveAccountNote(client, workspaceId));
	const remove = useMutation(deleteAccountNote(client, workspaceId));
	const [editing, setEditing] = useState(create);
	const [id, setId] = useState<string>();
	const [text, setText] = useState("");
	const [color, setColor] = useState<NoteColor>("yellow");
	const [deleting, setDeleting] = useState<string>();
	return (
		<div className="flex flex-col gap-3">
			{query.isLoading && <Spinner loading />}
			{query.error && (
				<>
					<ErrorAlert error={query.error} />
					<Button onClick={() => void query.refetch()}>Retry notes</Button>
				</>
			)}
			{save.error && <ErrorAlert error={save.error} />}
			{remove.error && <ErrorAlert error={remove.error} />}
			{query.data?.canEdit && !editing && (
				<Button
					variant="outline"
					onClick={() => {
						setId(undefined);
						setText("");
						setColor("yellow");
						setEditing(true);
					}}
				>
					<PlusIcon aria-hidden />
					Create note
				</Button>
			)}
			{editing && query.data?.canEdit && (
				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate(
							{ id, text: text.trim(), color },
							{ onSuccess: () => setEditing(false) },
						);
					}}
				>
					<Label htmlFor="account-note-text">Note</Label>
					<Textarea
						id="account-note-text"
						maxLength={600}
						value={text}
						onChange={(event) => setText(event.target.value)}
					/>
					<Label htmlFor="account-note-color">Color</Label>
					<Select
						value={color}
						onValueChange={(value) => {
							const next = NOTE_COLORS.find((c) => c === value);
							if (next) setColor(next);
						}}
					>
						<SelectTrigger id="account-note-color">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{NOTE_COLORS.map((c) => (
								<SelectItem key={c} value={c}>
									{c}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="m-0 text-xs text-content-secondary">
						New notes appear at the center of the workspace dashboard.
					</p>
					<div className="flex gap-2">
						<Button type="submit" disabled={save.isPending || !text.trim()}>
							{id ? "Save note" : "Create note"}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => setEditing(false)}
						>
							Cancel
						</Button>
					</div>
				</form>
			)}
			{query.data?.notes.length === 0 && <p>No notes on this workspace.</p>}
			{query.data?.notes.map((note) => (
				<article
					key={note.id}
					className="rounded-lg border border-solid border-border p-3"
				>
					<p className="m-0 whitespace-pre-wrap break-words">{note.text}</p>
					<p className="text-xs text-content-secondary">
						{note.author || "Administrator"}
						{note.dismissedAt ? " · Dismissed" : ""}
					</p>
					{query.data?.canEdit && (
						<div className="flex gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									setId(note.id);
									setText(note.text);
									setColor(note.color);
									setEditing(true);
								}}
							>
								<PencilIcon aria-hidden />
								Edit note
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => setDeleting(note.id)}
							>
								<TrashIcon aria-hidden />
								Delete note
							</Button>
						</div>
					)}
				</article>
			))}
			<ConfirmDialog
				open={!!deleting}
				title="Delete note"
				description="Remove this note from the workspace dashboard?"
				confirmText="Delete"
				type="delete"
				disabled={remove.isPending}
				onClose={() => setDeleting(undefined)}
				onConfirm={() => {
					if (deleting)
						remove.mutate(deleting, {
							onSuccess: () => setDeleting(undefined),
						});
				}}
			/>
		</div>
	);
};
