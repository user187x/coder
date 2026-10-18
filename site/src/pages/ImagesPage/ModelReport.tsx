import { cn } from "cn";
import {
	BrainCircuitIcon,
	DownloadIcon,
	FileCode2Icon,
	ShieldAlertIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	ImagesAPI,
	type ModelRawFile,
	type ModelScanSummary,
	type ModelSeverity,
	type ModelReport as Report,
} from "#/api/images";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Loader } from "#/components/Loader/Loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { createDayString } from "#/utils/createDayString";
import { formatSize, GRADE_STYLE } from "./badges";
import { SeverityButton, StatusIcon } from "./ImageReport";

const SEVERITIES: ModelSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const SEVERITY_STYLE: Record<ModelSeverity, string> = {
	CRITICAL: "text-highlight-red",
	HIGH: "text-highlight-orange",
	MEDIUM: "text-content-warning",
	LOW: "text-content-secondary",
	PASS: "text-content-success",
};

/** garak's words for its DEFCON levels (garak.analyze). */
const DEFCON: Record<number, string> = {
	1: "DC-1",
	2: "DC-2",
	3: "DC-3",
	4: "DC-4",
	5: "DC-5",
};

const at = (seconds: number) => new Date(seconds * 1000).toISOString();

/** A model's grade, A (clean) to F, with its critical and high results - the image grade's look. */
export const ModelGradeBadge: React.FC<{
	summary: Pick<ModelScanSummary, "grade" | "counts" | "tbsa"> | null;
	compact?: boolean;
}> = ({ summary, compact }) => {
	if (!summary?.grade) {
		return <span className="text-content-secondary text-sm">–</span>;
	}
	const c = summary.counts;
	const title =
		summary.grade === "?"
			? "Not graded: the scan did not finish (see the report)"
			: `garak: ${c.CRITICAL ?? 0} critical (DC-1) · ${c.HIGH ?? 0} high (DC-2) · ${c.MEDIUM ?? 0} medium (DC-3) · ${c.LOW ?? 0} low (DC-4) · ${c.PASS ?? 0} passed${summary.tbsa ? `; TBSA ${summary.tbsa} of 5` : ""}`;
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
			{summary.grade !== "?" && !compact && (
				<span className="text-xs text-content-secondary tabular-nums">
					{(c.CRITICAL ?? 0) > 0 && (
						<b className="text-highlight-red">{c.CRITICAL} crit · </b>
					)}
					{c.HIGH ?? 0} high
				</span>
			)}
		</span>
	);
};

/**
 * A model's security report (the Model library): garak's probes against the model, each probe and detector pair at
 * the DEFCON level garak gives it against its calibration (DC-1 critical, DC-2 high, DC-3 medium, DC-4 low; DC-5
 * passed), grouped by the OWASP Top 10 for LLM applications; the model file's checks; a few failing attempts each;
 * and garak's own files to download - laid out like an image's security report.
 */
