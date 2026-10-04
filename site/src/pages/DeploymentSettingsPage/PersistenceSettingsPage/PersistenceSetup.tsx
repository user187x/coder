import { useId } from "react";
import type { PersistenceReport, PersistenceSettings } from "#/api/platform";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { parseQuantity } from "./persistenceFixes";

const OPERATOR_STEPS: { title: string; detail: string; code: string }[] = [
	{
		title: "Air-gapped coder-platform bundle",
		detail:
			"The bundle carries the operator's chart and images. With DEPLOY=helm, deploy installs it as release cnpg in cnpg-system.",
		code: "./install deploy",
	},
	{
		title: "Helm, with access to the chart repository",
		detail: "Installs the operator and its CRDs into cnpg-system.",
		code: "helm upgrade --install cnpg cloudnative-pg --repo https://cloudnative-pg.github.io/charts --namespace cnpg-system --create-namespace --wait",
	},
	{
		title: "Helm, from a local chart and registry",
		detail:
			"For an offline cluster: the chart file from the bundle and the operator image pushed to your registry.",
		code: "helm upgrade --install cnpg charts/cloudnative-pg-*.tgz --namespace cnpg-system --create-namespace --set image.repository=$REGISTRY/cloudnative-pg/cloudnative-pg --wait",
	},
	{
		title: "Check that it runs",
		detail:
			"The operator is ready when its Deployment is available; then Re-check here.",
		code: "kubectl -n cnpg-system rollout status deploy/cloudnative-pg",
	},
];

/**
 * Shown while the CloudNativePG operator is missing: it needs cluster-admin
 * rights (CRDs, webhooks), so an administrator installs it once; everything
 * after that is done from this page.
 */
export const OperatorSetupCard: React.FC = () => {
	const id = useId();
	return (
		<section
			aria-labelledby={`${id}-operator`}
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id={`${id}-operator`} className="m-0 text-base font-semibold">
					Set up the operator
				</h2>
				<Badge variant="destructive">not installed</Badge>
			</div>
			<p className="m-0 text-sm text-content-secondary">
				CloudNativePG runs PostgreSQL inside Kubernetes: a primary and streaming
				replicas, automatic fail-over, volume management and backups. It adds
				cluster-wide resources (CRDs and a webhook), so a cluster administrator
				installs it once with one of these. This page then creates and manages
				Coder's database cluster.
			</p>
			<ol className="m-0 flex flex-col gap-4 pl-5">
				{OPERATOR_STEPS.map((step) => (
					<li key={step.title} className="flex flex-col gap-1.5">
						<span className="text-sm font-medium">{step.title}</span>
						<span className="text-xs text-content-secondary">
							{step.detail}
						</span>
						<CodeExample secret={false} code={step.code} />
					</li>
				))}
			</ol>
		</section>
	);
};

const DEFAULT_CLASS = "__default";

type ClusterSettingsCardProps = {
	report: PersistenceReport;
	settings: PersistenceSettings;
	onChange: (change: Partial<PersistenceSettings>) => void;
	onReset: () => void;
	onApply: () => void;
	/** No fix follows from the form as it is. */
	nothingToApply: boolean;
};

