import {
	CloudUploadIcon,
	DownloadIcon,
	EllipsisVerticalIcon,
	HammerIcon,
	PencilIcon,
	PlusIcon,
	SettingsIcon,
	TrashIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { FipsBadge, formatSize, GradeBadge, StatusBadge } from "./badges";
import { ImagesSettingsDialog } from "./ImagesSettingsDialog";
import { NewImageDialog } from "./NewImageDialog";
import { ResourceTabs } from "./ResourceTabs";

export const imagesKey = ["platform", "images"] as const;

type StatusFilter = "all" | "ready" | "building" | "draft" | "failed";

/**
 * Templates > Images: workspace images built in the cluster. Each is ready to
 * be named in a workspace template (localhost:5000/coder-images/<name>:<version>);
 * admins and template admins create, edit, build and delete them.
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
	const [settings, setSettings] = useState(false);
	const canEdit = query.data?.canEdit ?? false;

	const images = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (query.data?.images ?? []).filter(
			(i) =>
				(status === "all" || i.status === status) &&
				(!q || i.name.includes(q) || i.description.toLowerCase().includes(q)),
		);
	}, [query.data, search, status]);

	return (
		<Margins className="pb-12">
			<title>{pageTitle("Images")}</title>
			<ResourceTabs active="images" />
			<PageHeader
				actions={
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="lg"
							onClick={() => setSettings(true)}
						>
							<SettingsIcon />
							Settings
						</Button>
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
							<ImageRow key={image.id} image={image} canEdit={canEdit} />
						))
					)}
				</TableBody>
			</Table>

			{creating && <NewImageDialog onClose={() => setCreating(false)} />}
			{settings && <ImagesSettingsDialog onClose={() => setSettings(false)} />}
		</Margins>
	);
};

const ImageRow: React.FC<{ image: ImageListItem; canEdit: boolean }> = ({
	image,
	canEdit,
}) => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [deleting, setDeleting] = useState(false);
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
	const contents = [
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
		<TableRow {...clickable} data-testid={`image-${image.id}`}>
			<TableCell>
				<div className="flex flex-col gap-0.5">
					<span className="flex items-center gap-2 font-semibold">
						{image.name}
						<StatusBadge status={image.status} />
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
				<GradeBadge summary={image.summary} />
			</TableCell>
			<TableCell>
				<FipsBadge status={image.summary?.fips} />
			</TableCell>
			<TableCell className="text-sm text-content-secondary">
				{image.builtAt ? (
					<>
						{createDayString(image.builtAt)}
						{image.builtBy && <div className="text-xs">by {image.builtBy}</div>}
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
								<DropdownMenuItem asChild>
									<RouterLink to={`/images/${image.id}/edit`}>
										<PencilIcon />
										Edit
									</RouterLink>
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={image.status === "building" || build.isPending}
									onSelect={() => build.mutate()}
								>
									<HammerIcon />
									{image.version ? "Rebuild" : "Build"}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onSelect={() => s3.mutate(!image.s3.enabled)}>
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
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-content-destructive"
									disabled={image.status === "building"}
									onSelect={() => setDeleting(true)}
								>
									<TrashIcon />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
				<ConfirmDialog
					type="delete"
					open={deleting}
					title={`Delete ${image.name}`}
					description={`The image, its files and every version in the registry go. Workspaces still running it keep running; new ones can't start from it.`}
					confirmText="Delete"
					confirmLoading={remove.isPending}
					onClose={() => setDeleting(false)}
					onConfirm={() => remove.mutate()}
				/>
			</TableCell>
		</TableRow>
	);
};

export default ImagesPage;
