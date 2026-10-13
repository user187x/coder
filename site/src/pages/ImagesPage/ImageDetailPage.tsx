import {
	ArrowLeftIcon,
	CloudUploadIcon,
	DownloadIcon,
	HammerIcon,
	PencilIcon,
	ScanSearchIcon,
	TrashIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	Link as RouterLink,
	useLocation,
	useNavigate,
	useParams,
} from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { type ImageDetail, ImagesAPI, terraformSnippet } from "#/api/images";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Loader } from "#/components/Loader/Loader";
import { Margins } from "#/components/Margins/Margins";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { createDayString } from "#/utils/createDayString";
import { pageTitle } from "#/utils/page";
import {
	FipsBadge,
	formatSize,
	GradeBadge,
	StatusBadge,
	TrackedBadge,
} from "./badges";
import { ImageAddons } from "./ImageAddons";
import { imageKey } from "./ImageEditorPage";
import { ImageReport } from "./ImageReport";
import { imagesKey } from "./ImagesPage";

/**
 * Templates > Images > (an image): how to use it, its security report, its
 * add-ons, its builds, its backup. The workspace template's own image (tracked)
 * is read-only: its report and add-ons, rescans, a download.
 */
const ImageDetailPage: React.FC = () => {
	const { image: id = "" } = useParams();
	const query = useQuery({
		queryKey: imageKey(id),
		queryFn: () => ImagesAPI.get(id),
		refetchInterval: (q) =>
			q.state.data?.image.activeBuild ||
			q.state.data?.image.s3.status === "uploading"
				? 3000
				: false,
	});
	if (query.error) {
		return (
			<Margins className="py-10">
				<ErrorAlert error={query.error} />
			</Margins>
		);
	}
	if (!query.data) {
		return <Loader />;
	}
	return <ImageDetailView image={query.data.image} />;
};

