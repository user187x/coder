import {
	DatabaseBackupIcon,
	DownloadIcon,
	PlayIcon,
	PlugZapIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type DrTarget,
	type DrTargetInput,
	type DrView,
	PlatformAPI,
} from "#/api/platform";
import { Alert, AlertDescription } from "#/components/Alert/Alert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";

const drKey = ["platform", "persistence", "dr"] as const;

const formatBytes = (n: number | null | undefined) => {
	if (n === null || n === undefined) {
		return "–";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let v = n;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
};

const when = (t?: number) =>
	t ? new Date(t * 1000).toLocaleString() : "never";

const blank = (kind: "s3" | "postgres"): DrTargetInput => ({
	kind,
	name: kind === "s3" ? "Offsite bucket" : "Standby database",
	enabled: true,
	everyHours: 24,
	keep: 14,
	prefix: "coder-db/",
});

/**
 * Persistence > Disaster recovery: Coder's database outside the cluster - a
 * dump to download now, dumps into an S3 bucket every N hours (the newest
 * kept), or a copy into an external PostgreSQL every N hours (which then holds
 * what Coder's held). The dumps run in the database's primary instance.
 */
export const DisasterRecoveryCard: React.FC = () => {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: drKey,
		queryFn: PlatformAPI.getDisasterRecovery,
		refetchInterval: (q: { state: { data?: DrView } }) =>
			q.state.data?.running ? 3_000 : 30_000,
	});
	const [editing, setEditing] = useState<DrTargetInput | null>(null);
	const [deleting, setDeleting] = useState<DrTarget | null>(null);
	const setView = (view: DrView) => queryClient.setQueryData(drKey, view);
	const run = useMutation({
		mutationFn: PlatformAPI.runDrTarget,
		onSuccess: (view) => {
			setView(view);
			toast.info("Under way: its result shows in Recent copies.");
		},
		onError: (e) => toast.error(getErrorMessage(e, "It did not start.")),
	});
	const remove = useMutation({
		mutationFn: PlatformAPI.deleteDrTarget,
		onSuccess: (view) => {
			setView(view);
			setDeleting(null);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not deleted.")),
	});
	const view = query.data;

	return (
		<section
			aria-labelledby="persistence-dr"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
			data-testid="disaster-recovery"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<DatabaseBackupIcon
						aria-hidden
						className="size-5 text-content-secondary"
					/>
					<h2 id="persistence-dr" className="m-0 text-base font-semibold">
						Disaster recovery
					</h2>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={!view?.available}
						asChild={Boolean(view?.available)}
					>
						{view?.available ? (
							<a href={PlatformAPI.drDumpUrl()} download>
								<DownloadIcon />
								Download a dump
							</a>
						) : (
							<span>
								<DownloadIcon />
								Download a dump
							</span>
						)}
					</Button>
					<Button size="sm" onClick={() => setEditing(blank("s3"))}>
						<PlusIcon />
						Add a target
					</Button>
				</div>
			</div>
			<p className="m-0 text-sm text-content-secondary">
				Coder's database copied outside the cluster, besides its backups in it:
				a dump (pg_dump, custom format) to download now, dumps into an S3
				bucket, or a copy into an external PostgreSQL that then holds what
				Coder's held. Restore a dump with{" "}
				<span className="font-mono text-xs">
					pg_restore --clean --if-exists --no-owner -d &lt;database&gt;
					coder-db-….dump
				</span>
				.
			</p>
			{query.isLoading ? (
				<Spinner loading />
			) : !view ? (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{getErrorMessage(query.error, "Disaster recovery could not be read.")}
				</p>
			) : (
				<>
					{!view.available && (
						<Alert severity="info">
							<AlertDescription>{view.unavailable}</AlertDescription>
						</Alert>
					)}
					{view.targets.length > 0 && (
						<Table aria-label="Disaster recovery targets">
							<TableHeader>
								<TableRow>
									<TableHead>Target</TableHead>
									<TableHead>Schedule</TableHead>
									<TableHead>Last copy</TableHead>
									<TableHead className="w-1" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{view.targets.map((t) => (
									<TableRow key={t.id} data-testid="dr-target">
										<TableCell>
											<div className="font-medium">{t.name}</div>
											<div className="text-xs text-content-secondary">
												{t.kind === "s3"
													? `S3 ${t.bucket}/${t.prefix ?? ""} · keeps ${t.keep}`
													: `PostgreSQL ${t.where}`}
											</div>
										</TableCell>
										<TableCell className="text-sm">
											{!t.enabled
												? "Off"
												: t.everyHours
													? `Every ${t.everyHours} h`
													: "On demand"}
										</TableCell>
										<TableCell className="text-sm">
											{when(t.lastSuccess)}
											{t.lastRun && t.lastRun !== t.lastSuccess && (
												<Badge variant="warning" className="ml-2">
													last failed
												</Badge>
											)}
										</TableCell>
										<TableCell>
											<div className="flex justify-end gap-1">
												<Button
													size="sm"
													variant="outline"
													disabled={
														!view.available ||
														Boolean(view.running) ||
														run.isPending
													}
													onClick={() => run.mutate(t.id)}
												>
													<PlayIcon />
													Run now
												</Button>
												<Button
													size="sm"
													variant="subtle"
													onClick={() =>
														setEditing({
															...t,
															kind: t.kind,
														} as DrTargetInput)
													}
												>
													Edit
												</Button>
												<Button
													size="icon"
													variant="subtle"
													aria-label={`Delete ${t.name}`}
													onClick={() => setDeleting(t)}
												>
													<Trash2Icon />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
					{view.running && (
						<p
							className="m-0 flex items-center gap-2 text-sm"
							aria-live="polite"
						>
							<Spinner loading /> Copying to {view.running.name}…
						</p>
					)}
					{view.runs.length > 0 && (
						<div className="flex flex-col gap-2">
							<h3 className="m-0 text-sm font-semibold">Recent copies</h3>
							<ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
								{view.runs.slice(0, 8).map((r) => (
									<li key={r.id} className="flex flex-wrap gap-x-3">
										<span
											className={
												r.ok
													? "text-content-success"
													: "text-content-destructive"
											}
										>
											{r.ok ? "OK" : "Failed"}
										</span>
										<span>{new Date(r.at * 1000).toLocaleString()}</span>
										<span>{r.name}</span>
										<span className="text-content-secondary">
											{formatBytes(r.bytes)} · {r.seconds ?? "–"} s · {r.by}
										</span>
										{r.error && (
											<span className="text-content-destructive">
												{r.error}
											</span>
										)}
									</li>
								))}
							</ul>
						</div>
					)}
				</>
			)}
			{editing && (
				<TargetDialog
					initial={editing}
					onClose={() => setEditing(null)}
					onSaved={(v) => {
						setView(v);
						setEditing(null);
					}}
				/>
			)}
			<ConfirmDialog
				type="delete"
				hideCancel={false}
				open={Boolean(deleting)}
				title={`Delete ${deleting?.name ?? ""}?`}
				description="Its copies stay where they are; nothing is sent there any more."
				confirmText="Delete"
				confirmLoading={remove.isPending}
				onClose={() => setDeleting(null)}
				onConfirm={() => deleting && remove.mutate(deleting.id)}
			/>
		</section>
	);
};

const Field: React.FC<{
	id: string;
	label: string;
	hint?: string;
	children: React.ReactNode;
}> = ({ id, label, hint, children }) => (
	<div className="flex flex-col gap-1">
		<Label htmlFor={id}>{label}</Label>
		{children}
		{hint && <span className="text-xs text-content-secondary">{hint}</span>}
	</div>
);

const TargetDialog: React.FC<{
	initial: DrTargetInput;
	onClose: () => void;
	onSaved: (view: DrView) => void;
}> = ({ initial, onClose, onSaved }) => {
	const [t, setT] = useState<DrTargetInput>(initial);
	const set = (patch: Partial<DrTargetInput>) =>
		setT((cur) => ({ ...cur, ...patch }));
	const save = useMutation({
		mutationFn: () => PlatformAPI.saveDrTarget(t),
		onSuccess: (view) => {
			toast.success(`${t.name} saved.`);
			onSaved(view);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not saved.")),
	});
	const test = useMutation({
		mutationFn: () => PlatformAPI.testDrTarget(t),
		onSuccess: (r) => (r.ok ? toast.success(r.detail) : toast.error(r.detail)),
		onError: (e) => toast.error(getErrorMessage(e, "Not reached.")),
	});
	const editing = Boolean(initial.id);
	return (
		<ConfirmDialog
			type="info"
			hideCancel={false}
			open
			title={editing ? `Edit ${initial.name}` : "A disaster recovery target"}
			confirmText="Save"
			confirmLoading={save.isPending}
			onClose={onClose}
			onConfirm={() => save.mutate()}
			description={
				<div className="flex flex-col gap-4 text-left">
					{!editing && (
						<RadioGroup
							value={t.kind}
							onValueChange={(v) => setT({ ...blank(v as "s3" | "postgres") })}
							className="flex gap-6"
							aria-label="Where to"
						>
							<span className="flex items-center gap-2">
								<RadioGroupItem value="s3" id="dr-kind-s3" />
								<Label htmlFor="dr-kind-s3">An S3 bucket (dumps)</Label>
							</span>
							<span className="flex items-center gap-2">
								<RadioGroupItem value="postgres" id="dr-kind-pg" />
								<Label htmlFor="dr-kind-pg">
									An external PostgreSQL (a copy)
								</Label>
							</span>
						</RadioGroup>
					)}
					<Field id="dr-name" label="Name">
						<Input
							id="dr-name"
							value={t.name}
							onChange={(e) => set({ name: e.target.value })}
						/>
					</Field>
					{t.kind === "s3" ? (
						<div className="grid gap-3 sm:grid-cols-2">
							<Field id="dr-endpoint" label="Endpoint">
								<Input
									id="dr-endpoint"
									placeholder="https://s3.example.internal"
									value={t.endpoint ?? ""}
									onChange={(e) => set({ endpoint: e.target.value })}
								/>
							</Field>
							<Field id="dr-region" label="Region" hint="Empty: us-east-1">
								<Input
									id="dr-region"
									value={t.region ?? ""}
									onChange={(e) => set({ region: e.target.value })}
								/>
							</Field>
							<Field id="dr-bucket" label="Bucket">
								<Input
									id="dr-bucket"
									value={t.bucket ?? ""}
									onChange={(e) => set({ bucket: e.target.value })}
								/>
							</Field>
							<Field id="dr-prefix" label="Prefix">
								<Input
									id="dr-prefix"
									value={t.prefix ?? ""}
									onChange={(e) => set({ prefix: e.target.value })}
								/>
							</Field>
							<Field id="dr-access" label="Access key">
								<Input
									id="dr-access"
									value={t.accessKey ?? ""}
									onChange={(e) => set({ accessKey: e.target.value })}
								/>
							</Field>
							<Field
								id="dr-secret"
								label="Secret key"
								hint={editing ? "Empty: the saved one" : undefined}
							>
								<Input
									id="dr-secret"
									type="password"
									autoComplete="off"
									value={t.secretKey ?? ""}
									onChange={(e) => set({ secretKey: e.target.value })}
								/>
							</Field>
							<Field id="dr-keep" label="Dumps kept">
								<Input
									id="dr-keep"
									type="number"
									min={1}
									max={1000}
									value={t.keep ?? 14}
									onChange={(e) => set({ keep: Number(e.target.value) })}
								/>
							</Field>
							<Field
								id="dr-ca"
								label="CA certificate (PEM)"
								hint="For a bucket behind a private CA; empty: the system's"
							>
								<textarea
									id="dr-ca"
									className="min-h-16 rounded-md border border-solid border-border bg-transparent p-2 font-mono text-xs text-content-primary"
									value={t.caCert ?? ""}
									onChange={(e) => set({ caCert: e.target.value })}
								/>
							</Field>
						</div>
					) : (
						<Field
							id="dr-url"
							label="Database"
							hint={
								editing
									? "Empty: the saved one. Its tables are replaced at each copy."
									: "postgresql://user:password@host:5432/dbname?sslmode=require - its tables are replaced at each copy."
							}
						>
							<Input
								id="dr-url"
								type="password"
								autoComplete="off"
								value={t.url ?? ""}
								onChange={(e) => set({ url: e.target.value })}
							/>
						</Field>
					)}
					<div className="flex flex-wrap items-end gap-6">
						<Field id="dr-every" label="Every (hours)" hint="0: on demand only">
							<Input
								id="dr-every"
								type="number"
								min={0}
								max={168}
								className="w-28"
								value={t.everyHours}
								onChange={(e) => set({ everyHours: Number(e.target.value) })}
							/>
						</Field>
						<span className="flex items-center gap-2 pb-2">
							<Switch
								id="dr-enabled"
								checked={t.enabled}
								onCheckedChange={(enabled) => set({ enabled })}
							/>
							<Label htmlFor="dr-enabled">On</Label>
						</span>
						<Button
							variant="outline"
							size="sm"
							className="mb-1"
							disabled={test.isPending}
							onClick={() => test.mutate()}
						>
							<Spinner loading={test.isPending}>
								<PlugZapIcon />
							</Spinner>
							Test
						</Button>
					</div>
				</div>
			}
		/>
	);
};
