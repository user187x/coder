import { cn } from "cn";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { Link as RouterLink } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type CopaLevel,
	type ImageDetail,
	ImagesAPI,
	type PitLap,
	type PitStop,
} from "#/api/images";
import { Spinner } from "#/components/Spinner/Spinner";
import type { Finding } from "./fixPlan";
import { imagesKey } from "./ImagesPage";
import "./pitStop.css";

/**
 * The pit stop (Images › Fix image): Copa (Copacetic) patches the image in place - no rebuild - like a car coming into
 * the pit: into the pit, a report of what to fix, Copa's patch, a rescan, another lap while it can do better, and back
 * out on the track as the image's next version (or its patched copy's, for an image only scanned here).
 */

/** The stations of the pit lane, by the pit stop's build steps. */
const STATIONS: { key: string; label: string }[] = [
	{ key: "pit-in", label: "Pit in" },
	{ key: "report", label: "Report" },
	{ key: "patch", label: "Copa patch" },
	{ key: "rescan", label: "Rescan" },
	{ key: "pit-out", label: "Back on track" },
];

const LEVELS: { value: CopaLevel; label: string; hint: string }[] = [
	{ value: "patch", label: "Patch", hint: "1.2.3 → 1.2.x" },
	{ value: "minor", label: "Minor", hint: "1.2.3 → 1.x" },
	{ value: "major", label: "Major", hint: "any newer" },
];

/**
 * A finding Copa can fix: an OS package with a fixed version always; a Python one with library patching. (Node.js
 * ones Copa patches through a tooling image, and on the AI image that failed the whole patch: the service leaves
 * them out.)
 */
export const pitApplicable = (f: Finding, libraries: boolean) =>
	Boolean(f.to) &&
	(f.source === "apt" ||
		f.source === "base image" ||
		(libraries && f.source === "pip"));

