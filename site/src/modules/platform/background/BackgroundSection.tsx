import { cn } from "cn";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
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
import { backgrounds, backgroundsKey } from "#/api/queries/backgrounds";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import { setBackground } from "#/contexts/platformBoot";
import { ImageUploadSplit } from "../imageStore/ImageUploadSplit";
import { formatBytes } from "../images";
import { sniffImageType } from "../normalizeImage";
import { PREBAKED_BACKGROUNDS } from "../pictures";
import { CONTROLLER, DIALS } from "./backgroundHtml";
import {
	CustomHtmlEditor,
	DialControls,
	HtmlPreviewFrame,
	type HtmlSource,
	ParticlesControls,
} from "./HtmlBackgroundControls";
import { backgroundStyle } from "./PlatformBackground";
import {
	type ParticlesSettings,
	particlesHTML,
	particlesSettings,
} from "./particles";

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
type BackgroundEditorHandle = {
	dirty: boolean;
	ready: boolean;
	save: () => Promise<unknown>;
};

export const BackgroundSection: React.FC = () => {
	const [active, setActive] = useState<BackgroundSlot>("dashboard");
	const editors = useRef<
		Partial<Record<BackgroundSlot, BackgroundEditorHandle>>
	>({});
	const saveAll = useMutation({
		mutationFn: async () => {
			for (const slot of BACKGROUND_SLOTS) {
				const editor = editors.current[slot];
				if (editor?.dirty && !editor.ready)
					throw new Error(
						`${SLOT_TEXT[slot].title}: finish choosing a background before saving.`,
					);
			}
			for (const slot of BACKGROUND_SLOTS) {
				const editor = editors.current[slot];
				if (editor?.dirty) await editor.save();
			}
		},
	});
	const query = useQuery(backgrounds());

	return (
		<section
			aria-labelledby="customize-background"
			className="mt-10 border-0 border-t border-solid border-border pt-8"
		>
			<h2 id="customize-background" className="m-0 mb-2 text-lg font-semibold">
				Background image
			</h2>
			<p className="m-0 mb-4 text-sm text-content-secondary">
				Edit both backgrounds before saving. Switching views keeps your unsaved
				changes.
			</p>

			{query.isLoading ? (
				<Loader />
			) : !query.data ? (
				<ErrorAlert error={query.error} />
			) : (
				<div>
					<Tabs
						value={active}
						onValueChange={(value) => {
							if (value === "login" || value === "dashboard") setActive(value);
						}}
					>
						<TabsList aria-label="Background to edit">
							<TabsTrigger value="dashboard">Dashboard</TabsTrigger>
							<TabsTrigger value="login">Sign-in / sign-out</TabsTrigger>
						</TabsList>
						{BACKGROUND_SLOTS.map((slot) => (
							<TabsContent
								key={slot}
								value={slot}
								forceMount
								className="data-[state=inactive]:hidden"
							>
								<BackgroundCard
									slot={slot}
									state={query.data}
									managed
									ref={(handle) => {
										editors.current[slot] = handle ?? undefined;
									}}
								/>
							</TabsContent>
						))}
					</Tabs>
					{saveAll.error && <ErrorAlert error={saveAll.error} />}
					<Button
						className="mt-3"
						disabled={saveAll.isPending || !query.data.available}
						onClick={() => saveAll.mutate()}
					>
						Save backgrounds
					</Button>
				</div>
			)}
		</section>
	);
};

