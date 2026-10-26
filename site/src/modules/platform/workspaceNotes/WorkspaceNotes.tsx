import { cn } from "cn";
import { PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	NOTE_COLORS,
	type NoteColor,
	PlatformAPI,
	type WorkspaceNote,
} from "#/api/platform";
import { workspaceNotesKey as notesKey } from "#/api/queries/workspaceNotes";
import type { Workspace } from "#/api/typesGenerated";
import { useNoteDraftRequests } from "./noteDraftStore";
import "./workspaceNotes.css";

const NOTE_TEXT_MAX = 600;

export { notesKey };

type Draft = Pick<WorkspaceNote, "text" | "color" | "x" | "y">;

/**
 * Post-it notes on a workspace's page: admins stick them on any user's
 * workspace - to guide, remind, give a short how-to or a "don't forget" - and
 * they lie over everything else on the page (the highest z-index), hanging a
 * little crooked, where the admin put them. Admins add them on other users'
 * workspaces (the sticky-note button in the page's sidebar,
 * WorkspaceNotesButton), drag, edit (double-click or the pencil) and delete
 * them; the
 * workspace's owner can dismiss them (admins still see a dismissed note,
 * faded). Kept by the platform service, per workspace.
 */
export const WorkspaceNotes: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const queryClient = useQueryClient();
	const key = notesKey(workspace.id);
	const query = useQuery({
		queryKey: key,
		queryFn: () => PlatformAPI.getWorkspaceNotes(workspace.id),
		refetchInterval: 30_000,
		retry: false,
	});
	const [draft, setDraft] = useState<Draft | null>(null);
	// The sidebar button asks for a new note.
	const draftRequests = useNoteDraftRequests();
	const seenRequests = useRef(draftRequests);
	useEffect(() => {
		if (draftRequests !== seenRequests.current) {
			seenRequests.current = draftRequests;
			setDraft({ text: "", color: "yellow", x: 0.42, y: 0.3 });
		}
	}, [draftRequests]);
	const refresh = () => queryClient.invalidateQueries({ queryKey: key });
	const onError = (error: unknown) =>
		toast.error(getErrorMessage(error, "The note could not be saved."));
	const create = useMutation({
		mutationFn: (note: Draft) =>
			PlatformAPI.createWorkspaceNote(workspace.id, note),
		onSuccess: () => {
			setDraft(null);
			void refresh();
		},
		onError,
	});
	const update = useMutation({
		mutationFn: ({ id, ...change }: { id: string } & Partial<Draft>) =>
			PlatformAPI.updateWorkspaceNote(id, change),
		onSuccess: () => void refresh(),
		onError,
	});
	const remove = useMutation({
		mutationFn: PlatformAPI.deleteWorkspaceNote,
		onSuccess: () => void refresh(),
		onError,
	});
	const dismiss = useMutation({
		mutationFn: PlatformAPI.dismissWorkspaceNote,
		onSuccess: () => void refresh(),
		onError,
	});

	const notes = query.data?.notes ?? [];
	const canEdit = query.data?.canEdit ?? false;
	if (!query.data || (!canEdit && notes.length === 0)) {
		return null;
	}

	return createPortal(
		<div className="workspace-notes" data-testid="workspace-notes">
			{notes.map((note) => (
				<StickyNote
					key={note.id}
					note={note}
					canEdit={canEdit}
					onMove={(x, y) => update.mutate({ id: note.id, x, y })}
					onSave={(text, color) => update.mutate({ id: note.id, text, color })}
					onDelete={() => remove.mutate(note.id)}
					onDismiss={() => dismiss.mutate(note.id)}
				/>
			))}
			{draft && (
				<StickyNote
					note={{
						id: "draft",
						workspaceId: workspace.id,
						...draft,
						tilt: -2,
						author: null,
						createdAt: "",
						updatedAt: "",
						dismissedAt: null,
					}}
					canEdit
					startEditing
					onMove={(x, y) => setDraft({ ...draft, x, y })}
					onSave={(text, color) => create.mutate({ ...draft, text, color })}
					onCancel={() => setDraft(null)}
				/>
			)}
		</div>,
		document.body,
	);
};

type StickyNoteProps = {
	note: WorkspaceNote;
	canEdit: boolean;
	startEditing?: boolean;
	onMove: (x: number, y: number) => void;
	onSave: (text: string, color: NoteColor) => void;
	onDelete?: () => void;
	onDismiss?: () => void;
	onCancel?: () => void;
};

