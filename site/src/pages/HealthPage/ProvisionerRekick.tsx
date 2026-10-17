import { RotateCcwIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type {
	ProvisionerJobState,
	ProvisionersRekickResult,
	TerraformProcess,
} from "#/api/platform";
import {
	provisioners,
	rekickProvisioners,
	restartCoderPod,
} from "#/api/queries/platform";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";

/** "1h 05m", "3m 20s", "45s". */
export const formatAge = (seconds: number): string => {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) {
		return `${h}h ${String(m).padStart(2, "0")}m`;
	}
	if (m > 0) {
		return `${m}m ${String(s).padStart(2, "0")}s`;
	}
	return `${s}s`;
};

const jobLabel = (job: ProvisionerJobState) =>
	job.workspace
		? `${job.workspace} (${job.template ?? "workspace"})`
		: (job.template ?? job.type);

/**
 * Provisioner Daemons' re-kick: the jobs waiting, running or being
 * cancelled, how long each has run, and the terraform processes in each of
 * Coder's pods. A job that runs past the stuck mark (a build whose workspace
 * was deleted while its node could not take it waits forever) can be
 * re-kicked: cancelled through Coder, then its terraform stopped in the pod,
 * so its daemon fails it and takes the next job. A daemon that a re-kick does
 * not free is restarted with its pod.
 */
