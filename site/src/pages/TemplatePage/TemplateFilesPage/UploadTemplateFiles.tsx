import { FileIcon, UploadIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import type { Template, TemplateVersion } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { formatBytes } from "#/modules/platform/cloudDrive/drivePaths";
import { TarFileTypeCodes, TarReader, TarWriter } from "#/utils/tar";

const ROOT = "/";

/**
 * The version's files with `files` added in `folder` (a file of the same name replaced): a new tar, every other entry
 * (binary ones too) as it was.
 */
export const withUploadedFiles = async (
	tar: ArrayBuffer,
	folder: string,
	files: readonly File[],
): Promise<Blob> => {
	const reader = new TarReader();
	await reader.readFile(tar);
	const prefix = folder === ROOT ? "" : `${folder.replace(/\/+$/, "")}/`;
	const added = new Set(files.map((f) => prefix + f.name));
	const writer = new TarWriter();
	for (const info of reader.fileInfo) {
		const opts = {
			mode: info.mode,
			mtime: info.mtime,
			user: info.user,
			group: info.group,
		};
		if (info.type === TarFileTypeCodes.Dir) {
			writer.addFolder(info.name, opts);
		} else if (info.type === TarFileTypeCodes.File && !added.has(info.name)) {
			const blob = reader.getFileBlob(info.name);
			if (blob) {
				writer.addFile(info.name, blob, opts);
			}
		}
	}
	for (const file of files) {
		writer.addFile(prefix + file.name, file, { mode: 0o644 });
	}
	return (await writer.write()) as Blob;
};

type UploadTemplateFilesProps = {
	template: Template;
	/** The version the new one starts from: the one shown. */
	version: TemplateVersion;
	/** Its folders ("a/b"), for where the files go. */
	folders: readonly string[];
};

/**
 * Source Code's Upload, at the top of the file tree: files from the computer into a folder of the template, as a new
 * version made from the one shown, opened in the editor to build and publish.
 */
export const UploadTemplateFiles: React.FC<UploadTemplateFilesProps> = ({
	template,
	version,
	folders,
}) => {
	const navigate = useNavigate();
	const getLink = useLinks();
	const input = useRef<HTMLInputElement>(null);
	const folderId = useId();
	const [files, setFiles] = useState<File[]>([]);
	const [folder, setFolder] = useState(ROOT);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const open = files.length > 0;

	const close = () => {
		if (!saving) {
			setFiles([]);
			setError(null);
		}
	};

	const create = async () => {
		setSaving(true);
		setError(null);
		try {
			const tar = await withUploadedFiles(
				await API.getFile(version.job.file_id),
				folder,
				files,
			);
			const uploaded = await API.uploadFile(
				new File([tar], "template.tar", { type: "application/x-tar" }),
			);
			const created = await API.createTemplateVersion(
				template.organization_id,
				{
					template_id: template.id,
					file_id: uploaded.hash,
					provisioner: "terraform",
					storage_method: "file",
					tags: version.job.tags,
					message: `Uploaded ${files.map((f) => f.name).join(", ")}`,
				},
			);
			navigate(
				`${getLink(linkToTemplate(template.organization_name, template.name))}/versions/${created.name}/edit`,
			);
		} catch (err) {
			setError(getErrorMessage(err, "The new version could not be made."));
			setSaving(false);
		}
	};

	return (
		<>
			<input
				ref={input}
				type="file"
				multiple
				hidden
				data-testid="template-upload-input"
				onChange={(event) => {
					const picked = [...(event.target.files ?? [])];
					event.target.value = "";
					if (picked.length) {
						setFolder(ROOT);
						setFiles(picked);
					}
				}}
			/>
			<Button
				size="sm"
				variant="outline"
				className="w-full justify-start"
				title="Add files from your computer to this template (a new version)"
				onClick={() => input.current?.click()}
			>
				<UploadIcon />
				Upload
			</Button>
			<Dialog open={open} onOpenChange={(next) => !next && close()}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							Upload to {template.display_name || template.name}
						</DialogTitle>
						<DialogDescription>
							A new version from {version.name}, with these files (one of the
							same name is replaced). It opens in the editor to build and
							publish.
						</DialogDescription>
					</DialogHeader>
					<ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0">
						{files.map((file) => (
							<li
								key={file.name}
								className="flex items-center gap-2 text-sm text-content-primary"
							>
								<FileIcon className="size-4 shrink-0 text-content-secondary" />
								<span className="min-w-0 flex-1 truncate">{file.name}</span>
								<span className="shrink-0 tabular-nums text-xs text-content-secondary">
									{formatBytes(file.size)}
								</span>
								<Button
									size="icon"
									variant="subtle"
									className="size-6"
									aria-label={`Leave out ${file.name}`}
									disabled={saving}
									onClick={() => setFiles((f) => f.filter((x) => x !== file))}
								>
									<XIcon />
								</Button>
							</li>
						))}
					</ul>
					<div className="flex flex-col gap-2">
						<Label htmlFor={folderId}>Into the folder</Label>
						<Select value={folder} onValueChange={setFolder} disabled={saving}>
							<SelectTrigger id={folderId}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ROOT}>/ (the template's top)</SelectItem>
								{folders.map((f) => (
									<SelectItem key={f} value={f}>
										/{f}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{error && (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={close} disabled={saving}>
							Cancel
						</Button>
						<Button onClick={() => void create()} disabled={saving}>
							<Spinner loading={saving} />
							Create version
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};
