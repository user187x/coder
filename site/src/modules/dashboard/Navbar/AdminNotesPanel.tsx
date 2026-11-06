import {
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

type Draft = { id?: string; revision?: number; text: string; shared: boolean };

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
	const [deleting, setDeleting] = useState<AdminNote | null>(null);
	const notes = query.data?.notes.filter((note) =>
		visibility === "admins" ? note.shared : !note.shared,
	);
	const busy = save.isPending || remove.isPending;
	const edit = (note?: AdminNote) => {
		save.reset();
		setDraft(
			note
				? {
						id: note.id,
						revision: note.revision,
						text: note.text,
						shared: note.shared,
					}
				: { text: "", shared: visibility === "admins" },
		);
	};
	return (
		<div
			ref={panel}
			className="settings-notes-content flex min-h-0 flex-col"
			style={{ minHeight: height ?? undefined }}
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
							disabled={!org || Boolean(draft) || busy}
							onClick={() => edit()}
						>
							<PlusIcon />
							New note
						</Button>
						<Button
							size="icon"
							variant="subtle"
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
							<SelectTrigger id={`${id}-visibility`}>
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
							const fields = { text: draft.text, shared: draft.shared };
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
						{query.data && (
							<div className="shrink-0 overflow-hidden rounded-lg border border-solid border-border">
								<Table aria-label="Admin notes">
									<TableHeader>
										<TableRow>
											<TableHead>Note</TableHead>
											<TableHead className="w-16">Actions</TableHead>
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
												</TableCell>
											</TableRow>
										)}
										{notes?.map((note) => (
											<TableRow key={note.id}>
												<TableCell className="max-w-0 align-top">
													<button
														type="button"
														className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-content-primary"
														aria-label={`Read note: ${note.text.slice(0, 60)}`}
														onClick={() => {
															setVisibility(visibility);
															setReading(reading === note.id ? null : note.id);
															if (note.unread && !read.isPending)
																read.mutate({
																	action: "read",
																	id: note.id,
																	revision: note.revision,
																});
														}}
													>
														<span
															className={
																reading === note.id
																	? "whitespace-pre-wrap break-words"
																	: "line-clamp-2 break-words"
															}
														>
															{note.text}
														</span>
													</button>
													<div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-content-secondary">
														<span>{note.author_name}</span>
														{note.unread && <Badge size="sm">New</Badge>}
														<Badge size="sm">
															{note.shared ? "Admins" : "Self"}
														</Badge>
													</div>
													<time
														className="text-xs text-content-secondary"
														dateTime={note.updated_at}
													>
														{new Date(note.updated_at).toLocaleString("en-US")}
													</time>
													{deleting?.id === note.id && (
														<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
															<span>Delete this note?</span>
															<Button
																size="sm"
																variant="outline"
																disabled={busy}
																onClick={() => setDeleting(null)}
															>
																<Trash2Icon aria-hidden />
																Discard
															</Button>
															<Button
																size="sm"
																variant="destructive"
																disabled={busy}
																onClick={() =>
																	remove.mutate(
																		{
																			action: "delete",
																			id: note.id,
																			revision: note.revision,
																		},
																		{ onSuccess: () => setDeleting(null) },
																	)
																}
															>
																Delete note
															</Button>
														</div>
													)}
												</TableCell>
												<TableCell className="px-1 align-top">
													{note.can_edit && (
														<div className="flex">
															<Button
																size="icon"
																variant="subtle"
																aria-label="Edit note"
																disabled={busy}
																onClick={() => edit(note)}
															>
																<PencilIcon />
															</Button>
															<Button
																size="icon"
																variant="subtle"
																aria-label="Delete note"
																disabled={busy}
																onClick={() => {
																	remove.reset();
																	setDeleting(note);
																}}
															>
																<Trash2Icon />
															</Button>
														</div>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</>
				)}
			</div>
			<NotesResizeHandle panel={panel} height={height} onResize={setHeight} />
		</div>
	);
};
