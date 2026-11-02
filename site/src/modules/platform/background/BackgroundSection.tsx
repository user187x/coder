import { useImperativeHandle, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import type {
	BackgroundFit,
	BackgroundImage,
	BackgroundSlot,
	BackgroundsState,
} from "#/api/platform";
import {
	backgroundHTML,
	backgrounds,
	resetBackground,
	saveBackground,
} from "#/api/queries/backgrounds";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Label } from "#/components/Label/Label";
import { LAVA_BACKGROUND_DEFAULT, lavaHTML } from "#/components/LavaImage/lava";
import { Loader } from "#/components/Loader/Loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { setBackground } from "#/contexts/platformBoot";
import { formatBytes } from "#/utils/images";
import { FillControls } from "../fill/FillControls";
import { fillHTML } from "../fill/fill";
import { ImageUploadSplit } from "../imageStore/ImageUploadSplit";
import { LavaControls } from "../lava/LavaControls";
import { PREBAKED_BACKGROUNDS } from "../pictures";
import { BackgroundPreview } from "./BackgroundPreview";
import {
	backgroundDraft,
	type Draft,
	FITS,
	SLOT_TEXT,
} from "./backgroundDraft";
import {
	CustomHtmlEditor,
	DialControls,
	ParticlesControls,
} from "./HtmlBackgroundControls";
import { particlesHTML } from "./particles";
import { prepareBackground } from "./prepareBackground";

export type BackgroundEditorHandle = {
	dirty: boolean;
	ready: boolean;
	save: () => Promise<unknown>;
	reset: () => void;
};

export const BackgroundSection: React.FC = () => {
	const query = useQuery(backgrounds());
	return (
		<section
			aria-label="Dashboard background"
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<h2 className="m-0 mb-2 text-lg font-semibold">Dashboard background</h2>
			<p className="m-0 mb-5 text-sm text-content-secondary">
				Set the background behind signed-in pages.
			</p>
			{query.error && <ErrorAlert error={query.error} />}
			{query.isLoading ? (
				<Loader />
			) : (
				query.data && <BackgroundCard slot="dashboard" state={query.data} />
			)}
		</section>
	);
};

