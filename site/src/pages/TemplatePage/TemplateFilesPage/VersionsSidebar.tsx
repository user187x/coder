import { cn } from "cn";
import {
	ArchiveIcon,
	CircleAlertIcon,
	CombineIcon,
	LoaderIcon,
	XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import {
	templateVersions,
	templateVersionsQueryKey,
} from "#/api/queries/templates";
import type { Template, TemplateVersion } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Spinner } from "#/components/Spinner/Spinner";
import { createDayString } from "#/utils/createDayString";

type VersionsSidebarProps = {
	template: Template;
	canUpdate: boolean;
	/** The version whose code is shown. */
	shownVersionName: string;
	onSelect: (version: TemplateVersion) => void;
};

const Pill: React.FC<{
	className?: string;
	children: React.ReactNode;
	title?: string;
}> = ({ className, children, title }) => (
	<span
		title={title}
		className={cn(
			"shrink-0 rounded px-1 py-px text-[10px] font-medium uppercase leading-tight tracking-wide",
			className,
		)}
	>
		{children}
	</span>
);

/** The squashed message: the kept version's own, then each archived one's (newest first). */
const squashMessage = (keep: TemplateVersion, folded: TemplateVersion[]) => {
	const lines = folded
		.map((v) => `- ${v.name}${v.message ? `: ${v.message}` : ""}`)
		.join("\n");
	return `${keep.message ? `${keep.message}\n\n` : ""}Squashed ${folded.length} version${folded.length === 1 ? "" : "s"}:\n${lines}`.slice(
		0,
		1048576,
	);
};

/**
 * Source Code > Versions: the template's versions, newest first, as a compact
 * list under the file tree. Clicking one shows its code; Promote (on the
 * right) makes a version the active one. Admins can squash a range of versions:
 * the newest of the range stays, with the others' messages folded into its
 * own, and the others are archived (Coder keeps any that a workspace still
 * uses, and the active version).
 */
