import { cn } from "cn";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	FileUpIcon,
	RotateCcwIcon,
	ScanSearchIcon,
	ShieldIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type DataLevel,
	ImagesAPI,
	type SecurityDataStatus,
} from "#/api/images";
import { Button } from "#/components/Button/Button";
import { Spinner } from "#/components/Spinner/Spinner";
import { createDayString } from "#/utils/createDayString";

export const securityDataKey = ["platform", "images", "security-data"] as const;

export const useSecurityData = () =>
	useQuery({
		queryKey: securityDataKey,
		queryFn: ImagesAPI.securityData,
		refetchInterval: (q) => (q.state.data?.rescan?.running ? 3000 : 60_000),
	});

const day = (ts: string | null | undefined) =>
	ts
		? new Date(ts).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
			})
		: "—";

const LEVEL: Record<
	DataLevel,
	{ label: string; className: string; Icon: typeof CircleCheckIcon }
> = {
	current: {
		label: "Current",
		className: "text-content-success",
		Icon: CircleCheckIcon,
	},
	aging: {
		label: "Ageing",
		className: "text-content-warning",
		Icon: TriangleAlertIcon,
	},
	stale: {
		label: "Out of date",
		className: "text-content-destructive",
		Icon: CircleAlertIcon,
	},
	unknown: {
		label: "Unknown",
		className: "text-content-secondary",
		Icon: CircleAlertIcon,
	},
};

const Age: React.FC<{ days: number | null | undefined; level: DataLevel }> = ({
	days,
	level,
}) => {
	const { className, Icon } = LEVEL[level];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 whitespace-nowrap",
				className,
			)}
		>
			<Icon className="size-3.5" />
			{days === null || days === undefined
				? "age unknown"
				: days === 0
					? "today"
					: `${days} day${days === 1 ? "" : "s"} old`}
		</span>
	);
};

/**
 * The Images page's badge: how current the data that grades images is
 * (amber after 14 days, red after 30). Opens the settings.
 */
export const SecurityDataBadge: React.FC<{ onOpen: () => void }> = ({
	onOpen,
}) => {
	const { data } = useSecurityData();
	if (!data) {
		return null;
	}
	const { className, Icon } = LEVEL[data.level];
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex cursor-pointer items-center gap-1.5 rounded-md border border-solid border-border bg-transparent px-2.5 py-1 text-xs text-content-secondary hover:bg-surface-secondary"
			title={`Vulnerability database of ${day(data.vulnerabilityDb?.updatedAt)}; FIPS rules ${data.fipsRules.version} (${day(data.fipsRules.published)}). Click to update.`}
			data-testid="security-data-badge"
		>
			<ShieldIcon className="size-3.5" />
			Security data
			<span className={cn("flex items-center gap-1 font-medium", className)}>
				<Icon className="size-3.5" />
				{day(data.vulnerabilityDb?.updatedAt)}
			</span>
		</button>
	);
};

/**
 * Images > Settings > Security data: what grades images (trivy's
 * vulnerability and Java databases, the FIPS rules), when each was last
 * updated, and, for admins, loading a newer set (made with
 * build-security-data.sh on a machine with internet access), going back, and
 * rescanning every built image with it.
 */
