import { cn } from "cn";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	FileIcon,
	FileUpIcon,
	MonitorIcon,
	PackageIcon,
	PlusIcon,
	RefreshCwIcon,
	ShieldIcon,
	TerminalSquareIcon,
	TrashIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	type AptResult,
	type ImageDesktop,
	type ImageFile,
	type ImageInstallation,
	type ImageSpec,
	ImagesAPI,
	type LintIssue,
} from "#/api/images";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import { createDayString } from "#/utils/createDayString";
import { BashEditor } from "./BashEditor";
import { formatSize } from "./badges";

export type StepProps = {
	imageId: string;
	spec: ImageSpec;
	/** Takes a function of the latest spec where a change lands after an await (an upload), so edits made meanwhile stay. */
	onChange: React.Dispatch<React.SetStateAction<ImageSpec>>;
};

/** `files` with `added` in place of any of the same name. */
const withFiles = (files: ImageFile[], added: ImageFile[]) => [
	...files.filter((f) => !added.some((a) => a.name === f.name)),
	...added,
];

const splitNames = (text: string) =>
	text
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter(Boolean);

const PKG_RE = /^[a-z0-9][a-z0-9+.-]+(?::[a-z0-9-]+)?(?:=[A-Za-z0-9.+:~-]+)?$/;

// ---------------------------------------------------------------- packages

