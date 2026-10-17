import { cn } from "cn";
import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	type CloudDriveBackend,
	type CloudDriveStatus,
	PlatformAPI,
	type CloudDriveSettings as Settings,
} from "#/api/platform";
import { safeKey } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Slider } from "#/components/Slider/Slider";
import { Spinner } from "#/components/Spinner/Spinner";
import { homePath } from "./CloudDriveBrowser";

const ago = (unixSeconds: number | null) => {
	if (!unixSeconds) {
		return "";
	}
	const s = Math.max(0, Math.round(Date.now() / 1000 - unixSeconds));
	return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

/** Connected or not: a dot, and what it means. */
export const StatusIndicator: React.FC<{
	status: CloudDriveStatus | undefined;
	compact?: boolean;
}> = ({ status, compact = false }) => {
	const state =
		status?.connected === true
			? "connected"
			: status?.connected === false
				? "disconnected"
				: "unknown";
	const label =
		state === "connected"
			? "Connected"
			: state === "disconnected"
				? "Not connected"
				: "Checking…";
	return (
		<span
			className="inline-flex items-center gap-1.5 text-xs text-content-secondary"
			data-testid="cloud-drive-status"
			data-state={state}
			title={
				state === "disconnected"
					? (status?.error ?? "")
					: status?.latencyMs != null
						? `${status.latencyMs} ms · checked ${ago(status.checkedAt)}`
						: ""
			}
		>
			<span
				aria-hidden
				className={cn(
					"size-2 rounded-full",
					state === "connected"
						? "bg-content-success"
						: state === "disconnected"
							? "bg-content-destructive"
							: "bg-content-secondary",
				)}
			/>
			{compact ? <span className="sr-only">{label}</span> : label}
		</span>
	);
};

/**
 * Cloud Drive > Settings: where its files are (the chart's storage, or an S3
 * service an admin set here), and whether it is connected. Admins change the
 * backend - its endpoint, region, bucket and keys - after it answers (Test
 * connection), or go back to the chart's. Everyone else sees it read-only.
 */
export const CloudDriveSettings: React.FC<{ settings: Settings }> = ({
	settings,
}) => {
	const queryClient = useQueryClient();
	const custom = settings.source === "custom";
	const [form, setForm] = useState<CloudDriveBackend>({
		endpoint: custom ? settings.endpoint : "",
		region: custom ? settings.region : "",
		bucket: custom ? settings.bucket : settings.chart.bucket,
		accessKey: custom ? settings.accessKey : "",
		secretKey: "",
	});
	const [tested, setTested] = useState<CloudDriveStatus | null>(null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: safeKey });
	const check = useMutation({
		mutationFn: () => PlatformAPI.cloudDriveSettings(true),
		onSuccess: () => void refresh(),
	});
	const test = useMutation({
		mutationFn: () => PlatformAPI.testCloudDriveBackend(form),
		onSuccess: setTested,
	});
	const save = useMutation({
		mutationFn: (body: CloudDriveBackend | { reset: true }) =>
			PlatformAPI.saveCloudDriveSettings(body),
		onSuccess: () => {
			setTested(null);
			void refresh();
		},
	});
	const set = (key: keyof CloudDriveBackend) => (value: string) => {
		setTested(null);
		setForm((f) => ({ ...f, [key]: value }));
	};
	const problem = check.error ?? test.error ?? save.error;

	return (
		<div
			className="flex flex-col gap-5 px-6 py-5 text-sm"
			data-testid="cloud-drive-settings"
		>
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<h3 className="m-0 text-base font-semibold">Where your files are</h3>
					<div className="flex items-center gap-3">
						<StatusIndicator status={settings.status} />
						<Button
							size="sm"
							variant="outline"
							disabled={check.isPending}
							onClick={() => check.mutate()}
						>
							<Spinner loading={check.isPending} />
							Check now
						</Button>
					</div>
				</div>
				<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-content-secondary">
					<dt>Storage</dt>
					<dd className="m-0 text-content-primary">
						{custom
							? "An S3 service set here"
							: settings.kind === "minio"
								? "The cluster's own MinIO (the chart's)"
								: "The chart's S3 service"}
					</dd>
					<dt>Endpoint</dt>
					<dd className="m-0 break-all font-mono text-xs text-content-primary">
						{settings.endpoint}
					</dd>
					<dt>Bucket</dt>
					<dd className="m-0 font-mono text-xs text-content-primary">
						{settings.bucket}
						<span className="text-content-secondary">
							{" "}
							(each account: users/&lt;id&gt;/)
						</span>
					</dd>
					{settings.region && (
						<>
							<dt>Region</dt>
							<dd className="m-0 font-mono text-xs text-content-primary">
								{settings.region}
							</dd>
						</>
					)}
					<dt>In workspaces</dt>
					<dd className="m-0 font-mono text-xs text-content-primary">
						{homePath(settings.mountPath)}
					</dd>
					<dt>Last check</dt>
					<dd className="m-0 text-content-primary">
						{settings.status.connected
							? `Connected in ${settings.status.latencyMs} ms, ${ago(settings.status.checkedAt)}`
							: settings.status.connected === false
								? `Not connected (${ago(settings.status.checkedAt)}): ${settings.status.error}`
								: "Not checked yet"}
					</dd>
				</dl>
			</section>

			<CapacitySection settings={settings} />

			{settings.canEdit ? (
				<form
					className="flex flex-col gap-3 border-0 border-t border-solid border-border pt-5"
					onSubmit={(e) => {
						e.preventDefault();
						save.mutate(form);
					}}
				>
					<div>
						<h3 className="m-0 text-base font-semibold">
							Use another S3 service
						</h3>
						<p className="mt-1 mb-0 text-xs text-content-secondary">
							AWS S3, Ceph, another MinIO… Saved only once it answers; the
							bucket is made if it is missing. Files already stored stay where
							they are, and each workspace takes the new storage when it next
							starts. The nodes mount it from this address, so it must resolve
							outside the cluster's DNS.
						</p>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<Field id="cd-endpoint" label="Endpoint" wide>
							<Input
								id="cd-endpoint"
								placeholder="https://s3.us-east-1.amazonaws.com"
								value={form.endpoint}
								onChange={(e) => set("endpoint")(e.target.value)}
							/>
						</Field>
						<Field id="cd-bucket" label="Bucket">
							<Input
								id="cd-bucket"
								value={form.bucket}
								onChange={(e) => set("bucket")(e.target.value)}
							/>
						</Field>
						<Field id="cd-region" label="Region (if it needs one)">
							<Input
								id="cd-region"
								placeholder="us-east-1"
								value={form.region}
								onChange={(e) => set("region")(e.target.value)}
							/>
						</Field>
						<Field id="cd-access" label="Access key">
							<Input
								id="cd-access"
								autoComplete="off"
								value={form.accessKey}
								onChange={(e) => set("accessKey")(e.target.value)}
							/>
						</Field>
						<Field id="cd-secret" label="Secret key">
							<Input
								id="cd-secret"
								type="password"
								autoComplete="new-password"
								placeholder={custom && settings.hasSecret ? "unchanged" : ""}
								value={form.secretKey}
								onChange={(e) => set("secretKey")(e.target.value)}
							/>
						</Field>
					</div>
					{tested && (
						<p
							role="status"
							className={cn(
								"m-0 text-xs",
								tested.connected
									? "text-content-success"
									: "text-content-destructive",
							)}
						>
							{tested.connected
								? `It answers (${tested.latencyMs} ms)${tested.bucketExists ? "" : "; the bucket will be made"}.`
								: `No answer: ${tested.error}`}
						</p>
					)}
					{problem ? (
						<p role="alert" className="m-0 text-xs text-content-destructive">
							{getErrorMessage(problem, "That did not work.")}
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={test.isPending || !form.endpoint || !form.bucket}
							onClick={() => test.mutate()}
						>
							<Spinner loading={test.isPending} />
							Test connection
						</Button>
						<Button
							type="submit"
							size="sm"
							disabled={
								save.isPending ||
								!form.endpoint ||
								!form.bucket ||
								!form.accessKey
							}
						>
							<Spinner loading={save.isPending} />
							Save
						</Button>
						{custom && (
							<Button
								type="button"
								variant="subtle"
								size="sm"
								className="ml-auto"
								disabled={save.isPending}
								onClick={() => save.mutate({ reset: true })}
							>
								Use the chart's storage again
							</Button>
						)}
					</div>
				</form>
			) : (
				<p className="m-0 border-0 border-t border-solid border-border pt-4 text-xs text-content-secondary">
					Admins choose where Cloud Drives keep their files.
				</p>
			)}
		</div>
	);
};

const Field: React.FC<{
	id: string;
	label: string;
	wide?: boolean;
	children: React.ReactNode;
}> = ({ id, label, wide, children }) => (
	<div className={cn("flex flex-col gap-1.5", wide && "col-span-2")}>
		<Label htmlFor={id}>{label}</Label>
		{children}
	</div>
);

/** The slider's stops (GiB): fine at the small end, coarse at the large one. */
export const CAPACITY_STOPS = [
	1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500,
	750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10240,
];
const nearestStop = (gib: number) =>
	CAPACITY_STOPS.reduce(
		(best, stop, i) =>
			Math.abs(stop - gib) < Math.abs(CAPACITY_STOPS[best] - gib) ? i : best,
		0,
	);

/**
 * Every account's capacity: how much its Cloud Drive may hold (uploads past it are refused). Admins set it with the
 * slider or as a number, or go back to the chart's (userStorage.quotaGiB); everyone else sees it.
 */
const CapacitySection: React.FC<{ settings: Settings }> = ({ settings }) => {
	const queryClient = useQueryClient();
	const quota = settings.quota;
	const [gib, setGib] = useState(quota.gib);
	const save = useMutation({
		mutationFn: (body: { quotaGiB: number } | { reset: true }) =>
			PlatformAPI.saveCloudDriveQuota(body),
		onSuccess: (q) => {
			setGib(q.gib);
			void queryClient.invalidateQueries({ queryKey: safeKey });
		},
	});
	const valid = Number.isInteger(gib) && gib >= quota.min && gib <= quota.max;

	return (
		<section
			className="flex flex-col gap-3 border-0 border-t border-solid border-border pt-5"
			data-testid="cloud-drive-capacity"
		>
			<div className="flex items-center justify-between gap-3">
				<h3 className="m-0 text-base font-semibold">Capacity</h3>
				<span className="text-xs text-content-secondary">
					{quota.custom
						? `Set here (the chart's: ${quota.chartGib} GiB)`
						: "The chart's (userStorage.quotaGiB)"}
				</span>
			</div>
			{settings.canEdit ? (
				<>
					<p className="m-0 text-xs text-content-secondary">
						How much each account's Cloud Drive may hold. Uploads past it are
						refused; files already there stay.
					</p>
					<div className="flex items-center gap-4">
						<Slider
							aria-label="Capacity per account"
							min={0}
							max={CAPACITY_STOPS.length - 1}
							step={1}
							value={[nearestStop(gib)]}
							onValueChange={([i]) => setGib(CAPACITY_STOPS[i])}
							disabled={save.isPending}
							className="flex-1"
						/>
						<div className="flex items-center gap-1.5">
							<Input
								aria-label="Capacity per account, in GiB"
								type="number"
								min={quota.min}
								max={quota.max}
								step={1}
								value={Number.isFinite(gib) ? gib : ""}
								onChange={(e) => setGib(Number(e.target.value))}
								className="h-8 w-24 text-right tabular-nums"
							/>
							<span className="text-xs text-content-secondary">GiB</span>
						</div>
					</div>
					{!valid && (
						<p className="m-0 text-xs text-content-destructive">
							A whole number of {quota.min} to {quota.max} GiB.
						</p>
					)}
					{save.error ? (
						<p role="alert" className="m-0 text-xs text-content-destructive">
							{getErrorMessage(save.error, "The capacity was not saved.")}
						</p>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={!valid || gib === quota.gib || save.isPending}
							onClick={() => save.mutate({ quotaGiB: gib })}
						>
							<Spinner loading={save.isPending} />
							Save capacity
						</Button>
						{quota.custom && (
							<Button
								size="sm"
								variant="subtle"
								disabled={save.isPending}
								onClick={() => save.mutate({ reset: true })}
							>
								Use the chart's ({quota.chartGib} GiB)
							</Button>
						)}
					</div>
				</>
			) : (
				<p className="m-0 text-sm text-content-secondary">
					Each account's Cloud Drive holds up to{" "}
					<span className="font-semibold text-content-primary">
						{quota.gib} GiB
					</span>
					.
				</p>
			)}
		</section>
	);
};
