import { cn } from "cn";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	InfoIcon,
	KeyRoundIcon,
	ScanSearchIcon,
	ShieldCheckIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import type {
	CheckStatus,
	ImageReport as Report,
	ReportSummary,
	Severity,
} from "#/api/images";
import { Button } from "#/components/Button/Button";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { createDayString } from "#/utils/createDayString";
import { FipsBadge, GradeBadge } from "./badges";
import { useSecurityData } from "./SecurityData";

const SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

const SEVERITY_STYLE: Record<Severity, string> = {
	CRITICAL: "text-highlight-red",
	HIGH: "text-highlight-orange",
	MEDIUM: "text-content-warning",
	LOW: "text-content-secondary",
	UNKNOWN: "text-content-secondary",
};

const StatusIcon: React.FC<{ status: CheckStatus }> = ({ status }) =>
	status === "pass" ? (
		<CircleCheckIcon
			className="size-4 shrink-0 text-content-success"
			aria-label="pass"
		/>
	) : status === "fail" ? (
		<CircleAlertIcon
			className="size-4 shrink-0 text-content-destructive"
			aria-label="fail"
		/>
	) : status === "warn" ? (
		<TriangleAlertIcon
			className="size-4 shrink-0 text-content-warning"
			aria-label="warning"
		/>
	) : (
		<InfoIcon
			className="size-4 shrink-0 text-content-secondary"
			aria-label="info"
		/>
	);

/**
 * An image's security health report: its grade, the known vulnerabilities in
 * its packages (trivy, against the security data in force), secrets
 * left in its files, how it is set up (users, sudo, setuid, leftovers…) and
 * how far it goes toward FIPS 140.
 */