/** A name box with apt suggestions; Enter (or a pasted list) adds every name in it. */
const PackageInput: React.FC<{
	placeholder: string;
	onAdd: (names: string[]) => void;
	label: string;
}> = ({ placeholder, onAdd, label }) => {
	const [text, setText] = useState("");
	const [open, setOpen] = useState(false);
	const last = splitNames(text).pop() ?? "";
	const suggest = useQuery({
		queryKey: ["platform", "images", "apt-search", last],
		queryFn: () => ImagesAPI.aptSearch(last),
		enabled: last.length >= 2,
		staleTime: 60_000,
	});
	const add = (names: string[]) => {
		if (names.length) {
			onAdd(names);
		}
		setText("");
		setOpen(false);
	};
	return (
		<div className="relative">
			<Input
				aria-label={label}
				placeholder={placeholder}
				value={text}
				onFocus={() => setOpen(true)}
				onBlur={() => window.setTimeout(() => setOpen(false), 150)}
				onChange={(e) => {
					setText(e.target.value);
					setOpen(true);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						add(splitNames(text));
					}
				}}
				onPaste={(e) => {
					const pasted = e.clipboardData.getData("text");
					if (/[\s,]/.test(pasted.trim())) {
						e.preventDefault();
						add(splitNames(pasted));
					}
				}}
			/>
			{open && last.length >= 2 && (suggest.data?.packages.length ?? 0) > 0 && (
				<div
					role="listbox"
					className="absolute z-20 mt-1 max-h-64 w-full list-none overflow-y-auto rounded-md border border-solid border-border bg-surface-primary p-1 shadow-lg"
				>
					{suggest.data?.packages.map((p) => (
						<div key={p.name}>
							<button
								type="button"
								role="option"
								aria-selected={false}
								className="flex w-full cursor-pointer items-baseline gap-2 rounded border-0 bg-transparent px-2 py-1.5 text-left text-sm text-inherit hover:bg-surface-secondary"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => add([...splitNames(text).slice(0, -1), p.name])}
							>
								<span className="font-mono font-semibold">{p.name}</span>
								<span className="text-xs text-content-secondary">
									{p.version}
								</span>
								<span className="truncate text-xs text-content-secondary">
									{p.description}
								</span>
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
};

/** apt's answer for each package, checked again whenever the list changes. */
export const useAptCheck = (packages: string[]) => {
	const key = packages.join(" ");
	return useQuery({
		queryKey: ["platform", "images", "apt-check", key],
		queryFn: () => ImagesAPI.aptCheck(packages),
		enabled: packages.length > 0,
		staleTime: 5 * 60_000,
		// the last answer while a changed list is checked: rows don't flicker
		placeholderData: (previous) => previous,
	});
};

export const PackagesStep: React.FC<
	StepProps & {
		/** An installation in place of a package apt doesn't have (it leaves the package list). */
		onAddInstallation: (inst: ImageInstallation, replaces: string) => void;
	}
> = ({ imageId, spec, onChange, onAddInstallation }) => {
	const check = useAptCheck(spec.packages);
	const results: Record<string, AptResult> = check.data?.results ?? {};
	const [uploading, setUploading] = useState<Record<string, number>>({});
	const [problem, setProblem] = useState<string>();
	const fileRef = useRef<HTMLInputElement>(null);
	const pendingFor = useRef<string | null>(null);
	const index = check.data?.index;

	const uploadDebs = async (files: File[], replaces?: string) => {
		setProblem(undefined);
		const added: ImageFile[] = [];
		for (const file of files) {
			if (!file.name.endsWith(".deb")) {
				setProblem(`${file.name} is not a .deb file.`);
				continue;
			}
			try {
				setUploading((u) => ({ ...u, [file.name]: 0 }));
				const { file: f } = await ImagesAPI.uploadFile(
					imageId,
					"deb",
					file,
					undefined,
					(x) => setUploading((u) => ({ ...u, [file.name]: x })),
				);
				if (!added.some((d) => d.name === f.name)) {
					added.push({ name: f.name, size: f.size });
				}
			} catch (e) {
				setProblem(getErrorMessage(e, `${file.name} could not be uploaded.`));
			} finally {
				setUploading((u) => {
					const { [file.name]: _, ...rest } = u;
					return rest;
				});
			}
		}
		onChange((s) => ({
			...s,
			debs: withFiles(s.debs, added),
			packages:
				replaces && added.length
					? s.packages.filter((p) => p !== replaces)
					: s.packages,
		}));
	};

	const missing = spec.packages.filter(
		(p) => results[p] && !results[p].available,
	);

	return (
		<div className="flex flex-col gap-4">
			<p className="m-0 text-sm text-content-secondary">
				Installed with <code>apt-get install --no-install-recommends</code>,
				each checked in the apt sources first: a package they don't have stops
				the build until you upload its .deb or install it another way.
			</p>
			<PackageInput
				label="Add apt packages"
				placeholder="Type a package name (suggestions as you type), or paste a list…"
				onAdd={(names) => {
					const bad = names.filter((n) => !PKG_RE.test(n));
					setProblem(
						bad.length ? `Not package names: ${bad.join(", ")}` : undefined,
					);
					onChange({
						...spec,
						packages: [
							...spec.packages,
							...names.filter(
								(n) => PKG_RE.test(n) && !spec.packages.includes(n),
							),
						],
					});
				}}
			/>
			<div className="flex items-center gap-2 text-xs text-content-secondary">
				{index ? (
					<>
						{index.packages.toLocaleString()} packages in {index.sources} apt
						source
						{index.sources === 1 ? "" : "s"}
						{index.loadedAt && `, read ${createDayString(index.loadedAt)}`}
						{index.errors.length > 0 && (
							<span
								className="text-content-destructive"
								title={index.errors.join("\n")}
							>
								· {index.errors.length} source(s) unreachable
							</span>
						)}
					</>
				) : (
					check.isFetching && "Reading the apt package lists…"
				)}
				<Button
					size="xs"
					variant="subtle"
					onClick={async () => {
						await ImagesAPI.aptRefresh();
						void check.refetch();
					}}
				>
					<RefreshCwIcon />
					Read them again
				</Button>
			</div>
			{problem && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{problem}
				</p>
			)}
			{spec.packages.length > 0 && (
				<ul
					className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-solid border-border p-0"
					data-testid="package-list"
				>
					{spec.packages.map((p) => {
						const r = results[p];
						return (
							<li
								key={p}
								className="flex flex-wrap items-center gap-3 px-3 py-2"
								data-testid="package-row"
								data-state={
									!r ? "checking" : r.available ? "available" : "missing"
								}
							>
								{!r ? (
									<Spinner loading size="sm" />
								) : r.available ? (
									<CircleCheckIcon
										className="size-4 text-content-success"
										aria-label="available"
									/>
								) : (
									<CircleAlertIcon
										className="size-4 text-content-destructive"
										aria-label="not available"
									/>
								)}
								<span className="font-mono text-sm font-semibold">{p}</span>
								<span className="min-w-0 flex-1 truncate text-xs text-content-secondary">
									{!r
										? "checking…"
										: r.available
											? `${r.version ?? ""} ${r.description ?? ""}`
											: r.invalid
												? "not a package name"
												: "not in the apt sources"}
								</span>
								{r && !r.available && (
									<>
										<Button
											size="sm"
											variant="outline"
											onClick={() => {
												pendingFor.current = p;
												fileRef.current?.click();
											}}
										>
											<FileUpIcon />
											Upload its .deb
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => {
												const id = p.replace(/[^a-z0-9-]/g, "-").slice(0, 40);
												onAddInstallation(
													{
														id,
														name: p,
														files: [],
														script: `# ${p} is not in the apt sources: install it by hand.\n# Upload what it needs above (a tarball, a binary, an installer);\n# this runs as root, in the folder holding those files ($INSTALL_DIR).\n\n`,
													},
													p,
												);
											}}
										>
											<WrenchIcon />
											Install manually
										</Button>
									</>
								)}
								<Button
									size="icon"
									variant="subtle"
									aria-label={`Remove ${p}`}
									onClick={() =>
										onChange({
											...spec,
											packages: spec.packages.filter((x) => x !== p),
										})
									}
								>
									<XIcon />
								</Button>
							</li>
						);
					})}
				</ul>
			)}
			{missing.length > 0 && (
				<p
					className="m-0 flex items-center gap-2 rounded-md border border-solid border-border-destructive bg-surface-red px-3 py-2 text-sm text-highlight-red"
					role="status"
				>
					<CircleAlertIcon className="size-4 shrink-0" />
					{missing.length} package{missing.length === 1 ? " is" : "s are"} not
					available: upload {missing.length === 1 ? "its" : "their"} .deb,
					install {missing.length === 1 ? "it" : "them"} manually, or remove{" "}
					{missing.length === 1 ? "it" : "them"} to go on.
				</p>
			)}
			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<h3 className="m-0 text-sm font-semibold">Uploaded .deb files</h3>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							pendingFor.current = null;
							fileRef.current?.click();
						}}
					>
						<FileUpIcon />
						Upload .deb files…
					</Button>
				</div>
				<input
					ref={fileRef}
					type="file"
					accept=".deb,application/vnd.debian.binary-package"
					multiple
					className="hidden"
					aria-label="Upload .deb files"
					onChange={(e) => {
						const files = [...(e.currentTarget.files ?? [])];
						e.currentTarget.value = "";
						void uploadDebs(files, pendingFor.current ?? undefined);
					}}
				/>
				{Object.entries(uploading).map(([name, x]) => (
					<div
						key={name}
						className="flex items-center gap-2 text-xs text-content-secondary"
					>
						<Spinner loading size="sm" /> {name} {Math.round(x * 100)}%
					</div>
				))}
				{spec.debs.length === 0 ? (
					<p className="m-0 text-xs text-content-secondary">
						None. A .deb is installed with apt, so its dependencies come from
						the sources above.
					</p>
				) : (
					<ul className="m-0 flex list-none flex-col gap-1 p-0">
						{spec.debs.map((d) => (
							<li key={d.name} className="flex items-center gap-2 text-sm">
								<PackageIcon className="size-4 text-content-secondary" />
								<span className="font-mono">{d.name}</span>
								<span className="text-xs text-content-secondary">
									{formatSize(d.size)}
								</span>
								<Button
									size="icon"
									variant="subtle"
									aria-label={`Remove ${d.name}`}
									onClick={async () => {
										await ImagesAPI.deleteFile(imageId, "deb", d.name).catch(
											() => undefined,
										);
										onChange((s) => ({
											...s,
											debs: s.debs.filter((x) => x.name !== d.name),
										}));
									}}
								>
									<TrashIcon />
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------- installations

const NEW_SCRIPT = `# Runs as root while the image is built, in a folder holding this
# installation's files ($INSTALL_DIR). For example:
#   install -m 0755 kubectl /usr/local/bin/kubectl
#   tar -xzf tool.tar.gz -C /opt && ln -s /opt/tool/bin/tool /usr/local/bin/tool

`;

const installId = (name: string, taken: string[]) => {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 36) || "install";
	let id = base;
	for (let n = 2; taken.includes(id); n++) {
		id = `${base}-${n}`;
	}
	return id;
};

export const InstallationsStep: React.FC<
	StepProps & {
		onLint?: (id: string, issues: LintIssue[]) => void;
		openId?: string;
	}
> = ({ imageId, spec, onChange, onLint, openId }) => {
	const [open, setOpen] = useState<string | null>(openId ?? null);
	const [name, setName] = useState("");
	useEffect(() => {
		if (openId) {
			setOpen(openId);
		}
	}, [openId]);
	const set = (id: string, change: InstallationChange) =>
		onChange((s) => ({
			...s,
			installations: s.installations.map((i) =>
				i.id === id
					? { ...i, ...(typeof change === "function" ? change(i) : change) }
					: i,
			),
		}));
	const add = () => {
		const n = name.trim();
		if (!n) {
			return;
		}
		const id = installId(
			n,
			spec.installations.map((i) => i.id),
		);
		onChange({
			...spec,
			installations: [
				...spec.installations,
				{ id, name: n, script: NEW_SCRIPT, files: [] },
			],
		});
		setName("");
		setOpen(id);
	};

	return (
		<div className="flex flex-col gap-4">
			<p className="m-0 text-sm text-content-secondary">
				Software that needs more than apt: each installation gets its own files
				(uploaded here) and a bash script that installs them. Each runs as its
				own build step, in order.
			</p>
			<ul
				className="m-0 flex list-none flex-col gap-2 p-0"
				data-testid="installations"
			>
				{spec.installations.map((inst) => (
					<InstallationRow
						key={inst.id}
						imageId={imageId}
						inst={inst}
						expanded={open === inst.id}
						onToggle={() => setOpen(open === inst.id ? null : inst.id)}
						onChange={(c) => set(inst.id, c)}
						onRemove={async () => {
							for (const f of inst.files) {
								await ImagesAPI.deleteFile(
									imageId,
									"install",
									f.name,
									inst.id,
								).catch(() => undefined);
							}
							onChange((s) => ({
								...s,
								installations: s.installations.filter((i) => i.id !== inst.id),
							}));
							onLint?.(inst.id, []);
						}}
						onLint={(issues) => onLint?.(inst.id, issues)}
					/>
				))}
			</ul>
			<form
				className="flex items-center gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					add();
				}}
			>
				<Input
					aria-label="New installation's name"
					placeholder="Name an installation, e.g. kubectl"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="max-w-sm"
				/>
				<Button type="submit" variant="outline" disabled={!name.trim()}>
					<PlusIcon />
					Add installation
				</Button>
			</form>
		</div>
	);
};

type InstallationChange =
	| Partial<ImageInstallation>
	| ((inst: ImageInstallation) => Partial<ImageInstallation>);

const InstallationRow: React.FC<{
	imageId: string;
	inst: ImageInstallation;
	expanded: boolean;
	onToggle: () => void;
	onChange: (c: InstallationChange) => void;
	onRemove: () => void;
	onLint: (issues: LintIssue[]) => void;
}> = ({ imageId, inst, expanded, onToggle, onChange, onRemove, onLint }) => {
	const fileRef = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<Record<string, number>>({});
	const [problem, setProblem] = useState<string>();
	const [issues, setIssues] = useState<LintIssue[]>([]);
	const errors = issues.filter((i) => i.level === "error").length;
	const lines = inst.script
		.split("\n")
		.filter((l) => l.trim() && !l.trim().startsWith("#")).length;

	const uploadFiles = async (files: File[]) => {
		setProblem(undefined);
		const list: ImageFile[] = [];
		for (const file of files) {
			try {
				setProgress((p) => ({ ...p, [file.name]: 0 }));
				const { file: f } = await ImagesAPI.uploadFile(
					imageId,
					"install",
					file,
					inst.id,
					(x) => setProgress((p) => ({ ...p, [file.name]: x })),
				);
				list.push({ name: f.name, size: f.size });
			} catch (e) {
				setProblem(getErrorMessage(e, `${file.name} could not be uploaded.`));
			} finally {
				setProgress((p) => {
					const { [file.name]: _, ...rest } = p;
					return rest;
				});
			}
		}
		onChange((i) => ({ files: withFiles(i.files, list) }));
	};

	return (
		<li
			className="rounded-md border border-solid border-border"
			data-testid="installation"
			data-id={inst.id}
		>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				className="flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-inherit hover:bg-surface-secondary"
			>
				{expanded ? (
					<ChevronDownIcon className="size-4" />
				) : (
					<ChevronRightIcon className="size-4" />
				)}
				<TerminalSquareIcon className="size-4 text-content-secondary" />
				<span className="font-semibold">{inst.name}</span>
				<span className="text-xs text-content-secondary">
					{inst.files.length} file{inst.files.length === 1 ? "" : "s"} · {lines}{" "}
					line{lines === 1 ? "" : "s"} of script
				</span>
				<span className="flex-1" />
				{!inst.script.trim() || lines === 0 ? (
					<span className="text-xs text-content-warning">no script yet</span>
				) : errors > 0 ? (
					<span className="text-xs text-content-destructive">
						{errors} shellcheck error{errors === 1 ? "" : "s"}
					</span>
				) : null}
			</button>
			{expanded && (
				<div className="flex flex-col gap-3 border-0 border-t border-solid border-border p-3">
					<div className="flex flex-wrap items-end gap-3">
						<div className="flex flex-col gap-1">
							<Label htmlFor={`inst-${inst.id}`}>Name</Label>
							<Input
								id={`inst-${inst.id}`}
								value={inst.name}
								onChange={(e) => onChange({ name: e.target.value })}
								className="w-64"
							/>
						</div>
						<span className="flex-1" />
						<Button
							variant="outline"
							onClick={onRemove}
							className="text-content-destructive"
						>
							<TrashIcon />
							Remove installation
						</Button>
					</div>
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<span className="text-sm font-medium">Files</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => fileRef.current?.click()}
							>
								<FileUpIcon />
								Upload files…
							</Button>
							<span className="text-xs text-content-secondary">
								Up to 2 GB each; next to the script while it runs.
							</span>
						</div>
						<input
							ref={fileRef}
							type="file"
							multiple
							className="hidden"
							aria-label={`Upload files for ${inst.name}`}
							onChange={(e) => {
								const files = [...(e.currentTarget.files ?? [])];
								e.currentTarget.value = "";
								void uploadFiles(files);
							}}
						/>
						{Object.entries(progress).map(([n, x]) => (
							<div
								key={n}
								className="flex items-center gap-2 text-xs text-content-secondary"
							>
								<Spinner loading size="sm" /> {n} {Math.round(x * 100)}%
							</div>
						))}
						{problem && (
							<p role="alert" className="m-0 text-sm text-content-destructive">
								{problem}
							</p>
						)}
						{inst.files.length > 0 && (
							<ul className="m-0 flex list-none flex-wrap gap-2 p-0">
								{inst.files.map((f) => (
									<li
										key={f.name}
										className="flex items-center gap-1.5 rounded border border-solid border-border px-2 py-1 text-xs"
									>
										<FileIcon className="size-3.5 text-content-secondary" />
										<span className="font-mono">{f.name}</span>
										<span className="text-content-secondary">
											{formatSize(f.size)}
										</span>
										<button
											type="button"
											aria-label={`Remove ${f.name}`}
											className="cursor-pointer border-0 bg-transparent p-0 text-content-secondary hover:text-content-primary"
											onClick={async () => {
												await ImagesAPI.deleteFile(
													imageId,
													"install",
													f.name,
													inst.id,
												).catch(() => undefined);
												onChange((i) => ({
													files: i.files.filter((x) => x.name !== f.name),
												}));
											}}
										>
											<XIcon className="size-3.5" />
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
					<BashEditor
						label="install.sh (bash, run as root)"
						value={inst.script}
						onChange={(script) => onChange({ script })}
						onIssues={(i) => {
							setIssues(i);
							onLint(i);
						}}
					/>
					<div className="flex justify-end">
						<Button variant="outline" onClick={onToggle}>
							Done
						</Button>
					</div>
				</div>
			)}
		</li>
	);
};

// ---------------------------------------------------------------- remove and harden

export const HardenStep: React.FC<
	StepProps & { labels: Record<string, string> }
> = ({ spec, onChange, labels }) => {
	const h = spec.hardening;
	return (
		<div className="flex flex-col gap-6">
			<section className="flex flex-col gap-3">
				<h3 className="m-0 text-sm font-semibold">Remove software</h3>
				<p className="m-0 text-sm text-content-secondary">
					Packages the base image has that this one should not (less to patch,
					less to misuse): purged, with what only they needed.
				</p>
				<PackageInput
					label="Packages to remove"
					placeholder="e.g. nano telnet (Enter to add)"
					onAdd={(names) =>
						onChange({
							...spec,
							remove: [
								...spec.remove,
								...names.filter(
									(n) => PKG_RE.test(n) && !spec.remove.includes(n),
								),
							],
						})
					}
				/>
				{spec.remove.length > 0 && (
					<ul
						className="m-0 flex list-none flex-wrap gap-2 p-0"
						data-testid="remove-list"
					>
						{spec.remove.map((p) => (
							<li
								key={p}
								className="flex items-center gap-1 rounded-full border border-solid border-border px-2.5 py-0.5 font-mono text-xs"
							>
								{p}
								<button
									type="button"
									aria-label={`Keep ${p}`}
									className="cursor-pointer border-0 bg-transparent p-0 text-content-secondary"
									onClick={() =>
										onChange({
											...spec,
											remove: spec.remove.filter((x) => x !== p),
										})
									}
								>
									<XIcon className="size-3" />
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
			<section className="flex flex-col gap-3">
				<h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
					<ShieldIcon className="size-4" />
					Harden
				</h3>
				<ul
					className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2"
					data-testid="hardening"
				>
					{Object.entries(labels).map(([key, label]) => (
						<li key={key}>
							<label
								htmlFor={`harden-${key}`}
								className="flex cursor-pointer items-start gap-2 rounded-md border border-solid border-border p-2.5 text-sm hover:bg-surface-secondary"
							>
								<Switch
									id={`harden-${key}`}
									checked={Boolean(h[key as keyof typeof h])}
									onCheckedChange={(v) =>
										onChange({ ...spec, hardening: { ...h, [key]: v } })
									}
									aria-label={label}
								/>
								<span>{label}</span>
							</label>
						</li>
					))}
				</ul>
				<label
					htmlFor="harden-fips"
					className="flex cursor-pointer items-start gap-2 rounded-md border border-solid border-border p-2.5 text-sm hover:bg-surface-secondary"
				>
					<Switch
						id="harden-fips"
						checked={spec.fips}
						onCheckedChange={(v) => onChange({ ...spec, fips: v })}
						aria-label="FIPS-aligned crypto"
					/>
					<span>
						<b>FIPS-aligned crypto.</b> SSH limited to FIPS-approved ciphers,
						MACs and key exchanges; TLS 1.2 or later; OpenSSL's FIPS provider
						made the default when a validated module is in the image (Ubuntu
						Pro's <code>openssl-fips-module-3</code> from your mirror, as a
						package above). The report's FIPS check says how far the image goes.
					</span>
				</label>
				<BashEditor
					label="Your own hardening script (bash, run as root, last)"
					height={160}
					value={h.script}
					onChange={(script) =>
						onChange({ ...spec, hardening: { ...h, script } })
					}
				/>
			</section>
		</div>
	);
};

// ---------------------------------------------------------------- desktop

const DESKTOPS: { value: ImageDesktop; title: string; detail: string }[] = [
	{
		value: "keep",
		title: "As the base has it",
		detail: "The workspace image's XFCE desktop (or the base image's choice).",
	},
	{
		value: "xfce",
		title: "XFCE",
		detail:
			"Light and quick over VNC: the workspace template's default desktop.",
	},
	{
		value: "gnome",
		title: "GNOME",
		detail:
			"GNOME Flashback (GNOME without 3D effects, made for VNC). About 600 MB more.",
	},
	{
		value: "none",
		title: "No desktop",
		detail:
			"Terminal and apps only: a much smaller image. The Desktop app won't start.",
	},
];

export const DesktopStep: React.FC<StepProps> = ({ spec, onChange }) => (
	<div className="flex flex-col gap-3">
		<p className="m-0 text-sm text-content-secondary">
			The desktop the workspace's Desktop app (noVNC) shows.
		</p>
		<div
			role="radiogroup"
			aria-label="Desktop"
			className="grid gap-3 sm:grid-cols-2"
		>
			{DESKTOPS.map((d) => (
				<button
					key={d.value}
					type="button"
					role="radio"
					aria-checked={spec.desktop === d.value}
					onClick={() => onChange({ ...spec, desktop: d.value })}
					className={cn(
						"flex cursor-pointer items-start gap-3 rounded-lg border border-solid p-4 text-left text-inherit",
						spec.desktop === d.value
							? "border-content-link bg-surface-secondary ring-1 ring-content-link"
							: "border-border bg-transparent hover:bg-surface-secondary",
					)}
				>
					<MonitorIcon className="mt-0.5 size-5 shrink-0 text-content-secondary" />
					<span className="flex flex-col gap-1">
						<span className="font-semibold">{d.title}</span>
						<span className="text-sm text-content-secondary">{d.detail}</span>
					</span>
				</button>
			))}
		</div>
	</div>
);

// ---------------------------------------------------------------- configuration

export const ConfigStep: React.FC<StepProps> = ({ spec, onChange }) => {
	const c = spec.config;
	type Config = ImageSpec["config"];
	const set = (change: Partial<Config> | ((c: Config) => Partial<Config>)) =>
		onChange((s) => ({
			...s,
			config: {
				...s.config,
				...(typeof change === "function" ? change(s.config) : change),
			},
		}));
	const fileRef = useRef<HTMLInputElement>(null);
	const [newPath, setNewPath] = useState("");
	return (
		<div className="flex flex-col gap-5">
			<p className="m-0 text-sm text-content-secondary">
				Added to every shell in the workspace (
				<code>/etc/coder-image/bashrc</code>, read by{" "}
				<code>/etc/bash.bashrc</code>). Dotfiles go into new home folders, and
				into existing ones where the file is missing.
			</p>
			<BashEditor
				label="Environment (export VAR=value)"
				height={110}
				value={c.profile}
				onChange={(profile) => set({ profile })}
			/>
			<BashEditor
				label="Aliases (alias ll='ls -la')"
				height={130}
				value={c.aliases}
				onChange={(aliases) => set({ aliases })}
			/>
			<BashEditor
				label="Functions"
				height={170}
				value={c.functions}
				onChange={(functions) => set({ functions })}
			/>
			<section className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<h3 className="m-0 text-sm font-semibold">Dotfiles</h3>
					<Button
						size="sm"
						variant="outline"
						onClick={() => fileRef.current?.click()}
					>
						<FileUpIcon />
						Import files…
					</Button>
					<input
						ref={fileRef}
						type="file"
						multiple
						className="hidden"
						aria-label="Import dotfiles"
						onChange={async (e) => {
							const files = [...(e.currentTarget.files ?? [])];
							e.currentTarget.value = "";
							const added = await Promise.all(
								files.map(async (f) => ({
									path: f.name,
									content: await f.text(),
								})),
							);
							set((cfg) => ({
								dotfiles: [
									...cfg.dotfiles.filter(
										(d) => !added.some((a) => a.path === d.path),
									),
									...added,
								],
							}));
						}}
					/>
				</div>
				<form
					className="flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						const p = newPath.trim().replace(/^~?\/+/, "");
						if (p && !c.dotfiles.some((d) => d.path === p)) {
							set({ dotfiles: [...c.dotfiles, { path: p, content: "" }] });
						}
						setNewPath("");
					}}
				>
					<Input
						aria-label="New dotfile's path"
						placeholder="Path in the home folder, e.g. .vimrc or .config/git/config"
						value={newPath}
						onChange={(e) => setNewPath(e.target.value)}
						className="max-w-md"
					/>
					<Button type="submit" variant="outline" disabled={!newPath.trim()}>
						<PlusIcon />
						Add
					</Button>
				</form>
				{c.dotfiles.map((d) => (
					<div key={d.path} className="flex flex-col gap-1">
						<div className="flex items-center gap-2">
							<code className="text-sm">~/{d.path}</code>
							<Button
								size="icon"
								variant="subtle"
								aria-label={`Remove ${d.path}`}
								onClick={() =>
									set({ dotfiles: c.dotfiles.filter((x) => x.path !== d.path) })
								}
							>
								<TrashIcon />
							</Button>
						</div>
						<textarea
							aria-label={`Contents of ${d.path}`}
							value={d.content}
							rows={Math.min(14, Math.max(3, d.content.split("\n").length + 1))}
							spellCheck={false}
							onChange={(e) =>
								set({
									dotfiles: c.dotfiles.map((x) =>
										x.path === d.path ? { ...x, content: e.target.value } : x,
									),
								})
							}
							className="w-full resize-y rounded-md border border-solid border-border bg-surface-primary p-2 font-mono text-xs text-content-primary"
						/>
					</div>
				))}
			</section>
		</div>
	);
};

// ---------------------------------------------------------------- review

export const ReviewStep: React.FC<
	StepProps & {
		problems: string[];
		dockerfile?: string;
		plan?: { key: string; label: string }[];
	}
> = ({ spec, problems, dockerfile, plan }) => {
	const rows = useMemo(
		() => [
			[
				"Base",
				spec.base.kind === "image"
					? `Built image ${spec.base.id}`
					: "The workspace image",
			],
			[
				"Apt packages",
				spec.packages.length ? spec.packages.join(", ") : "none",
			],
			[
				".deb files",
				spec.debs.length ? spec.debs.map((d) => d.name).join(", ") : "none",
			],
			[
				"Installations",
				spec.installations.length
					? spec.installations.map((i) => i.name).join(", ")
					: "none",
			],
			["Removed", spec.remove.length ? spec.remove.join(", ") : "nothing"],
			[
				"Hardening",
				[
					...Object.entries(spec.hardening)
						.filter(([k, v]) => k !== "script" && v)
						.map(([k]) => k),
					spec.hardening.script.trim() ? "own script" : "",
					spec.fips ? "FIPS-aligned crypto" : "",
				]
					.filter(Boolean)
					.join(", ") || "none",
			],
			[
				"Desktop",
				{
					keep: "as the base has it",
					xfce: "XFCE",
					gnome: "GNOME",
					none: "none",
				}[spec.desktop],
			],
			[
				"Configuration",
				[
					spec.config.profile.trim() && "environment",
					spec.config.aliases.trim() && "aliases",
					spec.config.functions.trim() && "functions",
					spec.config.dotfiles.length &&
						`${spec.config.dotfiles.length} dotfiles`,
				]
					.filter(Boolean)
					.join(", ") || "none",
			],
		],
		[spec],
	);
	return (
		<div className="flex flex-col gap-5">
			<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
				{rows.map(([k, v]) => (
					<div key={k} className="contents">
						<dt className="text-content-secondary">{k}</dt>
						<dd className="m-0 break-words">{v}</dd>
					</div>
				))}
			</dl>
			{problems.length > 0 ? (
				<ul
					className="m-0 flex list-none flex-col gap-1 rounded-md border border-solid border-border-destructive bg-surface-red p-3 text-sm text-highlight-red"
					role="alert"
					data-testid="build-problems"
				>
					{problems.map((p) => (
						<li key={p} className="flex items-start gap-2">
							<CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
							{p}
						</li>
					))}
				</ul>
			) : (
				<p className="m-0 flex items-center gap-2 text-sm text-content-success">
					<CircleCheckIcon className="size-4" />
					Ready to build.
				</p>
			)}
			{plan && (
				<div className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold">The build, step by step</h3>
					<ol className="m-0 pl-5 text-sm text-content-secondary">
						{plan.map((s) => (
							<li key={s.key}>{s.label}</li>
						))}
					</ol>
				</div>
			)}
			{dockerfile && (
				<details>
					<summary className="cursor-pointer text-sm font-semibold">
						The generated Dockerfile
					</summary>
					<pre className="mt-2 max-h-96 overflow-auto rounded-md border border-solid border-border bg-surface-secondary p-3 text-xs leading-relaxed">
						{dockerfile}
					</pre>
				</details>
			)}
		</div>
	);
};
