import {
	CircleAlertIcon,
	FileSearchIcon,
	LockIcon,
	PlugIcon,
	RefreshCwIcon,
	ScanSearchIcon,
	SettingsIcon,
	ShieldCheckIcon,
	ShieldOffIcon,
	TrashIcon,
	UnlockIcon,
	UploadIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type HeldModel,
	ImagesAPI,
	libraryKey,
	type ModelScan,
	type ModelScanner,
} from "#/api/images";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
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
import { createDayString } from "#/utils/createDayString";
import { formatSize } from "./badges";
import { ModelGradeBadge, ModelReportDialog } from "./ModelReport";

export const scannerKey = ["platform", "model-scanner"] as const;

export const useModelScanner = (enabled = true) =>
	useQuery({
		queryKey: scannerKey,
		queryFn: ImagesAPI.modelScanner,
		enabled,
		retry: false,
		refetchInterval: (q) =>
			q.state.data?.checking || q.state.data?.candidate ? 3000 : 30_000,
	});

export const scanActive = (scan?: ModelScan) =>
	!!scan && ["queued", "starting", "fetching", "running"].includes(scan.status);

const PHASE: Record<string, string> = {
	starting: "Starting",
	fetching: "Fetching the model",
	checking: "Checking the file",
	loading: "Loading the model",
	probing: "Probing",
};

/** Where a model's scan is: queued, under way (garak's probes done), or its grade. */
export const ModelScanCell: React.FC<{ scan?: ModelScan }> = ({ scan }) => {
	if (!scan) {
		return <span className="text-content-secondary text-sm">–</span>;
	}
	if (scan.status === "queued") {
		return (
			<span className="flex flex-col gap-0.5 text-xs text-content-secondary">
				<span>Queued{scan.position ? ` (#${scan.position})` : ""}</span>
				{scan.last && <ModelGradeBadge summary={scan.last} compact />}
			</span>
		);
	}
	if (["starting", "fetching", "running"].includes(scan.status)) {
		const p = scan.progress;
		const fraction =
			p?.phase === "fetching" && p.total
				? (p.bytes ?? 0) / p.total
				: p?.phase === "probing" && p.probesTotal
					? (p.probesDone ?? 0) / p.probesTotal
					: null;
		return (
			<span
				className="flex min-w-40 flex-col gap-1 text-xs"
				data-testid="model-scan-progress"
			>
				<span className="flex items-center gap-1.5">
					<Spinner loading size="sm" />
					{PHASE[p?.phase ?? "starting"] ?? "Scanning"}
					{p?.phase === "probing" && p.probesTotal
						? ` ${p.probesDone ?? 0}/${p.probesTotal}`
						: ""}
				</span>
				{fraction !== null && (
					<span className="h-1 overflow-hidden rounded-full bg-surface-tertiary">
						<span
							className="block h-full bg-content-link transition-[width]"
							style={{ width: `${Math.round(fraction * 100)}%` }}
						/>
					</span>
				)}
				{p?.probe && (
					<span
						className="truncate font-mono text-content-secondary"
						title={p.probe}
					>
						{p.probe}
					</span>
				)}
			</span>
		);
	}
	if (scan.status === "failed" || scan.status === "cancelled") {
		return (
			<span className="flex flex-col gap-0.5 text-xs">
				<span
					className="flex items-center gap-1 text-content-destructive"
					title={scan.error ?? undefined}
				>
					<CircleAlertIcon className="size-3.5" />
					{scan.status === "failed" ? "Scan failed" : "Scan cancelled"}
				</span>
				{scan.last && <ModelGradeBadge summary={scan.last} compact />}
			</span>
		);
	}
	if (scan.last) {
		return <ModelGradeBadge summary={scan.last} />;
	}
	return <span className="text-content-secondary text-sm">Not scanned</span>;
};

/**
 * The scanner above the model library: garak's version, the profile and release grade; admins open its settings. A
 * plug-in: with none hooked up (the platform ships none), it says models go in unscanned, admins import one - or hide
 * the section.
 */
