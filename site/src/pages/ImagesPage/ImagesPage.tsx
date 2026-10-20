import {
	CloudUploadIcon,
	DownloadIcon,
	EllipsisVerticalIcon,
	HammerIcon,
	ImportIcon,
	PencilIcon,
	PlusIcon,
	SettingsIcon,
	TrashIcon,
	WrenchIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { type ImageListItem, ImagesAPI } from "#/api/images";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Margins } from "#/components/Margins/Margins";
import {
	PageHeader,
	PageHeaderSubtitle,
	PageHeaderTitle,
} from "#/components/PageHeader/PageHeader";
import { SearchField } from "#/components/SearchField/SearchField";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import { createDayString } from "#/utils/createDayString";
import { pageTitle } from "#/utils/page";
import {
	deleteDescription,
	FipsBadge,
	formatSize,
	GradeBadge,
	ImportedBadge,
	InThePitBadge,
	NeedsFixingBadge,
	PatchedBadge,
	StatusBadge,
	TrackedBadge,
} from "./badges";
import "./pitStop.css";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import {
	CoderForkBadge,
	CoderForkImages,
	ContentsToggle,
	ImageContentsTree,
	ourImage,
	useImageContents,
} from "./CoderForkImages";
import { IsoLibrary } from "./FileLibrary";
import { ImagesInUse, ImagesOnNodes } from "./ImagesInUse";
import { ImagesSettingsDialog } from "./ImagesSettingsDialog";
import {
	ImportImageDialog,
	type ImportImageDialogProps,
} from "./ImportImageDialog";
import { NewImageDialog } from "./NewImageDialog";
import { ResourceTabs } from "./ResourceTabs";
import { SecurityDataBadge } from "./SecurityData";

export const imagesKey = ["platform", "images"] as const;

type StatusFilter = "all" | "ready" | "building" | "draft" | "failed";

/**
 * Templates > Images: workspace images built in the cluster. Each is ready to
 * be named in a workspace template (localhost:5000/coder-images/<name>:<version>);
 * admins and template admins create, edit, build and delete them. First, the
 * image the workspace template runs (tracked, read-only): its security report
 * and add-ons, for everyone to see. Every entry can be deleted (confirmed
 * first). The Coder fork's own images carry a tag and open what they hold;
 * Coder fork images lists them all.
 */
