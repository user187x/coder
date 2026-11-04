import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { NavbarStyle } from "#/api/platform";
import { backgroundHTML, backgrounds } from "#/api/queries/backgrounds";
import {
	navbarAppearance,
	updateNavbarAppearance,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import { Switch } from "#/components/Switch/Switch";
import { BackgroundPreview } from "#/modules/platform/background/BackgroundPreview";

export function NavbarAppearance() {
	const id = useId();
	const client = useQueryClient();
	const query = useQuery(navbarAppearance());
	const background = useQuery(backgrounds()).data?.dashboard;
	const html = useQuery(
		backgroundHTML(background?.kind === "html" ? background.url : undefined),
	);
	const save = useMutation(updateNavbarAppearance(client));
	const [draft, setDraft] = useState<NavbarStyle | null>(null);
	const value = draft ??
		query.data ?? { transparency: 0, scale: 100, wireframe: true };
	const dirty =
		value.scale !== query.data?.scale ||
		value.wireframe !== query.data?.wireframe ||
		value.transparency !== query.data?.transparency;
	useEffect(() => {
		if (draft === null) return;
		document.documentElement.style.setProperty(
			"--navbar-preview-alpha",
			String(1 - draft.transparency / 100),
		);
		document.documentElement.style.setProperty(
			"--navbar-preview-scale",
			String(draft.scale / 100),
		);
		document.documentElement.style.setProperty(
			"--navbar-preview-border",
			draft.wireframe ? "hsl(var(--border-default))" : "transparent",
		);
		return () => {
			document.documentElement.style.removeProperty("--navbar-preview-scale");
			document.documentElement.style.removeProperty("--navbar-preview-border");
			document.documentElement.style.removeProperty("--navbar-preview-alpha");
		};
	}, [draft]);
	return (
		<section
			className="rounded-xl border border-solid border-border bg-surface-primary p-6"
			aria-labelledby={id}
		>
			<h2 id={id} className="m-0 text-base font-semibold">
				Navigation bar
			</h2>
			<p className="text-sm text-content-secondary">
				Set the transparency, size and outline of the navigation bar for
				everyone.
			</p>
			{query.isLoading && <Loader />}
			{(query.error || save.error) && (
				<ErrorAlert error={query.error ?? save.error} />
			)}
			{query.data && (
				<div className="grid items-start gap-6 xl:grid-cols-2">
					<div className="min-w-0">
						<label
							className="flex justify-between text-sm font-medium"
							htmlFor={`${id}-range`}
						>
							Navbar transparency <span aria-hidden>{value.transparency}%</span>
						</label>
						<input
							id={`${id}-range`}
							type="range"
							min="0"
							max="100"
							step="1"
							className="block my-3 w-full accent-content-link"
							aria-valuetext={`${value.transparency}% transparent`}
							value={value.transparency}
							disabled={save.isPending}
							onChange={(e) =>
								setDraft({
									...value,
									transparency: e.currentTarget.valueAsNumber,
								})
							}
						/>
						<label
							className="flex justify-between text-sm font-medium"
							htmlFor={`${id}-size`}
						>
							Navbar size <span aria-hidden>{value.scale}%</span>
						</label>
						<input
							type="range"
							id={`${id}-size`}
							min={75}
							max={125}
							step={1}
							className="block my-3 w-full accent-content-link"
							aria-valuetext={`${value.scale}%`}
							value={value.scale}
							disabled={save.isPending}
							onChange={(e) =>
								setDraft({ ...value, scale: e.currentTarget.valueAsNumber })
							}
						/>
						<label
							className="mb-4 flex items-center justify-between text-sm font-medium"
							htmlFor={`${id}-frame`}
						>
							Show navbar wireframe
							<Switch
								id={`${id}-frame`}
								checked={value.wireframe}
								disabled={save.isPending}
								onCheckedChange={(wireframe) =>
									setDraft({ ...value, wireframe })
								}
							/>
						</label>
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={save.isPending || !dirty}
								onClick={() =>
									save.mutate(value, { onSuccess: () => setDraft(null) })
								}
							>
								Save navbar appearance
							</Button>
							<Button
								variant="outline"
								disabled={save.isPending || draft === null}
								onClick={() => setDraft(null)}
							>
								Discard changes
							</Button>
						</div>
					</div>
					<div className="flex min-w-0 flex-col gap-3">
						<span className="text-sm font-medium">Live preview</span>
						<BackgroundPreview
							slot="dashboard"
							image={background?.kind === "html" ? null : (background ?? null)}
							html={html.data}
							opacity={background?.opacity ?? 0}
							layer={background?.layer ?? "under"}
							dials={background?.params ?? {}}
							navbarStyle={value}
						/>
					</div>
				</div>
			)}
		</section>
	);
}
