import "#/modules/platform/settingsPage/settingsPage.css";
import { cn } from "cn";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type ImageDetail,
	type ImageInstallation,
	ImagesAPI,
	type Severity,
} from "#/api/images";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { createDayString } from "#/utils/createDayString";
import { pageTitle } from "#/utils/page";
import {
	classify,
	type Finding,
	type FixGroup,
	fixScript,
	gradeAfter,
	hunks,
} from "./fixPlan";
import { imagesKey } from "./ImagesPage";
import { ImportImageDialog, nameFrom } from "./ImportImageDialog";

/** Where the proposed APIs (an agent run, a pull request, accepting a risk) are written down for review. */
const PROPOSAL = "docs/fix-image-api.md";

const GRADE_TILE: Record<string, string> = {
	A: "bg-(--ws-go-bg) text-(--ws-go)",
	B: "bg-(--ws-go-bg) text-(--ws-go)",
	C: "bg-(--ws-warn-bg) text-(--ws-warn)",
	D: "bg-(--ws-danger-bg) text-(--ws-danger)",
	F: "bg-(--ws-danger-bg) text-(--ws-danger)",
};

const SEVERITY_CHIP: Record<string, string> = {
	CRITICAL: "bg-(--ws-danger-bg) text-(--ws-danger)",
	HIGH: "bg-(--ws-warn-bg) text-(--ws-warn)",
};

const GROUPS: {
	group: FixGroup;
	glyph: string;
	tile: string;
	title: string;
	sub: string;
}[] = [
	{
		group: "upgrade",
		glyph: "↑",
		tile: "bg-(--ws-go-bg) text-(--ws-go)",
		title: "Fix by upgrading a package",
		sub: "Pin a patched version in the Dockerfile",
	},
	{
		group: "rebase",
		glyph: "⟲",
		tile: "bg-(--ws-on) text-(--ws-soft)",
		title: "Fix by rebasing the image",
		sub: "Move to a newer base image tag (or upgrade it here until then)",
	},
	{
		group: "addon",
		glyph: "▣",
		tile: "bg-(--ws-raised) text-(--ws-text-3)",
		title: "Fixed in a newer add-on",
		sub: "Inside a program the image ships: a newer release of it fixes them",
	},
	{
		group: "none",
		glyph: "!",
		tile: "bg-(--ws-raised) text-(--ws-text-3)",
		title: "No fix available yet",
		sub: "Accept the risk or remove the component",
	},
];

const PIPELINE = ["Plan fixes", "Patch", "Rebuild", "Rescan", "Promote"];

const countsText = (counts: Partial<Record<Severity, number>>) => {
	const crit = counts.CRITICAL ?? 0;
	const high = counts.HIGH ?? 0;
	if (!crit && !high) {
		return <>No critical or high</>;
	}
	return (
		<>
			{crit > 0 && (
				<span className="font-semibold text-(--ws-danger)">{crit} crit · </span>
			)}
			{high} high
		</>
	);
};

const GradeTile: React.FC<{ grade: string }> = ({ grade }) => (
	<span
		className={cn(
			"flex size-10 shrink-0 items-center justify-center rounded-(--ws-r-md) text-lg font-bold",
			GRADE_TILE[grade] ?? "bg-(--ws-raised) text-(--ws-text-3)",
		)}
	>
		{grade}
	</span>
);

/** The script's commands as the Dockerfile's RUN step shows them (comments apart: in a RUN they would end it). */
const dockerRun = (commands: readonly string[]) =>
	commands.length === 0 ? "" : `+ RUN ${commands.join(" && \\\n+     ")}\n`;

