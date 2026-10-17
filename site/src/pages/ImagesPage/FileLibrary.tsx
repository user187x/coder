import {
	BrainCircuitIcon,
	DiscIcon,
	DownloadCloudIcon,
	TrashIcon,
	UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { ImagesAPI, type Library, type LibraryKind } from "#/api/images";
import { PlatformError } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { createDayString } from "#/utils/createDayString";
import { formatSize } from "./badges";

export const libraryKey = (kind: LibraryKind) =>
	["platform", "library", kind] as const;

/** Where workspaces have it, as their users see it: ~/isos, ~/models. */
const homePath = (path: string) => path.replace(/^\/home\/coder(?=\/|$)/, "~");

/** What sets one library apart from the other. */
type LibraryCopy = {
	kind: LibraryKind;
	title: string;
	icon: React.ReactNode;
	/** One file, several ("ISO", "ISOs"). */
	noun: [string, string];
	accept: string;
	placeholder: string;
	/** Before how much is there. */
	describe: (lib: Library) => React.ReactNode;
};

/**
 * A shared library on the Cloud Drive's storage: files every workspace (or every AI workspace) has read-only.
 * Everyone sees what is there; admins and template admins upload files (with their progress), have the service fetch
 * one from a URL (its progress while it comes in), and delete them. Nothing where the deployment has no Cloud Drive
 * storage.
 */
const FileLibrary: React.FC<LibraryCopy> = ({
	kind,
	title,
	icon,
	noun,
	accept,
	placeholder,
	describe,
}) => {
	const queryClient = useQueryClient();
	const key = libraryKey(kind);
	const query = useQuery({
		queryKey: key,
		queryFn: () => ImagesAPI.library(kind),
		retry: false,
		refetchInterval: (q) =>
			q.state.data?.imports.some((i) => !i.done && !i.error) ? 2000 : 30_000,
	});
	const fileInput = useRef<HTMLInputElement>(null);
	const [upload, setUpload] = useState<{
		name: string;
		fraction: number;
	} | null>(null);
	const [url, setUrl] = useState("");
	const [confirming, setConfirming] = useState<string | null>(null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: key });
	const send = useMutation({
		mutationFn: (file: File) => {
			setUpload({ name: file.name, fraction: 0 });
			return ImagesAPI.uploadToLibrary(kind, file, (fraction) =>
				setUpload({ name: file.name, fraction }),
			);
		},
		onSettled: () => {
			setUpload(null);
			void refresh();
		},
	});
	const fetchUrl = useMutation({
		mutationFn: () => ImagesAPI.importToLibrary(kind, url.trim(), ""),
		onSuccess: () => {
			setUrl("");
			void refresh();
		},
	});
	const remove = useMutation({
		mutationFn: (name: string) => ImagesAPI.deleteFromLibrary(kind, name),
		onSettled: () => {
			setConfirming(null);
			void refresh();
		},
	});

	const lib = query.data;
	if (
		!lib ||
		(query.error instanceof PlatformError && query.error.status === 404)
	) {
		return null;
	}
	const running = lib.imports.filter((i) => !i.done);
	const problem = send.error ?? fetchUrl.error ?? remove.error;
	const headingId = `library-${kind}`;

	return (
		<section className="mt-10" aria-labelledby={headingId}>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2
						id={headingId}
						className="m-0 flex items-center gap-2 text-lg font-semibold"
					>
						{icon}
						{title}
					</h2>
					<p className="mt-1 mb-0 text-sm text-content-secondary">
						{describe(lib)} {lib.files.length}{" "}
						{lib.files.length === 1 ? noun[0] : noun[1]},{" "}
						{formatSize(lib.usedBytes)}.
					</p>
				</div>
				{lib.canEdit && (
					<div className="flex flex-wrap items-center gap-2">
						<input
							ref={fileInput}
							type="file"
							accept={accept}
							hidden
							data-testid={`${kind}-file-input`}
							onChange={(e) => {
								const f = e.target.files?.[0];
								e.target.value = "";
								if (f) {
									send.mutate(f);
								}
							}}
						/>
						<form
							className="flex items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								fetchUrl.mutate();
							}}
						>
							<Input
								aria-label={`The ${noun[0]}'s address`}
								placeholder={placeholder}
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								className="h-8 w-64 text-xs"
							/>
							<Button
								type="submit"
								size="sm"
								variant="outline"
								disabled={
									!/^https?:\/\/\S+$/.test(url.trim()) || fetchUrl.isPending
								}
							>
								<DownloadCloudIcon />
								Fetch
							</Button>
						</form>
						<Button
							size="sm"
							disabled={send.isPending}
							onClick={() => fileInput.current?.click()}
						>
							<UploadIcon />
							Upload {noun[0]}
						</Button>
					</div>
				)}
			</div>
			{problem ? (
				<p role="alert" className="mt-2 mb-0 text-sm text-content-destructive">
					{getErrorMessage(problem, "That did not work.")}
				</p>
			) : null}
			{(upload || running.length > 0 || lib.imports.some((i) => i.error)) && (
				<div
					className="mt-3 flex flex-col gap-1.5"
					data-testid={`${kind}-progress`}
				>
					{upload && (
						<LibraryProgress
							name={upload.name}
							fraction={upload.fraction}
							label="Uploading"
						/>
					)}
					{lib.imports
						.filter((i) => !i.done)
						.map((i) =>
							i.error ? (
								<p
									key={i.name}
									className="m-0 text-xs text-content-destructive"
								>
									{i.name}: {i.error}
								</p>
							) : (
								<LibraryProgress
									key={i.name}
									name={i.name}
									fraction={i.total ? i.bytes / i.total : 0}
									label="Fetching"
								/>
							),
						)}
				</div>
			)}
			<Table className="mt-3" data-testid={`${kind}-table`}>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[60%]">{noun[0]}</TableHead>
						<TableHead className="w-[15%]">Size</TableHead>
						<TableHead className="w-[20%]">Added</TableHead>
						<TableHead className="w-[5%]" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{lib.files.length === 0 ? (
						<TableRow>
							<TableCell colSpan={4} className="text-sm text-content-secondary">
								No {noun[1]} yet.
								{lib.canEdit &&
									" Upload one, or fetch one from an address the cluster reaches."}
							</TableCell>
						</TableRow>
					) : (
						lib.files.map((f) => (
							<TableRow key={f.name}>
								<TableCell className="break-all font-mono text-xs">
									{homePath(lib.mountPath)}/{f.name}
								</TableCell>
								<TableCell className="text-sm tabular-nums">
									{formatSize(f.size)}
								</TableCell>
								<TableCell className="text-sm text-content-secondary">
									{createDayString(f.modified)}
								</TableCell>
								<TableCell className="text-right">
									{lib.canEdit &&
										(confirming === f.name ? (
											<Button
												size="xs"
												variant="destructive"
												disabled={remove.isPending}
												onClick={() => remove.mutate(f.name)}
											>
												Delete?
											</Button>
										) : (
											<Button
												size="icon"
												variant="subtle"
												aria-label={`Delete ${f.name}`}
												onClick={() => setConfirming(f.name)}
											>
												<TrashIcon />
											</Button>
										))}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</section>
	);
};

const LibraryProgress: React.FC<{
	name: string;
	fraction: number;
	label: string;
}> = ({ name, fraction, label }) => (
	<div className="flex items-center gap-3 text-xs">
		<span className="w-64 truncate text-content-primary" title={name}>
			{label} {name}
		</span>
		<div
			role="progressbar"
			aria-label={`${label} ${name}`}
			aria-valuenow={Math.round(fraction * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
			className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tertiary"
		>
			<div
				className="h-full bg-content-link transition-[width]"
				style={{ width: `${Math.round(fraction * 100)}%` }}
			/>
		</div>
		<span className="w-10 text-right tabular-nums text-content-secondary">
			{Math.round(fraction * 100)}%
		</span>
	</div>
);

/** The ISO library: disk images for every workspace, read-only at ~/isos in each. */
export const IsoLibrary: React.FC = () => (
	<FileLibrary
		kind="isos"
		title="ISO library"
		icon={<DiscIcon aria-hidden className="size-5 text-content-secondary" />}
		noun={["ISO", "ISOs"]}
		accept=".iso,.img"
		placeholder="https://… .iso"
		describe={(lib) => (
			<>
				Disk images for every workspace: read-only at{" "}
				<code>{homePath(lib.mountPath)}</code> in each. Your own go in your
				Cloud Drive.
			</>
		)}
	/>
);

/**
 * The model library: language models (GGUF) for the AI workspaces (UBUNTU LM STUDIO, UBUNTU OPENCODE), read-only at
 * ~/models in each, where LM Studio lists them and OpenCode can use them.
 */
export const ModelLibrary: React.FC = () => (
	<FileLibrary
		kind="models"
		title="Model library"
		icon={
			<BrainCircuitIcon aria-hidden className="size-5 text-content-secondary" />
		}
		noun={["model", "models"]}
		accept=".gguf"
		placeholder="https://… .gguf"
		describe={(lib) => (
			<>
				Language models (GGUF) for the LM Studio and OpenCode workspaces:
				read-only at <code>{homePath(lib.mountPath)}</code> in each, where LM
				Studio lists them and OpenCode can use them. Your own go in your Cloud
				Drive's <code>models</code> folder.
			</>
		)}
	/>
);
