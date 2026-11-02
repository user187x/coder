import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import {
	LOGIN_EFFECTS,
	LOGIN_PAGE_DEFAULT,
	type LoginEffect,
	type LoginPageSettings,
} from "#/api/platform";
import { backgrounds } from "#/api/queries/backgrounds";
import { loginPage, updateLoginPage } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Slider } from "#/components/Slider/Slider";
import { Spinner } from "#/components/Spinner/Spinner";
import { Tabs, TabsList, TabsTrigger } from "#/components/Tabs/Tabs";
import { Textarea } from "#/components/Textarea/Textarea";
import { ColorField } from "#/modules/platform/ColorField";
import { getApplicationName } from "#/utils/appearance";
import {
	BackgroundCard,
	type BackgroundEditorHandle,
} from "../background/BackgroundSection";
import { ImageUploadSplit } from "../imageStore/ImageUploadSplit";
import { PREBAKED_BACKGROUNDS } from "../pictures";
import { SignInTitle } from "./SignInTitle";

const EFFECT_LABEL: Record<LoginEffect, { name: string; hint: string }> = {
	wireframe: {
		name: "Wireframe",
		hint: "The outline a dash keeps tracing (the default)",
	},
	neon: { name: "Neon", hint: "Filled, glowing, the glow slowly pulsing" },
	plain: { name: "Plain", hint: "Filled, still" },
};

const COLOR_PRESETS = [
	{ name: "Cyan (the default)", value: LOGIN_PAGE_DEFAULT.color },
	{ name: "Magenta", value: "#ff4fd8" },
	{ name: "Green", value: "#50fa7b" },
	{ name: "Amber", value: "#ffb000" },
	{ name: "White", value: "#ffffff" },
] as const;

const same = (a: LoginPageSettings, b: LoginPageSettings) =>
	(Object.keys(LOGIN_PAGE_DEFAULT) as (keyof LoginPageSettings)[]).every(
		(k) => a[k] === b[k],
	);

/**
 * General > Customize > Sign-in and sign-out page: the title of the page
 * everyone signs in on (and lands on after signing out), the text effect it is
 * drawn with - the traced outline it has always had, a neon glow, or plain -
 * with that effect's colour and speed, and a message under it for each.
 * Saved by the platform service; boot.js hands it to every page.
 */