const ImageDetailView: React.FC<{ image: ImageDetail }> = ({ image }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const queryClient = useQueryClient();
	const [deleting, setDeleting] = useState(false);
	const tracked = image.tracked;
	const editable = image.canEdit && !tracked;
	const tag = tracked?.image.split(":").pop();
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: imageKey(image.id) });
		void queryClient.invalidateQueries({ queryKey: imagesKey, exact: true });
	};
	const build = useMutation({
		mutationFn: () => ImagesAPI.build(image.id),
		onSuccess: ({ build: n }) => navigate(`/images/${image.id}/builds/${n}`),
		onError: (e) =>
			toast.error(getErrorMessage(e, "The build could not start.")),
	});
	const rescan = useMutation({
		mutationFn: () => ImagesAPI.rescan(image.id),
		onSuccess: ({ build: n }) => navigate(`/images/${image.id}/builds/${n}`),
		onError: (e) =>
			toast.error(getErrorMessage(e, "The rescan could not start.")),
	});
	const s3 = useMutation({
		mutationFn: (enabled: boolean) => ImagesAPI.setS3(image.id, enabled),
		onSuccess: refresh,
		onError: (e) => toast.error(getErrorMessage(e, "Not changed.")),
	});
	const backup = useMutation({
		mutationFn: () => ImagesAPI.backupNow(image.id),
		onSuccess: refresh,
		onError: (e) =>
			toast.error(getErrorMessage(e, "The backup could not start.")),
	});
	const remove = useMutation({
		mutationFn: () => ImagesAPI.remove(image.id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: imagesKey });
			toast.success(`${image.name} deleted.`);
			navigate("/images");
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not deleted.")),
	});
	// /images/<id>#report (from the build page): scrolled to the report
	useEffect(() => {
		if (location.hash === "#report") {
			document.getElementById("report")?.scrollIntoView();
		}
	}, [location.hash]);

	return (
		<Margins className="flex flex-col gap-8 pb-12">
			<title>{pageTitle(image.name, "Images")}</title>
			<header className="flex flex-col gap-3 pt-8">
				<Button variant="subtle" size="sm" asChild className="self-start">
					<RouterLink to="/images">
						<ArrowLeftIcon />
						Images
					</RouterLink>
				</Button>
				<div className="flex flex-wrap items-center gap-3">
					<h1 className="m-0 text-3xl font-semibold">{image.name}</h1>
					<StatusBadge
						status={image.status}
						building={Boolean(image.activeBuild)}
					/>
					{tracked && <TrackedBadge />}
					{tag && <span className="text-content-secondary">{tag}</span>}
					{image.version > 0 && (
						<span className="text-content-secondary">v{image.version}</span>
					)}
					<span className="flex-1" />
					{image.activeBuild && (
						<Button variant="outline" asChild>
							<RouterLink
								to={`/images/${image.id}/builds/${image.activeBuild}`}
							>
								<Spinner loading />
								{tracked ? "Scanning: watch it" : "Building: watch it"}
							</RouterLink>
						</Button>
					)}
					{image.pullRef && (
						<Button variant="outline" asChild>
							<a href={ImagesAPI.downloadUrl(image.id)} download>
								<DownloadIcon />
								Download ({formatSize(image.size)})
							</a>
						</Button>
					)}
					{tracked && image.canEdit && image.pullRef && (
						<Button
							variant="outline"
							onClick={() => rescan.mutate()}
							disabled={Boolean(image.activeBuild) || rescan.isPending}
							title="Scan it again with the security data in force"
						>
							<Spinner loading={rescan.isPending}>
								<ScanSearchIcon />
							</Spinner>
							Rescan
						</Button>
					)}
					{editable && (
						<>
							<Button variant="outline" asChild>
								<RouterLink to={`/images/${image.id}/edit`}>
									<PencilIcon />
									Edit
								</RouterLink>
							</Button>
							<Button
								onClick={() => build.mutate()}
								disabled={Boolean(image.activeBuild) || build.isPending}
							>
								<Spinner loading={build.isPending}>
									<HammerIcon />
								</Spinner>
								{image.version ? "Rebuild" : "Build"}
							</Button>
							{image.pullRef && (
								<Button
									variant="outline"
									onClick={() => rescan.mutate()}
									disabled={Boolean(image.activeBuild) || rescan.isPending}
									title="Scan this version again with the security data in force (nothing is rebuilt)"
								>
									<Spinner loading={rescan.isPending}>
										<ScanSearchIcon />
									</Spinner>
									Rescan
								</Button>
							)}
							<Button
								variant="outline"
								size="icon"
								aria-label={`Delete ${image.name}`}
								disabled={Boolean(image.activeBuild)}
								onClick={() => setDeleting(true)}
							>
								<TrashIcon />
							</Button>
						</>
					)}
				</div>
				{image.description && (
					<p className="m-0 max-w-3xl text-content-secondary">
						{image.description}
					</p>
				)}
				<p className="m-0 text-xs text-content-secondary">
					{tracked ? (
						<>
							Deployed with the platform
							{image.builtAt &&
								` · current since ${createDayString(image.builtAt)}`}
						</>
					) : (
						<>
							Created {createDayString(image.createdAt)}
							{image.createdBy && ` by ${image.createdBy}`}
							{image.builtAt &&
								` · built ${createDayString(image.builtAt)}${image.builtBy ? ` by ${image.builtBy}` : ""}`}
						</>
					)}
					{image.digest && (
						<>
							·
							<span className="font-mono" title={image.digest}>
								{image.digest.slice(0, 19)}
							</span>
						</>
					)}
				</p>
			</header>

			{tracked ? (
				<section className="flex flex-col gap-3" data-testid="tracked-image">
					<h2 className="m-0 text-lg font-semibold">
						Used by the workspace template
					</h2>
					<CodeExample code={tracked.image} secret={false} />
					<p className="m-0 max-w-3xl text-sm text-content-secondary">
						The workspace template
						{tracked.template && <b> {tracked.template}</b>} runs this image:
						every workspace from it starts here. It comes with the platform and
						follows it (an upgrade that ships a new image updates this entry and
						scans it), so it is not edited or built in this view. New images
						build on it: <b>New Image</b> starts from the workspace image.
					</p>
					{!image.pullRef && (
						<p className="m-0 rounded-md border border-solid border-border p-4 text-sm text-content-secondary">
							Waiting for the image builder's copy of it, which is scanned: the
							install seeds it (<code>./make --deploy</code>, or{" "}
							<code>./mirror-images.sh seed-builder</code> after an Argo CD
							install).
						</p>
					)}
				</section>
			) : image.pullRef ? (
				<section className="flex flex-col gap-3" data-testid="use-in-template">
					<h2 className="m-0 text-lg font-semibold">Use in a template</h2>
					<CodeExample code={image.pullRef} secret={false} />
					<pre className="m-0 overflow-x-auto rounded-md border border-solid border-border bg-surface-secondary p-3 text-xs">
						{terraformSnippet(image.pullRef)}
					</pre>
					<p className="m-0 text-xs text-content-secondary">
						Each node pulls it from the cluster's image registry. Name the
						version (<code>:{image.version}</code>), not <code>latest</code>, so
						a rebuild doesn't change workspaces under you; versions stay until
						the image is deleted.
					</p>
				</section>
			) : (
				<p className="m-0 rounded-md border border-solid border-border p-4 text-sm text-content-secondary">
					Not built yet.{" "}
					{editable && (
						<RouterLink
							to={`/images/${image.id}/edit`}
							className="text-content-link"
						>
							Open the builder
						</RouterLink>
					)}
				</p>
			)}

			<section className="flex flex-col gap-3" id="report">
				<div className="flex items-center gap-3">
					<h2 className="m-0 text-lg font-semibold">Security health</h2>
					{!image.report && image.summary && (
						<GradeBadge summary={image.summary} />
					)}
					{!image.report && image.summary && (
						<FipsBadge status={image.summary.fips} />
					)}
				</div>
				{image.report ? (
					<ImageReport
						report={image.report}
						summary={image.summary}
						onRescan={
							image.canEdit && !image.activeBuild
								? () => rescan.mutate()
								: undefined
						}
						rescanning={rescan.isPending}
					/>
				) : (
					<p className="m-0 text-sm text-content-secondary">
						{tracked
							? image.activeBuild
								? "Being scanned…"
								: "Not scanned yet."
							: "Each build is scanned; this image has no scan yet."}
					</p>
				)}
			</section>

			{(image.report?.addons || tracked) && (
				<section className="flex flex-col gap-3" id="addons">
					<h2 className="m-0 text-lg font-semibold">
						Add-ons
						{!tracked && (
							<span className="ml-2 text-sm font-normal text-content-secondary">
								of the workspace image it is built on (its own are in the
								builder)
							</span>
						)}
					</h2>
					{image.report?.addons ? (
						<ImageAddons addons={image.report.addons} />
					) : (
						<p className="m-0 text-sm text-content-secondary">
							{image.report
								? "This image does not list its add-ons (workspace images from 1.8.2 on do)."
								: "Listed once it is scanned."}
						</p>
					)}
				</section>
			)}

			{!tracked && (
				<section className="flex flex-col gap-3" data-testid="s3">
					<h2 className="m-0 text-lg font-semibold">S3 backup</h2>
					<div className="flex flex-wrap items-center gap-4 text-sm">
						<label htmlFor="image-s3" className="flex items-center gap-2">
							<Switch
								id="image-s3"
								checked={Boolean(image.s3.enabled)}
								disabled={!image.canEdit || s3.isPending}
								onCheckedChange={(v) => s3.mutate(v)}
								aria-label="Back up to S3 after every build"
							/>
							Back up to S3 after every build
						</label>
						{image.canEdit && image.pullRef && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => backup.mutate()}
								disabled={backup.isPending || image.s3.status === "uploading"}
							>
								<Spinner
									loading={backup.isPending || image.s3.status === "uploading"}
								>
									<CloudUploadIcon />
								</Spinner>
								Back up now
							</Button>
						)}
						<span className="text-content-secondary">
							{image.s3.status === "uploading" ? (
								"Uploading…"
							) : image.s3.status === "done" ? (
								`v${image.s3.version} is in s3://${image.s3.bucket}/${image.s3.key} (${formatSize(image.s3.bytes ?? null)}, ${createDayString(image.s3.finishedAt ?? "")})`
							) : image.s3.status === "failed" ? (
								<span className="text-content-destructive">
									The last backup failed: {image.s3.error}
								</span>
							) : (
								"Not backed up yet. Set the bucket in Images > Settings."
							)}
						</span>
					</div>
				</section>
			)}

			<section className="flex flex-col gap-3">
				<h2 className="m-0 text-lg font-semibold">
					{tracked ? "Scans" : "Builds"}
				</h2>
				{image.builds.length === 0 ? (
					<p className="m-0 text-sm text-content-secondary">None yet.</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Build</TableHead>
								<TableHead>Version</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Started</TableHead>
								<TableHead>Took</TableHead>
								<TableHead>By</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{image.builds.map((b) => (
								<TableRow
									key={b.id}
									className="cursor-pointer"
									onClick={() => navigate(`/images/${image.id}/builds/${b.id}`)}
								>
									<TableCell>
										<RouterLink
											to={`/images/${image.id}/builds/${b.id}`}
											className="text-content-link"
										>
											#{b.id}
										</RouterLink>
									</TableCell>
									<TableCell>{tracked ? tag : `v${b.version}`}</TableCell>
									<TableCell className="text-sm">
										{b.status}
										{b.error && (
											<div className="line-clamp-1 max-w-md text-xs text-content-destructive">
												{b.error}
											</div>
										)}
									</TableCell>
									<TableCell className="text-sm text-content-secondary">
										{createDayString(b.startedAt)}
									</TableCell>
									<TableCell className="text-sm tabular-nums text-content-secondary">
										{b.finishedAt ? took(b.startedAt, b.finishedAt) : "–"}
									</TableCell>
									<TableCell className="text-sm text-content-secondary">
										{b.by ?? "–"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</section>

			<ConfirmDialog
				type="delete"
				open={deleting}
				title={`Delete ${image.name}`}
				description="The image, its files and every version in the registry go. Workspaces still running it keep running; new ones can't start from it."
				confirmText="Delete"
				confirmLoading={remove.isPending}
				onClose={() => setDeleting(false)}
				onConfirm={() => remove.mutate()}
			/>
		</Margins>
	);
};

const took = (from: string, to: string) => {
	const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default ImageDetailPage;