const StickyNote: React.FC<StickyNoteProps> = ({
	note,
	canEdit,
	startEditing = false,
	onMove,
	onSave,
	onDelete,
	onDismiss,
	onCancel,
}) => {
	const el = useRef<HTMLDivElement>(null);
	const [editing, setEditing] = useState(startEditing);
	const [text, setText] = useState(note.text);
	const [color, setColor] = useState<NoteColor>(note.color);
	// Where it is while being dragged (fractions of the window).
	const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
	useEffect(() => {
		if (!editing) {
			setText(note.text);
			setColor(note.color);
		}
	}, [note.text, note.color, editing]);

	const at = dragAt ?? { x: note.x, y: note.y };
	const dismissed = Boolean(note.dismissedAt);

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!canEdit || editing || event.button !== 0) {
			return;
		}
		if ((event.target as HTMLElement).closest("button, textarea")) {
			return;
		}
		const box = el.current?.getBoundingClientRect();
		if (!box) {
			return;
		}
		event.preventDefault();
		const dx = event.clientX - box.left;
		const dy = event.clientY - box.top;
		let last = at;
		const place = (clientX: number, clientY: number) => {
			const x = Math.min(
				Math.max(0, (clientX - dx) / window.innerWidth),
				Math.max(0, 1 - box.width / window.innerWidth),
			);
			const y = Math.min(
				Math.max(0, (clientY - dy) / window.innerHeight),
				Math.max(0, 1 - box.height / window.innerHeight),
			);
			last = { x, y };
			setDragAt(last);
		};
		const move = (e: PointerEvent) => place(e.clientX, e.clientY);
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			setDragAt(null);
			if (last.x !== note.x || last.y !== note.y) {
				onMove(last.x, last.y);
			}
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	return (
		<div
			ref={el}
			role="note"
			aria-label={`Note${note.author ? ` from ${note.author}` : ""}`}
			data-testid="workspace-note"
			data-color={editing ? color : note.color}
			data-dragging={dragAt ? "" : undefined}
			data-dismissed={dismissed || undefined}
			className={cn("workspace-note", canEdit && !editing && "cursor-grab")}
			style={
				{
					left: `${at.x * 100}vw`,
					top: `${at.y * 100}vh`,
					"--note-tilt": `${note.tilt}deg`,
				} as React.CSSProperties
			}
			onPointerDown={onPointerDown}
			onDoubleClick={() => canEdit && !editing && setEditing(true)}
		>
			<span className="workspace-note-tape" aria-hidden />
			<div className="workspace-note-tools">
				{canEdit && !editing && (
					<button
						type="button"
						aria-label="Edit the note"
						title="Edit"
						onClick={() => setEditing(true)}
					>
						<PencilIcon />
					</button>
				)}
				{canEdit && !editing && onDelete && (
					<button
						type="button"
						aria-label="Delete the note"
						title="Delete"
						onClick={onDelete}
					>
						<Trash2Icon />
					</button>
				)}
				{!canEdit && onDismiss && (
					<button
						type="button"
						aria-label="Dismiss the note"
						title="Dismiss"
						onClick={onDismiss}
					>
						<XIcon />
					</button>
				)}
			</div>
			{editing ? (
				<div className="workspace-note-edit">
					<textarea
						aria-label="Note"
						// biome-ignore lint/a11y/noAutofocus: the note was just opened for writing
						autoFocus
						maxLength={NOTE_TEXT_MAX}
						value={text}
						placeholder="Write a reminder, a how-to, a don't-forget..."
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (
								e.key === "Enter" &&
								(e.ctrlKey || e.metaKey) &&
								text.trim()
							) {
								onSave(text.trim(), color);
								setEditing(false);
							} else if (e.key === "Escape") {
								setEditing(false);
								onCancel?.();
							}
						}}
					/>
					<div className="workspace-note-edit-bar">
						<span role="radiogroup" aria-label="Colour">
							{NOTE_COLORS.map((c) => (
								<button
									key={c}
									type="button"
									role="radio"
									aria-checked={c === color}
									aria-label={c}
									data-swatch={c}
									onClick={() => setColor(c)}
								/>
							))}
						</span>
						<button
							type="button"
							onClick={() => {
								setEditing(false);
								onCancel?.();
							}}
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={!text.trim()}
							onClick={() => {
								onSave(text.trim(), color);
								setEditing(false);
							}}
						>
							{note.id === "draft" ? "Stick it" : "Save"}
						</button>
					</div>
				</div>
			) : (
				<p className="workspace-note-text">{note.text}</p>
			)}
			{(note.author || dismissed) && !editing && (
				<span className="workspace-note-foot">
					{note.author && `- ${note.author}`}
					{dismissed && canEdit && " · dismissed by the owner"}
				</span>
			)}
		</div>
	);
};