export const VersionsSidebar: React.FC<VersionsSidebarProps> = ({
	template,
	canUpdate,
	shownVersionName,
	onSelect,
}) => {
	const queryClient = useQueryClient();
	const { data } = useQuery(templateVersions(template.id));
	const [activeId, setActiveId] = useState(template.active_version_id);
	const [toPromote, setToPromote] = useState<TemplateVersion>();
	const [toArchive, setToArchive] = useState<TemplateVersion>();
	const [squashing, setSquashing] = useState(false);
	const [range, setRange] = useState<{ from?: string; to?: string }>({});
	const [confirmSquash, setConfirmSquash] = useState(false);

	const versions = useMemo(() => [...(data ?? [])].reverse(), [data]);
	const newestId = useMemo(
		() => versions.find((v) => v.job.status === "succeeded")?.id,
		[versions],
	);
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: templateVersionsQueryKey(template.id),
		});

	const promote = useMutation({
		mutationFn: (v: TemplateVersion) =>
			API.updateActiveTemplateVersion(template.id, { id: v.id }),
		onSuccess: (_, v) => {
			setActiveId(v.id);
			setToPromote(undefined);
			toast.success(`Version "${v.name}" is now active.`);
		},
		onError: (e, v) =>
			toast.error(getErrorMessage(e, `"${v.name}" was not promoted.`), {
				description: getErrorDetail(e),
			}),
	});
	const archive = useMutation({
		mutationFn: (v: TemplateVersion) => API.archiveTemplateVersion(v.id),
		onSuccess: async (_, v) => {
			await refresh();
			setToArchive(undefined);
			toast.success(`Version "${v.name}" archived.`);
		},
		onError: (e, v) =>
			toast.error(getErrorMessage(e, `"${v.name}" was not archived.`), {
				description: getErrorDetail(e),
			}),
	});

	// the range, newest first: everything between the two picked ends
	const selected = useMemo(() => {
		const i = versions.findIndex((v) => v.id === range.from);
		const j = versions.findIndex((v) => v.id === (range.to ?? range.from));
		if (i < 0 || j < 0) {
			return [];
		}
		return versions.slice(Math.min(i, j), Math.max(i, j) + 1);
	}, [versions, range]);
	const keep = selected[0];
	const fold = selected.slice(1);
	const activeInFold = fold.some((v) => v.id === activeId);

	const squash = useMutation({
		mutationFn: async () => {
			if (!keep) {
				return { archived: [] as string[], kept: [] as string[] };
			}
			const archived: string[] = [];
			const kept: string[] = [];
			for (const v of fold) {
				try {
					await API.archiveTemplateVersion(v.id);
					archived.push(v.name);
				} catch {
					kept.push(v.name);
				}
			}
			const folded = fold.filter((v) => archived.includes(v.name));
			if (folded.length) {
				await API.patchTemplateVersion(keep.id, {
					name: keep.name,
					message: squashMessage(keep, folded),
				});
			}
			return { archived, kept };
		},
		onSuccess: async ({ archived, kept }) => {
			await refresh();
			setConfirmSquash(false);
			setSquashing(false);
			setRange({});
			toast.success(
				`Squashed ${archived.length} version${archived.length === 1 ? "" : "s"} into "${keep?.name}".`,
				kept.length
					? {
							description: `Kept (in use by a workspace, or active): ${kept.join(", ")}.`,
						}
					: undefined,
			);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The versions were not squashed.")),
	});

	const pick = (v: TemplateVersion) => {
		if (!range.from || range.to) {
			setRange({ from: v.id });
		} else {
			setRange({ ...range, to: v.id });
		}
	};

	return (
		<section
			aria-label="Versions"
			className="flex min-h-0 flex-col rounded-lg border border-solid border-surface-quaternary"
			data-testid="versions-sidebar"
		>
			<header className="flex items-center gap-1.5 border-0 border-b border-solid border-surface-quaternary px-2.5 py-1.5">
				<span className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
					Versions
				</span>
				<span className="text-xs tabular-nums text-content-secondary">
					{data ? versions.length : ""}
				</span>
				<span className="flex-1" />
				{canUpdate && versions.length > 1 && (
					<Button
						size="xs"
						variant={squashing ? "default" : "subtle"}
						onClick={() => {
							setSquashing(!squashing);
							setRange({});
						}}
						title="Squash a range of versions into its newest"
						aria-pressed={squashing}
					>
						{squashing ? <XIcon /> : <CombineIcon />}
						{squashing ? "Cancel" : "Squash"}
					</Button>
				)}
			</header>
			{squashing && (
				<div className="flex flex-col gap-1.5 border-0 border-b border-solid border-surface-quaternary bg-surface-secondary px-2.5 py-2 text-xs">
					<span className="text-content-secondary">
						{!range.from
							? "Pick the first version of the range…"
							: !range.to
								? "…then the last."
								: `${selected.length} versions: "${keep?.name}" stays, ${fold.length} folded into it.`}
					</span>
					{activeInFold && (
						<span className="flex items-start gap-1 text-content-warning">
							<CircleAlertIcon className="mt-px size-3 shrink-0" />
							The active version is in the range and stays.
						</span>
					)}
					<Button
						size="xs"
						disabled={!range.to || fold.length === 0}
						onClick={() => setConfirmSquash(true)}
						data-testid="squash-confirm"
					>
						<CombineIcon />
						Squash {fold.length ? fold.length + 1 : ""} versions
					</Button>
				</div>
			)}
			<ol className="m-0 max-h-[min(52vh,30rem)] list-none overflow-y-auto p-0 py-0.5">
				{!data && (
					<li className="flex justify-center p-3">
						<Spinner loading size="sm" />
					</li>
				)}
				{versions.map((v) => {
					const active = v.id === activeId;
					const shown = v.name === shownVersionName;
					const inRange = squashing && selected.some((s) => s.id === v.id);
					const status = v.job.status;
					return (
						<li key={v.id} data-testid={`sidebar-version-${v.name}`}>
							<div
								className={cn(
									"group flex items-center gap-1.5 py-1 pl-2 pr-1.5 text-xs",
									shown && !squashing && "bg-surface-secondary",
									inRange && "bg-surface-sky",
								)}
							>
								<button
									type="button"
									onClick={() => (squashing ? pick(v) : onSelect(v))}
									aria-current={shown ? "true" : undefined}
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit"
									title={`${v.name}${v.message ? `\n${v.message}` : ""}\n${v.created_by.username}, ${new Date(v.created_at).toLocaleString()}`}
								>
									{squashing ? (
										<input
											type="checkbox"
											readOnly
											tabIndex={-1}
											checked={inRange}
											className="size-3 shrink-0"
											aria-label={`Range includes ${v.name}`}
										/>
									) : (
										<Avatar
											size="sm"
											className="size-4 shrink-0"
											fallback={v.created_by.username}
											src={v.created_by.avatar_url}
										/>
									)}
									<span className="flex min-w-0 flex-col">
										<span
											className={cn(
												"truncate font-mono text-[11px]",
												shown
													? "font-semibold text-content-primary"
													: "text-content-primary",
											)}
										>
											{v.name}
										</span>
										<span className="flex min-w-0 items-center gap-1 text-[10px] text-content-secondary">
											<span className="truncate">
												{createDayString(v.created_at)}
											</span>
											{active && (
												<Pill className="bg-surface-green text-highlight-green">
													active
												</Pill>
											)}
											{v.id === newestId && !active && (
												<Pill className="bg-surface-tertiary text-content-secondary">
													newest
												</Pill>
											)}
											{status === "failed" && (
												<Pill className="bg-surface-red text-highlight-red">
													failed
												</Pill>
											)}
											{(status === "canceled" || status === "canceling") && (
												<Pill className="bg-surface-tertiary text-content-secondary">
													canceled
												</Pill>
											)}
										</span>
									</span>
								</button>
								{!squashing &&
									(status === "pending" || status === "running") && (
										<LoaderIcon
											className="size-3.5 shrink-0 animate-spin text-content-secondary"
											aria-label="Building"
										/>
									)}
								{!squashing &&
									canUpdate &&
									status === "succeeded" &&
									!active && (
										<Button
											size="xs"
											variant="outline"
											className="h-6 shrink-0 px-2 text-[11px]"
											onClick={() => setToPromote(v)}
											data-testid="promote"
										>
											Promote
										</Button>
									)}
								{!squashing &&
									canUpdate &&
									status === "failed" &&
									!v.archived && (
										<Button
											size="icon"
											variant="subtle"
											className="size-6 shrink-0"
											onClick={() => setToArchive(v)}
											aria-label={`Archive ${v.name}`}
											title="Archive"
										>
											<ArchiveIcon className="size-3.5" />
										</Button>
									)}
							</div>
						</li>
					);
				})}
			</ol>

			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={Boolean(toPromote)}
				onConfirm={() => toPromote && promote.mutate(toPromote)}
				onClose={() => setToPromote(undefined)}
				title="Promote version"
				confirmLoading={promote.isPending}
				confirmText="Promote"
				description={
					<>
						Promote version <strong>{toPromote?.name}</strong>? Workspaces will
						be prompted to “Update” to it.
					</>
				}
			/>
			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={Boolean(toArchive)}
				onConfirm={() => toArchive && archive.mutate(toArchive)}
				onClose={() => setToArchive(undefined)}
				title="Archive version"
				confirmLoading={archive.isPending}
				confirmText="Archive"
				description={
					<>
						Archive version <strong>{toArchive?.name}</strong>? This is
						reversible. Archived versions cannot be used by workspaces.
					</>
				}
			/>
			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={confirmSquash}
				onConfirm={() => squash.mutate()}
				onClose={() => setConfirmSquash(false)}
				title={`Squash ${selected.length} versions`}
				confirmLoading={squash.isPending}
				confirmText="Squash"
				description={
					<div className="flex flex-col gap-2">
						<span>
							<strong>{keep?.name}</strong> stays, with the messages of the
							others added to its own. These are archived (reversible):
						</span>
						<ul className="m-0 max-h-40 overflow-y-auto pl-5 font-mono text-xs">
							{fold.map((v) => (
								<li key={v.id}>
									{v.name}
									{v.id === activeId ? " (active: stays)" : ""}
								</li>
							))}
						</ul>
						<span className="text-xs text-content-secondary">
							A version a workspace still uses stays as well.
						</span>
					</div>
				}
			/>
		</section>
	);
};