/** The pit stop's options and its start, in Fix plan (the findings chosen come from the page). */
export const PitStopPanel: React.FC<{
	image: ImageDetail;
	chosen: readonly Finding[];
	libraries: boolean;
	onLibraries: (on: boolean) => void;
}> = ({ image, chosen, libraries, onLibraries }) => {
	const queryClient = useQueryClient();
	const [maxLevel, setMaxLevel] = useState<CopaLevel>("minor");
	const [laps, setLaps] = useState(2);
	// a lap after the first only goes a library level further: as many laps as levels up to the most allowed
	const useful = libraries
		? LEVELS.findIndex((l) => l.value === maxLevel) + 1
		: 1;
	const lapsTaken = Math.min(laps, useful);
	const running = image.pit?.outcome === "running";
	const n = chosen.length;
	const start = useMutation({
		mutationFn: () =>
			ImagesAPI.pitStop(image.id, {
				keys: chosen.map((f) => ({ id: f.id, pkg: f.pkg })),
				libraries,
				level: "patch",
				maxLevel: libraries ? maxLevel : "patch",
				laps: lapsTaken,
			}),
		onSuccess: ({ pit }) => {
			// the new pit stop on the page at once (not the last one's lane until the refetch)
			queryClient.setQueryData<{ image: ImageDetail }>(
				[...imagesKey, image.id],
				(old) => (old ? { image: { ...old.image, pit } } : old),
			);
			void queryClient.invalidateQueries({ queryKey: imagesKey });
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The pit stop could not start.")),
	});
	const copyOf = image.scanned ?? image.tracked;
	const target = copyOf
		? `${(copyOf.image.split("/").pop() ?? "image").split(":")[0]}-patched`
		: image.name;

	return (
		<div className="flex flex-col gap-3.5 px-[22px] pb-[22px] pt-4">
			<p className="m-0 text-[13px] text-(--ws-text-3)">
				Copa patches the image in place - no rebuild - rescans it, takes another
				lap while it can do better, and puts it back on the track as{" "}
				<span className="ws-mono text-(--ws-text-2)">{target}</span>
				{copyOf ? " (a patched copy: this one is only scanned here)" : ""}.
			</p>

			<label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
				<input
					type="checkbox"
					className="mt-0.5 size-4"
					checked={libraries}
					onChange={(e) => onLibraries(e.target.checked)}
					data-testid="pit-libraries"
				/>
				<span>
					Python packages too{" "}
					<span className="ml-1 rounded-full border border-solid border-(--ws-line) px-1.5 text-[10.5px] uppercase tracking-[0.05em] text-(--ws-muted)">
						experimental
					</span>
					<span className="block text-xs text-(--ws-muted)">
						OS packages always; Python libraries from PyPI, in their own
						environments.
					</span>
				</span>
			</label>

			{libraries && (
				<fieldset className="m-0 border-0 p-0">
					<legend className="mb-1.5 p-0 text-[12.5px] text-(--ws-text-3)">
						Library updates may go up to
					</legend>
					<div
						role="radiogroup"
						aria-label="Library updates may go up to"
						className="grid grid-cols-3 gap-1 rounded-[11px] border border-solid border-(--ws-line) bg-(--ws-well) p-1"
					>
						{LEVELS.map((l) => (
							<button
								key={l.value}
								type="button"
								role="radio"
								aria-checked={maxLevel === l.value}
								onClick={() => setMaxLevel(l.value)}
								className={cn(
									"ws-hit flex cursor-pointer flex-col items-center rounded-lg border-0 py-1.5 text-[12.5px]",
									maxLevel === l.value
										? "bg-(--ws-switch-off) font-semibold text-(--ws-text)"
										: "bg-transparent text-(--ws-muted)",
								)}
							>
								{l.label}
								<span className="ws-mono text-[10.5px] font-normal text-(--ws-faint)">
									{l.hint}
								</span>
							</button>
						))}
					</div>
					<span className="mt-1 block text-xs text-(--ws-muted)">
						Lap 1 takes patch versions; each lap after goes a level further, up
						to this.
					</span>
				</fieldset>
			)}

			<div className="flex items-center justify-between gap-3">
				<span className="text-[12.5px] text-(--ws-text-3)">Laps at most</span>
				<div
					role="radiogroup"
					aria-label="Laps at most"
					className="flex gap-1 rounded-[11px] border border-solid border-(--ws-line) bg-(--ws-well) p-1"
				>
					{[1, 2, 3].map((k) => (
						<button
							key={k}
							type="button"
							role="radio"
							aria-checked={lapsTaken === k}
							disabled={k > useful}
							title={
								k > useful
									? libraries
										? "Each lap after the first goes a library level further: allow minor or major updates for more"
										: "Without library updates one lap does all Copa can"
									: undefined
							}
							onClick={() => setLaps(k)}
							className={cn(
								"ws-hit h-8 w-10 cursor-pointer rounded-lg border-0 text-[13px] disabled:cursor-not-allowed disabled:opacity-40",
								lapsTaken === k
									? "bg-(--ws-switch-off) font-semibold text-(--ws-text)"
									: "bg-transparent text-(--ws-muted)",
							)}
						>
							{k}
						</button>
					))}
				</div>
			</div>

			<button
				type="button"
				className="ws-hit inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-(--ws-r-md) border-0 bg-(--ws-accent) text-sm font-semibold text-(--ws-accent-ink) disabled:cursor-not-allowed disabled:opacity-60"
				disabled={!image.canEdit || n === 0 || running || start.isPending}
				onClick={() => start.mutate()}
				data-testid="pit-start"
			>
				{start.isPending ? <Spinner loading size="sm" /> : <CarGlyph />}
				{!image.canEdit
					? "Only admins and template admins patch images"
					: running
						? "In the pit…"
						: n === 0
							? "Select findings Copa can fix"
							: `Box, box - pit stop for ${n} finding${n === 1 ? "" : "s"}`}
			</button>
			<p className="m-0 text-xs text-(--ws-muted)">
				Copa updates packages from the distribution's repositories (and PyPI for
				libraries): the cluster must reach them or the mirrors the image names.
			</p>
		</div>
	);
};

/** A small race car, seen from the side. */
const CarGlyph: React.FC<{ className?: string }> = ({ className }) => (
	<svg
		viewBox="0 0 32 16"
		width="26"
		height="13"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.6"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		className={className}
	>
		<path d="M2 11h3m6 0h10m6 0h3V9l-5-2-4-3h-6l-3 3H5L2 9z" />
		<circle cx="8" cy="11.5" r="2.5" />
		<circle cx="24" cy="11.5" r="2.5" />
		<path d="M14 4.5l-1.5 2.5h7" />
	</svg>
);

