import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	BACKGROUND_SLOTS,
	type BackgroundDials,
	type BackgroundFit,
	type BackgroundImage,
	type BackgroundLayer,
	type BackgroundParams,
	type BackgroundSlot,
	type BackgroundsState,
	PlatformAPI,
} from "#/api/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { setBackground } from "#/contexts/platformBoot";
import { GalleryPicker } from "../gallery/GalleryPicker";
import { formatBytes } from "../images";
import { sniffImageType } from "../normalizeImage";
import { PREBAKED_BACKGROUNDS } from "../pictures";
import { CONTROLLER, DIALS } from "./backgroundHtml";
import {
	CustomHtmlEditor,
	DialControls,
	HtmlPreviewFrame,
	type HtmlSource,
	HtmlSourcePicker,
	ParticlesControls,
} from "./HtmlBackgroundControls";
import { backgroundStyle } from "./PlatformBackground";
import {
	type ParticlesSettings,
	particlesHTML,
	particlesSettings,
} from "./particles";

const QUERY_KEY = ["platform", "backgrounds"] as const;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1200;
const MAX_BYTES = 4 * 1024 * 1024;

const SLOT_TEXT: Record<BackgroundSlot, { title: string; hint: string }> = {
	login: {
		title: "Sign-in page",
		hint: "Behind the sign-in form, for everyone, before they sign in.",
	},
	dashboard: {
		title: "Dashboard",
		hint: "Behind every page once signed in.",
	},
};

const FITS: { value: BackgroundFit; label: string }[] = [
	{ value: "cover", label: "Fill the window" },
	{ value: "contain", label: "Fit inside" },
	{ value: "tile", label: "Tile" },
];

/**
 * A picture ready to store: an animated GIF as it is (so it keeps moving),
 * anything else scaled to at most 1920 × 1200 and saved as WebP (else JPEG),
 * which keeps photographs small.
 */
export const prepareBackground = async (
	file: File,
): Promise<{ dataURL: string; bytes: number }> => {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const type = sniffImageType(bytes);
	if (!type || type === "image/svg+xml") {
		throw new Error("Choose a PNG, JPEG, WebP, GIF or AVIF image.");
	}
	if (type === "image/gif" && bytes.length <= MAX_BYTES) {
		const dataURL = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(new Error("The file could not be read."));
			reader.readAsDataURL(new Blob([bytes], { type }));
		});
		return { dataURL, bytes: bytes.length };
	}
	const bitmap = await createImageBitmap(new Blob([bytes], { type }));
	const scale = Math.min(
		1,
		MAX_WIDTH / bitmap.width,
		MAX_HEIGHT / bitmap.height,
	);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	for (const quality of [0.85, 0.7, 0.55]) {
		let dataURL = canvas.toDataURL("image/webp", quality);
		if (!dataURL.startsWith("data:image/webp")) {
			dataURL = canvas.toDataURL("image/jpeg", quality);
		}
		const size = Math.round((dataURL.length - dataURL.indexOf(",") - 1) * 0.75);
		if (size <= MAX_BYTES) {
			return { dataURL, bytes: size };
		}
	}
	throw new Error("That picture is too large, even made smaller.");
};

/**
 * Admin settings > Customize > Background image: a faint picture behind the
 * sign-in page and behind the dashboard, each with its own image, strength,
 * fit and layer. It is an extra layer on the page; none of Coder's own styles
 * change, and at the default strength it is barely there.
 */
export const BackgroundSection: React.FC = () => {
	const query = useQuery({
		queryKey: QUERY_KEY,
		queryFn: PlatformAPI.getBackgrounds,
	});

	return (
		<section
			aria-labelledby="customize-background"
			className="mt-10 border-0 border-t border-solid border-border pt-8"
		>
			<h2 id="customize-background" className="m-0 mb-2 text-2xl font-semibold">
				Background image
			</h2>
			<p className="m-0 mb-6 max-w-3xl text-sm font-medium text-content-secondary">
				A faint picture behind the sign-in page and the dashboard. By default it
				lies beneath everything on the page, mixed into the page's own
				background colour, so the pages keep their look and their text stays
				readable; it can also lie over the page as a watermark. Either way the
				mouse never notices it.
			</p>
			{query.isLoading ? (
				<Loader />
			) : !query.data ? (
				<ErrorAlert error={query.error} />
			) : (
				<div className="grid gap-6 lg:grid-cols-2">
					{BACKGROUND_SLOTS.map((slot) => (
						<BackgroundCard key={slot} slot={slot} state={query.data} />
					))}
				</div>
			)}
		</section>
	);
};