export const BackgroundCard: React.FC<{
	slot: BackgroundSlot;
	state: BackgroundsState;
	managed?: boolean;
	controls?: React.ReactNode;
	previewContent?: React.ReactNode;
	previewHeader?: React.ReactNode;
	disabled?: boolean;
	onDirtyChange?: (dirty: boolean) => void;
	ref?: React.Ref<BackgroundEditorHandle>;
}> = ({
	slot,
	state,
	managed,
	ref,
	controls,
	previewContent,
	previewHeader,
	disabled,
	onDirtyChange,
}) => {
	const queryClient = useQueryClient();
	const current = state[slot];
	const limits = state.limits.opacity;
	const htmlMax = state.limits.htmlMaxBytes ?? 256 * 1024;
	const savedUrl =
		current?.kind === "html" &&
		!["particles", "lava", "fill"].includes(current.params?.preset?.name ?? "")
			? current.url
			: undefined;
	const htmlQuery = useQuery(backgroundHTML(savedUrl));

	const [edited, setDraft] = useState<Draft | null>(null);
	const draft = edited ?? backgroundDraft(current, limits.default);
	const customHtml = draft.html ?? htmlQuery.data ?? "";
	const change = (patch: Partial<Draft>) => {
		setDraft({ ...draft, removed: false, ...patch, dirty: true });
		onDirtyChange?.(true);
	};
	const [galleryPick, setGalleryPick] = useState<string>();
	const [problem, setProblem] = useState<string>();
	const [preparing, setPreparing] = useState(false);
	const loadingHtml = Boolean(savedUrl) && htmlQuery.isLoading;
	const inputRef = useRef<HTMLInputElement>(null);

	const html =
		draft.source === "fill"
			? fillHTML(draft.fill)
			: draft.source === "particles"
				? particlesHTML(draft.particles)
				: draft.source === "lava"
					? lavaHTML(draft.lava, draft.fit)
					: draft.source === "custom"
						? customHtml
						: "";

	const saveOptions = saveBackground(queryClient, slot);
	const resetOptions = resetBackground(queryClient, slot);
	const reset = () => {
		setDraft(null);
		setGalleryPick(undefined);
		setProblem(undefined);
		onDirtyChange?.(false);
	};
	const body = {
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
						...(draft.source === "fill"
							? { preset: draft.fill }
							: draft.source === "particles"
								? { preset: draft.particles }
								: draft.source === "lava"
									? { preset: { ...draft.lava, fit: draft.fit } }
									: {}),
					},
				}),
		opacity: draft.opacity,
		fit: draft.fit,
		layer: draft.layer,
	};
	const save = useMutation({
		...saveOptions,
		onSuccess: async (result) => {
			await saveOptions.onSuccess(result);
			setBackground(slot, result[slot] ?? null);
			reset();
			toast.success(`${SLOT_TEXT[slot].title}: background saved.`);
		},
	});
	const remove = useMutation({
		...resetOptions,
		onSuccess: async () => {
			await resetOptions.onSuccess();
			setBackground(slot, null);
			reset();
			toast.success(`${SLOT_TEXT[slot].title}: background removed.`);
		},
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
		save: () => (draft.removed ? remove.mutateAsync() : save.mutateAsync(body)),
		reset,
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
			className="grid items-start gap-6 xl:grid-cols-2"
			data-testid={`background-${slot}`}
		>
			<fieldset
				disabled={disabled || busy || !state.available}
				className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
			>
				{controls}
				<h3 className="m-0 text-sm font-semibold">Background</h3>
				{htmlQuery.error && <ErrorAlert error={htmlQuery.error} />}
				{save.error && <ErrorAlert error={save.error} />}
				{remove.error && <ErrorAlert error={remove.error} />}
				<div className="flex flex-wrap items-center gap-3">
					{/* Platform: Upload, its arrow the image store in a dialog (its animated previews only while open) */}
					<ImageUploadSplit
						testId={`background-${slot}-image`}
						title={`${SLOT_TEXT[slot].title} background: the image store`}
						onUpload={() => inputRef.current?.click()}
						disabled={disabled || busy || !state.available}
						busy={preparing}
						gallery={{
							extra: PREBAKED_BACKGROUNDS,
							onFill: (fill) =>
								change({
									source: "fill",
									fill,
									opacity: limits.max,
									dials: {},
								}),
							// Drawn live as the Lava lamp source, not as a picture.
							onLava: (lava) => {
								setProblem(undefined);
								setGalleryPick(undefined);
								change({
									source: "lava",
									lava: { ...lava, size: Math.min(lava.size, 60) },
									fit: "contain",
									dataURL: undefined,
									picture: undefined,
									name: undefined,
								});
							},
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
						{draft.source === "fill"
							? `Color or gradient${draft.dirty ? " (not saved yet)" : ""}`
							: isHtml
								? `${draft.source === "particles" ? "Particles" : draft.source === "lava" ? "Lava lamp" : "Your own HTML"}, ${formatBytes(htmlBytes)}${draft.dirty ? " (not saved yet)" : ""}`
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
								source !== "lava" &&
								source !== "custom" &&
								source !== "fill"
							)
								return;
							setProblem(undefined);
							setGalleryPick(undefined);
							change({
								source,
								dataURL: undefined,
								picture: undefined,
								name: undefined,
								...(source === "lava" ? { fit: "contain" } : {}),
								...(source === "fill"
									? { opacity: limits.max, dials: {} }
									: {}),
							});
						}}
					>
						<SelectTrigger id={`background-source-${slot}`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="image">Picture</SelectItem>
							<SelectItem value="fill">Color or gradient</SelectItem>
							<SelectItem value="particles">Animated particles</SelectItem>
							<SelectItem value="lava">Lava lamp</SelectItem>
							<SelectItem value="custom">Custom HTML / CSS</SelectItem>
						</SelectContent>
					</Select>
				</div>
				{problem && (
					<p role="alert" className="m-0 text-sm text-content-destructive">
						{problem}
					</p>
				)}

				{draft.source === "fill" && (
					<FillControls
						value={draft.fill}
						onChange={(fill) => change({ fill })}
						disabled={busy}
					/>
				)}
				{draft.source === "particles" && (
					<ParticlesControls
						value={draft.particles}
						disabled={busy}
						onChange={(particles) => change({ particles })}
					/>
				)}
				{draft.source === "lava" && (
					<fieldset className="m-0 rounded-md border border-solid border-border p-3">
						<legend className="px-1 text-sm font-semibold">Lava lamp</legend>
						<LavaControls
							value={draft.lava}
							defaults={LAVA_BACKGROUND_DEFAULT}
							disabled={busy}
							onChange={(lava) => change({ lava })}
						/>
					</fieldset>
				)}
				{draft.source === "custom" && (
					<CustomHtmlEditor
						html={customHtml}
						maxBytes={htmlMax}
						loading={loadingHtml}
						disabled={busy}
						onChange={(next) => change({ html: next })}
						onProblem={setProblem}
					/>
				)}
				{isHtml && draft.source !== "fill" && (
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
						{draft.source === "fill"
							? "100% shows the selected colors at full strength."
							: `${Math.round(limits.default * 100)}% (the default) is barely noticeable; keep it low so text stays easy to read.`}
					</span>
				</label>

				<div className="grid gap-3 sm:grid-cols-2">
					{(!isHtml || draft.source === "lava") && (
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
							onClick={() =>
								draft.removed ? remove.mutate() : save.mutate(body)
							}
						>
							<Spinner loading={save.isPending} />
							Save
						</Button>
					)}
					{draft.dirty && !managed && (
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => {
								reset();
							}}
						>
							Discard changes
						</Button>
					)}
					{current && (
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => change({ removed: true })}
						>
							<Spinner loading={remove.isPending} />
							{draft.removed ? "Removal pending save" : "Remove"}
						</Button>
					)}
				</div>
			</fieldset>
			<div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-20">
				{previewHeader ?? <span className="text-sm font-medium">Preview</span>}
				<BackgroundPreview
					slot={slot}
					image={preview}
					html={isHtml && ready && !draft.removed ? html : undefined}
					dials={draft.dials}
					opacity={draft.opacity}
					layer={draft.layer}
				>
					{previewContent}
				</BackgroundPreview>
			</div>
		</div>
	);
};
