import { cn } from "cn";
import {
	ChevronDownIcon,
	MonitorIcon,
	PanelRightCloseIcon,
	RadioIcon,
	ScanEyeIcon,
	SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { PanelAccent, PanelColorPart, PanelColors } from "#/api/platform";
import { panelAccentGlobal, updatePanelColors } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ColorField } from "#/modules/platform/ColorField";
import {
	panelAccentColor,
	panelColorStyle,
	panelTextTokens,
} from "#/modules/platform/panelAccent/PanelAccent";

const parts = {
	backdrop: ["Backdrop", "#18181b"],
	surface: ["Front panel", "#252830"],
	button: ["Panel buttons", "#3f424a"],
	container: ["Inner container", "#272a31"],
	border: ["Panel borders", "#52525b"],
	text: ["Panel text", "#e4e4e7"],
	icon: ["Panel icons", "#e4e4e7"],
	track: ["Graph tracks", "#3f3f46"],
	cpu: ["CPU bars", "#16a34a"],
	memory: ["Memory bars", "#16a34a"],
	net: ["NET bars", "#60a5fa"],
	disk: ["DISK bars", "#60a5fa"],
} satisfies Record<PanelColorPart, [string, string]>;

const targetClass =
	"cursor-pointer border-0 bg-transparent p-0 text-inherit outline-content-link -outline-offset-1 hover:outline-2 focus-visible:outline-2 aria-pressed:outline-2";