const ImagesPage: React.FC = () => {
	const query = useQuery({
		queryKey: imagesKey,
		queryFn: ImagesAPI.list,
		refetchInterval: (q) =>
			q.state.data?.images.some((i) => i.status === "building") ? 3000 : 30_000,
	});
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState<StatusFilter>("all");
	const [creating, setCreating] = useState(false);
	const [importing, setImporting] = useState<
		ImportImageDialogProps["initial"] | null
	>(null);
	const [settings, setSettings] = useState(false);
	// The header's "N images need fixing": the list narrowed to them
	const [onlyNeedsFixing, setOnlyNeedsFixing] = useState(false);
	const canEdit = query.data?.canEdit ?? false;
	const needFixing = (query.data?.images ?? []).filter(
		(i) => i.summary?.needsFixing,
	).length;

	const images = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (query.data?.images ?? [])
			.filter(
				(i) =>
					(status === "all" || i.status === status) &&
					(!onlyNeedsFixing || i.summary?.needsFixing) &&
					(!q || i.name.includes(q) || i.description.toLowerCase().includes(q)),
			)
			.sort((a, b) => Number(Boolean(b.tracked)) - Number(Boolean(a.tracked)));
	}, [query.data, search, status, onlyNeedsFixing]);

	return (
		<Margins className="pb-12">
			<title>{pageTitle("Images")}</title>
			<ResourceTabs active="images" />
			<PageHeader
				actions={
					<div className="flex flex-wrap items-center gap-2">
						{(needFixing > 0 || onlyNeedsFixing) && (
							<Button
								variant="outline"
								size="lg"
								aria-pressed={onlyNeedsFixing}
								onClick={() => setOnlyNeedsFixing(!onlyNeedsFixing)}
								title={
									onlyNeedsFixing
										? "Show every image again"
										: "Show only the images that need fixing"
								}
								className="border-border-destructive/60 bg-surface-destructive/25 text-highlight-red aria-pressed:bg-surface-destructive/60"
								data-testid="images-need-fixing"
							>
								<span
									aria-hidden
									className="size-2 rounded-full bg-border-destructive"
								/>
								{needFixing} image{needFixing === 1 ? "" : "s"} need
								{needFixing === 1 ? "s" : ""} fixing
							</Button>
						)}
						<SecurityDataBadge onOpen={() => setSettings(true)} />
						<Button
							variant="outline"
							size="lg"
							onClick={() => setSettings(true)}
						>
							<SettingsIcon />
							Settings
						</Button>
						{canEdit && (
							<Button
								variant="outline"
								size="lg"
								onClick={() => setImporting({})}
							>
								<ImportIcon />
								Import
							</Button>
						)}
						{canEdit && (
							<Button size="lg" onClick={() => setCreating(true)}>
								<PlusIcon />
								New Image
							</Button>
						)}
					</div>
				}
			>
				<PageHeaderTitle>Images</PageHeaderTitle>
				<PageHeaderSubtitle>
					Workspace images built in the cluster, ready for any workspace
					template.
				</PageHeaderSubtitle>
			</PageHeader>

			<div className="mb-4 flex flex-wrap items-center gap-3">
				<SearchField
					value={search}
					onChange={setSearch}
					placeholder="Search images…"
					className="min-w-64 flex-1"
					aria-label="Search images"
				/>
				<div role="tablist" aria-label="Status" className="flex gap-1">
					{(["all", "ready", "building", "draft", "failed"] as const).map(
						(s) => (
							<Button
								key={s}
								role="tab"
								aria-selected={status === s}
								size="sm"
								variant={status === s ? "default" : "outline"}
								onClick={() => setStatus(s)}
								className="capitalize"
							>
								{s}
							</Button>
						),
					)}
				</div>
			</div>

			{query.error ? <ErrorAlert error={query.error} /> : null}

			{/* Platform: in a rounded card, its footer saying what it holds and what anything in it does */}
			<TableCard
				data-testid="images-card"
				summary={
					query.data && query.data.images.length > 0 ? (
						<span data-testid="images-summary">
							Showing{" "}
							<strong className="font-semibold text-content-primary">
								{images.length}
							</strong>{" "}
							of{" "}
							<strong className="font-semibold text-content-primary">
								{query.data.images.length}
							</strong>{" "}
							{query.data.images.length === 1 ? "image" : "images"} ·{" "}
							{query.data.images.filter((i) => i.status === "ready").length}{" "}
							ready
							{needFixing > 0 && ` · ${needFixing} need fixing`}
						</span>
					) : undefined
				}
				hint="Point at anything in the table to read what it does"
			>
				<Table data-testid="images-table">
					<TableHeader>
						<TableRow>
							<TableHead className="w-[32%]">Name</TableHead>
							<TableHead className="w-[14%]">Contents</TableHead>
							<TableHead className="w-[10%]">Size</TableHead>
							<TableHead className="w-[12%]">Security</TableHead>
							<TableHead className="w-[10%]">FIPS</TableHead>
							<TableHead className="w-[14%]">Last built</TableHead>
							<TableHead className="w-[1%]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{query.isLoading ? (
							<TableRow>
								<TableCell colSpan={7} className="text-content-secondary">
									Loading…
								</TableCell>
							</TableRow>
						) : images.length === 0 ? (
							<TableEmpty
								message={
									query.data?.images.length
										? "No image matches."
										: "No images yet"
								}
								description={
									query.data?.images.length
										? undefined
										: canEdit
											? "Build one: apt packages, installations, hardening, a desktop and your configuration on top of the workspace image."
											: "Admins and template admins build images here."
								}
								cta={
									canEdit && !query.data?.images.length ? (
										<Button onClick={() => setCreating(true)}>
											<PlusIcon />
											New Image
										</Button>
									) : undefined
								}
							/>
						) : (
							images.map((image) => (
								<ImageRow
									key={image.id}
									image={image}
									canEdit={canEdit}
									onImport={() =>
										setImporting({
											name: image.id,
											ref:
												image.imported?.source === "registry"
													? image.imported.from
													: undefined,
											source:
												image.imported?.source === "copa"
													? undefined
													: image.imported?.source,
										})
									}
								/>
							))
						)}
					</TableBody>
				</Table>
			</TableCard>

			<CoderForkImages />
			<ImagesInUse
				canEdit={canEdit}
				onImport={(initial) => setImporting(initial)}
			/>
			<ImagesOnNodes canEdit={canEdit} />
			<IsoLibrary />
			{creating && <NewImageDialog onClose={() => setCreating(false)} />}
			{importing && (
				<ImportImageDialog
					initial={importing}
					onClose={() => setImporting(null)}
				/>
			)}
			{settings && <ImagesSettingsDialog onClose={() => setSettings(false)} />}
		</Margins>
	);
};