/** The cluster's shape: create it, or change instances, storage and backups. */
export const ClusterSettingsCard: React.FC<ClusterSettingsCardProps> = ({
	report,
	settings,
	onChange,
	onReset,
	onApply,
	nothingToApply,
}) => {
	const id = useId();
	const { cluster, storageClasses, snapshotClasses, operator } = report.facts;
	const sizeValid = (parseQuantity(settings.storageSize) ?? 0) >= 2 ** 30;
	const instancesValid =
		Number.isInteger(settings.instances) &&
		settings.instances >= 1 &&
		settings.instances <= 9;

	return (
		<section
			aria-labelledby={`${id}-settings`}
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id={`${id}-settings`} className="m-0 text-base font-semibold">
					{cluster ? "Cluster settings" : "Create Coder's database cluster"}
				</h2>
				<span className="text-xs text-content-secondary">
					{cluster
						? "The name and storage class are fixed once the cluster exists; storage can only grow."
						: "Suggested values are filled in."}
				</span>
			</div>
			<form
				autoComplete="off"
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					onApply();
				}}
			>
				<div className="grid gap-4 md:grid-cols-3">
					<Field id={`${id}-name`} label="Cluster name">
						<Input
							id={`${id}-name`}
							value={settings.clusterName}
							disabled={Boolean(cluster)}
							onChange={(event) =>
								onChange({ clusterName: event.target.value.trim() })
							}
						/>
					</Field>
					<Field
						id={`${id}-instances`}
						label="Instances"
						hint="1 primary + replicas. 3 survives losing any one."
						error={instancesValid ? undefined : "Between 1 and 9."}
					>
						<Input
							id={`${id}-instances`}
							type="number"
							min={1}
							max={9}
							value={settings.instances}
							onChange={(event) =>
								onChange({ instances: Number(event.target.value) })
							}
						/>
					</Field>
					<Field
						id={`${id}-size`}
						label="Storage per instance"
						hint="A Kubernetes quantity, e.g. 20Gi."
						error={sizeValid ? undefined : "At least 1Gi, e.g. 20Gi."}
					>
						<Input
							id={`${id}-size`}
							value={settings.storageSize}
							onChange={(event) =>
								onChange({ storageSize: event.target.value.trim() })
							}
						/>
					</Field>
					<Field id={`${id}-class`} label="Storage class">
						<Select
							value={settings.storageClass || DEFAULT_CLASS}
							disabled={Boolean(cluster)}
							onValueChange={(value) =>
								onChange({ storageClass: value === DEFAULT_CLASS ? "" : value })
							}
						>
							<SelectTrigger id={`${id}-class`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={DEFAULT_CLASS}>
									The cluster's default
								</SelectItem>
								{storageClasses.map((c) => (
									<SelectItem key={c.name} value={c.name}>
										{c.name} ({c.label}
										{c.isDefault ? ", default" : ""})
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field
						id={`${id}-snapshot`}
						label="Backups: snapshot class"
						hint={
							snapshotClasses.length
								? undefined
								: "No VolumeSnapshotClass in this cluster."
						}
					>
						<Select
							value={settings.snapshotClass || DEFAULT_CLASS}
							disabled={!snapshotClasses.length}
							onValueChange={(value) =>
								onChange({
									snapshotClass: value === DEFAULT_CLASS ? "" : value,
								})
							}
						>
							<SelectTrigger id={`${id}-snapshot`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={DEFAULT_CLASS}>No backups</SelectItem>
								{snapshotClasses.map((name) => (
									<SelectItem key={name} value={name}>
										{name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field
						id={`${id}-schedule`}
						label="Backup schedule"
						hint="Six cron fields, seconds first: 0 0 2 * * * is daily at 02:00."
					>
						<Input
							id={`${id}-schedule`}
							value={settings.backupSchedule}
							disabled={!settings.snapshotClass}
							onChange={(event) =>
								onChange({ backupSchedule: event.target.value })
							}
						/>
					</Field>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="submit"
						disabled={
							!operator.installed ||
							nothingToApply ||
							!sizeValid ||
							!instancesValid
						}
					>
						{cluster ? "Apply these settings" : "Create the cluster"}
					</Button>
					<Button variant="outline" onClick={onReset}>
						Back to suggested values
					</Button>
					{!operator.installed && (
						<span className="text-xs text-content-secondary">
							Install the operator first.
						</span>
					)}
				</div>
			</form>
		</section>
	);
};

const Field: React.FC<{
	id: string;
	label: string;
	hint?: string;
	error?: string;
	children: React.ReactNode;
}> = ({ id, label, hint, error, children }) => (
	<div className="flex flex-col gap-1.5">
		<Label htmlFor={id}>{label}</Label>
		{children}
		{error ? (
			<span className="text-xs text-content-destructive">{error}</span>
		) : (
			hint && <span className="text-xs text-content-secondary">{hint}</span>
		)}
	</div>
);