export function PanelColorPreview({
	admin,
	accent,
	scale,
	text,
	backdrop,
}: {
	admin: boolean;
	accent: PanelAccent | null;
	scale: number;
	text: string | null;
	backdrop: string | null;
}) {
	const client = useQueryClient();
	const query = useQuery(panelAccentGlobal());
	const save = useMutation(updatePanelColors(client));
	const [selected, setSelected] = useState<PanelColorPart | null>(null);
	const [draft, setDraft] = useState<PanelColors>({});
	const colors = { ...query.data?.colors, ...draft };
	const previewText = colors.text ?? text;
	const tokens = previewText ? panelTextTokens(previewText) : null;
	const editing = admin && query.isSuccess;
	const dirty = Object.keys(draft).length > 0;
	const target = (
		part: PanelColorPart,
		className: string,
		children?: React.ReactNode,
	) =>
		editing ? (
			<button
				type="button"
				title={`Edit ${parts[part][0].toLowerCase()} colour`}
				aria-label={`Edit ${parts[part][0].toLowerCase()} colour`}
				aria-pressed={selected === part}
				disabled={save.isPending}
				onClick={() => setSelected(part)}
				className={cn(targetClass, className)}
			>
				{children}
			</button>
		) : children ? (
			<span className={className}>{children}</span>
		) : null;
	const label = (value: string) =>
		target("text", "relative rounded px-1 py-0.5 text-xs", value);
	const icon = (value: React.ReactNode) =>
		target(
			"icon",
			"relative rounded p-0.5 text-[color:var(--panel-color-icon,currentColor)]",
			value,
		);
	const surface = "absolute inset-0 rounded-[inherit]";
	const pill = (iconNode: React.ReactNode, value?: string) => (
		<div
			className="relative flex min-h-7 flex-1 items-center justify-center gap-0.5 rounded-full border border-solid border-border"
			style={{
				backgroundColor: colors.button ?? undefined,
				borderColor: colors.border ?? undefined,
			}}
		>
			{target("button", surface)}
			{icon(iconNode)}
			{value && label(value)}
		</div>
	);

	return (
		<div
			role="group"
			aria-label="Panel preview"
			className="flex min-w-0 flex-col gap-2"
		>
			<span className="text-sm font-medium">Preview</span>
			{admin && (
				<p className="m-0 text-xs text-content-secondary">
					Select a part of the preview, then save your colours for everyone.
				</p>
			)}
			{admin && query.error && <ErrorAlert error={query.error} />}
			{save.error && <ErrorAlert error={save.error} />}
			<div
				className="relative flex min-h-72 items-start justify-center-safe overflow-auto rounded-xl bg-(--dashboard-panel-bg) p-4"
				style={{
					backgroundColor:
						colors.backdrop ?? backdrop ?? "hsl(var(--surface-secondary))",
				}}
			>
				{target("backdrop", surface)}
				<div
					data-panel-accent-preview={accent ? "" : undefined}
					data-panel-text-preview={tokens ? "" : undefined}
					className="relative w-64 shrink-0 rounded-2xl border border-solid border-border bg-surface-primary p-2 text-xs shadow-md"
					style={
						{
							...panelColorStyle(colors),
							zoom: scale / 100,
							backgroundColor: colors.surface ?? undefined,
							borderColor: colors.border ?? undefined,
							"--panel-accent": accent ? panelAccentColor(accent) : undefined,
							"--panel-text-primary": tokens?.primary,
							"--panel-text-secondary": tokens?.secondary,
						} as React.CSSProperties
					}
				>
					{target("border", "absolute -inset-0.5 rounded-[inherit]")}
					{target("surface", "absolute inset-0.5 rounded-[inherit]")}
					<div className="mb-2 flex items-center justify-between px-1">
						<div className="flex items-center">
							{icon(<SettingsIcon aria-hidden className="size-3.5" />)}
							{label("Settings")}
						</div>
						{icon(<ChevronDownIcon aria-hidden className="size-3.5" />)}
					</div>
					<div className="mb-1 flex gap-1">
						{pill(<ScanEyeIcon aria-hidden className="size-3.5" />, "HUD")}
						{pill(<PanelRightCloseIcon aria-hidden className="size-3.5" />)}
					</div>
					<div className="flex items-center justify-between px-2 py-1.5 text-content-secondary">
						<div className="flex items-center">
							{icon(<RadioIcon aria-hidden className="size-3.5" />)}
							{label("Region")}
						</div>
						{label("Default")}
					</div>
					<div className="mb-2">
						{pill(
							<MonitorIcon aria-hidden className="size-3.5" />,
							"Workspaces",
						)}
					</div>
					<div
						className="relative flex flex-col gap-2 rounded-lg border border-solid border-border bg-surface-primary p-2"
						style={{
							backgroundColor: colors.container ?? undefined,
							borderColor: colors.border ?? undefined,
						}}
					>
						{target("container", surface)}
						<span className="self-start font-semibold">{label("Cluster")}</span>
						{(
							[
								["cpu", "CPU", "40%", "w-2/5"],
								["memory", "Memory", "73%", "w-3/4"],
								["net", "NET", "", "w-1/3"],
								["disk", "DISK", "62%", "w-3/5"],
							] as const
						).map(([part, name, value, width]) => (
							<div key={part} className="flex flex-col gap-1">
								<span className="flex justify-between text-content-secondary">
									{label(name)}
									{value && label(value)}
								</span>
								<div
									className="relative flex h-2 rounded-full bg-surface-quaternary"
									style={{ backgroundColor: colors.track ?? undefined }}
								>
									{target("track", surface)}
									<span
										className={cn(
											"pointer-events-none relative h-full rounded-full",
											part === "net" || part === "disk"
												? "bg-content-link"
												: "bg-content-success",
											width,
										)}
										style={{ backgroundColor: colors[part] ?? undefined }}
									>
										{target(part, cn(surface, "pointer-events-auto"))}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
			{editing && selected && (
				<fieldset
					disabled={save.isPending}
					className="m-0 flex min-w-0 flex-wrap items-end gap-2 border-0 p-0"
				>
					<ColorField
						key={selected}
						label={`${parts[selected][0]} colour`}
						value={
							colors[selected] ??
							(selected === "text"
								? text
								: selected === "backdrop"
									? backdrop
									: null) ??
							parts[selected][1]
						}
						onChange={(value) =>
							setDraft((current) => ({ ...current, [selected]: value }))
						}
					/>
					<Button
						variant="outline"
						size="sm"
						disabled={save.isPending || !colors[selected]}
						onClick={() =>
							setDraft((current) => ({ ...current, [selected]: null }))
						}
					>
						Reset colour
					</Button>
				</fieldset>
			)}
			{editing && (
				<Button
					className="self-start"
					disabled={!dirty || save.isPending}
					onClick={() => save.mutate(draft, { onSuccess: () => setDraft({}) })}
				>
					Save for everyone
				</Button>
			)}
		</div>
	);
}