export const SecurityDataSection: React.FC = () => {
	const queryClient = useQueryClient();
	const { data, error } = useSecurityData();
	const fileRef = useRef<HTMLInputElement>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const set = (s: SecurityDataStatus) =>
		queryClient.setQueryData(
			securityDataKey,
			(old: SecurityDataStatus | undefined) => ({ ...old, ...s }),
		);
	const upload = useMutation({
		mutationFn: (file: File) => ImagesAPI.uploadSecurityData(file, setProgress),
		onSuccess: (s) => {
			set(s);
			toast.success(
				`Security data loaded: vulnerability database of ${day(s.vulnerabilityDb?.updatedAt)}. Rescan the built images for current grades.`,
			);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The security data was not loaded.")),
		onSettled: () => setProgress(null),
	});
	const activate = useMutation({
		mutationFn: (id: string | null) => ImagesAPI.activateSecurityData(id),
		onSuccess: (s) => {
			set(s);
			toast.success(
				s.source.kind === "bundled"
					? "Back to the bundled security data."
					: "Security data switched.",
			);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not switched.")),
	});
	const rescan = useMutation({
		mutationFn: ImagesAPI.rescanAll,
		onSuccess: ({ images }) => {
			void queryClient.invalidateQueries({ queryKey: securityDataKey });
			toast.success(
				images.length
					? `Rescanning ${images.length} image${images.length === 1 ? "" : "s"}, one after another.`
					: "No built image to rescan.",
			);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The rescan did not start.")),
	});

	if (error) {
		return (
			<p className="m-0 text-sm text-content-destructive">
				{getErrorMessage(error, "The security data could not be read.")}
			</p>
		);
	}
	if (!data) {
		return <Spinner loading />;
	}
	const can = Boolean(data.canChange);
	const rows: [string, React.ReactNode, React.ReactNode][] = [
		[
			"Vulnerability database",
			<>
				{day(data.vulnerabilityDb?.updatedAt)}
				{data.trivyVersion && (
					<span className="text-content-secondary">
						{" "}
						· trivy {data.trivyVersion}
					</span>
				)}
			</>,
			<Age
				days={data.vulnerabilityDb?.ageDays}
				level={data.vulnerabilityDb?.level ?? "unknown"}
			/>,
		],
		[
			"Java database",
			data.javaDb ? (
				day(data.javaDb.updatedAt)
			) : (
				<span className="text-content-secondary">
					Not loaded: .jar, .war and .ear are not scanned
				</span>
			),
			data.javaDb ? (
				<Age days={data.javaDb.ageDays} level={data.javaDb.level} />
			) : null,
		],
		[
			"FIPS rules",
			<span title={data.fipsRules.sources.join("\n")}>
				{data.fipsRules.version} · {data.fipsRules.standard} · published{" "}
				{day(data.fipsRules.published)}
			</span>,
			<Age days={data.fipsRules.ageDays} level={data.fipsRules.level} />,
		],
	];

	return (
		<section className="flex flex-col gap-3" data-testid="security-data">
			<div className="flex items-center gap-2">
				<h3 className="m-0 text-sm font-semibold">Security data</h3>
				<span
					className={cn(
						"flex items-center gap-1 text-xs font-medium",
						LEVEL[data.level].className,
					)}
				>
					{LEVEL[data.level].label}
				</span>
			</div>
			<p className="m-0 text-xs text-content-secondary">
				What the security report grades images with. In an air gap it ages:
				trivy publishes a new vulnerability database every few hours. Make a
				newer file on a machine with internet access (
				<code>development/tools/build-security-data.sh</code>), carry it across
				and load it here. Ageing after {data.thresholds.agingDays} days, out of
				date after {data.thresholds.staleDays}.
			</p>
			<dl className="m-0 grid grid-cols-[max-content_1fr_max-content] gap-x-4 gap-y-1.5 rounded-md border border-solid border-border p-3 text-sm">
				{rows.map(([k, v, age]) => (
					<div key={k} className="contents">
						<dt className="text-content-secondary">{k}</dt>
						<dd className="m-0 min-w-0 break-words">{v}</dd>
						<dd className="m-0 text-xs">{age}</dd>
					</div>
				))}
				<dt className="text-content-secondary">Loaded</dt>
				<dd className="col-span-2 m-0 text-xs text-content-secondary">
					{data.source.kind === "bundled"
						? "The bundle's own data (as old as the bundle)."
						: `${data.source.file ?? "uploaded file"}, made ${day(data.source.createdAt)}, loaded ${createDayString(data.source.installedAt ?? "")} by ${data.source.installedBy}`}
				</dd>
			</dl>
			{can && (
				<div className="flex flex-wrap items-center gap-2">
					<input
						ref={fileRef}
						type="file"
						accept=".tar.gz,.tgz,application/gzip"
						className="hidden"
						aria-label="Security data file"
						onChange={(e) => {
							const f = e.currentTarget.files?.[0];
							e.currentTarget.value = "";
							if (f) {
								upload.mutate(f);
							}
						}}
					/>
					<Button
						size="sm"
						onClick={() => fileRef.current?.click()}
						disabled={upload.isPending}
						data-testid="security-data-upload"
					>
						<Spinner loading={upload.isPending}>
							<FileUpIcon />
						</Spinner>
						{progress !== null
							? progress < 1
								? `Uploading ${Math.round(progress * 100)}%`
								: "Checking…"
							: "Load security data…"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => rescan.mutate()}
						disabled={rescan.isPending || data.rescan?.running}
						title="Scan every built image again with the data above (nothing is rebuilt)"
					>
						<Spinner
							loading={rescan.isPending || Boolean(data.rescan?.running)}
						>
							<ScanSearchIcon />
						</Spinner>
						{data.rescan?.running
							? `Rescanning: ${data.rescan.done.length + data.rescan.failed.length} of ${data.rescan.done.length + data.rescan.failed.length + data.rescan.queued.length}`
							: "Rescan all built images"}
					</Button>
					{data.source.kind === "uploaded" && (
						<Button
							size="sm"
							variant="subtle"
							onClick={() => activate.mutate(null)}
							disabled={activate.isPending}
						>
							<RotateCcwIcon />
							Use the bundled data
						</Button>
					)}
				</div>
			)}
			{can && data.history.length > 1 && (
				<ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-content-secondary">
					{data.history
						.filter((h) => !h.active)
						.map((h) => (
							<li key={h.id} className="flex items-center gap-2">
								Earlier: vulnerability database of {day(h.dbUpdatedAt)}, loaded{" "}
								{day(h.installedAt)} by {h.installedBy}
								<Button
									size="xs"
									variant="subtle"
									onClick={() => activate.mutate(h.id)}
								>
									Use it
								</Button>
							</li>
						))}
				</ul>
			)}
			{data.rescan && !data.rescan.running && data.rescan.failed.length > 0 && (
				<p className="m-0 text-xs text-content-destructive">
					Not rescanned: {data.rescan.failed.join(", ")} (see their builds).
				</p>
			)}
		</section>
	);
};