export const ImageReport: React.FC<{
	report: Report;
	summary: ReportSummary | null;
	/** A rescan with the security data in force, offered when newer data than this report's is loaded. */
	onRescan?: () => void;
	rescanning?: boolean;
}> = ({ report, summary, onRescan, rescanning }) => {
	const [severity, setSeverity] = useState<Severity | "all">("all");
	const { data: current } = useSecurityData();
	const graded = report.data?.vulnerabilityDbUpdatedAt ?? report.dbUpdatedAt;
	const newer =
		current?.vulnerabilityDb?.updatedAt &&
		(!graded || new Date(current.vulnerabilityDb.updatedAt) > new Date(graded));
	const ageDays = graded
		? Math.floor((Date.now() - new Date(graded).getTime()) / 86_400_000)
		: null;
	const v = report.vulnerabilities;
	const shown = v.top.filter(
		(x) => severity === "all" || x.severity === severity,
	);
	return (
		<div className="flex flex-col gap-6" data-testid="image-report">
			<div className="flex flex-wrap items-center gap-6">
				<div className="flex items-center gap-3">
					<GradeBadge summary={summary} />
					<span className="text-sm text-content-secondary">
						Scanned {createDayString(report.scannedAt)}
						{report.os && ` · ${report.os}`}
						{report.dbUpdatedAt &&
							` · vulnerability database of ${report.dbUpdatedAt.slice(0, 10)}`}
					</span>
				</div>
				<FipsBadge status={report.fips.status} />
			</div>
			<div
				className={cn(
					"flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-solid px-3 py-2 text-xs",
					newer || (ageDays ?? 0) > 30
						? "border-border-warning bg-surface-orange text-highlight-orange"
						: "border-border text-content-secondary",
				)}
				data-testid="report-data"
			>
				<span className="font-medium">Graded with</span>
				<span>
					vulnerability database of {graded ? graded.slice(0, 10) : "—"}
					{ageDays !== null &&
						` (${ageDays} day${ageDays === 1 ? "" : "s"} old when scanned: ${report.scannedAt.slice(0, 10)})`}
				</span>
				<span>
					{report.data?.javaDbUpdatedAt
						? `Java database of ${report.data.javaDbUpdatedAt.slice(0, 10)}`
						: "Java archives not scanned"}
				</span>
				<span>
					FIPS rules{" "}
					{report.data?.fipsRules.version ??
						report.fips.rules?.version ??
						"(built in)"}
					{(report.data?.fipsRules.published ?? report.fips.rules?.published) &&
						` (${report.data?.fipsRules.published ?? report.fips.rules?.published})`}
				</span>
				{report.data?.trivyVersion && (
					<span>trivy {report.data.trivyVersion}</span>
				)}
				{newer && (
					<span className="flex items-center gap-2 font-medium">
						Newer security data is loaded (
						{current?.vulnerabilityDb?.updatedAt?.slice(0, 10)}).
						{onRescan && (
							<Button
								size="xs"
								variant="outline"
								onClick={onRescan}
								disabled={rescanning}
							>
								<Spinner loading={rescanning}>
									<ScanSearchIcon />
								</Spinner>
								Rescan for a current grade
							</Button>
						)}
					</span>
				)}
			</div>
			{report.error && (
				<p
					role="alert"
					className="m-0 rounded-md border border-solid border-border-destructive bg-surface-red p-3 text-sm text-highlight-red"
				>
					The scan didn't finish: {report.error}
				</p>
			)}

			<section className="flex flex-col gap-3">
				<h3 className="m-0 text-base font-semibold">Vulnerabilities</h3>
				<div
					className="flex flex-wrap gap-2"
					role="group"
					aria-label="Severity"
				>
					<SeverityButton
						label="All"
						count={v.total}
						active={severity === "all"}
						onClick={() => setSeverity("all")}
					/>
					{SEVERITIES.filter((s) => (v.counts[s] ?? 0) > 0).map((s) => (
						<SeverityButton
							key={s}
							label={s.toLowerCase()}
							count={v.counts[s] ?? 0}
							active={severity === s}
							className={SEVERITY_STYLE[s]}
							onClick={() => setSeverity(s)}
						/>
					))}
					<span className="self-center text-xs text-content-secondary">
						{v.fixable} have a fixed version
					</span>
				</div>
				{v.note && (
					<p className="m-0 text-xs text-content-secondary">{v.note}</p>
				)}
				{shown.length > 0 ? (
					<div className="max-h-[28rem] overflow-auto rounded-md border border-solid border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Severity</TableHead>
									<TableHead>ID</TableHead>
									<TableHead>Package</TableHead>
									<TableHead>Installed</TableHead>
									<TableHead>Fixed in</TableHead>
									<TableHead>Title</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{shown.map((x) => (
									<TableRow key={`${x.id}:${x.pkg}:${x.target}`}>
										<TableCell
											className={cn(
												"text-xs font-semibold",
												SEVERITY_STYLE[x.severity],
											)}
										>
											{x.severity}
										</TableCell>
										<TableCell className="font-mono text-xs">{x.id}</TableCell>
										<TableCell className="font-mono text-xs">{x.pkg}</TableCell>
										<TableCell className="font-mono text-xs">
											{x.installed}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{x.fixed || "–"}
										</TableCell>
										<TableCell className="text-xs">{x.title}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				) : (
					v.scanned !== false && (
						<p className="m-0 text-sm text-content-success">None found.</p>
					)
				)}
				{v.top.length < v.total && (
					<p className="m-0 text-xs text-content-secondary">
						The {v.top.length} most severe of {v.total} are listed.
					</p>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base font-semibold">
					<KeyRoundIcon className="size-4" />
					Secrets in the image
				</h3>
				{report.secrets.length === 0 ? (
					<p className="m-0 text-sm text-content-success">None found.</p>
				) : (
					<ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
						{report.secrets.map((s) => (
							<li
								key={`${s.target}:${s.line}:${s.rule}`}
								className="flex items-start gap-2"
							>
								<CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-content-destructive" />
								<span>
									<b>{s.title}</b> in <code>{s.target}</code>
									{s.line ? ` line ${s.line}` : ""}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="m-0 text-base font-semibold">How the image is set up</h3>
				<ul
					className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-solid border-border p-0"
					data-testid="image-checks"
				>
					{report.checks.map((c) => (
						<li key={c.id} className="px-3 py-2" data-status={c.status}>
							<details>
								<summary
									className={cn(
										"flex items-start gap-2 text-sm",
										c.items.length ? "cursor-pointer" : "list-none",
									)}
								>
									<StatusIcon status={c.status} />
									<span className="flex flex-col">
										<span className="font-medium">{c.title}</span>
										<span className="text-xs text-content-secondary">
											{c.detail}
										</span>
									</span>
								</summary>
								{c.items.length > 0 && (
									<ul className="mt-2 max-h-48 overflow-auto pl-8 font-mono text-xs text-content-secondary">
										{c.items.map((i) => (
											<li key={i}>{i}</li>
										))}
									</ul>
								)}
							</details>
						</li>
					))}
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base font-semibold">
					<ShieldCheckIcon className="size-4" />
					FIPS 140 compliance
				</h3>
				<p className="m-0 text-sm text-content-secondary">{report.fips.note}</p>
				<ul
					className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-solid border-border p-0"
					data-testid="fips-checks"
				>
					{report.fips.checks.map((c) => (
						<li
							key={c.id}
							className="flex items-start gap-2 px-3 py-2 text-sm"
							data-status={c.status}
						>
							<StatusIcon status={c.status} />
							<span className="flex flex-col">
								<span className="font-medium">{c.title}</span>
								<span className="text-xs text-content-secondary">
									{c.detail}
								</span>
							</span>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
};

const SeverityButton: React.FC<{
	label: string;
	count: number;
	active: boolean;
	className?: string;
	onClick: () => void;
}> = ({ label, count, active, className, onClick }) => (
	<button
		type="button"
		aria-pressed={active}
		onClick={onClick}
		className={cn(
			"flex cursor-pointer items-center gap-1.5 rounded-full border border-solid px-3 py-1 text-xs capitalize",
			active
				? "border-content-primary bg-surface-secondary"
				: "border-border bg-transparent",
			className,
		)}
	>
		{label}
		<b className="tabular-nums">{count.toLocaleString()}</b>
	</button>
);