const clock = (from: string, to?: string | null) => {
	const s = Math.max(
		0,
		Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000),
	);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The pit lane: where the image is now, its laps, the log's tail, and how it went back out. */
export const PitLane: React.FC<{ pit: PitStop; imageId: string }> = ({
	pit,
	imageId,
}) => {
	const queryClient = useQueryClient();
	const running = pit.outcome === "running";
	const [, tick] = useState(0);
	useEffect(() => {
		if (!running) {
			return;
		}
		const t = window.setInterval(() => tick((n) => n + 1), 1000);
		return () => window.clearInterval(t);
	}, [running]);
	const cancel = useMutation({
		mutationFn: () => ImagesAPI.cancelBuild(pit.target, pit.build),
		onSuccess: () =>
			void queryClient.invalidateQueries({ queryKey: imagesKey }),
		onError: (e) => toast.error(getErrorMessage(e, "Not cancelled.")),
	});
	const at = Math.max(
		0,
		STATIONS.findIndex(
			(s) => s.key === pit.steps.find((x) => x.state === "active")?.key,
		),
	);
	const station = pit.outcome === "on-track" ? STATIONS.length - 1 : at;
	const tail = pit.log.trim().split("\n").slice(-6);
	const history = pit.history ?? [];

	return (
		<section
			aria-label="Pit stop"
			data-testid="pit-lane"
			data-outcome={pit.outcome}
			className="w-full overflow-hidden rounded-(--ws-r-card) border border-solid border-(--ws-line) bg-(--ws-card)"
		>
			<div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-(--ws-row-line) px-[22px] py-3.5">
				<span
					className={cn(
						"flex size-8 items-center justify-center rounded-lg",
						pit.outcome === "on-track"
							? "bg-(--ws-go-bg) text-(--ws-go)"
							: pit.outcome === "running"
								? "bg-(--ws-on) text-(--ws-soft)"
								: "bg-(--ws-danger-bg) text-(--ws-danger)",
					)}
				>
					<CarGlyph />
				</span>
				<div className="min-w-0">
					<h2 className="m-0 text-sm font-semibold">
						{pit.outcome === "on-track"
							? "Back on the track"
							: pit.outcome === "running"
								? `In the pit · lap ${Math.max(pit.lap, 1)} of ${pit.laps}`
								: pit.outcome === "cancelled"
									? "Pit stop cancelled"
									: "Pit stop failed"}
					</h2>
					<p className="m-0 truncate text-xs text-(--ws-muted)">
						{pit.message}
					</p>
				</div>
				<span
					className="ws-mono ml-auto rounded-full border border-solid border-(--ws-line) bg-(--ws-chip) px-2.5 py-1 text-xs text-(--ws-text-2)"
					title="Pit time"
				>
					{clock(pit.startedAt, pit.finishedAt)}
				</span>
				{running && (
					<button
						type="button"
						className="ws-btn ws-hit h-8 rounded-(--ws-r-sm) px-3 text-[12.5px]"
						disabled={cancel.isPending}
						onClick={() => cancel.mutate()}
						data-testid="pit-cancel"
					>
						Cancel
					</button>
				)}
			</div>

			<ol
				className="pit-lane m-0 grid list-none grid-cols-5 px-[22px] pb-3 pt-5"
				aria-label="Pit lane"
			>
				{STATIONS.map((s, i) => {
					const done = i < station || pit.outcome === "on-track";
					const here = i === station && pit.outcome !== "on-track";
					return (
						<li
							key={s.key}
							className="relative flex flex-col items-center gap-2"
							data-state={done ? "done" : here ? "here" : "ahead"}
							aria-current={here ? "step" : undefined}
						>
							{i > 0 && (
								<span
									aria-hidden="true"
									className={cn(
										"pit-track absolute right-1/2 top-[13px] h-[3px] w-full",
										i <= station ? "pit-track-done" : "",
									)}
								/>
							)}
							<span
								className={cn(
									"relative z-1 flex size-[28px] items-center justify-center rounded-full border-2 border-solid text-[11px] font-semibold",
									done
										? "border-(--ws-go) bg-(--ws-go-bg) text-(--ws-go)"
										: here
											? running
												? "pit-here border-(--ws-accent) bg-(--ws-accent) text-(--ws-accent-ink)"
												: "border-(--ws-danger) bg-(--ws-danger-bg) text-(--ws-danger)"
											: "border-(--ws-radio-off) bg-(--ws-well) text-(--ws-muted)",
								)}
							>
								{here && running ? (
									<CarGlyph className="pit-car" />
								) : done ? (
									"✓"
								) : s.key === "pit-out" ? (
									"⚑"
								) : (
									i + 1
								)}
							</span>
							<span
								className={cn(
									"text-center text-[12px]",
									here ? "font-semibold text-(--ws-text)" : "text-(--ws-muted)",
								)}
							>
								{s.label}
							</span>
						</li>
					);
				})}
			</ol>

			{history.length > 0 && (
				<div
					className="flex flex-wrap gap-2 px-[22px] pb-3"
					data-testid="pit-laps"
				>
					{history.map((l) => (
						<LapChip key={l.lap} lap={l} total={pit.pairs.length} />
					))}
				</div>
			)}

			{pit.outcome === "on-track" ? (
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-0 border-t border-solid border-(--ws-row-line) bg-(--ws-inset) px-[22px] py-3.5 text-[13px]">
					<span>
						Grade <strong>{pit.before.grade ?? "?"}</strong> →{" "}
						<strong className="text-(--ws-go)">
							{pit.after?.grade ?? "?"}
						</strong>
					</span>
					<span>
						{pit.fixed ?? 0} of {pit.pairs.length} findings fixed
					</span>
					{pit.ref && (
						<span className="flex min-w-0 items-center gap-2">
							<span className="text-(--ws-muted)">Workspaces pull</span>
							<code className="ws-mono truncate rounded-(--ws-r-xs) border border-solid border-(--ws-line) bg-(--ws-chip) px-2 py-0.5 text-xs">
								{pit.ref}
							</code>
							<button
								type="button"
								className="ws-link-btn h-auto px-0 text-xs"
								onClick={() => {
									void navigator.clipboard?.writeText(pit.ref ?? "");
									toast.success("Copied");
								}}
							>
								Copy
							</button>
						</span>
					)}
					{pit.target !== imageId && (
						<RouterLink
							to={`/images/${pit.target}`}
							className="ws-quiet-link ml-auto text-[13px]"
						>
							Open {pit.target} →
						</RouterLink>
					)}
				</div>
			) : (
				(running || pit.error) && (
					<pre
						className="ws-mono m-0 max-h-[150px] overflow-auto border-0 border-t border-solid border-(--ws-row-line) bg-(--ws-code) px-[22px] py-3 text-[11.5px] leading-[1.55] text-(--ws-text-3)"
						data-testid="pit-log"
					>
						{pit.error && !running ? `${pit.error}\n\n` : ""}
						{tail.join("\n")}
					</pre>
				)
			)}
		</section>
	);
};

const LapChip: React.FC<{ lap: PitLap; total: number }> = ({ lap, total }) => (
	<span
		className={cn(
			"inline-flex items-center gap-2 rounded-full border border-solid px-3 py-1 text-xs",
			lap.status === "done"
				? "border-(--ws-line) bg-(--ws-chip) text-(--ws-text-2)"
				: lap.status === "failed"
					? "border-(--ws-danger) bg-(--ws-danger-bg) text-(--ws-danger)"
					: "border-(--ws-accent) text-(--ws-text)",
		)}
		data-testid="pit-lap"
	>
		<span className="font-semibold">Lap {lap.lap}</span>
		{lap.level && <span className="text-(--ws-muted)">{lap.level}</span>}
		{lap.status === "done" ? (
			<>
				<span>grade {lap.grade ?? "?"}</span>
				<span className="text-(--ws-muted)">
					{total - (lap.remaining ?? 0)}/{total} fixed
				</span>
			</>
		) : lap.status === "failed" ? (
			<span title={lap.error}>failed</span>
		) : (
			<span className="text-(--ws-muted)">patching…</span>
		)}
	</span>
);