export const ModelScannerPanel: React.FC = () => {
	const query = useModelScanner();
	const [open, setOpen] = useState(false);
	const s = query.data;
	if (!s) {
		return null;
	}
	if (!s.enabled) {
		return s.hidden ? null : <ScannerAbsentPanel scanner={s} />;
	}
	const profile = s.profiles.find((p) => p.id === s.profile);
	const newer =
		s.latest.version && s.garak && s.latest.version !== s.garak
			? s.latest.version
			: null;
	return (
		<div
			className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-solid border-border px-3 py-2 text-xs"
			data-testid="model-scanner"
		>
			<span className="flex items-center gap-1.5 font-medium">
				<ShieldCheckIcon className="size-4 text-content-success" />
				{s.garak ? (
					<>
						Scanned by garak <span data-testid="garak-version">{s.garak}</span>
					</>
				) : s.error ? (
					<span className="text-content-destructive">
						The scanner could not be read
					</span>
				) : (
					"Reading the scanner…"
				)}
			</span>
			{s.llamaCpp.build && (
				<span className="text-content-secondary">
					llama.cpp b{s.llamaCpp.build}
				</span>
			)}
			{profile && (
				<span className="text-content-secondary">
					{profile.title} profile
					{profile.probes ? ` (${profile.probes} probes` : ""}
					{profile.cap ? `, ${profile.cap} prompts each` : ""}
					{profile.probes ? ")" : ""}
				</span>
			)}
			<span className="text-content-secondary">
				released at grade {s.releaseGrade} or better
			</span>
			{s.calibration && (
				<span className="text-content-secondary">
					calibration {s.calibration.date.slice(0, 10)}
				</span>
			)}
			{s.running.length > 0 && (
				<span className="text-content-link">
					scanning {s.running[0].name}
					{s.queue.length > 0 && `, ${s.queue.length} queued`}
				</span>
			)}
			{newer && (
				<span
					className="font-medium text-highlight-orange"
					data-testid="garak-newer"
				>
					garak {newer} is out
				</span>
			)}
			{s.custom && (
				<span className="text-content-secondary">updated scanner</span>
			)}
			<Button
				size="xs"
				variant="outline"
				className="ml-auto"
				onClick={() => setOpen(true)}
			>
				<SettingsIcon />
				Scanner
			</Button>
			{open && (
				<ModelScannerDialog scanner={s} onClose={() => setOpen(false)} />
			)}
		</div>
	);
};

/** Admins: a scanner's settings saved (hooked up, hidden, ...), the scanner and the library asked again. */
const useSaveScanner = (done?: string) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: Parameters<typeof ImagesAPI.saveModelScanner>[0]) =>
			ImagesAPI.saveModelScanner(body),
		onSuccess: (_d, body) => {
			if (done ?? body.image) {
				toast.success(
					done ?? "Checking the scanner image: it is used once it answers.",
				);
			}
			void queryClient.invalidateQueries({ queryKey: scannerKey });
			void queryClient.invalidateQueries({ queryKey: libraryKey("models") });
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not saved.")),
	});
};