/** A free name for a fixed copy of an image: <name>-fixed, else -fixed-2 and on (image names: 3 to 40 characters). */
const copyName = (name: string, taken: ReadonlySet<string>) => {
	const base = `${name.slice(0, 33)}-fixed`;
	for (let n = 1; n < 100; n++) {
		const candidate = n === 1 ? base : `${name.slice(0, 30)}-fixed-${n}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
	return `${name.slice(0, 28)}-fixed-${Date.now() % 1000}`;
};

/**
 * Images › an image › Fix image (the Images list's Fix CVEs, View fix): its findings grouped by how they get fixed, the
 * ones to fix chosen (all fixable to start), the grade they would leave, and the fix: an installation step that
 * upgrades them - added to the image's own spec and built (an image built here), or to a fixed copy built on it (an
 * image imported or tracked) - built and scanned again; the new version is picked by whoever uses it (Promote). Handing
 * the fixes to an agent, opening a pull request and accepting a risk need APIs this deployment does not have yet: they
 * are proposed (docs/fix-image-api.md) and shown, off, until they exist.
 */
const FixImagePage: React.FC = () => {
	const { image: id = "" } = useParams();
	const query = useQuery({
		queryKey: [...imagesKey, id],
		queryFn: () => ImagesAPI.get(id),
		refetchInterval: (q) =>
			q.state.data?.image.activeBuild != null ? 3000 : false,
	});
	const image = query.data?.image;

	if (query.error) {
		return (
			<div className="ws-settings min-h-full p-8">
				<ErrorAlert error={query.error} />
			</div>
		);
	}
	if (!image) {
		return <Loader />;
	}
	return <FixImage image={image} />;
};

const FixImage: React.FC<{ image: ImageDetail }> = ({ image }) => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const findings = useMemo(() => classify(image), [image]);
	const [selected, setSelected] = useState<ReadonlySet<string>>(
		() => new Set(findings.filter((f) => f.applicable).map((f) => f.key)),
	);
	const [mode, setMode] = useState<"manual" | "agent">("manual");
	const list = useQuery({ queryKey: imagesKey, queryFn: ImagesAPI.list });

	const chosen = findings.filter((f) => f.applicable && selected.has(f.key));
	const after = gradeAfter(image, chosen);
	const now = image.report?.vulnerabilities.counts ?? {};
	const script = fixScript(chosen);
	const n = chosen.length;

	const builtHere = !image.imported && !image.scanned && !image.tracked;
	// A fixed copy is built on the image as the builder's registry holds it: an imported one, or the workspace image.
	// One scanned in place is only named where it was found (another registry, a node): imported first.
	const copyable =
		!builtHere && !image.scanned && Boolean(image.ref || image.tracked);
	const [importing, setImporting] = useState(false);
	const canApply = image.canEdit && (builtHere || copyable) && n > 0;

	const apply = useMutation({
		mutationFn: async () => {
			const step: ImageInstallation = {
				id: `security-fixes-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`.slice(
					0,
					40,
				),
				name: `Security fixes (${n} finding${n === 1 ? "" : "s"})`,
				script: `${script.join("\n")}\n`,
				files: [],
			};
			let target = image;
			if (!builtHere) {
				const taken = new Set((list.data?.images ?? []).map((i) => i.name));
				target = (
					await ImagesAPI.create(
						copyName(image.name, taken),
						`${image.name} with ${n} security fix${n === 1 ? "" : "es"} (Fix image)`,
						image.tracked
							? { kind: "workspace" }
							: { kind: "image", id: image.id },
					)
				).image;
			}
			const steps = target.spec.installations.filter((i) => i.id !== step.id);
			await ImagesAPI.save(target.id, {
				spec: { ...target.spec, installations: [...steps, step] },
			});
			const { build } = await ImagesAPI.build(target.id);
			return { id: target.id, build };
		},
		onSuccess: ({ id: target, build }) => {
			void queryClient.invalidateQueries({ queryKey: imagesKey });
			navigate(`/images/${target}/builds/${build}`);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The fixes could not be applied.")),
	});

	const toggle = (f: Finding) =>
		setSelected((now) => {
			const next = new Set(now);
			if (next.has(f.key)) {
				next.delete(f.key);
			} else {
				next.add(f.key);
			}
			return next;
		});

	// The pipeline as it stands: a fix build running is at Rebuild (its scan: Rescan); else the plan.
	const active = image.builds.find((b) => b.id === image.activeBuild);
	const stage = !active
		? 0
		: active.status === "scanning"
			? 3
			: active.status === "ready"
				? 4
				: 2;

	const manualCta = !image.canEdit
		? "Only admins and template admins fix images"
		: n === 0
			? "Select findings to fix"
			: builtHere
				? `Apply ${n} fix${n === 1 ? "" : "es"}, rebuild and rescan`
				: copyable
					? `Build a fixed copy with ${n} fix${n === 1 ? "" : "es"} and rescan`
					: "Import the image to build a fixed copy";

	return (
		<div className="ws-settings min-h-full">
			<title>{pageTitle(`Fix ${image.name}`, "Images")}</title>
			<header className="border-0 border-b border-solid border-(--ws-header-line) bg-(--ws-header)">
				<div className="mx-auto flex max-w-[1304px] flex-wrap items-center justify-between gap-4 px-8 py-5">
					<div className="min-w-0">
						<nav
							aria-label="Breadcrumb"
							className="flex gap-1.5 text-[13px] text-(--ws-muted)"
						>
							<RouterLink to="/images" className="ws-quiet-link ws-hit">
								Images
							</RouterLink>
							<span aria-hidden="true">/</span>
							<RouterLink
								to={`/images/${image.id}`}
								className="ws-quiet-link ws-hit text-(--ws-text-2)"
							>
								{image.name}
							</RouterLink>
						</nav>
						<h1 className="m-0 mt-0.5 flex flex-wrap items-center gap-3 text-[22px] font-semibold tracking-[-0.01em]">
							Fix image
							{(image.pullRef || image.report?.ref) && (
								<code className="ws-mono rounded-(--ws-r-xs) border border-solid border-(--ws-line) bg-(--ws-chip) px-2 py-[3px] text-[13px] font-normal text-(--ws-muted)">
									{image.pullRef ?? image.report?.ref}
								</code>
							)}
						</h1>
					</div>
					<div
						className="flex items-center gap-3.5 rounded-(--ws-r-lg) border border-solid border-(--ws-line) bg-(--ws-chip) px-3.5 py-2.5"
						data-testid="fix-score"
					>
						<div className="flex items-center gap-2.5">
							<GradeTile grade={image.report?.grade ?? "?"} />
							<div className="text-[12.5px] leading-[1.3]">
								<div className="text-(--ws-muted)">Now</div>
								<div>{countsText(now)}</div>
							</div>
						</div>
						<svg
							width="22"
							height="22"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
							className="text-(--ws-faint)"
						>
							<path d="M5 12h14M13 6l6 6-6 6" />
						</svg>
						<div className="flex items-center gap-2.5" data-testid="fix-after">
							<GradeTile grade={after.grade} />
							<div className="text-[12.5px] leading-[1.3]">
								<div className="text-(--ws-muted)">After selected fixes</div>
								<div>{countsText(after.counts)}</div>
							</div>
						</div>
					</div>
				</div>
				<div className="mx-auto max-w-[1304px] px-8 pb-[18px]">
					<ol
						className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0"
						aria-label="Steps"
					>
						{PIPELINE.map((label, i) => (
							<li key={label} className="contents">
								{i > 0 && (
									<span aria-hidden="true" className="text-(--ws-radio-off)">
										—
									</span>
								)}
								<span
									aria-current={i === stage ? "step" : undefined}
									className={cn(
										"flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px]",
										i === stage
											? "bg-(--ws-on) font-semibold text-(--ws-on-text)"
											: "border border-solid border-(--ws-line) bg-(--ws-chip) text-(--ws-muted)",
									)}
								>
									<span
										className={cn(
											"flex size-[18px] items-center justify-center rounded-full text-[11px]",
											i === stage
												? "bg-(--ws-accent) text-(--ws-accent-ink)"
												: i < stage
													? "bg-(--ws-go-bg) text-(--ws-go)"
													: "border border-solid border-(--ws-radio-off)",
										)}
									>
										{i < stage ? "✓" : i + 1}
									</span>
									{label}
								</span>
							</li>
						))}
					</ol>
				</div>
			</header>

			<div className="mx-auto flex max-w-[1304px] flex-wrap items-start gap-6 px-8 py-7">
				<section
					aria-labelledby="h-findings"
					className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-(--ws-r-card) border border-solid border-(--ws-line) bg-(--ws-card)"
				>
					<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-(--ws-row-line) px-[22px] py-[18px]">
						<div>
							<h2 id="h-findings" className="m-0 text-base font-semibold">
								Findings
							</h2>
							<p className="m-0 text-[13px] text-(--ws-muted)">
								Grouped by how they get fixed. Select what to include in this
								run.
							</p>
						</div>
						<div className="flex gap-1.5">
							<button
								type="button"
								className="ws-btn ws-hit h-[34px] rounded-(--ws-r-sm) px-3 font-medium"
								onClick={() =>
									setSelected(
										new Set(
											findings.filter((f) => f.applicable).map((f) => f.key),
										),
									)
								}
							>
								Select all fixable
							</button>
							<button
								type="button"
								className="ws-btn ws-hit h-[34px] rounded-(--ws-r-sm) bg-transparent px-3 text-(--ws-text-3)"
								onClick={() => setSelected(new Set())}
							>
								Clear
							</button>
						</div>
					</div>

					{findings.length === 0 && (
						<p className="m-0 px-[22px] py-6 text-[13px] text-(--ws-muted)">
							{image.report
								? "No findings: nothing to fix."
								: "Not scanned yet: scan the image to see what to fix."}
						</p>
					)}
					{GROUPS.map((g) => {
						const items = findings.filter((f) => f.group === g.group);
						if (items.length === 0) {
							return null;
						}
						return (
							<div
								key={g.group}
								className="border-0 border-b border-solid border-(--ws-row-line)"
								data-testid={`fix-group-${g.group}`}
							>
								<div className="flex items-center gap-2.5 bg-(--ws-inset) px-[22px] py-3">
									<span
										aria-hidden="true"
										className={cn(
											"flex size-[22px] items-center justify-center rounded-md text-[11px] font-bold",
											g.tile,
										)}
									>
										{g.glyph}
									</span>
									<span className="text-[13.5px] font-semibold">{g.title}</span>
									<span className="text-[12.5px] text-(--ws-muted)">
										{g.sub}
									</span>
									<span className="ws-mono ml-auto text-xs text-(--ws-muted)">
										{items.length} finding{items.length === 1 ? "" : "s"}
									</span>
								</div>
								{items.map((f) => (
									<FindingRow
										key={f.key}
										finding={f}
										on={selected.has(f.key)}
										onToggle={() => toggle(f)}
									/>
								))}
							</div>
						);
					})}
					{image.report &&
						image.report.vulnerabilities.total > findings.length && (
							<p className="m-0 border-0 border-b border-solid border-(--ws-row-line) px-[22px] py-3 text-[12.5px] text-(--ws-muted)">
								The {findings.length} most severe of{" "}
								{image.report.vulnerabilities.total} findings: fix these, scan
								again, and the rest come up.
							</p>
						)}
					<div className="flex flex-wrap items-center gap-2.5 px-[22px] py-3.5 text-[12.5px] text-(--ws-muted)">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 11v5M12 8h.01" />
						</svg>
						Findings with no available fix can be accepted with a reason; they
						stay visible on the score until a fix ships.
						<button
							type="button"
							disabled
							className="ws-link-btn h-auto px-0 disabled:opacity-60"
							title={`Accepting a risk needs an API this deployment does not have yet (proposed in ${PROPOSAL})`}
						>
							Accept risk…
						</button>
					</div>
				</section>

				<aside
					aria-labelledby="h-plan"
					className="flex min-w-0 max-w-[440px] flex-[1_1_360px] flex-col gap-4"
				>
					<div className="overflow-hidden rounded-(--ws-r-card) border border-solid border-(--ws-line) bg-(--ws-card)">
						<div className="border-0 border-b border-solid border-(--ws-row-line) px-[22px] py-[18px]">
							<h2 id="h-plan" className="m-0 text-base font-semibold">
								Fix plan
							</h2>
							<p className="m-0 text-[13px] text-(--ws-muted)">
								{n} finding{n === 1 ? "" : "s"} selected
							</p>
						</div>
						<div className="px-[22px] pt-4">
							<div
								role="tablist"
								aria-label="Who applies the fixes"
								className="grid grid-cols-2 gap-1 rounded-[11px] border border-solid border-(--ws-line) bg-(--ws-well) p-1"
							>
								{(
									[
										["manual", "Fix it myself"],
										["agent", "Hand to an agent"],
									] as const
								).map(([value, label]) => (
									<button
										key={value}
										type="button"
										role="tab"
										aria-selected={mode === value}
										onClick={() => setMode(value)}
										className={cn(
											"ws-hit h-[38px] cursor-pointer rounded-lg border-0 text-[13px]",
											mode === value
												? "bg-(--ws-switch-off) font-semibold text-(--ws-text)"
												: "bg-transparent font-medium text-(--ws-muted)",
										)}
									>
										{label}
									</button>
								))}
							</div>
						</div>

						{mode === "manual" ? (
							<div className="flex flex-col gap-3.5 px-[22px] pb-[22px] pt-4">
								<p className="m-0 text-[13px] text-(--ws-text-3)">
									The changes below are generated from your selection:{" "}
									{builtHere
										? "a step added to this image, built and scanned again."
										: "a fixed copy built on this image, then scanned."}
								</p>
								<div className="overflow-hidden rounded-(--ws-r-md) border border-solid border-(--ws-line) bg-(--ws-code)">
									<div className="flex items-center justify-between border-0 border-b border-solid border-(--ws-row-line) px-3 py-2 text-xs text-(--ws-muted)">
										<span className="ws-mono">Dockerfile</span>
										<span>
											{hunks(script)} hunk{hunks(script) === 1 ? "" : "s"}
										</span>
									</div>
									<pre
										className="ws-mono m-0 max-h-[320px] overflow-auto p-3 text-xs leading-[1.6] text-(--ws-text-2)"
										data-testid="fix-diff"
									>
										{!builtHere && (image.pullRef || image.tracked) && (
											<span className="text-(--ws-go)">
												{`+ FROM ${image.tracked ? image.tracked.image : image.pullRef}\n`}
											</span>
										)}
										{n === 0 ? (
											<span className="text-(--ws-muted)">
												Select findings to see the changes.
											</span>
										) : (
											<>
												{script
													.filter((line) => line.startsWith("#"))
													.map((line) => (
														<span key={line} className="text-(--ws-muted)">
															{`+ ${line}\n`}
														</span>
													))}
												<span className="text-(--ws-go)">
													{dockerRun(
														script.filter((line) => !line.startsWith("#")),
													)}
												</span>
											</>
										)}
									</pre>
								</div>
								<label
									className="flex items-center gap-2.5 text-[13px] text-(--ws-faint)"
									title={`Pull requests need a Git host for the image's build files: proposed in ${PROPOSAL}`}
								>
									<input type="checkbox" disabled className="size-4" />
									Open as a pull request instead of committing
								</label>
								<button
									type="button"
									className="ws-hit inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-(--ws-r-md) border-0 bg-(--ws-accent) text-sm font-semibold text-(--ws-accent-ink) disabled:cursor-not-allowed disabled:opacity-60"
									disabled={!canApply || apply.isPending}
									onClick={() => apply.mutate()}
									data-testid="fix-apply"
								>
									{apply.isPending && <Spinner loading size="sm" />}
									{manualCta}
								</button>
								{image.scanned && image.canEdit && (
									<button
										type="button"
										className="ws-btn ws-hit justify-center font-medium"
										onClick={() => setImporting(true)}
										data-testid="fix-import"
									>
										Import {image.scanned.image}
									</button>
								)}
								{importing && image.scanned && (
									<ImportImageDialog
										initial={{
											name: nameFrom(image.scanned.image),
											ref: image.scanned.image,
										}}
										onClose={() => setImporting(false)}
									/>
								)}
							</div>
						) : (
							<AgentPanel n={n} />
						)}
					</div>

					<Activity image={image} />
				</aside>
			</div>
		</div>
	);
};

