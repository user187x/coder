import { BoxIcon, UploadIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { ImagesAPI } from "#/api/images";
import { dependencyImagesKey } from "#/api/queries/images";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CopyButton } from "#/components/CopyButton/CopyButton";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableCard } from "#/modules/platform/tableCard/TableCard";

/** Dependency archives stored in the local registry for offline pulls. */
export const DockerImageLibrary: React.FC<{ canUpload: boolean }> = ({
	canUpload,
}) => {
	const headingId = useId();
	const [uploading, setUploading] = useState(false);
	const query = useQuery({
		queryKey: dependencyImagesKey,
		queryFn: ImagesAPI.dependencies,
		refetchInterval: (query) =>
			query.state.data?.upload?.error === null ? 2000 : 30_000,
	});
	const upload = query.data?.upload;
	const images = query.data?.images ?? [];

	return (
		<section className="dashboard-panel min-w-0" aria-labelledby={headingId}>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h2 id={headingId} className="m-0 flex items-center gap-2 text-lg">
					<BoxIcon className="size-4" aria-hidden />
					Docker Image Library
				</h2>
				{canUpload && (
					<Button
						onClick={() => setUploading(true)}
						disabled={upload?.error === null}
					>
						<UploadIcon />
						Upload image
					</Button>
				)}
			</div>
			<p className="mb-3 text-sm text-content-secondary">
				Use these local pull references in Coder's deployment configuration to
				pull dependency images when upstream registries are offline.
			</p>
			{query.error ? <ErrorAlert error={query.error} /> : null}
			{upload && (
				<p
					role={upload.error ? "alert" : "status"}
					className="mb-3 wrap-anywhere text-sm"
				>
					{upload.error
						? `Could not store ${upload.reference}. ${upload.error}`
						: `Storing ${upload.reference} in the local registry…`}
				</p>
			)}
			<TableCard
				summary={`${images.length} ${images.length === 1 ? "image" : "images"}`}
			>
				<Table aria-label="Docker Image Library">
					<TableHeader>
						<TableRow>
							<TableHead>Local pull reference</TableHead>
							<TableHead className="w-12" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{query.isLoading || (!query.error && images.length === 0) ? (
							<TableRow>
								<TableCell colSpan={2} className="text-content-secondary">
									{query.isLoading
										? "Loading…"
										: "No dependency images uploaded yet."}
								</TableCell>
							</TableRow>
						) : (
							images.map((ref) => (
								<TableRow key={ref}>
									<TableCell className="wrap-anywhere font-mono text-xs">
										{ref}
									</TableCell>
									<TableCell>
										<CopyButton
											text={ref}
											label={`Copy ${ref}`}
											variant="subtle"
											size="icon"
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</TableCard>
			{uploading && (
				<UploadDependencyDialog onClose={() => setUploading(false)} />
			)}
		</section>
	);
};

const UploadDependencyDialog: React.FC<{ onClose: () => void }> = ({
	onClose,
}) => {
	const referenceId = useId();
	const archiveId = useId();
	const queryClient = useQueryClient();
	const [ref, setRef] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [progress, setProgress] = useState(0);
	const upload = useMutation({
		mutationFn: (archive: File) =>
			ImagesAPI.uploadDependency(ref.trim(), archive, setProgress),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: dependencyImagesKey });
			onClose();
		},
	});

	return (
		<Dialog
			open
			onOpenChange={(open) => !open && !upload.isPending && onClose()}
		>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Upload a dependency image</DialogTitle>
					<DialogDescription>
						Select a Docker save or OCI image archive. The local registry keeps
						the image's repository path and tag.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex min-w-0 flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (file && ref.trim() && !upload.isPending) {
							setProgress(0);
							upload.mutate(file);
						}
					}}
				>
					<div className="flex flex-col gap-2">
						<Label htmlFor={referenceId}>Image reference in the archive</Label>
						<Input
							id={referenceId}
							placeholder="ghcr.io/cloudnative-pg/pgbouncer:1.25.1"
							value={ref}
							onChange={(event) => setRef(event.target.value)}
							disabled={upload.isPending}
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor={archiveId}>Image archive</Label>
						<Input
							id={archiveId}
							type="file"
							accept=".tar,.tar.gz,.tgz,application/x-tar,application/gzip"
							onChange={(event) => setFile(event.target.files?.[0] ?? null)}
							disabled={upload.isPending}
							aria-required
						/>
					</div>
					{upload.isPending && (
						<p role="status">Uploading {Math.round(progress * 100)}%</p>
					)}
					{upload.error ? <ErrorAlert error={upload.error} /> : null}
					<DialogFooter className="gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={upload.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!file || !ref.trim() || upload.isPending}
						>
							Upload
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