type Draft = {
	removed?: boolean;
	/** A picture, the Particles preset, or HTML of one's own. */
	source: "image" | HtmlSource;
	dataURL?: string;
	/** One of the dashboard's own pictures, by its path: saved as that, not uploaded. */
	picture?: string;
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
	managed?: boolean;
	ref?: React.Ref<BackgroundEditorHandle>;
}> = ({ slot, state, managed, ref }) => {
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
		setDraft((d) => ({ ...d, removed: false, ...patch, dirty: true }));
	const [galleryPick, setGalleryPick] = useState<string>();
	const [problem, setProblem] = useState<string>();
	const [preparing, setPreparing] = useState(false);
	const [loadingHtml, setLoadingHtml] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Saving the other slot or refetching must not discard this slot's unsaved edits.
	const savedParams = JSON.stringify(current?.params ?? {});
	useEffect(() => {
		setDraft((previous) => (previous.dirty ? previous : fresh()));
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
					? draft.picture
						? { picture: draft.picture }
						: draft.dataURL
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
			setDraft((previous) => ({ ...previous, dirty: false }));
			setBackground(slot, result[slot] ?? null);
			void queryClient.invalidateQueries({ queryKey: backgroundsKey });
			toast.success(`${SLOT_TEXT[slot].title}: background saved.`);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "The background could not be saved.")),
	});
	const remove = useMutation({
		mutationFn: () => PlatformAPI.resetBackground(slot),
		onSuccess: () => {
			setDraft((previous) => ({ ...previous, removed: false, dirty: false }));
			setBackground(slot, null);
			void queryClient.invalidateQueries({ queryKey: backgroundsKey });
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
			change({
				...ready,
				name: file.name,
				source: "image",
				picture: undefined,
			});
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
			? (draft.picture ??
				draft.dataURL ??
				(current?.kind !== "html" ? current?.url : undefined))
			: undefined;
	const htmlBytes = new TextEncoder().encode(html).length;
	const ready =
		draft.removed ||
		(isHtml
			? html.trim().length > 0 && htmlBytes <= htmlMax && !loadingHtml
			: Boolean(imageURL));
	const busy = save.isPending || remove.isPending || preparing;
	useImperativeHandle(ref, () => ({
		dirty: draft.dirty,
		ready: ready && !busy,
		save: () => (draft.removed ? remove.mutateAsync() : save.mutateAsync()),
	}));
	const preview: BackgroundImage | null =
		!draft.removed && imageURL
			? {
					url: imageURL,
					opacity: draft.opacity,
					fit: draft.fit,
					layer: draft.layer,
				}
			: null;

	return (
		<div
			className="grid gap-4 rounded-lg border border-solid border-border p-4 lg:grid-cols-2"
			data-testid={`background-${slot}`}
		>
			<div className="flex items-start justify-between gap-3 lg:col-span-2">
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
				html={isHtml && ready && !draft.removed ? html : undefined}
				dials={draft.dials}
				opacity={draft.opacity}
				layer={draft.layer}
			/>

			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex flex-wrap items-center gap-3">
					{/* Platform: Upload, its arrow the image store in a dialog (its animated previews only while open) */}
					<ImageUploadSplit
						testId={`background-${slot}-image`}
						title={`${SLOT_TEXT[slot].title} background: the image store`}
						onUpload={() => inputRef.current?.click()}
						disabled={busy || !state.available}
						busy={preparing}
						gallery={{
							extra: PREBAKED_BACKGROUNDS,
							selected: draft.source === "image" ? galleryPick : undefined,
							onSelect: setGalleryPick,
							disabled: busy,
							onPick: (file) => void pick(file, file.name),
							// The dashboard's own pictures are saved as their path: no upload, nothing to go missing.
							onPickBuiltin: (picture) => {
								setProblem(undefined);
								setGalleryPick(picture.name);
								change({
									source: "image",
									picture: picture.url,
									dataURL: undefined,
									bytes: undefined,
									name: picture.name,
								});
							},
						}}
					/>
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
									? `${current.type.replace("image/", "").toUpperCase()}, ${formatBytes(current.bytes)}${current.builtin ? " · built into the dashboard" : ""}${current.updatedBy ? ` · by ${current.updatedBy}` : ""}`
									: "No image."}
					</span>
				</div>
				<div className="flex items-center gap-3">
					<Label htmlFor={`background-source-${slot}`}>Source</Label>
					<Select
						value={draft.source}
						onValueChange={(source) => {
							if (
								source !== "image" &&
								source !== "particles" &&
								source !== "custom"
							)
								return;
							setProblem(undefined);
							setGalleryPick(undefined);
							change({
								source,
								dataURL: undefined,
								picture: undefined,
								name: undefined,
							});
						}}
					>
						<SelectTrigger id={`background-source-${slot}`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="image">Picture</SelectItem>
							<SelectItem value="particles">Animated particles</SelectItem>
							<SelectItem value="custom">Custom HTML / CSS</SelectItem>
						</SelectContent>
					</Select>
				</div>
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
					{!managed && (
						<Button
							disabled={busy || !draft.dirty || !ready}
							onClick={() => save.mutate()}
						>
							<Spinner loading={save.isPending} />
							Save
						</Button>
					)}
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
							onClick={() =>
								managed ? change({ removed: true }) : remove.mutate()
							}
						>
							<Spinner loading={remove.isPending} />
							{draft.removed ? "Removal pending save" : "Remove"}
						</Button>
					)}
				</div>
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