const FindingRow: React.FC<{
	finding: Finding;
	on: boolean;
	onToggle: () => void;
}> = ({ finding: f, on, onToggle }) => (
	<div
		className="flex items-center gap-3.5 border-0 border-t border-solid border-(--ws-line-soft) px-[22px] py-3"
		data-testid="fix-finding"
	>
		{f.applicable ? (
			<button
				type="button"
				role="checkbox"
				aria-checked={on}
				aria-label={`${f.id} (${f.pkg})`}
				onClick={onToggle}
				className={cn(
					"ws-hit flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md p-0",
					on
						? "border-0 bg-(--ws-accent) text-(--ws-accent-ink)"
						: "border border-solid border-(--ws-radio-off) bg-(--ws-well)",
				)}
			>
				{on && (
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M5 12l5 5 9-10" />
					</svg>
				)}
			</button>
		) : (
			<span
				aria-hidden="true"
				className="size-[22px] shrink-0 rounded-md border border-dashed border-(--ws-radio-off)"
			/>
		)}
		<div className="min-w-0 flex-[1_1_200px]">
			<div className="flex flex-wrap items-center gap-2">
				<span className="ws-mono text-[13px] font-medium">{f.id}</span>
				<span
					className={cn(
						"inline-flex h-5 items-center rounded-md px-[7px] text-[11px] font-semibold uppercase tracking-[0.04em]",
						SEVERITY_CHIP[f.severity] ?? "bg-(--ws-raised) text-(--ws-text-3)",
					)}
				>
					{f.severity.toLowerCase()}
				</span>
			</div>
			{f.title && (
				<div className="mt-0.5 text-[12.5px] text-(--ws-text-3)">{f.title}</div>
			)}
		</div>
		<div className="ws-mono flex min-w-0 flex-[1_1_220px] flex-wrap items-center gap-2 text-[12.5px]">
			<span className="text-(--ws-text-2)">{f.pkg}</span>
			<span className="text-(--ws-danger)">{f.installed}</span>
			{f.to ? (
				<>
					<span className="text-(--ws-faint)">→</span>
					<span className="text-(--ws-go)">{f.to}</span>
				</>
			) : (
				<span className="text-(--ws-faint)">no fix yet</span>
			)}
		</div>
		<span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-md border border-solid border-(--ws-line) bg-(--ws-raised) px-2 text-[11.5px] text-(--ws-muted)">
			{f.source}
		</span>
	</div>
);