const ImageRow: React.FC<{
	image: ImageListItem;
	canEdit: boolean;
	/** An imported image: import a new version of it. */
	onImport: () => void;
}> = ({ image, canEdit, onImport }) => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [deleting, setDeleting] = useState(false);
	const [showContents, setShowContents] = useState(false);
	// one of the Coder fork's images (the workspace template's, or one imported or scanned as it is)
	const asked =
		image.tracked?.image ??
		image.scanned?.image ??
		(image.imported?.source === "registry" ? image.imported.from : null);
	const ours = ourImage(useImageContents().data, asked);
	const clickable = useClickableTableRow({
		onClick: () => navigate(`/images/${image.id}`),
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey: imagesKey });
	const build = useMutation({
		mutationFn: () => ImagesAPI.build(image.id),
		onSuccess: ({ build: n }) => navigate(`/images/${image.id}/builds/${n}`),
		onError: (e) =>
			toast.error(getErrorMessage(e, "The build could not start.")),
	});
	const s3 = useMutation({
		mutationFn: (enabled: boolean) => ImagesAPI.setS3(image.id, enabled),
		onSuccess: (_, enabled) => {
			void refresh();
			toast.success(
				enabled ? "Backed up to S3 after every build." : "S3 backup off.",
			);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not changed.")),
	});
	const backup = useMutation({
		mutationFn: () => ImagesAPI.backupNow(image.id),
		onSuccess: () => {
			void refresh();
			toast.success("Backing up to S3…");
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The backup could not start.")),
	});
	const remove = useMutation({
		mutationFn: () => ImagesAPI.remove(image.id),
		onSuccess: () => {
			setDeleting(false);
			void refresh();
			toast.success(`${image.name} deleted.`);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not deleted.")),
	});
	const tracked = image.tracked;
	const summary = image.summary;
	const fixableHigh =
		(summary?.fixableCounts?.CRITICAL ?? 0) +
		(summary?.fixableCounts?.HIGH ?? 0);
	const fixHref = `/images/${image.id}/fix`;
	const contents = [
		tracked &&
			image.summary?.addons &&
			`${image.summary.addons} add-ons · ${image.summary.addonPackages ?? 0} packages`,
		image.counts.packages &&
			`${image.counts.packages} package${image.counts.packages === 1 ? "" : "s"}`,
		image.counts.installations &&
			`${image.counts.installations} installation${image.counts.installations === 1 ? "" : "s"}`,
		image.desktop !== "keep" &&
			(image.desktop === "none" ? "no desktop" : image.desktop.toUpperCase()),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Fragment>
			<TableRow
				{...clickable}
				data-testid={`image-${image.id}`}
				className={
					summary?.needsFixing ? "bg-surface-destructive/10" : undefined
				}
			>
				<TableCell>
					<div className="flex flex-col gap-0.5">
						<span className="flex flex-wrap items-center gap-2 font-semibold">
							{ours && (
								<ContentsToggle
									open={showContents}
									onToggle={() => setShowContents(!showContents)}
									name={image.name}
								/>
							)}
							{image.name}
							<StatusBadge status={image.status} />
							{summary?.needsFixing && <NeedsFixingBadge />}
							{ours && <CoderForkBadge ours={ours} />}
							{tracked && <TrackedBadge />}
							{image.pit && (
								<InThePitBadge lap={image.pit.lap} laps={image.pit.laps} />
							)}
							{image.imported?.source === "copa" ? (
								<PatchedBadge from={image.imported.from} />
							) : (
								image.imported && <ImportedBadge from={image.imported.from} />
							)}
							{image.version > 0 && (
								<span className="text-xs font-normal text-content-secondary">
									v{image.version}
								</span>
							)}
						</span>
						<span className="line-clamp-1 text-sm text-content-secondary">
							{image.description ||
								(image.base.kind === "image"
									? `Based on ${image.base.id}`
									: "Based on the workspace image")}
						</span>
						{image.pullRef && (
							<span className="flex items-center gap-1 font-mono text-xs text-content-secondary">
								{image.pullRef}
								<CopyButton
									text={image.pullRef}
									label="Copy the image reference"
									variant="subtle"
									size="icon"
									className="size-6"
									onClick={(e) => e.stopPropagation()}
								/>
							</span>
						)}
					</div>
				</TableCell>
				<TableCell className="text-sm text-content-secondary">
					{contents || "–"}
				</TableCell>
				<TableCell className="text-sm tabular-nums">
					{formatSize(image.size)}
				</TableCell>
				<TableCell>
					<GradeBadge summary={summary}>
						{summary?.needsFixing ? (
							<span
								className="text-xs text-content-success"
								data-testid="image-projected"
							>
								{summary.fixableHere ?? summary.fixable} fixable →{" "}
								{summary.projectedGrade}
							</span>
						) : (
							fixableHigh > 0 && (
								<RouterLink
									to={fixHref}
									onClick={(e) => e.stopPropagation()}
									className="text-xs text-content-link no-underline hover:underline"
								>
									View fix →
								</RouterLink>
							)
						)}
					</GradeBadge>
				</TableCell>
				<TableCell>
					<FipsBadge status={image.summary?.fips} />
				</TableCell>
				<TableCell className="text-sm text-content-secondary">
					{image.builtAt ? (
						<>
							{createDayString(image.builtAt)}
							<div className="text-xs">
								{tracked
									? "deployed with the platform"
									: image.builtBy && `by ${image.builtBy}`}
							</div>
						</>
					) : (
						"Never"
					)}
					{image.s3.enabled && (
						<div
							className="mt-0.5 flex items-center gap-1 text-xs"
							title={image.s3.error ?? image.s3.key ?? ""}
						>
							<CloudUploadIcon className="size-3" />
							S3{" "}
							{image.s3.status === "uploading"
								? "uploading…"
								: image.s3.status === "failed"
									? "failed"
									: image.s3.status === "done"
										? `v${image.s3.version}`
										: "on"}
						</div>
					)}
				</TableCell>
				<TableCell onClick={(e) => e.stopPropagation()}>
					<div className="flex items-center justify-end gap-1">
						{summary?.needsFixing && (
							<Button
								asChild
								size="sm"
								className="whitespace-nowrap bg-content-link font-semibold text-surface-primary hover:bg-content-link/90"
							>
								<RouterLink to={fixHref} data-testid="image-fix">
									Fix CVEs
								</RouterLink>
							</Button>
						)}
						{image.pullRef && (
							<Button
								asChild
								variant="outline"
								size="icon"
								title="Download (docker load)"
							>
								<a
									href={ImagesAPI.downloadUrl(image.id)}
									download
									aria-label={`Download ${image.name}`}
								>
									<DownloadIcon />
								</a>
							</Button>
						)}
						{canEdit && (
							<Button
								variant="outline"
								size="icon"
								title={
									tracked
										? "Delete this entry (the workspace image itself stays)"
										: image.scanned
											? "Delete this scan (the image itself is not touched)"
											: "Delete"
								}
								aria-label={`Delete ${image.name}`}
								disabled={image.status === "building"}
								onClick={() => setDeleting(true)}
								data-testid="image-delete"
							>
								<TrashIcon />
							</Button>
						)}
						{canEdit && !tracked && !image.scanned && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="subtle"
										size="icon"
										aria-label={`${image.name}: more`}
									>
										<EllipsisVerticalIcon />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{image.imported?.source === "copa" ? (
										// a patched copy: its next version is another pit stop
										<DropdownMenuItem
											onSelect={() => navigate(`/images/${image.id}/fix`)}
										>
											<WrenchIcon />
											Pit stop
										</DropdownMenuItem>
									) : image.imported ? (
										<DropdownMenuItem
											disabled={image.status === "building"}
											onSelect={onImport}
										>
											<ImportIcon />
											Import a new version
										</DropdownMenuItem>
									) : (
										<>
											<DropdownMenuItem asChild>
												<RouterLink to={`/images/${image.id}/edit`}>
													<PencilIcon />
													Edit
												</RouterLink>
											</DropdownMenuItem>
											<DropdownMenuItem
												disabled={
													image.status === "building" || build.isPending
												}
												onSelect={() => build.mutate()}
											>
												<HammerIcon />
												{image.version ? "Rebuild" : "Build"}
											</DropdownMenuItem>
										</>
									)}
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onSelect={() => s3.mutate(!image.s3.enabled)}
									>
										<CloudUploadIcon />
										{image.s3.enabled
											? "Turn S3 backup off"
											: "Back up to S3 after every build"}
									</DropdownMenuItem>
									<DropdownMenuItem
										disabled={!image.pullRef || image.s3.status === "uploading"}
										onSelect={() => backup.mutate()}
									>
										<CloudUploadIcon />
										Back up to S3 now
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
					<ConfirmDialog
						type="delete"
						open={deleting}
						title={`Delete ${image.name}`}
						description={deleteDescription(image)}
						confirmText="Delete"
						confirmLoading={remove.isPending}
						onClose={() => setDeleting(false)}
						onConfirm={() => remove.mutate()}
					/>
				</TableCell>
			</TableRow>
			{ours && showContents && (
				<TableRow className="hover:bg-transparent">
					<TableCell colSpan={7} className="bg-surface-secondary/40">
						<ImageContentsTree ours={ours} asked={asked ?? undefined} />
					</TableCell>
				</TableRow>
			)}
		</Fragment>
	);
};

export default ImagesPage;