export const ProvisionerRekick: React.FC = () => {
	const queryClient = useQueryClient();
	const { data: report, error, isLoading } = useQuery(provisioners());
	const rekick = useMutation(rekickProvisioners(queryClient));
	const restart = useMutation(restartCoderPod(queryClient));
	const [result, setResult] = useState<ProvisionersRekickResult>();
	const [restarting, setRestarting] = useState<string>();

	const run = async (jobs: string[]) => {
		try {
			const out = await rekick.mutateAsync(jobs);
			setResult(out);
			if (out.stillRunning.length) {
				toast.warning(
					"Re-kicked, but a job is still running: its daemon may need its pod restarted.",
				);
			} else {
				toast.success(
					`Re-kicked: ${out.cancelled.length} cancelled, ${out.stopped.length} terraform process${out.stopped.length === 1 ? "" : "es"} stopped.`,
				);
			}
		} catch (e) {
			toast.error(getErrorMessage(e, "The re-kick failed."));
		}
	};

	if (isLoading) {
		return <Spinner loading />;
	}
	if (error || !report) {
		return <ErrorAlert error={error} />;
	}
	const stuck = report.jobs.filter((j) => j.stuck);
	const busy = rekick.isPending;

	return (
		<section
			className="flex flex-col gap-4"
			data-testid="provisioner-rekick"
			aria-label="Jobs and terraform processes"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h3 className="m-0 text-base font-medium">Jobs</h3>
					<p className="m-0 mt-1 text-sm text-content-secondary">
						A job running longer than {formatAge(report.stuckAfterSeconds)} is
						stuck: re-kicking cancels it and stops its terraform, so its daemon
						takes the next job.
					</p>
				</div>
				<Button
					disabled={stuck.length === 0 || busy}
					onClick={() => run(stuck.map((j) => j.id))}
				>
					<Spinner loading={busy}>
						<ZapIcon />
					</Spinner>
					Re-kick stuck jobs{stuck.length ? ` (${stuck.length})` : ""}
				</Button>
			</div>

			<Table aria-label="Provisioner jobs">
				<TableHeader>
					<TableRow>
						<TableHead>Job</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Running for</TableHead>
						<TableHead className="w-1" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{report.jobs.length === 0 ? (
						<TableRow>
							<TableCell colSpan={4} className="text-content-secondary">
								No job is waiting or running.
							</TableCell>
						</TableRow>
					) : (
						report.jobs.map((job) => (
							<TableRow key={job.id} data-testid="provisioner-job">
								<TableCell>
									<div className="font-medium">{jobLabel(job)}</div>
									<div className="text-xs text-content-secondary">
										{job.type.replaceAll("_", " ")} · {job.organization}
									</div>
								</TableCell>
								<TableCell>
									<span className="flex items-center gap-2 capitalize">
										{job.status}
										{job.stuck && <Badge variant="warning">Stuck</Badge>}
									</span>
								</TableCell>
								<TableCell className="tabular-nums">
									{formatAge(job.ageSeconds)}
								</TableCell>
								<TableCell>
									{job.status !== "pending" && (
										<Button
											size="sm"
											variant={job.stuck ? "default" : "outline"}
											disabled={busy}
											onClick={() => run([job.id])}
										>
											<ZapIcon />
											Re-kick
										</Button>
									)}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>

			{result && <RekickResult result={result} />}

			<div className="flex flex-col gap-2">
				<h3 className="m-0 text-base font-medium">Terraform in Coder's pods</h3>
				{Object.entries(report.pods).map(([pod, procs]) => (
					<PodProcesses
						key={pod}
						pod={pod}
						procs={procs}
						onRestart={() => setRestarting(pod)}
					/>
				))}
			</div>

			<ConfirmDialog
				type="delete"
				open={Boolean(restarting)}
				title={`Restart ${restarting ?? ""}?`}
				description="The pod is deleted and its Deployment starts another: for about half a minute Coder answers from its other pods only (with one pod, not at all), and open terminals and apps reconnect. Its provisioner daemons start afresh."
				confirmText="Restart"
				confirmLoading={restart.isPending}
				onClose={() => setRestarting(undefined)}
				onConfirm={async () => {
					if (!restarting) {
						return;
					}
					try {
						await restart.mutateAsync(restarting);
						toast.success(`${restarting} is restarting.`);
						setRestarting(undefined);
					} catch (e) {
						toast.error(getErrorMessage(e, "The pod could not be restarted."));
					}
				}}
			/>
		</section>
	);
};

const RekickResult: React.FC<{ result: ProvisionersRekickResult }> = ({
	result,
}) => (
	<Alert
		severity={
			result.stillRunning.length || result.errors.length ? "warning" : "success"
		}
	>
		<AlertTitle>
			{result.stillRunning.length
				? "Still running after the re-kick"
				: "Re-kicked"}
		</AlertTitle>
		<AlertDescription>
			{result.cancelled.length} cancelled
			{result.cancelled.some((c) => c.error) &&
				` (${result.cancelled
					.filter((c) => c.error)
					.map((c) => `${c.workspace ?? c.id}: ${c.error}`)
					.join("; ")})`}
			, {result.stopped.length} terraform process
			{result.stopped.length === 1 ? "" : "es"} stopped
			{result.stopped.length > 0 &&
				` (${result.stopped.map((p) => `${p.pod} pid ${p.pid}`).join(", ")})`}
			.
			{result.stillRunning.length > 0 &&
				" Its daemon did not let go: restart its pod below."}
			{result.errors.length > 0 && ` ${result.errors.join("; ")}`}
		</AlertDescription>
	</Alert>
);

type PodProcessesProps = {
	pod: string;
	procs: TerraformProcess[] | { error: string };
	onRestart: () => void;
};

const PodProcesses: React.FC<PodProcessesProps> = ({
	pod,
	procs,
	onRestart,
}) => (
	<div
		className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-solid border-border px-4 py-3"
		data-testid="coder-pod"
	>
		<div className="min-w-0">
			<div className="font-mono text-sm">{pod}</div>
			<div className="text-xs text-content-secondary">
				{"error" in procs
					? `Its processes could not be read: ${procs.error}`
					: procs.length === 0
						? "No terraform running"
						: procs
								.map(
									(p) =>
										`${p.command || "terraform"} ${formatAge(p.ageSeconds)}${p.defunct ? " (defunct)" : ""}`,
								)
								.join(" · ")}
			</div>
		</div>
		<Button size="sm" variant="outline" onClick={onRestart}>
			<RotateCcwIcon />
			Restart pod
		</Button>
	</div>
);
