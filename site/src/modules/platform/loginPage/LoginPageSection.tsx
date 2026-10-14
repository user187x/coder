import { cn } from "cn";
import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	LOGIN_EFFECTS,
	LOGIN_PAGE_DEFAULT,
	type LoginEffect,
	type LoginPageSettings,
} from "#/api/platform";
import { loginPage, updateLoginPage } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { Slider } from "#/components/Slider/Slider";
import { Spinner } from "#/components/Spinner/Spinner";
import { Textarea } from "#/components/Textarea/Textarea";
import { ColorField } from "#/modules/platform/ColorField";
import { ContourTitle } from "#/modules/platform/contourTitle/ContourTitle";
import { getApplicationName } from "#/utils/appearance";
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
	const save = useMutation(updateLoginPage(queryClient));
	const [draft, setDraft] = useState<LoginPageSettings | null>(null);
	const [preview, setPreview] = useState<"in" | "out">("in");
	const ids = useId();
	const applicationName = getApplicationName();

	useEffect(() => {
		if (query.data && draft === null) {
			setDraft({ ...LOGIN_PAGE_DEFAULT, ...query.data });
		}
	}, [query.data, draft]);

	if (query.isLoading) {
		return <Loader />;
	}
	if (!query.data || !draft) {
		return <ErrorAlert error={query.error} />;
	}
	const saved = { ...LOGIN_PAGE_DEFAULT, ...query.data };
	const dirty = !same(draft, saved);
	const set = (patch: Partial<LoginPageSettings>) =>
		setDraft({ ...draft, ...patch });
	const submit = (settings: LoginPageSettings, what: string) =>
		save.mutate(settings, {
			onSuccess: (res) => {
				setDraft({ ...LOGIN_PAGE_DEFAULT, ...res });
				window.__cuiLoginPage = res;
				toast.success(what);
			},
			onError: (e) =>
				toast.error(getErrorMessage(e, "The sign-in page was not saved.")),
		});

	return (
		<section
			aria-labelledby="customize-login-page"
			className="mt-10 border-0 border-t border-solid border-border pt-8"
			data-testid="customize-login-page"
		>
			<h2 id="customize-login-page" className="m-0 mb-2 text-2xl font-semibold">
				Sign-in and sign-out page
			</h2>
			<p className="m-0 mb-6 max-w-3xl text-sm font-medium text-content-secondary">
				The page everyone signs in on, and lands on after signing out: its
				title, the text effect it is drawn with (the traced outline it has
				always had, or another), and a message under it for each.
			</p>

			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="flex flex-col gap-5">
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

					<fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
						<legend className="mb-2 p-0 text-sm font-medium">
							Text effect
						</legend>
						<div className="grid grid-cols-3 gap-2" role="radiogroup">
							{LOGIN_EFFECTS.map((effect) => (
								<button
									key={effect}
									type="button"
									role="radio"
									aria-checked={draft.effect === effect}
									onClick={() => set({ effect })}
									data-testid={`login-effect-${effect}`}
									className={cn(
										"flex cursor-pointer flex-col items-center gap-1 overflow-hidden rounded-lg border border-solid bg-surface-secondary/40 px-2 pt-2 pb-2.5 text-center font-[inherit] text-content-primary",
										draft.effect === effect
											? "border-content-link ring-1 ring-content-link"
											: "border-border hover:border-content-secondary",
									)}
								>
									<span className="pointer-events-none flex h-10 w-full items-center justify-center overflow-hidden [&_svg]:h-10">
										<ContourTitle
											text="Aa"
											effect={effect}
											color={draft.color}
											speed={draft.speed}
										/>
									</span>
									<span className="text-sm font-medium">
										{EFFECT_LABEL[effect].name}
									</span>
									<span className="text-[11px] leading-tight text-content-secondary">
										{EFFECT_LABEL[effect].hint}
									</span>
								</button>
							))}
						</div>
					</fieldset>

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
								Seconds for one {draft.effect === "neon" ? "pulse" : "trace"}:
								lower is faster.
							</span>
						</div>
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

					<div className="flex flex-wrap gap-2">
						<Button
							disabled={!dirty || save.isPending}
							onClick={() => submit(draft, "The sign-in page is saved.")}
							data-testid="login-page-save"
						>
							<Spinner loading={save.isPending} />
							Save
						</Button>
						<Button
							variant="outline"
							disabled={!dirty || save.isPending}
							onClick={() => setDraft(saved)}
						>
							Discard changes
						</Button>
						<Button
							variant="outline"
							disabled={same(saved, LOGIN_PAGE_DEFAULT) || save.isPending}
							onClick={() =>
								submit(
									LOGIN_PAGE_DEFAULT,
									"The sign-in page is back to its defaults.",
								)
							}
						>
							Restore defaults
						</Button>
					</div>
				</div>

				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm font-medium">Preview</span>
						<div
							className="inline-flex rounded-md border border-solid border-border p-0.5"
							role="tablist"
						>
							{(
								[
									["in", "Signing in"],
									["out", "After signing out"],
								] as const
							).map(([value, label]) => (
								<button
									key={value}
									type="button"
									role="tab"
									aria-selected={preview === value}
									onClick={() => setPreview(value)}
									className={cn(
										"cursor-pointer rounded border-0 px-2.5 py-1 font-[inherit] text-xs",
										preview === value
											? "bg-surface-tertiary text-content-primary"
											: "bg-transparent text-content-secondary hover:text-content-primary",
									)}
								>
									{label}
								</button>
							))}
						</div>
					</div>
					<div
						className="flex min-h-56 items-center justify-center rounded-lg border border-solid border-border bg-surface-primary px-6 py-10"
						data-testid="login-page-preview"
					>
						<div className="w-full max-w-[385px]">
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
				</div>
			</div>
		</section>
	);
};