/** No scanner hooked up: what that means, the one being checked, and (admins) Import scanner and Hide. */
const ScannerAbsentPanel: React.FC<{ scanner: ModelScanner }> = ({
	scanner: s,
}) => {
	const [importing, setImporting] = useState(false);
	const hide = useSaveScanner();
	return (
		<div
			className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs"
			data-testid="model-scanner-absent"
		>
			<span className="flex items-center gap-1.5 font-medium">
				<ShieldOffIcon className="size-4 text-content-secondary" />
				LLM scanning (garak) is not hooked up
			</span>
			<span className="text-content-secondary">
				models go straight into the library, unscanned
			</span>
			{s.candidate && (
				<span className="flex items-center gap-1.5 text-content-link">
					<Spinner loading size="sm" /> Checking {s.candidate}…
				</span>
			)}
			{s.candidateError && (
				<span className="text-content-destructive">{s.candidateError}</span>
			)}
			{s.canEdit && (
				<span className="ml-auto flex items-center gap-3">
					<span className="flex items-center gap-1.5 text-content-secondary">
						<Switch
							checked
							disabled={hide.isPending}
							onCheckedChange={() => hide.mutate({ hidden: true })}
							aria-label="Show this section while no scanner is hooked up"
							data-testid="model-scanner-hide"
						/>
						Shown
					</span>
					<Button
						size="xs"
						onClick={() => setImporting(true)}
						data-testid="model-scanner-import"
					>
						<PlugIcon />
						Import scanner
					</Button>
				</span>
			)}
			{importing && <ScannerImportDialog onClose={() => setImporting(false)} />}
		</div>
	);
};

/** The section hidden (admins, no scanner hooked up): a small button that shows it again. */
export const ShowScannerButton: React.FC = () => {
	const query = useModelScanner();
	const show = useSaveScanner();
	const s = query.data;
	if (!s?.canEdit || s.enabled || !s.hidden) {
		return null;
	}
	return (
		<Button
			size="xs"
			variant="subtle"
			disabled={show.isPending}
			onClick={() => show.mutate({ hidden: false })}
			data-testid="model-scanner-show"
		>
			<ShieldOffIcon />
			Show LLM scanning
		</Button>
	);
};

/**
 * Hooks the scanner up, as a plug-in: a docker save archive of development/tools/build-garak-image.sh (it lands in the
 * Images view, then is chosen), an image the Images view holds already, or a registry's. The platform checks it (its
 * info Job) before it scans with it.
 */
