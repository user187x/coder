import { cn } from "cn";
import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import { useNavigate } from "react-router";
import { getErrorMessage } from "#/api/errors";
import { ImagesAPI } from "#/api/images";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";
import { imagesKey } from "./ImagesPage";

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const REF_RE =
	/^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?(?:\/[a-z0-9][a-z0-9._-]*)+(?::[A-Za-z0-9._-]{1,128}|@sha256:[0-9a-f]{64})$/;

type Source = "registry" | "upload";

/** A name for an image from its reference or file: "harbor.local/team/tool:1.2" -> "tool". */
export const nameFrom = (text: string): string =>
	(text.split("/").pop() ?? "")
		.replace(/(@sha256:.*|:[^:]*|\.tar(\.gz)?|\.tgz)$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);

export type ImportImageDialogProps = {
	onClose: () => void;
	/** Prefilled: a new version of an imported image, or an image in use not yet here. */
	initial?: { name?: string; ref?: string; source?: Source };
};

/**
 * Import: a container image brought into the Images view rather than built -
 * copied from a registry the cluster reaches (its reference; a user and
 * password if it asks for one), or uploaded as a `docker save` or OCI archive
 * (.tar or .tar.gz) with its progress. It is stored in the cluster's registry
 * as coder-images/<name>:<version>, scanned like a built image, and ready for
 * templates and workspaces. Then its progress page.
 */
export const ImportImageDialog: React.FC<ImportImageDialogProps> = ({
	onClose,
	initial,
}) => {
	const navigate = useNavigate();
	const list = useQuery({ queryKey: imagesKey, queryFn: ImagesAPI.list });
	const [source, setSource] = useState<Source>(initial?.source ?? "registry");
	const [name, setName] = useState(initial?.name ?? "");
	const [nameTouched, setNameTouched] = useState(Boolean(initial?.name));
	const [description, setDescription] = useState("");
	const [ref, setRef] = useState(initial?.ref ?? "");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const run = useMutation({
		mutationFn: () =>
			source === "registry"
				? ImagesAPI.importFromRegistry({
						name,
						description,
						ref: ref.trim(),
						username: username || undefined,
						password: password || undefined,
					})
				: ImagesAPI.importArchive(name, description, file as File, setProgress),
		onSuccess: ({ image, build }) =>
			navigate(`/images/${image}/builds/${build}`),
		onSettled: () => setProgress(null),
	});
	const existing = (list.data?.images ?? []).find((i) => i.id === name);
	const nameProblem = !NAME_RE.test(name)
		? "3–40 lowercase letters, digits and dashes."
		: existing && !existing.imported
			? `${name} is an image built here: pick another name.`
			: null;
	const valid =
		!nameProblem &&
		(source === "registry" ? REF_RE.test(ref.trim()) : Boolean(file));
	const suggest = (text: string) => {
		if (!nameTouched) {
			setName(nameFrom(text));
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && !run.isPending && onClose()}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Import an image</DialogTitle>
					<DialogDescription>
						Bring in a container image instead of building it: it is stored in
						the cluster's registry, scanned like a built image, and ready for
						templates and workspaces.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex min-w-0 flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (valid) {
							run.mutate();
						}
					}}
				>
					<div role="tablist" aria-label="From" className="flex gap-1">
						{(
							[
								["registry", "From a registry"],
								["upload", "Upload an archive"],
							] as const
						).map(([key, label]) => (
							<Button
								key={key}
								type="button"
								role="tab"
								aria-selected={source === key}
								variant={source === key ? "default" : "outline"}
								size="sm"
								disabled={run.isPending}
								onClick={() => setSource(key)}
							>
								{label}
							</Button>
						))}
					</div>

					{source === "registry" ? (
						<>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="import-ref">Image reference</Label>
								<Input
									id="import-ref"
									value={ref}
									autoFocus={!initial?.ref}
									placeholder="harbor.example.org/team/tool:1.2"
									onChange={(e) => {
										setRef(e.target.value);
										suggest(e.target.value);
									}}
								/>
								<span className="text-xs text-content-secondary">
									With its registry, and a tag or @sha256 digest. The platform
									service copies it, so the cluster must reach that registry.
								</span>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-user">User (if it asks)</Label>
									<Input
										id="import-user"
										value={username}
										autoComplete="off"
										onChange={(e) => setUsername(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="import-password">Password or token</Label>
									<Input
										id="import-password"
										type="password"
										value={password}
										autoComplete="new-password"
										onChange={(e) => setPassword(e.target.value)}
									/>
								</div>
							</div>
						</>
					) : (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="import-file">Archive</Label>
							<input
								id="import-file"
								type="file"
								accept=".tar,.tar.gz,.tgz,application/x-tar,application/gzip"
								disabled={run.isPending}
								onChange={(e) => {
									const f = e.target.files?.[0] ?? null;
									setFile(f);
									if (f) {
										suggest(f.name);
									}
								}}
								className="text-sm text-content-primary file:mr-3 file:rounded-md file:border file:border-solid file:border-border file:bg-surface-secondary file:px-3 file:py-1.5 file:text-content-primary"
							/>
							<span className="text-xs text-content-secondary">
								From <code>docker save</code> (or <code>podman save</code>), or
								an OCI layout, as .tar or .tar.gz.
							</span>
							{progress !== null && (
								<div className="flex items-center gap-3 text-xs">
									<div
										role="progressbar"
										aria-label="Uploading the archive"
										aria-valuenow={Math.round(progress * 100)}
										aria-valuemin={0}
										aria-valuemax={100}
										className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tertiary"
									>
										<div
											className="h-full bg-content-link transition-[width]"
											style={{ width: `${Math.round(progress * 100)}%` }}
										/>
									</div>
									<span className="w-10 text-right tabular-nums text-content-secondary">
										{Math.round(progress * 100)}%
									</span>
								</div>
							)}
						</div>
					)}

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="import-name">Name</Label>
						<Input
							id="import-name"
							value={name}
							onChange={(e) => {
								setNameTouched(true);
								setName(
									e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
								);
							}}
						/>
						<span
							className={cn(
								"text-xs",
								name && nameProblem
									? "text-content-destructive"
									: "text-content-secondary",
							)}
						>
							{name && nameProblem
								? nameProblem
								: existing?.imported
									? `A new version of ${name} (v${existing.version + 1}).`
									: `Templates and workspaces use it as ${list.data?.pullPrefix ?? "localhost:5000"}/coder-images/${name || "<name>"}:<version>.`}
						</span>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="import-description">Description</Label>
						<Textarea
							id="import-description"
							rows={2}
							value={description}
							placeholder="What is it for? Who uses it?"
							onChange={(e) => setDescription(e.target.value)}
						/>
					</div>
					{run.error ? (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							{getErrorMessage(run.error, "The image was not imported.")}
						</p>
					) : null}
					<DialogFooter className="gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={run.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!valid || run.isPending}>
							<Spinner loading={run.isPending} />
							Import
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