export const LoginPageSection: React.FC = () => {
	const queryClient = useQueryClient();
	const query = useQuery(loginPage());
	const backgroundQuery = useQuery(backgrounds());
	const background = useRef<BackgroundEditorHandle>(null);
	const [backgroundDirty, setBackgroundDirty] = useState(false);
	const save = useMutation({
		...updateLoginPage(queryClient),
		onSuccess: (res) => {
			queryClient.setQueryData(loginPage().queryKey, res);
			setDraft(null);
			window.__cuiLoginPage = res;
		},
	});
	const [edited, setDraft] = useState<LoginPageSettings | null>(null);
	const [preview, setPreview] = useState<"in" | "out">("in");
	const ids = useId();
	const imageInput = useRef<HTMLInputElement>(null);
	const applicationName = getApplicationName();

	const saved = { ...LOGIN_PAGE_DEFAULT, ...query.data };
	const draft = edited ?? saved;
	const dirty = !same(draft, saved);
	const saveAll = useMutation({
		mutationFn: async () => {
			if (background.current?.dirty && !background.current.ready)
				throw new Error("Finish choosing a background before saving.");
			if (dirty) await save.mutateAsync(draft);
			if (background.current?.dirty) await background.current.save();
		},
		onSuccess: () => toast.success("Sign-in and sign-out appearance saved."),
	});
	if (query.isLoading || backgroundQuery.isLoading) return <Loader />;
	if (!query.data || !backgroundQuery.data)
		return <ErrorAlert error={query.error ?? backgroundQuery.error} />;
	const set = (patch: Partial<LoginPageSettings>) =>
		setDraft({ ...draft, ...patch });

	const pickImage = (file: File) => {
		if (file.size > 256 * 1024) {
			toast.error("The heading image must be smaller than 256 KB.");
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				const headingImage = reader.result;
				setDraft((current) => ({ ...(current ?? draft), headingImage }));
			}
		};
		reader.onerror = () => toast.error("The heading image could not be read.");
		reader.readAsDataURL(file);
	};

	return (
		<section
			aria-labelledby={`${ids}-heading`}
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
			data-testid={`${ids}-heading`}
		>
			<h2 id={`${ids}-heading`} className="m-0 mb-2 text-lg font-semibold">
				Sign-in and sign-out page
			</h2>
			<p className="m-0 mb-4 text-sm text-content-secondary">
				Set the heading, messages and background together. Your preview follows
				unsaved changes.
			</p>

			{query.error && <ErrorAlert error={query.error} />}
			{backgroundQuery.error && <ErrorAlert error={backgroundQuery.error} />}
			<BackgroundCard
				slot="login"
				state={backgroundQuery.data}
				managed
				ref={background}
				disabled={saveAll.isPending}
				onDirtyChange={setBackgroundDirty}
				controls={
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div className="sm:col-span-2 flex flex-col gap-2">
							<Label htmlFor={`${ids}-heading-mode`}>Heading</Label>
							<Select
								value={draft.headingMode ?? "text"}
								onValueChange={(value) => {
									if (value === "none" || value === "text" || value === "image")
										set({ headingMode: value });
								}}
							>
								<SelectTrigger id={`${ids}-heading-mode`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">None</SelectItem>
									<SelectItem value="text">Text</SelectItem>
									<SelectItem value="image">Image</SelectItem>
								</SelectContent>
							</Select>
							{draft.headingMode === "image" && (
								<>
									<Label className="sr-only" htmlFor={`${ids}-heading-image`}>
										Upload heading image
									</Label>
									<Input
										id={`${ids}-heading-image`}
										ref={imageInput}
										className="hidden"
										type="file"
										accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
										onChange={(event) => {
											const file = event.target.files?.[0];
											if (file) pickImage(file);
											event.target.value = "";
										}}
									/>
									<ImageUploadSplit
										title="Heading image: the image store"
										onUpload={() => imageInput.current?.click()}
										disabled={save.isPending}
										gallery={{
											extra: PREBAKED_BACKGROUNDS,
											lava: { size: 128, maxBytes: 256 * 1024 },
											onPick: pickImage,
											onPickBuiltin: (picture) =>
												set({ headingImage: picture.url }),
										}}
									/>
									<span className="text-xs text-content-secondary">
										Upload PNG, JPEG, GIF, WebP or AVIF up to 256 KB, or choose
										an image from the store. The title supplies alternative
										text.
									</span>
								</>
							)}
						</div>
						{draft.headingMode !== "none" && (
							<>
								<div className="flex flex-col gap-2">
									<Label htmlFor={`${ids}-title`}>Title</Label>
									<Input
										id={`${ids}-title`}
										value={draft.title}
										maxLength={40}
										placeholder={applicationName}
										onChange={(e) => set({ title: e.target.value })}
									/>
									<span className="text-xs text-content-secondary">
										Empty: the deployment's name ({applicationName}).
									</span>
								</div>

								<div className="flex flex-col gap-2">
									<Label htmlFor={`${ids}-effect`}>Text effect</Label>
									<Select
										value={draft.effect}
										onValueChange={(value) => {
											const effect = LOGIN_EFFECTS.find(
												(effect) => effect === value,
											);
											if (effect) set({ effect });
										}}
									>
										<SelectTrigger id={`${ids}-effect`}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{LOGIN_EFFECTS.map((effect) => (
												<SelectItem key={effect} value={effect}>
													{EFFECT_LABEL[effect].name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<ColorField
									label="Colour"
									value={draft.color}
									presets={COLOR_PRESETS}
									onChange={(color) => set({ color: color.toLowerCase() })}
								/>

								{draft.effect !== "plain" && (
									<div className="flex flex-col gap-2">
										<div className="flex items-center justify-between">
											<Label htmlFor={`${ids}-speed`}>
												{draft.effect === "neon" ? "Pulse" : "Trace"} speed
											</Label>
											<span className="text-sm tabular-nums text-content-secondary">
												{draft.speed.toFixed(1)} s
											</span>
										</div>
										<Slider
											id={`${ids}-speed`}
											min={0.5}
											max={20}
											step={0.1}
											value={[draft.speed]}
											onValueChange={([speed]) => set({ speed })}
											aria-label="Seconds per trace or pulse"
										/>
										<span className="text-xs text-content-secondary">
											Seconds for one{" "}
											{draft.effect === "neon" ? "pulse" : "trace"}: lower is
											faster.
										</span>
									</div>
								)}
							</>
						)}
						<div className="flex flex-col gap-2">
							<Label htmlFor={`${ids}-message`}>Sign-in message</Label>
							<Textarea
								id={`${ids}-message`}
								value={draft.message}
								maxLength={300}
								rows={2}
								placeholder="For example: Authorised users only."
								onChange={(e) => set({ message: e.target.value })}
								onFocus={() => setPreview("in")}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor={`${ids}-signed-out`}>Sign-out message</Label>
							<Textarea
								id={`${ids}-signed-out`}
								value={draft.signedOutMessage}
								maxLength={300}
								rows={2}
								placeholder="For example: You are signed out. Close this window on a shared computer."
								onChange={(e) => set({ signedOutMessage: e.target.value })}
								onFocus={() => setPreview("out")}
							/>
							<span className="text-xs text-content-secondary">
								Shown right after signing out, instead of the sign-in message.
							</span>
						</div>
					</div>
				}
				previewHeader={
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="text-sm font-medium">Live preview</span>
						<Tabs
							value={preview}
							onValueChange={(value) => {
								if (value === "in" || value === "out") setPreview(value);
							}}
						>
							<TabsList aria-label="Sign-in preview">
								<TabsTrigger value="in">Signing in</TabsTrigger>
								<TabsTrigger value="out">After signing out</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				}
				previewContent={
					<div
						className="flex min-h-80 items-center justify-center px-6 py-8"
						data-testid="login-page-preview"
					>
						<div className="w-full max-w-[385px] rounded-lg bg-surface-primary/90 p-5">
							<SignInTitle
								settings={draft}
								applicationName={applicationName}
								signedOut={preview === "out"}
							/>
							<div className="flex flex-col gap-2 opacity-50" aria-hidden>
								<div className="h-9 rounded-md border border-solid border-border" />
								<div className="h-9 rounded-md border border-solid border-border" />
								<div className="h-9 rounded-md bg-surface-invert-primary" />
							</div>
						</div>
					</div>
				}
			/>
			{saveAll.error && <ErrorAlert error={saveAll.error} />}
			<div className="mt-6 flex flex-wrap gap-2 border-0 border-t border-solid border-border pt-5">
				<Button
					disabled={
						(!dirty && !backgroundDirty) ||
						saveAll.isPending ||
						(draft.headingMode === "image" && !draft.headingImage)
					}
					onClick={() => saveAll.mutate()}
				>
					<Spinner loading={saveAll.isPending} />
					Save sign-in appearance
				</Button>
				<Button
					variant="outline"
					disabled={(!dirty && !backgroundDirty) || saveAll.isPending}
					onClick={() => {
						setDraft(null);
						background.current?.reset();
					}}
				>
					Discard changes
				</Button>
				<Button
					variant="subtle"
					disabled={saveAll.isPending}
					onClick={() => setDraft(LOGIN_PAGE_DEFAULT)}
				>
					Reset text
				</Button>
			</div>
		</section>
	);
};