/**
 * Hand to an agent: the run's settings as the design has them, all off - an agent run (its runner, a scoped token,
 * the step log in Activity, approval before Promote) needs the API proposed in docs/fix-image-api.md.
 */
const AgentPanel: React.FC<{ n: number }> = ({ n }) => (
	<div className="flex flex-col gap-3.5 px-[22px] pb-[22px] pt-4">
		<div>
			<label htmlFor="agent-pick" className="text-[12.5px] text-(--ws-text-3)">
				Agent
			</label>
			<select
				id="agent-pick"
				disabled
				className="ws-input ws-select mt-1.5 h-[42px] text-[13.5px]"
			>
				<option>No agent runner configured</option>
			</select>
		</div>
		<fieldset className="m-0 border-0 p-0">
			<legend className="mb-1.5 p-0 text-[12.5px] text-(--ws-text-3)">
				Allowed to
			</legend>
			<div className="flex flex-col gap-2 text-[13px] text-(--ws-faint)">
				{[
					["Edit the Dockerfile and build files", true],
					["Run builds and scans in the cluster", true],
					["Open a pull request for review", true],
					["Promote the image without approval", false],
				].map(([label, on]) => (
					<label key={String(label)} className="flex items-center gap-2.5">
						<input
							type="checkbox"
							disabled
							defaultChecked={Boolean(on)}
							className="size-4"
						/>
						{label}
					</label>
				))}
			</div>
		</fieldset>
		<div>
			<label htmlFor="agent-notes" className="text-[12.5px] text-(--ws-text-3)">
				Instructions
			</label>
			<textarea
				id="agent-notes"
				rows={3}
				disabled
				placeholder="Prefer upgrading packages over rebasing. Stop and report if a build fails twice."
				className="ws-input mt-1.5 h-auto resize-y px-3 py-2.5 text-[13px]"
			/>
		</div>
		<div className="flex gap-2.5 rounded-(--ws-r-md) border border-solid border-(--ws-line) bg-(--ws-well) p-3 text-[12.5px] text-(--ws-text-3)">
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				className="mt-0.5 shrink-0 text-(--ws-soft)"
			>
				<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
			</svg>
			<span>
				Agent runs are not available yet: they need a runner, a scoped token and
				a step log, proposed in <code className="ws-mono">{PROPOSAL}</code> for
				review. Fix it myself applies the same fixes now.
			</span>
		</div>
		<button
			type="button"
			disabled
			className="h-11 cursor-not-allowed rounded-(--ws-r-md) border-0 bg-(--ws-accent) text-sm font-semibold text-(--ws-accent-ink) opacity-60"
		>
			{n
				? `Hand ${n} finding${n === 1 ? "" : "s"} to the agent`
				: "Select findings to fix"}
		</button>
	</div>
);

