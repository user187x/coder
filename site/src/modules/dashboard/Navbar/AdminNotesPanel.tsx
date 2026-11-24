import {
	ChevronDownIcon,
	ChevronUpIcon,
	ListChecksIcon,
	PencilIcon,
	PlusIcon,
	SaveIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { AdminNote } from "#/api/adminNotes";
import { adminNotes, changeAdminNote } from "#/api/queries/adminNotes";
import { organizations } from "#/api/queries/organizations";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { Textarea } from "#/components/Textarea/Textarea";

import { NotesResizeHandle } from "./NotesResizeHandle";
import "./adminNotesTray.css";

type Draft = {
	id?: string;
	revision?: number;
	title: string;
	text: string;
	shared: boolean;
};

/** Database-backed notes, with local drafts preserved across background refreshes. */
export const AdminNotesPanel = ({
	enabled,
	onClose,
}: {
	enabled: boolean;
	onClose: () => void;
}) => {
	const id = useId();
	const client = useQueryClient();
	const orgs = useQuery({ ...organizations(), enabled });
	const [selectedVisibility, setVisibility] = useState<string | null>(null);
	const [height, setHeight] = useState<number | null>(null);
	const panel = useRef<HTMLDivElement>(null);
	const organization =
		orgs.data?.find((org) => org.is_default) ?? orgs.data?.[0];
	const org = organization?.id ?? "";
	const query = useQuery({
		...adminNotes(org),
		enabled: enabled && Boolean(org),
		retry: false,
	});
	const visibility =
		selectedVisibility ??
		(query.data?.notes.some((note) => note.unread) ? "admins" : "self");
	const read = useMutation(changeAdminNote(client, org));
	const save = useMutation(changeAdminNote(client, org));
	const remove = useMutation(changeAdminNote(client, org));
	const [draft, setDraft] = useState<Draft | null>(null);
	const [reading, setReading] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<readonly AdminNote[] | null>(null);
	const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
	const [contextNote, setContextNote] = useState<string | null>(null);
	const notes = query.data?.notes.filter((note) =>
		visibility === "admins" ? note.shared : !note.shared,
	);
	const selectableNotes =
		query.data?.notes.filter((note) => note.can_edit || note.shared) ?? [];
	const selectedNotes = selectableNotes.filter((note) =>
		selection.has(note.id),
	);
	const contextTargets = selectedNotes.length
		? selectedNotes
		: selectableNotes.filter((note) => note.id === contextNote);
	const allSelected =
		selectedNotes.length > 0 && selectedNotes.length === selectableNotes.length;
	const busy = save.isPending || remove.isPending;
	const selectionDisabled = busy || Boolean(deleting);
	const selectAll = () =>
		setSelection(new Set(selectableNotes.map((note) => note.id)));
	const setSelected = (noteId: string, checked: boolean) => {
		setSelection((previous) => {
			const next = new Set(previous);
			if (checked) next.add(noteId);
			else next.delete(noteId);
			return next;
		});
	};
	const requestDelete = (targets: readonly AdminNote[]) => {
		if (!targets.length) return;
		remove.reset();
		setDeleting(targets);
	};
	const confirmDelete = () => {
		const notes = deleting?.map(({ id, revision }) => ({ id, revision }));
		if (!notes?.length) return;
		remove.mutate(
			notes.length === 1
				? { action: "delete", ...notes[0] }
				: { action: "delete_many", notes },
			{
				onSuccess: () => {
					setDeleting(null);
					setSelection((previous) => {
						const next = new Set(previous);
						for (const note of notes) next.delete(note.id);
						return next;
					});
				},
			},
		);
	};
	const edit = (note?: AdminNote) => {
		save.reset();
		setDraft(
			note
				? {
						id: note.id,
						revision: note.revision,
						title: note.title ?? "",
						text: note.text,
						shared: note.shared,
					}
				: { title: "", text: "", shared: visibility === "admins" },
		);
	};
	return (
		<div
			ref={panel}
			className="settings-notes-content flex min-h-0 flex-col"
			style={{ height: height ?? undefined }}
			role="dialog"
			aria-label="Admin notes"
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
				<div className="flex shrink-0 items-center justify-between gap-2">
					<strong className="text-sm">Admin notes</strong>
					<div className="flex gap-1">
						<Button
							size="sm"
							variant="outline"
							className="settings-notes-control rounded-full"
							disabled={!org || Boolean(draft) || busy}
							onClick={() => edit()}
						>
							<PlusIcon />
							New note
						</Button>
						<Button
							size="icon"
							variant="outline"
							className="settings-notes-control rounded-full"
							aria-label="Close admin notes"
							onClick={onClose}
						>
							<XIcon />
						</Button>
					</div>
				</div>
				{orgs.isLoading && <Spinner loading />}
				{orgs.isError && (
					<>
						<ErrorAlert error={orgs.error} />
						<Button onClick={() => void orgs.refetch()}>
							Retry organizations
						</Button>
					</>
				)}
				{orgs.data && orgs.data.length === 0 && (
					<p className="text-xs">No organizations available.</p>
				)}
				{organization && (
					<>
						<Label htmlFor={`${id}-visibility`}>Visibility</Label>
						<Select
							value={draft ? (draft.shared ? "admins" : "self") : visibility}
							onValueChange={(value) => {
								if (draft) setDraft({ ...draft, shared: value === "admins" });
								else setVisibility(value);
							}}
							disabled={busy}
						>
							<SelectTrigger
								id={`${id}-visibility`}
								className="settings-notes-control rounded-full"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="admins">Admins</SelectItem>
								<SelectItem value="self">Self</SelectItem>
							</SelectContent>
						</Select>
					</>
				)}
				{draft ? (
					<form
						className="flex flex-1 flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							const fields = {
								title: draft.title.trim(),
								text: draft.text,
								shared: draft.shared,
							};
							const change =
								draft.id && draft.revision
									? {
											action: "update" as const,
											id: draft.id,
											revision: draft.revision,
											...fields,
										}
									: { action: "create" as const, ...fields };
							save.mutate(change, {
								onSuccess: () => {
									setVisibility(draft.shared ? "admins" : "self");
									setDraft(null);
								},
							});
						}}
					>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={`${id}-title`}>Title</Label>
							<Input
								id={`${id}-title`}
								placeholder="Use the first line of the note"
								maxLength={120}
								value={draft.title}
								disabled={busy}
								onChange={(event) =>
									setDraft({ ...draft, title: event.target.value })
								}
							/>
						</div>
						<Label htmlFor={`${id}-text`}>Note</Label>
						<Textarea
							id={`${id}-text`}
							autoFocus
							maxLength={10000}
							rows={6}
							className="min-h-28 flex-1 resize-none [field-sizing:content] bg-surface-tertiary text-content-primary"
							value={draft.text}
							disabled={busy}
							onChange={(event) =>
								setDraft({ ...draft, text: event.target.value })
							}
						/>
						{save.error && <ErrorAlert error={save.error} />}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busy}
								onClick={() => setDraft(null)}
							>
								<Trash2Icon aria-hidden />
								Discard
							</Button>
							<Button
								type="submit"
								size="sm"
								disabled={busy || !draft.text.trim() || !org}
							>
								<SaveIcon aria-hidden />
								{save.isPending ? "Saving…" : "Save"}
							</Button>
						</div>
					</form>
				) : (
					<>
						{read.error && <ErrorAlert error={read.error} />}
						{query.isLoading && org && <Spinner loading />}
						{query.error && (
							<>
								<ErrorAlert error={query.error} />
								<Button onClick={() => void query.refetch()}>
									Retry notes
								</Button>
							</>
						)}
						{remove.error && <ErrorAlert error={remove.error} />}
						{selectedNotes.length > 0 && (
							<div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
								<span aria-live="polite">{selectedNotes.length} selected</span>
								<Button
									size="sm"
									variant="outline"
									disabled={selectionDisabled}
									onClick={() => requestDelete(selectedNotes)}
								>
									<Trash2Icon aria-hidden />
									Delete selected
								</Button>
								<Button
									size="sm"
									variant="subtle"
									disabled={selectionDisabled}
									onClick={() => setSelection(new Set())}
								>
									Clear selection
								</Button>
							</div>
						)}
						{deleting && (
							<div
								role="group"
								aria-label="Confirm deleting notes"
								className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-solid border-border p-2 text-xs"
							>
								<span>
									{deleting.length === 1
										? "Delete this note?"
										: `Delete all ${deleting.length} selected notes?`}
								</span>
								<Button
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() => setDeleting(null)}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									variant="destructive"
									disabled={busy}
									onClick={confirmDelete}
								>
									{remove.isPending ? "Deleting…" : "Confirm delete"}
								</Button>
							</div>
						)}
						{query.data && (
							<ContextMenu modal={false}>
								<ContextMenuTrigger asChild>
									<div
										onContextMenu={(event) => {
											event.stopPropagation();
											const row =
												event.target instanceof Element
													? event.target.closest("[data-note-id]")
													: null;
											setContextNote(row?.getAttribute("data-note-id") ?? null);
										}}
										className="settings-notes-list shrink-0 grow overflow-hidden rounded-lg border border-solid border-border bg-surface-primary"
									>
										<Table aria-label="Admin notes" className="table-fixed">
											<TableHeader>
												<TableRow>
													<TableHead className="w-8 px-0 text-center">
														<Checkbox
															aria-label="Select all admin notes"
															title="Select all notes across Self and Admins"
															disabled={
																selectionDisabled || !selectableNotes.length
															}
															checked={
																allSelected
																	? true
																	: selectedNotes.length
																		? "indeterminate"
																		: false
															}
															onCheckedChange={(checked) =>
																checked ? selectAll() : setSelection(new Set())
															}
														/>
													</TableHead>
													<TableHead>Note</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{notes?.length === 0 && (
													<TableRow>
														<TableCell
															colSpan={2}
															className="text-xs text-content-secondary"
														>
															No notes with this visibility yet.
															<Button
																type="button"
																size="xs"
																variant="subtle"
																onClick={() => edit()}
															>
																<PlusIcon aria-hidden />
																Write a note
															</Button>
														</TableCell>
													</TableRow>
												)}
												{notes?.map((note, index) => {
													const expanded = reading === note.id;
													const title =
														note.title ||
														note.text.split("\n", 1)[0]?.slice(0, 120) ||
														"Untitled note";
													const toggleNote = () => {
														setVisibility(visibility);
														setReading(expanded ? null : note.id);
														if (!expanded && note.unread && !read.isPending) {
															read.mutate({
																action: "read",
																id: note.id,
																revision: note.revision,
															});
														}
													};
													return (
														<TableRow
															key={note.id}
															className="group/note"
															data-note-id={note.id}
															data-state={
																selection.has(note.id) ? "selected" : undefined
															}
														>
															<TableCell className="px-0 align-top text-center">
																<Checkbox
																	aria-label={`Select note: ${title}`}
																	checked={selection.has(note.id)}
																	disabled={
																		selectionDisabled ||
																		!(note.can_edit || note.shared)
																	}
																	onCheckedChange={(checked) =>
																		setSelected(note.id, checked === true)
																	}
																/>
															</TableCell>
															<TableCell className="align-top">
																<header className="flex items-start gap-1">
																	<span className="shrink-0 text-xs tabular-nums text-content-secondary">
																		{index + 1}.
																	</span>
																	<button
																		type="button"
																		className="block min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-content-primary"
																		aria-label={`${note.can_edit ? "Edit" : "Read"} note: ${title}`}
																		aria-expanded={
																			note.can_edit ? undefined : expanded
																		}
																		onClick={
																			note.can_edit
																				? () => edit(note)
																				: toggleNote
																		}
																	>
																		<span className="mb-1 block truncate font-semibold">
																			{title}
																		</span>
																		<span
																			className={
																				expanded
																					? "whitespace-pre-wrap wrap-anywhere"
																					: "line-clamp-2 wrap-anywhere"
																			}
																		>
																			{note.text}
																		</span>
																	</button>
																	<div className="flex shrink-0 opacity-0 group-hover/note:opacity-100 group-has-[:focus-visible]/note:opacity-100 [@media(hover:none)]:opacity-100">
																		<Button
																			size="icon"
																			variant="subtle"
																			className="size-6"
																			aria-label={
																				expanded
																					? "Collapse note"
																					: "Expand note"
																			}
																			title={
																				expanded
																					? "Collapse note"
																					: "Expand note"
																			}
																			aria-expanded={expanded}
																			onClick={toggleNote}
																		>
																			{expanded ? (
																				<ChevronUpIcon aria-hidden />
																			) : (
																				<ChevronDownIcon aria-hidden />
																			)}
																		</Button>
																		{(note.can_edit || note.shared) && (
																			<Button
																				size="icon"
																				variant="subtle"
																				className="size-6"
																				aria-label="Delete note"
																				title="Delete note"
																				disabled={busy}
																				onClick={() => requestDelete([note])}
																			>
																				<Trash2Icon aria-hidden />
																			</Button>
																		)}
																	</div>
																</header>
																<div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-content-secondary">
																	<span>{note.author_name}</span>
																	{note.unread && <Badge size="sm">New</Badge>}
																	<Badge size="sm">
																		{note.shared ? "Admins" : "Self"}
																	</Badge>
																	{note.can_edit && (
																		<Button
																			size="icon"
																			variant="subtle"
																			className="ml-auto size-6"
																			aria-label="Edit note"
																			title="Edit note"
																			disabled={busy}
																			onClick={() => edit(note)}
																		>
																			<PencilIcon aria-hidden />
																		</Button>
																	)}
																</div>
																<time
																	className="text-xs text-content-secondary"
																	dateTime={note.updated_at}
																>
																	{new Date(note.updated_at).toLocaleString(
																		"en-US",
																	)}
																</time>
															</TableCell>
														</TableRow>
													);
												})}
											</TableBody>
										</Table>
									</div>
								</ContextMenuTrigger>
								<ContextMenuContent
									aria-label="Admin notes actions"
									className="z-[2147483647]"
								>
									<ContextMenuItem
										disabled={
											selectionDisabled ||
											allSelected ||
											!selectableNotes.length
										}
										title="Select all notes across Self and Admins"
										onSelect={selectAll}
									>
										<ListChecksIcon aria-hidden />
										Select all
									</ContextMenuItem>
									<ContextMenuItem
										disabled={selectionDisabled || !contextTargets.length}
										onSelect={() => requestDelete(contextTargets)}
									>
										<Trash2Icon aria-hidden />
										Delete
									</ContextMenuItem>
								</ContextMenuContent>
							</ContextMenu>
						)}
					</>
				)}
			</div>
			<NotesResizeHandle panel={panel} height={height} onResize={setHeight} />
		</div>
	);
};
