import { cn } from "cn";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type {
	PersistenceCheck,
	PersistenceFix,
	PersistenceReport,
	PersistenceSettings,
} from "#/api/platform";
import {
	applyPersistenceFixes,
	persistenceReport,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { LiveStatus } from "#/modules/platform/ClusterVisuals";
import {
	CHECK_STATUS_LABELS,
	CHECK_STATUS_VARIANTS,
	worstCheckStatus,
} from "#/modules/platform/checkStatus";
import { PersistenceMap } from "./PersistenceMap";
import { ClusterSettingsCard, OperatorSetupCard } from "./PersistenceSetup";
import { InstancesTable, StorageClassesTable } from "./PersistenceTables";
import { FIX_LABELS, fixesForSettings, fixesNeeded } from "./persistenceFixes";

/**
 * Coder's persistence layer: where the database runs, how it survives a lost
 * node (replicas, storage) and lost data (backups), drawn as a live map;
 * every check with what is there now and what it should be; and, through the
 * platform service, creating and changing the CloudNativePG cluster on
 * approval.
 */
export const PersistenceView: React.FC = () => {
	const queryClient = useQueryClient();
	const [paused, setPaused] = useState(false);
	const reportQuery = useQuery(persistenceReport(paused));
	const report = reportQuery.data;
	const apply = useMutation(applyPersistenceFixes(queryClient));
	const [draft, setDraft] = useState<PersistenceSettings | null>(null);
	const [pending, setPending] = useState<PersistenceFix[] | null>(null);

	if (reportQuery.isLoading) {
		return <Loader />;
	}
	if (!report) {
		return <ErrorAlert error={reportQuery.error} />;
	}

	const settings = draft ?? report.facts.settings;
	const fixes = fixesNeeded(report);
	const formFixes = fixesForSettings(report, settings);

	const applyFixes = (list: PersistenceFix[]) =>
		apply.mutate(
			{ fixes: list, settings },
			{
				onSuccess: ({ done }) => {
					setPending(null);
					setDraft(null);
					toast.success(`${done.join(". ")}.`);
				},
				onError: (error) => {
					setPending(null);
					toast.error(
						getErrorMessage(error, "The changes could not be applied."),
					);
				},
			},
		);

	return (
		<div className="flex flex-col gap-6">
			<StatusCard
				report={report}
				fixes={fixes}
				checking={reportQuery.isFetching}
				onApproveAll={() => setPending(fixes)}
				onRecheck={() => {
					void reportQuery.refetch();
				}}
			/>
			<section
				aria-labelledby="persistence-map"
				className="flex flex-col gap-5 rounded-lg border border-solid border-border p-6"
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="persistence-map" className="m-0 text-base font-semibold">
						Database map
					</h2>
					<div className="flex items-center gap-3">
						<LiveStatus paused={paused} updatedAt={reportQuery.dataUpdatedAt} />
						<Button
							size="sm"
							variant="outline"
							aria-pressed={paused}
							onClick={() => setPaused(!paused)}
						>
							{paused ? "Resume" : "Pause"}
						</Button>
					</div>
				</div>
				{reportQuery.error ? (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						The latest re-check failed:{" "}
						{getErrorMessage(reportQuery.error, "unknown error")}
					</p>
				) : null}
				<PersistenceMap report={report} />
			</section>
			{!report.facts.operator.installed && report.mode !== "external" && (
				<OperatorSetupCard />
			)}
			<ChecksCard
				report={report}
				checkedAt={reportQuery.dataUpdatedAt}
				onFix={(fix) => setPending([fix])}
			/>
			{report.mode !== "external" && (
				<ClusterSettingsCard
					report={report}
					settings={settings}
					nothingToApply={!formFixes.length}
					onChange={(change) => setDraft({ ...settings, ...change })}
					onReset={() => setDraft(null)}
					onApply={() => setPending(formFixes)}
				/>
			)}
			{report.facts.cluster && <InstancesTable report={report} />}
			<StorageClassesTable report={report} />
			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={pending !== null}
				title="Apply these changes?"
				confirmText="Apply"
				confirmLoading={apply.isPending}
				description={
					<div className="flex flex-col gap-3">
						<ul className="m-0 pl-5">
							{pending?.map((fix) => (
								<li key={fix}>{FIX_LABELS[fix]}</li>
							))}
						</ul>
						<p className="m-0 text-sm">
							Cluster <code>{settings.clusterName}</code>: {settings.instances}{" "}
							{settings.instances === 1 ? "instance" : "instances"},{" "}
							{settings.storageSize} each
							{settings.storageClass ? ` on ${settings.storageClass}` : ""}
							{pending?.includes("cnpg.backup")
								? `, snapshots with ${settings.snapshotClass || "the first snapshot class"} on ${settings.backupSchedule}`
								: ""}
							.
						</p>
						{pending?.includes("cnpg.cluster") && (
							<p className="m-0 text-sm">
								The new cluster starts empty. Coder keeps using its current
								database until its data is copied over and{" "}
								<code>CODER_PG_CONNECTION_URL</code> points at the{" "}
								<code>{settings.clusterName}-app</code> Secret.
							</p>
						)}
						{report.facts.cluster?.managedBy &&
							report.facts.cluster.managedBy !== "General > Persistence" && (
								<p className="m-0 text-sm">
									The cluster is managed by {report.facts.cluster.managedBy}:
									make the same change there, or its next deploy undoes it.
								</p>
							)}
					</div>
				}
				onClose={() => setPending(null)}
				onConfirm={() => pending && applyFixes(pending)}
			/>
		</div>
	);
};

type StatusCardProps = {
	report: PersistenceReport;
	fixes: PersistenceFix[];
	checking: boolean;
	onApproveAll: () => void;
	onRecheck: () => void;
};

const StatusCard: React.FC<StatusCardProps> = ({
	report,
	fixes,
	checking,
	onApproveAll,
	onRecheck,
}) => {
	const { checks, facts } = report;
	const level = worstCheckStatus(checks);
	const problems = checks.filter(
		(c) => c.status === "error" || c.status === "warn",
	).length;
	const db = facts.coderDatabase;
	const factRows: [string, string | null | undefined][] = [
		["Backed by", facts.provider],
		[
			"Database",
			db.host ? `${db.host}:${db.port ?? 5432}/${db.database ?? ""}` : null,
		],
		[
			"Cluster",
			facts.cluster
				? `${facts.cluster.namespace}/${facts.cluster.name} (${facts.cluster.phase ?? "phase unknown"})`
				: null,
		],
		[
			"Operator",
			facts.operator.installed
				? `CloudNativePG ${facts.operator.version ?? ""} ${facts.operator.namespace ? `in ${facts.operator.namespace}` : ""}`
				: "not installed",
		],
		["Managed by", facts.cluster?.managedBy],
	];

	return (
		<section
			aria-labelledby="persistence-status"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex items-start gap-4">
				<span
					aria-hidden
					className={cn(
						"mt-1.5 size-3 shrink-0 rounded-full",
						level === "error"
							? "bg-content-destructive"
							: level === "warn"
								? "bg-content-warning"
								: "bg-content-success",
					)}
				/>
				<div>
					<h2 id="persistence-status" className="m-0 text-base font-semibold">
						{level === "ok"
							? "Coder's data is replicated and backed up"
							: `${problems} ${problems === 1 ? "thing needs" : "things need"} attention`}
					</h2>
					<p className="m-0 text-sm text-content-secondary">
						{level === "ok"
							? "Everything below was checked just now."
							: !facts.operator.installed && report.mode !== "external"
								? "Install the CloudNativePG operator (below), then create Coder's cluster here."
								: fixes.length
									? "Review the suggestions below, then approve them. Nothing changes until you do."
									: "These cannot be fixed from here; the details below say what to do."}
					</p>
				</div>
			</div>
			<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
				{factRows.map(([key, value]) => (
					<div key={key} className="contents">
						<dt className="text-content-secondary">{key}</dt>
						<dd className="m-0 break-all">{value || "N/A"}</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					disabled={!fixes.length}
					title={fixes.map((fix) => FIX_LABELS[fix]).join("\n")}
					onClick={onApproveAll}
				>
					{fixes.length
						? `Approve suggested fixes (${fixes.length})`
						: "Nothing to fix"}
				</Button>
				<Button variant="outline" disabled={checking} onClick={onRecheck}>
					<Spinner loading={checking} />
					Re-check
				</Button>
			</div>
		</section>
	);
};

const CHECK_GROUPS = [
	"Database",
	"Operator",
	"High availability",
	"Storage",
	"Backups",
];

type ChecksCardProps = {
	report: PersistenceReport;
	checkedAt: number;
	onFix: (fix: PersistenceFix) => void;
};

const ChecksCard: React.FC<ChecksCardProps> = ({
	report,
	checkedAt,
	onFix,
}) => (
	<section
		aria-labelledby="persistence-checks"
		className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
	>
		<div className="flex flex-wrap items-center justify-between gap-3">
			<h2 id="persistence-checks" className="m-0 text-base font-semibold">
				What was found
			</h2>
			{checkedAt > 0 && (
				<span className="text-xs text-content-secondary" data-pixel="ignore">
					Checked {new Date(checkedAt).toLocaleTimeString("en-US")}
				</span>
			)}
		</div>
		{CHECK_GROUPS.map((group) => {
			const checks = report.checks.filter((c) => c.group === group);
			if (!checks.length) {
				return null;
			}
			return (
				<div key={group} className="flex flex-col gap-2">
					<h3 className="m-0 text-sm font-semibold">{group}</h3>
					{checks.map((check) => (
						<CheckRow key={check.id} check={check} onFix={onFix} />
					))}
				</div>
			);
		})}
	</section>
);

const CheckRow: React.FC<{
	check: PersistenceCheck;
	onFix: (fix: PersistenceFix) => void;
}> = ({ check, onFix }) => (
	<div className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-md border border-solid border-border p-3">
		<Badge size="xs" variant={CHECK_STATUS_VARIANTS[check.status]}>
			{CHECK_STATUS_LABELS[check.status]}
		</Badge>
		<div className="flex min-w-0 flex-col gap-1">
			<span className="text-sm font-medium">{check.title}</span>
			{(check.current || check.expected) && (
				<span className="flex flex-wrap items-center gap-2 font-mono text-xs [overflow-wrap:anywhere]">
					{check.current && <span>{check.current}</span>}
					{check.expected && (
						<>
							<span aria-hidden className="text-content-secondary">
								→
							</span>
							<span className="text-content-success">{check.expected}</span>
						</>
					)}
				</span>
			)}
			{check.detail && (
				<p className="m-0 text-xs text-content-secondary">{check.detail}</p>
			)}
		</div>
		{check.fix === "cnpg.operator" ? (
			<span className="text-xs text-content-secondary">Set up below</span>
		) : check.fix ? (
			<Button
				size="sm"
				variant="outline"
				onClick={() => {
					if (check.fix && check.fix !== "cnpg.operator") {
						onFix(check.fix);
					}
				}}
			>
				Fix
			</Button>
		) : (
			<span />
		)}
	</div>
);