type Draft = {
	/** A picture, the Particles preset, or HTML of one's own. */
	source: "image" | HtmlSource;
	dataURL?: string;
	name?: string;
	bytes?: number;
	html: string;
	particles: ParticlesSettings;
	dials: BackgroundDials;
	opacity: number;
	fit: BackgroundFit;
	layer: BackgroundLayer;
	/** Something differs from what is saved. */
	dirty: boolean;
};

const DIAL_KEYS = Object.keys(DIALS) as (keyof BackgroundDials)[];
const dialsOf = (params: BackgroundParams | undefined): BackgroundDials => {
	const out: BackgroundDials = {};
	for (const key of DIAL_KEYS) {
		if (typeof params?.[key] === "number") {
			out[key] = params[key];
		}
	}
	return out;
};

/** The HTML a stored background was saved with (the service serves it with its speed controller added). */
const savedHtml = async (url: string) =>
	(await (await fetch(url, { credentials: "same-origin" })).text()).replace(
		CONTROLLER,
		"",
	);

const BackgroundCard: React.FC<{
	slot: BackgroundSlot;
	state: BackgroundsState;
}> = ({ slot, state }) => {
	const queryClient = useQueryClient();
	const current = state[slot];
	const limits = state.limits.opacity;
	const htmlMax = state.limits.htmlMaxBytes ?? 256 * 1024;
	const fresh = (): Draft => {
		const preset = current?.params?.preset;
		return {
			source:
				current?.kind !== "html"
					? "image"
					: preset?.name === "particles"
						? "particles"
						: "custom",
			html: "",
			particles: particlesSettings(preset),
			dials: dialsOf(current?.params),
			opacity: current?.opacity ?? limits.default,
			fit: current?.fit ?? "cover",
			layer: current?.layer ?? "under",
			dirty: false,
		};
	};
	const [draft, setDraft] = useState<Draft>(fresh);
	const change = (patch: Partial<Draft>) =>
		setDraft((d) => ({ ...d, ...patch, dirty: true }));
	const [galleryPick, setGalleryPick] = useState<string>();
	const [problem, setProblem] = useState<string>();
	const [preparing, setPreparing] = useState(false);
	const [loadingHtml, setLoadingHtml] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// A save elsewhere (or the first load) resets the draft; a refetch of the same values does not.
	const savedParams = JSON.stringify(current?.params ?? {});
	useEffect(() => {
		setDraft(fresh());
		setGalleryPick(undefined);
	}, [
		current?.url,
		current?.opacity,
		current?.fit,
		current?.layer,
		savedParams,
	]);

	// Editing a saved custom HTML background: its HTML, as it was saved.
	const savedUrl =
		current?.kind === "html" && current.params?.preset === undefined
			? current.url
			: undefined;
	const needHtml = draft.source === "custom" && !draft.html && savedUrl;
	useEffect(() => {
		if (!needHtml || !savedUrl) {
			return;
		}
		let cancelled = false;
		setLoadingHtml(true);
		savedHtml(savedUrl)
			.then((html) => {
				if (!cancelled) {
					setDraft((d) => (d.html ? d : { ...d, html }));
				}
			})
			.catch(() => {
				// It stays empty; pasting or importing replaces it.
			})
			.finally(() => {
				if (!cancelled) {
					setLoadingHtml(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [needHtml, savedUrl]);

	const html =
		draft.source === "particles"
			? particlesHTML(draft.particles)
			: draft.source === "custom"
				? draft.html
				: "";

	const save = useMutation({
		mutationFn: () =>
			PlatformAPI.saveBackground(slot, {
				...(draft.source === "image"
					? draft.dataURL
						? { dataUrl: draft.dataURL }
						: {}
					: {
							html,
							params: {
								...draft.dials,
								...(draft.source === "particles"
									? { preset: draft.particles }
									: {}),
							},
						}),
				opacity: draft.opacity,
				fit: draft.fit,
				layer: draft.layer,
			}),
		onSuccess: (result) => {
			setBackground(slot, result[slot] ?? null);
			void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			toast.success(`${SLOT_TEXT[slot].title}: background saved.`);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "The background could not be saved.")),
	});
	const remove = useMutation({
		mutationFn: () => PlatformAPI.resetBackground(slot),
		onSuccess: () => {
			setBackground(slot, null);
			void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
			toast.success(`${SLOT_TEXT[slot].title}: background removed.`);
		},
		onError: (error) =>
			toast.error(
				getErrorMessage(error, "The background could not be removed."),
			),
	});

	const pick = async (file: File, fromGallery?: string) => {
		setProblem(undefined);
		setPreparing(true);
		try {
			const ready = await prepareBackground(file);
			change({ ...ready, name: file.name, source: "image" });
			setGalleryPick(fromGallery);
		} catch (error) {
			setProblem(
				`${file.name}: ${error instanceof Error ? error.message : "this browser cannot read it as a picture."}`,
			);
		} finally {
			setPreparing(false);
		}
	};

	const isHtml = draft.source !== "image";
	const imageURL =
		draft.source === "image"
			? (draft.dataURL ?? (current?.kind !== "html" ? current?.url : undefined))
			: undefined;
	const htmlBytes = new TextEncoder().encode(html).length;
	const ready = isHtml
		? html.trim().length > 0 && htmlBytes <= htmlMax && !loadingHtml
		: Boolean(imageURL);
	const busy = save.isPending || remove.isPending || preparing;
	const preview: BackgroundImage | null = imageURL
		? {
				url: imageURL,
				opacity: draft.opacity,
				fit: draft.fit,
				layer: draft.layer,
			}
		: null;

	return (
		<div
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-5"
			data-testid={`background-${slot}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="m-0 text-base font-semibold">
						{SLOT_TEXT[slot].title}
					</h3>
					<p className="m-0 mt-1 text-sm text-content-secondary">
						{SLOT_TEXT[slot].hint}
					</p>
				</div>
				<Badge variant={current ? "green" : "default"}>
					{current
						? current.kind === "html"
							? current.params?.preset?.name === "particles"
								? "Particles"
								: "HTML"
							: "Picture"
						: "None"}
				</Badge>
			</div>

			<BackgroundPreview
				slot={slot}
				image={preview}
				html={isHtml && ready ? html : undefined}
				dials={draft.dials}
				opacity={draft.opacity}
				layer={draft.layer}
			/>

			<div className="flex flex-wrap items-center gap-3">
				<Button
					variant="outline"
					disabled={busy || !state.available}
					onClick={() => inputRef.current?.click()}
				>
					<Spinner loading={preparing} />
					Choose an image…
				</Button>
				<input
					ref={inputRef}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
					aria-label={`Choose the ${SLOT_TEXT[slot].title.toLowerCase()} background image`}
					className="hidden"
					onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						if (file) {
							void pick(file);
						}
					}}
				/>
				<span className="min-w-0 truncate text-sm text-content-secondary">
					{isHtml
						? `${draft.source === "particles" ? "Particles" : "Your own HTML"}, ${formatBytes(htmlBytes)}${draft.dirty ? " (not saved yet)" : ""}`
						: draft.name
							? `${draft.name}${draft.bytes ? `, ${formatBytes(draft.bytes)}` : ""} (not saved yet)`
							: current && current.kind !== "html"
								? `${current.type.replace("image/", "").toUpperCase()}, ${formatBytes(current.bytes)}${current.updatedBy ? ` · by ${current.updatedBy}` : ""}`
								: "No image."}
				</span>
			</div>
			<GalleryPicker
				label="Or use one of the provided pictures:"
				extra={PREBAKED_BACKGROUNDS}
				selected={draft.source === "image" ? galleryPick : undefined}
				onSelect={setGalleryPick}
				disabled={busy}
				onPick={(file) => void pick(file, file.name)}
			/>
			<HtmlSourcePicker
				selected={isHtml ? (draft.source as HtmlSource) : undefined}
				disabled={busy}
				onSelect={(source) => {
					setProblem(undefined);
					setGalleryPick(undefined);
					change({ source, dataURL: undefined, name: undefined });
				}}
			/>
			{problem && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{problem}
				</p>
			)}

			{draft.source === "particles" && (
				<ParticlesControls
					value={draft.particles}
					disabled={busy}
					onChange={(particles) => change({ particles })}
				/>
			)}
			{draft.source === "custom" && (
				<CustomHtmlEditor
					html={draft.html}
					maxBytes={htmlMax}
					loading={loadingHtml}
					disabled={busy}
					onChange={(next) => change({ html: next })}
					onProblem={setProblem}
				/>
			)}
			{isHtml && (
				<DialControls
					value={draft.dials}
					disabled={busy}
					onChange={(dials) => change({ dials })}
				/>
			)}

			<label className="flex flex-col gap-1.5 text-sm">
				<span className="flex justify-between font-medium">
					Strength
					<span className="tabular-nums text-content-secondary">
						{Math.round(draft.opacity * 100)}%
					</span>
				</span>
				<input
					type="range"
					min={Math.round(limits.min * 100)}
					max={Math.round(limits.max * 100)}
					step={1}
					value={Math.round(draft.opacity * 100)}
					disabled={busy}
					onChange={(event) =>
						change({ opacity: Number(event.target.value) / 100 })
					}
					aria-label={`${SLOT_TEXT[slot].title} background strength`}
				/>
				<span className="text-xs text-content-secondary">
					{Math.round(limits.default * 100)}% (the default) is barely
					noticeable; keep it low so text stays easy to read.
				</span>
			</label>

			<div className="grid gap-3 sm:grid-cols-2">
				{!isHtml && (
					<label className="flex flex-col gap-1.5 text-sm font-medium">
						Fit
						<select
							value={draft.fit}
							disabled={busy}
							onChange={(event) =>
								change({ fit: event.target.value as BackgroundFit })
							}
							className="h-9 rounded-md border border-solid border-border bg-surface-primary px-2 text-sm text-content-primary"
						>
							{FITS.map((f) => (
								<option key={f.value} value={f.value}>
									{f.label}
								</option>
							))}
						</select>
					</label>
				)}
				<fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0 text-sm">
					<legend className="mb-1.5 p-0 font-medium">Layer</legend>
					{(
						[
							["under", "Behind the page (recommended)"],
							["over", "Over the page, as a watermark"],
						] as const
					).map(([value, label]) => (
						<label key={value} className="flex items-center gap-2">
							<input
								type="radio"
								name={`background-layer-${slot}`}
								checked={draft.layer === value}
								disabled={busy}
								onChange={() => change({ layer: value })}
							/>
							{label}
						</label>
					))}
				</fieldset>
			</div>

			<div className="flex flex-wrap gap-3">
				<Button
					disabled={busy || !draft.dirty || !ready}
					onClick={() => save.mutate()}
				>
					<Spinner loading={save.isPending} />
					Save
				</Button>
				{draft.dirty && (
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => {
							setDraft(fresh());
							setGalleryPick(undefined);
							setProblem(undefined);
						}}
					>
						Discard changes
					</Button>
				)}
				{current && (
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => remove.mutate()}
					>
						<Spinner loading={remove.isPending} />
						Remove
					</Button>
				)}
			</div>
		</div>
	);
};

/** A small page with the background as it will be: same strength, fit and layer. */
const BackgroundPreview: React.FC<{
	slot: BackgroundSlot;
	image: BackgroundImage | null;
	html?: string;
	dials: BackgroundDials;
	opacity: number;
	layer: BackgroundLayer;
}> = ({ slot, image, html, dials, opacity, layer }) => {
	const htmlLayer = html ? (
		<HtmlPreviewFrame
			html={html}
			dials={dials}
			className={cn(
				"absolute inset-0 h-[300%] w-[300%] origin-top-left scale-[0.3333]",
				layer === "under" ? "-z-10" : "z-10",
			)}
			style={{ opacity }}
		/>
	) : null;
	return (
		<div
			className="relative isolate h-44 overflow-hidden rounded-md border border-solid border-border bg-surface-primary"
			aria-label="Preview"
			role="img"
		>
			{layer === "under" && htmlLayer}
			{image && image.layer === "under" && (
				<div
					className="absolute inset-0 -z-10"
					style={backgroundStyle(image)}
				/>
			)}
			{slot === "login" ? (
				<div className="flex h-full flex-col items-center justify-center gap-2">
					<span className="h-5 w-16 rounded bg-content-secondary/40" />
					<span className="h-7 w-40 rounded-md border border-solid border-border bg-surface-primary" />
					<span className="h-7 w-40 rounded-md border border-solid border-border bg-surface-primary" />
					<span className="h-7 w-40 rounded-md bg-content-primary/80" />
				</div>
			) : (
				<div className="flex h-full flex-col">
					<div className="flex h-8 items-center gap-2 border-0 border-b border-solid border-border px-3">
						<span className="h-3 w-10 rounded bg-content-secondary/40" />
						<span className="h-3 w-16 rounded bg-content-secondary/25" />
						<span className="h-3 w-12 rounded bg-content-secondary/25" />
					</div>
					<div className="flex flex-1 flex-col gap-2 p-4">
						<span className="h-4 w-40 rounded bg-content-secondary/40" />
						<span className="h-3 w-64 rounded bg-content-secondary/25" />
						<span className="h-14 w-full rounded-md border border-solid border-border" />
					</div>
				</div>
			)}
			{layer === "over" && htmlLayer}
			{image && image.layer === "over" && (
				<div
					className="pointer-events-none absolute inset-0"
					style={backgroundStyle(image)}
				/>
			)}
			{!image && !html && (
				<span className="absolute right-2 bottom-2 text-xs text-content-secondary">
					No background
				</span>
			)}
		</div>
	);
};
