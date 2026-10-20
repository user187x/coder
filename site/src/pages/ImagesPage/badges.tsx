import { cn } from "cn";
import { ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import type { ImageListItem, ImageStatus, ReportSummary } from "#/api/images";
import { Badge } from "#/components/Badge/Badge";

export const StatusBadge: React.FC<{
	status: ImageStatus;
	building?: boolean;
}> = ({ status, building }) => {
	if (building || status === "building") {
		return <Badge variant="info">Building</Badge>;
	}
	if (status === "ready") {
		return <Badge variant="green">Ready</Badge>;
	}
	if (status === "failed") {
		return <Badge variant="destructive">Failed</Badge>;
	}
	return <Badge variant="default">Draft</Badge>;
};

/** An image brought in (from a registry or an archive), not built here. */
export const ImportedBadge: React.FC<{ from: string }> = ({ from }) => (
	<Badge variant="default" title={`Imported from ${from}`}>
		Imported
	</Badge>
);

/** A patched copy a pit stop made (Copa, Fix image) of an image only scanned here. */
export const PatchedBadge: React.FC<{ from: string }> = ({ from }) => (
	<Badge
		variant="green"
		title={`${from}, patched in place by Copa (a pit stop)`}
	>
		Patched
	</Badge>
);

/** An image in the pit now: Copa patching it (lap n of the laps allowed). */
export const InThePitBadge: React.FC<{ lap: number; laps: number }> = ({
	lap,
	laps,
}) => (
	<Badge
		variant="warning"
		className="pit-badge"
		title="A pit stop: Copa is patching it, then it is rescanned"
		data-testid="image-in-the-pit"
	>
		In the pit · lap {lap}/{laps}
	</Badge>
);

/** The workspace template's own image (tracked here, read-only). */
export const TrackedBadge: React.FC = () => (
	<Badge
		variant="info"
		title="The image the workspace template runs: listed for its security report and add-ons"
	>
		In use by workspaces
	</Badge>
);

export const GRADE_STYLE: Record<string, string> = {
	A: "bg-surface-green text-highlight-green border-border-green",
	B: "bg-surface-green text-highlight-green border-border-green",
	C: "bg-surface-orange text-highlight-orange border-border-warning",
	D: "bg-surface-orange text-highlight-orange border-border-warning",
	F: "bg-surface-red text-highlight-red border-border-destructive",
	"?": "bg-surface-secondary text-content-secondary border-border",
};

/** The security report's grade: A (clean) to F (critical findings, secrets or failed checks). */
export const GradeBadge: React.FC<{
	summary: ReportSummary | null;
	/** A second line under the counts (the Images list's "31 fixable → B", View fix). */
	children?: React.ReactNode;
}> = ({ summary, children }) => {
	if (!summary?.grade) {
		return <span className="text-content-secondary text-sm">–</span>;
	}
	const c = summary.counts;
	const title =
		summary.grade === "?"
			? "Not scanned (see the report)"
			: `Critical ${c.CRITICAL ?? 0} · High ${c.HIGH ?? 0} · Medium ${c.MEDIUM ?? 0} · Low ${c.LOW ?? 0}; ${summary.secrets} secrets; checks: ${summary.checks.fail} failed, ${summary.checks.warn} warnings`;
	return (
		<span className="inline-flex items-center gap-2" title={title}>
			<span
				className={cn(
					"inline-flex size-7 items-center justify-center rounded-md border border-solid text-sm font-bold",
					GRADE_STYLE[summary.grade] ?? GRADE_STYLE["?"],
				)}
			>
				{summary.grade}
			</span>
			{summary.grade !== "?" && (
				<span className="flex flex-col">
					<span className="text-xs text-content-secondary tabular-nums">
						{(c.CRITICAL ?? 0) > 0 && (
							<b className="text-highlight-red">{c.CRITICAL} crit · </b>
						)}
						{c.HIGH ?? 0} high
					</span>
					{children}
				</span>
			)}
		</span>
	);
};

/** Graded D or F with fixes that would raise it (summary.needsFixing): the Images list's call to fix it. */
export const NeedsFixingBadge: React.FC = () => (
	<Badge
		variant="destructive"
		title="Graded D or F, and fixing what has a fix would raise the grade"
		data-testid="needs-fixing"
	>
		<span aria-hidden className="size-1.5 rounded-full bg-current" />
		Needs fixing
	</Badge>
);

export const FipsBadge: React.FC<{
	status: ReportSummary["fips"] | undefined;
}> = ({ status }) => {
	if (!status) {
		return <span className="text-content-secondary text-sm">–</span>;
	}
	const [Icon, label, style] =
		status === "ready"
			? [ShieldCheckIcon, "Ready", "text-highlight-green"]
			: status === "partial"
				? [ShieldIcon, "Partial", "text-highlight-orange"]
				: [ShieldAlertIcon, "Not ready", "text-content-secondary"];
	return (
		<span className={cn("inline-flex items-center gap-1 text-sm", style)}>
			<Icon className="size-4" />
			{label}
		</span>
	);
};

export const formatSize = (bytes: number | null | undefined) => {
	if (!bytes) {
		return "–";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	let v = bytes;
	let i = 0;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	return `${v.toFixed(v < 10 && i ? 1 : 0)} ${units[i]}`;
};

/** What deleting an entry of the Images view does (its confirm dialog says it before). */
export const deleteDescription = (
	image: Pick<ImageListItem, "tracked" | "scanned" | "imported">,
) =>
	image.tracked
		? `Only this entry and its security report go: the workspace template keeps running ${image.tracked.image}, its workspaces keep running, and the registry keeps the copy new images build on. The entry comes back when the platform deploys another workspace image.`
		: image.scanned
			? `Only this scan goes: ${image.scanned.image} itself is not touched.`
			: image.imported
				? "The imported image, every version of it in the registry and its reports go. Workspaces still running it keep running; new ones can't start from it."
				: "The image, its files and every version in the registry go. Workspaces still running it keep running; new ones can't start from it.";