/** What happened to the image: its last scan, its builds, how it came in. */
const Activity: React.FC<{ image: ImageDetail }> = ({ image }) => {
	const items: { at: string; dot: string; title: string; detail: string }[] =
		[];
	if (image.report) {
		const c = image.report.vulnerabilities.counts;
		items.push({
			at: image.report.scannedAt,
			dot: "bg-(--ws-go)",
			title: image.report.error ? "Scan failed" : "Scan completed",
			detail: image.report.error
				? image.report.error.slice(0, 80)
				: `${image.report.grade} · ${c.CRITICAL ?? 0} critical, ${c.HIGH ?? 0} high`,
		});
	}
	for (const b of image.builds.slice(0, 4)) {
		items.push({
			at: b.startedAt,
			dot:
				b.status === "ready"
					? "bg-(--ws-go)"
					: b.status === "failed" || b.status === "cancelled"
						? "bg-(--ws-warn)"
						: "bg-(--ws-accent)",
			title: `Build v${b.version} ${b.status === "ready" ? "ready" : b.status}`,
			detail: b.message ?? "",
		});
	}
	items.push({
		at: image.imported?.at ?? image.createdAt,
		dot: "bg-(--ws-radio-off)",
		title: image.imported
			? "Image imported"
			: image.scanned
				? "Image scanned as it is"
				: image.tracked
					? "Deployed with the platform"
					: "Image created",
		detail: image.imported?.by
			? `by ${image.imported.by}`
			: image.createdBy
				? `by ${image.createdBy}`
				: "",
	});
	items.sort((a, b) => b.at.localeCompare(a.at));
	const last = image.builds[0];

	return (
		<div className="overflow-hidden rounded-(--ws-r-card) border border-solid border-(--ws-line) bg-(--ws-card)">
			<div className="flex items-center justify-between border-0 border-b border-solid border-(--ws-row-line) px-[22px] py-3.5">
				<h2 className="m-0 text-sm font-semibold">Activity</h2>
				<span className="text-xs text-(--ws-muted)">
					{last
						? `Last build · ${createDayString(last.startedAt)}`
						: "No builds yet"}
				</span>
			</div>
			<ol
				className="m-0 flex list-none flex-col gap-3 px-[22px] py-3.5 text-[13px]"
				data-testid="fix-activity"
			>
				{items.slice(0, 6).map((item, i) => (
					<li key={i} className="flex gap-3">
						<span
							className={cn("mt-[7px] size-2 shrink-0 rounded-full", item.dot)}
						/>
						<div>
							<div>{item.title}</div>
							<div className="text-xs text-(--ws-muted)">
								{createDayString(item.at)}
								{item.detail && ` · ${item.detail}`}
							</div>
						</div>
					</li>
				))}
			</ol>
		</div>
	);
};

export default FixImagePage;