export const ModelReportView: React.FC<{ report: Report }> = ({ report }) => {
	const [severity, setSeverity] = useState<ModelSeverity | "all" | "failing">(
		"failing",
	);
	const [owasp, setOwasp] = useState<string | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const failing = report.findings.filter((f) => f.severity !== "PASS");
	const shown = report.findings.filter(
		(f) =>
			(severity === "all" ||
				(severity === "failing"
					? f.severity !== "PASS"
					: f.severity === severity)) &&
			(!owasp || f.owasp.includes(owasp)),
	);
	const minutes =
		report.startedAt && report.scannedAt
			? Math.max(1, Math.round((report.scannedAt - report.startedAt) / 60))
			: null;
	const file = report.file;
	return (
		<div className="flex flex-col gap-6" data-testid="model-report">
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
				<div className="flex items-center gap-3">
					<ModelGradeBadge
						summary={{
							grade: report.grade,
							counts: report.counts,
							tbsa: report.tbsa?.score ?? null,
						}}
					/>
					<span className="text-sm text-content-secondary">
						Scanned {createDayString(at(report.scannedAt))}
						{minutes !== null && ` in ${minutes} min`} · {report.probes} probes
						{report.prompts
							? `, ${report.prompts.toLocaleString()} prompts`
							: ""}
					</span>
				</div>
				{report.tbsa && (
					<span
						className="rounded-md border border-solid border-border px-2 py-1 text-xs"
						title="garak's tier-based security aggregate: one score for the run, from 1.0 (worst) to 5.0, its tier 1 probes weighing most"
						data-testid="model-tbsa"
					>
						garak TBSA{" "}
						<b className="tabular-nums">{report.tbsa.score.toFixed(1)}</b> / 5
					</span>
				)}
				<StageNote report={report} />
			</div>
			<div
				className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-solid border-border px-3 py-2 text-xs text-content-secondary"
				data-testid="model-report-data"
			>
				<span className="font-medium text-content-primary">Graded with</span>
				<span>garak {report.garak}</span>
				<span>
					{report.profileTitle} profile ({report.profile})
				</span>
				<span>
					{report.calibration
						? `garak's calibration of ${report.calibration.date} (${report.calibration.models} models)`
						: "no calibration: pass rates only"}
				</span>
				{report.llamaCpp.build && (
					<span>
						llama.cpp b{report.llamaCpp.build}
						{report.server.jinja === false && " (built-in chat template)"}
					</span>
				)}
				<span>releases at {report.releaseGrade} or better</span>
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
				<h3 className="m-0 flex items-center gap-2 text-base font-semibold">
					<ShieldAlertIcon className="size-4" />
					What garak's probes got the model to do
				</h3>
				<div
					className="flex flex-wrap gap-2"
					role="group"
					aria-label="Severity"
				>
					<SeverityButton
						label="Failing"
						count={failing.length}
						active={severity === "failing"}
						onClick={() => setSeverity("failing")}
					/>
					{SEVERITIES.filter((s) => (report.counts[s] ?? 0) > 0).map((s) => (
						<SeverityButton
							key={s}
							label={s.toLowerCase()}
							count={report.counts[s] ?? 0}
							active={severity === s}
							className={SEVERITY_STYLE[s]}
							onClick={() => setSeverity(s)}
						/>
					))}
					<SeverityButton
						label="passed"
						count={report.counts.PASS ?? 0}
						active={severity === "PASS"}
						className={SEVERITY_STYLE.PASS}
						onClick={() => setSeverity("PASS")}
					/>
					<SeverityButton
						label="All"
						count={report.findings.length}
						active={severity === "all"}
						onClick={() => setSeverity("all")}
					/>
				</div>
				{report.owasp.length > 0 && (
					<div
						className="flex flex-wrap gap-1.5"
						role="group"
						aria-label="OWASP Top 10 for LLM applications"
						data-testid="model-owasp"
					>
						{report.owasp.map((o) => {
							const bad = SEVERITIES.reduce(
								(n, s) => n + (o.counts[s] ?? 0),
								0,
							);
							return (
								<button
									key={o.id}
									type="button"
									aria-pressed={owasp === o.id}
									onClick={() => setOwasp(owasp === o.id ? null : o.id)}
									title={`${o.pairs} probe and detector results; ${SEVERITIES.map((s) => `${o.counts[s] ?? 0} ${s.toLowerCase()}`).join(", ")}`}
									className={cn(
										"flex cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 py-1 text-xs",
										owasp === o.id
											? "border-content-primary bg-surface-secondary"
											: "border-border bg-transparent",
									)}
								>
									<span className="font-mono">{o.id}</span>
									<span className="text-content-secondary">{o.title}</span>
									<b
										className={cn(
											"tabular-nums",
											(o.counts.CRITICAL ?? 0) > 0
												? SEVERITY_STYLE.CRITICAL
												: (o.counts.HIGH ?? 0) > 0
													? SEVERITY_STYLE.HIGH
													: bad
														? SEVERITY_STYLE.MEDIUM
														: SEVERITY_STYLE.PASS,
										)}
									>
										{bad}/{o.pairs}
									</b>
								</button>
							);
						})}
					</div>
				)}
				{shown.length > 0 ? (
					<div className="max-h-[30rem] overflow-auto rounded-md border border-solid border-border">
						<Table data-testid="model-findings">
							<TableHeader>
								<TableRow>
									<TableHead>Severity</TableHead>
									<TableHead>Probe</TableHead>
									<TableHead>Detector</TableHead>
									<TableHead>OWASP</TableHead>
									<TableHead className="text-right">Failed</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{shown.map((f) => {
									const key = `${f.probe}|${f.detector}`;
									const isOpen = open === key;
									return (
										<Fragment key={key}>
											<TableRow
												className={cn(
													f.examples.length > 0 && "cursor-pointer",
												)}
												onClick={() =>
													f.examples.length > 0 && setOpen(isOpen ? null : key)
												}
											>
												<TableCell
													className={cn(
														"whitespace-nowrap text-xs font-semibold",
														SEVERITY_STYLE[f.severity],
													)}
													title={[f.absoluteComment, f.relativeComment]
														.filter(Boolean)
														.join("; ")}
												>
													{f.severity === "PASS" ? "passed" : f.severity}
													{f.defcon ? (
														<span className="ml-1 font-normal text-content-secondary">
															{DEFCON[f.defcon]}
														</span>
													) : null}
												</TableCell>
												<TableCell className="text-xs">
													<span className="font-mono">{f.probe}</span>
													{f.tier ? (
														<span className="ml-1 text-content-secondary">
															tier {f.tier}
														</span>
													) : null}
													<span className="block text-content-secondary">
														{f.goal || f.description}
													</span>
												</TableCell>
												<TableCell
													className="font-mono text-xs"
													title={f.detectorDescription}
												>
													{f.detector}
												</TableCell>
												<TableCell className="font-mono text-xs">
													{f.owasp.join(" ") || "–"}
												</TableCell>
												<TableCell className="whitespace-nowrap text-right text-xs tabular-nums">
													{f.failed}/{f.total}{" "}
													<span className="text-content-secondary">
														({Math.round((1 - f.passRate) * 100)}%)
													</span>
												</TableCell>
											</TableRow>
											{isOpen && (
												<TableRow>
													<TableCell
														colSpan={5}
														className="bg-surface-secondary"
													>
														<FindingExamples examples={f.examples} />
													</TableCell>
												</TableRow>
											)}
										</Fragment>
									);
								})}
							</TableBody>
						</Table>
					</div>
				) : (
					<p className="m-0 text-sm text-content-success">
						{severity === "failing" ? "Nothing failing." : "None."}
					</p>
				)}
				<p className="m-0 text-xs text-content-secondary">
					Each row is one of garak's probes judged by one of its detectors: how
					many of its prompts got an answer the detector flags. The severity is
					garak's DEFCON level for that pass rate against the models garak was
					calibrated on. Click a row for examples.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base font-semibold">
					<BrainCircuitIcon className="size-4" />
					The model file
				</h3>
				<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
					{(
						[
							["Model", [file.name, file.sizeLabel].filter(Boolean).join(" ")],
							["Architecture", file.architecture],
							[
								"Parameters",
								file.parameters ? file.parameters.toLocaleString() : "",
							],
							["Quantization", file.fileType],
							["Context", file.contextLength?.toLocaleString()],
							["License", file.license],
							["Size", formatSize(file.size)],
							["SHA-256", file.sha256],
						] as [string, string | undefined][]
					)
						.filter(([, v]) => v)
						.map(([k, v]) => (
							<Fragment key={k}>
								<dt className="text-content-secondary">{k}</dt>
								<dd className="m-0 break-all font-mono">{v}</dd>
							</Fragment>
						))}
				</dl>
				<ul
					className="m-0 flex list-none flex-col divide-y divide-border rounded-md border border-solid border-border p-0"
					data-testid="model-checks"
				>
					{report.checks.map((c) => (
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

			<section className="flex flex-wrap items-center gap-2">
				<span className="text-sm font-medium">garak's own files</span>
				{(
					[
						["report.jsonl", "Report (JSONL)"],
						["hitlog.jsonl", "Hits (JSONL)"],
						["report.html", "HTML report"],
					] as [ModelRawFile, string][]
				).map(([f, label]) => (
					<Button key={f} asChild size="sm" variant="outline">
						<a href={ImagesAPI.modelReportFileUrl(report.name, f)} download>
							<DownloadIcon />
							{label}
						</a>
					</Button>
				))}
			</section>
		</div>
	);
};

const StageNote: React.FC<{ report: Report }> = ({ report }) => {
	if (report.stage === "released") {
		const r = report.releasedBy;
		return (
			<span className="text-xs text-content-success">
				In the library
				{r &&
					(r.by === "policy"
						? " (released by its grade)"
						: ` (released by ${r.by}${r.override ? ", over its grade" : ""})`)}
			</span>
		);
	}
	return (
		<span className="text-xs text-highlight-orange">
			Held: no workspace has it
			{report.holdReason ? ` (${report.holdReason})` : ""}
		</span>
	);
};

const FindingExamples: React.FC<{
	examples: Report["findings"][number]["examples"];
}> = ({ examples }) => (
	<div className="flex flex-col gap-3 py-1" data-testid="model-examples">
		{examples.map((e, i) => (
			<div key={i} className="grid gap-2 text-xs md:grid-cols-2">
				<div className="flex flex-col gap-1">
					<span className="flex items-center gap-1 font-medium">
						<FileCode2Icon className="size-3" />
						Prompt
					</span>
					<pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-solid border-border bg-surface-primary p-2 font-mono">
						{e.prompt}
					</pre>
				</div>
				<div className="flex flex-col gap-1">
					<span className="font-medium">
						The model's answer
						{e.score !== null && (
							<span className="ml-1 font-normal text-content-secondary">
								(detector score {e.score.toFixed(2)})
							</span>
						)}
					</span>
					<pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-solid border-border bg-surface-primary p-2 font-mono">
						{e.output || "(nothing)"}
					</pre>
				</div>
			</div>
		))}
	</div>
);

/** A model's report in a dialog (the Model library's Report button). */
export const ModelReportDialog: React.FC<{
	name: string;
	onClose: () => void;
}> = ({ name, onClose }) => {
	const query = useQuery({
		queryKey: ["platform", "model-report", name],
		queryFn: () => ImagesAPI.modelReport(name),
	});
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-5xl">
				<DialogHeader>
					<DialogTitle className="break-all">
						Security report: {name}
					</DialogTitle>
					<DialogDescription>
						garak, NVIDIA's LLM vulnerability scanner, probed the model before
						workspaces could use it.
					</DialogDescription>
				</DialogHeader>
				<div className="max-h-[70vh] overflow-y-auto pr-1">
					{query.data ? (
						<ModelReportView report={query.data} />
					) : query.error ? (
						<p role="alert" className="text-sm text-content-destructive">
							{getErrorMessage(query.error, "The report could not be read.")}
						</p>
					) : (
						<Loader />
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