const ScannerImportDialog: React.FC<{ onClose: () => void }> = ({
	onClose,
}) => {
	const save = useSaveScanner();
	const [file, setFile] = useState<File | null>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const [imported, setImported] = useState<string | null>(null);
	const [ref, setRef] = useState("");
	const images = useQuery({
		queryKey: ["platform", "images", "list"],
		queryFn: ImagesAPI.list,
		// an archive uploaded: until its entry is ready (its image pushed to the registry)
		refetchInterval: imported ? 3000 : false,
	});
	const ready = (images.data?.images ?? []).filter(
		(i) => i.status === "ready" && i.pullRef,
	);
	const done = imported ? ready.find((i) => i.id === imported) : undefined;
	const hooked = useRef(false);
	useEffect(() => {
		if (done?.pullRef && !hooked.current) {
			hooked.current = true;
			save.mutate({ image: done.pullRef });
			onClose();
		}
	}, [done?.pullRef, save.mutate, onClose]);
	const upload = useMutation({
		mutationFn: (f: File) =>
			ImagesAPI.importArchive(
				"coder-garak",
				"The Model Library's security scanner (garak), a plug-in",
				f,
				setProgress,
			),
		onSuccess: (r) => {
			setImported(r.image);
			toast.success(
				"Uploaded: the scanner is hooked up once its image is ready.",
			);
		},
		onError: (e) => {
			setProgress(null);
			toast.error(getErrorMessage(e, "Not uploaded."));
		},
	});
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				className="max-w-xl"
				data-testid="model-scanner-import-dialog"
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<PlugIcon className="size-5" />
						Import the LLM scanner
					</DialogTitle>
					<DialogDescription>
						garak, NVIDIA's LLM vulnerability scanner, with its detector models
						and llama.cpp - a plug-in, none ships with the platform. Once it is
						checked, every model added to the library is scanned before
						workspaces have it.
					</DialogDescription>
				</DialogHeader>
				<section className="flex flex-col gap-2">
					<Label htmlFor="scanner-archive">
						Its archive (docker save, .tar or .tar.gz)
					</Label>
					<span className="text-xs text-content-secondary">
						development/tools/build-garak-image.sh writes it to dist/plugins/.
					</span>
					<span className="flex items-center gap-2">
						<Input
							id="scanner-archive"
							type="file"
							accept=".tar,.tar.gz,.tgz"
							onChange={(e) => setFile(e.target.files?.[0] ?? null)}
							className="text-xs"
							data-testid="model-scanner-archive"
						/>
						<Button
							size="sm"
							disabled={!file || upload.isPending || imported !== null}
							onClick={() => file && upload.mutate(file)}
						>
							<UploadIcon />
							Upload
						</Button>
					</span>
					{progress !== null && (
						<span className="text-xs text-content-secondary">
							{imported
								? "Uploaded: pushing its image to the registry…"
								: `Uploading… ${Math.round(progress * 100)}%`}
						</span>
					)}
				</section>
				<section className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4">
					<Label htmlFor="scanner-ref">
						Or an image the Images view holds, or a registry's
					</Label>
					{ready.length > 0 && (
						<Select value="" onValueChange={(v) => setRef(v)}>
							<SelectTrigger aria-label="An imported image">
								<SelectValue placeholder="An image of the Images view" />
							</SelectTrigger>
							<SelectContent>
								{ready.map((i) => (
									<SelectItem key={i.id} value={i.pullRef as string}>
										{i.name} v{i.version}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Input
						id="scanner-ref"
						placeholder="registry/coder-garak:0.17.1-2"
						value={ref}
						onChange={(e) => setRef(e.target.value)}
						className="font-mono text-xs"
					/>
				</section>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!ref.trim() || save.isPending}
						onClick={() => {
							save.mutate({ image: ref.trim() });
							onClose();
						}}
						data-testid="model-scanner-use"
					>
						Hook it up
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

const GRADES = ["A", "B", "C", "D", "F"];

/**
 * The scanner's settings: everyone sees what scans the models (garak's version, its probes, detector models and
 * calibration); admins choose the profile, the grade a model needs to be released, and the scanner image - a newer
 * one imported in the Images view (garak's probes and detectors are updated with garak itself) - and rescan every
 * model with it.
 */
const ModelScannerDialog: React.FC<{
	scanner: ModelScanner;
	onClose: () => void;
}> = ({ scanner: s, onClose }) => {
	const queryClient = useQueryClient();
	const [profile, setProfile] = useState(s.profile);
	const [grade, setGrade] = useState(s.releaseGrade);
	const [image, setImage] = useState(s.custom ? s.image : "");
	useEffect(() => {
		setProfile(s.profile);
		setGrade(s.releaseGrade);
	}, [s.profile, s.releaseGrade]);
	const images = useQuery({
		queryKey: ["platform", "images", "list"],
		queryFn: ImagesAPI.list,
		enabled: s.canEdit,
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: scannerKey });
		void queryClient.invalidateQueries({ queryKey: libraryKey("models") });
	};
	const save = useMutation({
		mutationFn: (body: Parameters<typeof ImagesAPI.saveModelScanner>[0]) =>
			ImagesAPI.saveModelScanner(body),
		onSuccess: (_d, body) => {
			toast.success(
				body.image !== undefined && body.image
					? "Checking the scanner image: it is used once it answers."
					: "Saved.",
			);
			refresh();
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not saved.")),
	});
	const rescan = useMutation({
		mutationFn: ImagesAPI.rescanAllModels,
		onSuccess: (r) => {
			toast.success(`${r.queued} model${r.queued === 1 ? "" : "s"} queued.`);
			refresh();
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not queued.")),
	});
	const ready = (images.data?.images ?? []).filter(
		(i) => i.status === "ready" && i.pullRef,
	);
	const current = s.profiles.find((p) => p.id === profile);
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Model scanner</DialogTitle>
					<DialogDescription>
						Every model added to the library is scanned with garak, NVIDIA's LLM
						vulnerability scanner, before workspaces can use it.
						{!s.canEdit && " Only admins change these settings."}
					</DialogDescription>
				</DialogHeader>
				<div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1 text-sm">
					<section
						className="flex flex-col gap-1 rounded-md border border-solid border-border px-3 py-2 text-xs"
						data-testid="model-scanner-info"
					>
						<span>
							<b>garak {s.garak ?? "–"}</b>
							{s.llamaCpp.version &&
								` · llama.cpp ${s.llamaCpp.version} (b${s.llamaCpp.build})`}
							{s.python && ` · Python ${s.python}`}
						</span>
						<span className="text-content-secondary">
							{s.probes.active} active probes of {s.probes.total};{" "}
							{s.detectorModels.length} detector models and {s.datasets.length}{" "}
							datasets in the image (no network needed)
							{s.calibration &&
								`; calibrated on ${s.calibration.models} models (${s.calibration.date.slice(0, 10)})`}
						</span>
						<span className="break-all font-mono text-content-secondary">
							{s.image}
							{s.builtAt && ` (built ${s.builtAt})`}
						</span>
						{s.error && (
							<span className="text-content-destructive">{s.error}</span>
						)}
						{s.latest.version ? (
							<span
								className={
									s.latest.version !== s.garak
										? "font-medium text-highlight-orange"
										: "text-content-success"
								}
							>
								{s.latest.version !== s.garak
									? `garak ${s.latest.version} is the newest release (PyPI): build a scanner with it (development/tools/build-garak-image.sh), import it in the Images view and choose it below.`
									: "The newest garak release (PyPI)."}
							</span>
						) : (
							s.latest.checkedAt && (
								<span className="text-content-secondary">
									Newer releases: PyPI not reached (an air-gapped network?).
								</span>
							)
						)}
					</section>

					<section className="flex flex-col gap-2">
						<Label htmlFor="scan-profile">Profile for new models</Label>
						<Select
							value={profile}
							onValueChange={setProfile}
							disabled={!s.canEdit}
						>
							<SelectTrigger id="scan-profile">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{s.profiles.map((p) => (
									<SelectItem key={p.id} value={p.id}>
										{p.title}
										{p.probes ? ` - ${p.probes} probes` : ""}
										{p.cap ? `, ${p.cap} prompts each` : ""}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{current?.description && (
							<span className="text-xs text-content-secondary">
								{current.description} At most {current.hours} hours.
							</span>
						)}
					</section>

					<section className="flex flex-col gap-2">
						<Label htmlFor="release-grade">
							Release into the library at grade
						</Label>
						<Select
							value={grade}
							onValueChange={setGrade}
							disabled={!s.canEdit}
						>
							<SelectTrigger id="release-grade">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{GRADES.map((g) => (
									<SelectItem key={g} value={g}>
										{g === "F"
											? "Any grade (every finished scan)"
											: `${g} or better`}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<span className="text-xs text-content-secondary">
							A model graded worse, or with code in its chat template, stays
							held until an admin releases it.
						</span>
					</section>

					{s.canEdit && (
						<div className="flex justify-end">
							<Button
								size="sm"
								disabled={
									save.isPending ||
									(profile === s.profile && grade === s.releaseGrade)
								}
								onClick={() => save.mutate({ profile, releaseGrade: grade })}
							>
								<Spinner loading={save.isPending} />
								Save
							</Button>
						</div>
					)}

					{s.canEdit && (
						<section
							className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4"
							data-testid="scanner-image"
						>
							<Label htmlFor="scanner-image">Scanner image (an update)</Label>
							<span className="text-xs text-content-secondary">
								garak's probes, payloads and detectors ship with garak: a newer
								scanner image updates them. Import one in the Images view (from
								a registry, or a <code>docker save</code> archive of
								build-garak-image.sh), then choose it here; it is checked before
								it is used. Empty: the chart's.
							</span>
							{ready.length > 0 && (
								<Select value="" onValueChange={(v) => setImage(v)}>
									<SelectTrigger aria-label="An imported image">
										<SelectValue placeholder="An image of the Images view" />
									</SelectTrigger>
									<SelectContent>
										{ready.map((i) => (
											<SelectItem key={i.id} value={i.pullRef as string}>
												{i.name} v{i.version}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
							<Input
								id="scanner-image"
								placeholder={s.defaultImage}
								value={image}
								onChange={(e) => setImage(e.target.value)}
								className="font-mono text-xs"
							/>
							{s.candidate && (
								<span className="flex items-center gap-1.5 text-xs">
									<Spinner loading size="sm" /> Checking {s.candidate}…
								</span>
							)}
							{s.candidateError && (
								<span className="text-xs text-content-destructive">
									{s.candidateError}
								</span>
							)}
							<div className="flex flex-wrap justify-end gap-2">
								{s.custom && (
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											setImage("");
											save.mutate({ image: "" });
										}}
									>
										{s.defaultImage
											? "Back to the chart's"
											: "Unhook the scanner"}
									</Button>
								)}
								<Button
									size="sm"
									variant="outline"
									disabled={
										save.isPending || !image.trim() || image.trim() === s.image
									}
									onClick={() => save.mutate({ image: image.trim() })}
								>
									Use this scanner
								</Button>
							</div>
						</section>
					)}
				</div>
				<DialogFooter>
					{s.canEdit && (
						<Button
							variant="outline"
							disabled={rescan.isPending}
							onClick={() => rescan.mutate()}
						>
							<Spinner loading={rescan.isPending}>
								<RefreshCwIcon />
							</Spinner>
							Rescan every model
						</Button>
					)}
					<Button onClick={onClose}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/** The actions on a model's scan: its report, a rescan (or cancel), and (admins) release or hold. */
export const ModelScanActions: React.FC<{
	name: string;
	scan?: ModelScan;
	held: boolean;
	canScan: boolean;
	canRelease: boolean;
}> = ({ name, scan, held, canScan, canRelease }) => {
	const queryClient = useQueryClient();
	const [report, setReport] = useState(false);
	const [confirm, setConfirm] = useState<"release" | "hold" | null>(null);
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: libraryKey("models") });
		void queryClient.invalidateQueries({ queryKey: scannerKey });
	};
	const act = useMutation({
		mutationFn: (what: "scan" | "cancel" | "release" | "hold") =>
			what === "scan"
				? ImagesAPI.scanModel(name)
				: what === "cancel"
					? ImagesAPI.cancelModelScan(name)
					: what === "release"
						? ImagesAPI.releaseModel(name)
						: ImagesAPI.holdModel(name),
		onSuccess: (_d, what) => {
			setConfirm(null);
			toast.success(
				{
					scan: "Queued for a scan.",
					cancel: "Cancelled.",
					release: "Released: workspaces have it now.",
					hold: "Held: no workspace has it now.",
				}[what],
			);
			refresh();
		},
		onError: (e) => toast.error(getErrorMessage(e, "That did not work.")),
	});
	const active = scanActive(scan);
	const passes = !!scan?.last && !scan.reason;
	return (
		<span className="flex items-center justify-end gap-1">
			{scan?.last && (
				<Button
					size="icon"
					variant="subtle"
					aria-label={`Security report of ${name}`}
					title="Security report"
					onClick={() => setReport(true)}
				>
					<FileSearchIcon />
				</Button>
			)}
			{canScan &&
				(active ? (
					<Button
						size="icon"
						variant="subtle"
						aria-label={`Cancel the scan of ${name}`}
						title="Cancel the scan"
						disabled={act.isPending}
						onClick={() => act.mutate("cancel")}
					>
						<XIcon />
					</Button>
				) : (
					<Button
						size="icon"
						variant="subtle"
						aria-label={`Scan ${name} again`}
						title="Scan again"
						disabled={act.isPending}
						onClick={() => act.mutate("scan")}
					>
						<ScanSearchIcon />
					</Button>
				))}
			{canRelease && held && !active && (
				<Button
					size="icon"
					variant="subtle"
					aria-label={`Release ${name}`}
					title={passes ? "Release" : "Release anyway"}
					onClick={() => setConfirm("release")}
				>
					<UnlockIcon />
				</Button>
			)}
			{canRelease && !held && !scan?.newerHeld && (
				<Button
					size="icon"
					variant="subtle"
					aria-label={`Hold ${name}`}
					title="Hold (take it out of the workspaces)"
					onClick={() => setConfirm("hold")}
				>
					<LockIcon />
				</Button>
			)}
			{report && (
				<ModelReportDialog name={name} onClose={() => setReport(false)} />
			)}
			<ConfirmDialog
				type={confirm === "release" && !passes ? "delete" : "info"}
				open={confirm !== null}
				title={confirm === "release" ? `Release ${name}?` : `Hold ${name}?`}
				description={
					confirm === "release"
						? scan?.reason
							? `It stays held because ${scan.reason}. Released, every AI workspace has it at ~/models; the release is recorded with your name.`
							: "Every AI workspace has it at ~/models from now on."
						: "It leaves the library: no workspace has it until it is released again."
				}
				confirmText={
					confirm === "release"
						? passes
							? "Release"
							: "Release anyway"
						: "Hold"
				}
				confirmLoading={act.isPending}
				onClose={() => setConfirm(null)}
				onConfirm={() => confirm && act.mutate(confirm)}
			/>
		</span>
	);
};

/** The models waiting in the hold: their scan, why they wait, and what admins can do. */
export const HeldModels: React.FC<{
	held: HeldModel[];
	canEdit: boolean;
	canRelease: boolean;
}> = ({ held, canEdit, canRelease }) => {
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState<string | null>(null);
	const remove = useMutation({
		mutationFn: (name: string) =>
			ImagesAPI.deleteFromLibrary("models", name, true),
		onSettled: () => {
			setConfirming(null);
			void queryClient.invalidateQueries({ queryKey: libraryKey("models") });
		},
	});
	if (held.length === 0) {
		return null;
	}
	return (
		<div className="mt-4 flex flex-col gap-2" data-testid="models-held">
			<h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
				<LockIcon className="size-4 text-highlight-orange" />
				Held until their security scan releases them ({held.length})
			</h3>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[38%]">Model</TableHead>
						<TableHead className="w-[10%]">Size</TableHead>
						<TableHead className="w-[22%]">Security</TableHead>
						<TableHead className="w-[18%]">Why it waits</TableHead>
						<TableHead className="w-[12%]" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{held.map((m) => (
						<TableRow key={m.name} data-testid={`held-${m.name}`}>
							<TableCell className="break-all font-mono text-xs">
								{m.name}
								{m.alsoReleased && (
									<span className="block font-sans text-content-secondary">
										a newer version of the library's
									</span>
								)}
							</TableCell>
							<TableCell className="text-sm tabular-nums">
								{formatSize(m.size)}
							</TableCell>
							<TableCell>
								<ModelScanCell scan={m.scan} />
							</TableCell>
							<TableCell className="text-xs text-content-secondary">
								{scanActive(m.scan)
									? "being scanned"
									: (m.scan.reason ??
										(m.scan.error ? m.scan.error : "not scanned yet"))}
								{m.modified && (
									<span className="block">
										added {createDayString(m.modified)}
									</span>
								)}
							</TableCell>
							<TableCell>
								<span className="flex items-center justify-end gap-1">
									<ModelScanActions
										name={m.name}
										scan={m.scan}
										held
										canScan={canEdit}
										canRelease={canRelease}
									/>
									{canEdit &&
										(confirming === m.name ? (
											<Button
												size="xs"
												variant="destructive"
												disabled={remove.isPending}
												onClick={() => remove.mutate(m.name)}
											>
												Delete?
											</Button>
										) : (
											<Button
												size="icon"
												variant="subtle"
												aria-label={`Delete the held ${m.name}`}
												onClick={() => setConfirming(m.name)}
											>
												<TrashIcon />
											</Button>
										))}
								</span>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
};
