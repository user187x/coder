import type { PreviewParameter } from "#/api/typesGenerated";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { DynamicParameter } from "#/modules/workspaces/DynamicParameter/DynamicParameter";
import { FolderGlyph, MonitorGlyph, PackageGlyph } from "../settingsIcons";
import { CardLoader, ParameterProblems, SettingsCard } from "../settingsParts";
import type { BuildParameters } from "../useBuildParameters";
import { editable, RESOURCE_PARAMETERS } from "./ResourcesCard";

/** The template's parameters this card shows as its own controls. */
const ENVIRONMENT_PARAMETERS = [
	"desktop_theme",
	"workspace_image",
	"workspace_image_custom",
	"start_directory",
];

/** The workspace image's choices that are not one of Templates › Images' (the template's own, and Another image…). */
const TEMPLATE_IMAGE = "template";
const CUSTOM_IMAGE = "custom";

/** A small picture of each desktop theme. */
const ThemePreview: React.FC<{ theme: string }> = ({ theme }) =>
	theme === "classic" ? (
		<div
			aria-hidden="true"
			className="relative h-[117px] border-0 border-b border-solid border-(--ws-line) bg-[#3b4a5c]"
		>
			<div className="absolute left-[18px] top-3.5 h-[72px] w-[152px] border border-solid border-[#aeb6c0] bg-[#d9dde3]" />
			<div className="absolute left-[18px] top-3.5 h-3 w-[150px] bg-[#4a6c9a]" />
			<div className="absolute inset-x-0 bottom-0 flex h-[18px] items-center gap-1 bg-[#c9ced6] px-1.5">
				<span className="h-2.5 w-[26px] bg-[#9aa5b4]" />
				<span className="h-2.5 w-10 bg-[#b3bcc8]" />
			</div>
		</div>
	) : theme === "serenade" ? (
		<div
			aria-hidden="true"
			className="relative h-[117px] border-0 border-b border-solid border-(--ws-line) bg-[#1b1830]"
		>
			<div className="absolute left-[18px] top-4 h-[64px] w-[122px] rounded-md border border-solid border-[#3a3460] bg-[#2a2545]" />
			<div className="absolute left-[70px] top-[30px] h-[58px] w-[112px] rounded-md border border-solid border-[#463f70] bg-[#322c52]" />
			<div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-[9px] bg-[#2a2545] px-2 py-[5px]">
				{["#8e7be0", "#6cb3e8", "#e8a36c", "#7fd1a8"].map((color) => (
					<span
						key={color}
						className="size-3 rounded"
						style={{ background: color }}
					/>
				))}
			</div>
		</div>
	) : (
		<div
			aria-hidden="true"
			className="h-[117px] border-0 border-b border-solid border-(--ws-line) bg-(--ws-well)"
		/>
	);

const DesktopTheme: React.FC<{
	params: BuildParameters;
	parameter: PreviewParameter;
	saving: boolean;
}> = ({ params, parameter, saving }) => {
	const value = params.value(parameter.name);
	return (
		<fieldset
			className="m-0 min-w-0 border-0 p-0"
			data-testid={`parameter-field-${parameter.name}`}
		>
			<legend className="mb-3 flex w-full flex-wrap items-baseline justify-between gap-1 p-0">
				<span className="font-medium">Desktop theme</span>
				<span className="text-[13px] text-(--ws-muted)">
					Applies at the next start
				</span>
			</legend>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3">
				{parameter.options.map((option) => (
					<button
						key={option.value.value}
						type="button"
						className="ws-theme"
						aria-pressed={value === option.value.value}
						disabled={!editable(params, parameter, saving)}
						onClick={() => void params.change(parameter, option.value.value)}
					>
						<ThemePreview theme={option.value.value} />
						<div className="flex items-start gap-2.5 px-3.5 py-3">
							<span className="ws-radio">
								<span />
							</span>
							<span>
								<span className="block font-semibold">{option.name}</span>
								<span className="block text-[12.5px] text-(--ws-muted)">
									{option.description}
								</span>
							</span>
						</div>
					</button>
				))}
			</div>
			<ParameterProblems problems={parameter.diagnostics} className="mt-2" />
		</fieldset>
	);
};

const imageLabel = (option: PreviewParameter["options"][number]) =>
	option.value.value === TEMPLATE_IMAGE
		? `${option.name} (recommended)`
		: option.name;

const WorkspaceImage: React.FC<{
	params: BuildParameters;
	parameter: PreviewParameter;
	saving: boolean;
}> = ({ params, parameter, saving }) => {
	const value = params.value(parameter.name);
	const custom = params.parameter("workspace_image_custom");
	const disabled = !editable(params, parameter, saving);
	const options = parameter.options;
	const fixed = options.filter((o) =>
		[TEMPLATE_IMAGE, CUSTOM_IMAGE].includes(o.value.value),
	);
	const others = options.filter(
		(o) => ![TEMPLATE_IMAGE, CUSTOM_IMAGE].includes(o.value.value),
	);
	const item = (option: PreviewParameter["options"][number]) => (
		<SelectItem key={option.value.value} value={option.value.value}>
			{imageLabel(option)}
		</SelectItem>
	);
	return (
		<div data-testid={`parameter-field-${parameter.name}`}>
			<label htmlFor="ws-image" className="flex items-center gap-2 font-medium">
				<PackageGlyph className="text-(--ws-soft)" />
				Workspace image
			</label>
			<Select
				value={value}
				onValueChange={(next) => void params.change(parameter, next)}
				disabled={disabled}
			>
				<SelectTrigger id="ws-image" className="ws-input ws-select mt-2">
					<SelectValue placeholder="Choose an image" />
				</SelectTrigger>
				<SelectContent>
					{fixed.filter((o) => o.value.value === TEMPLATE_IMAGE).map(item)}
					{others.length > 0 && (
						<SelectGroup>
							<SelectLabel className="text-xs text-content-secondary">
								Built or imported images
							</SelectLabel>
							{others.map(item)}
						</SelectGroup>
					)}
					{fixed.filter((o) => o.value.value === CUSTOM_IMAGE).map(item)}
				</SelectContent>
			</Select>
			{custom && (
				<div
					className="mt-2.5"
					data-testid="parameter-field-workspace_image_custom"
				>
					<label htmlFor="ws-image-custom" className="ws-small-label">
						{custom.display_name || "Image to run"}
					</label>
					<input
						id="ws-image-custom"
						type="text"
						className="ws-input ws-input-mono mt-1.5"
						spellCheck={false}
						value={params.value(custom.name)}
						disabled={!editable(params, custom, saving)}
						aria-invalid={Boolean(params.fieldError(custom.name))}
						onChange={(event) =>
							void params.change(custom, event.target.value.trim())
						}
					/>
					{params.fieldError(custom.name) && (
						<p className="ws-error">{params.fieldError(custom.name)}</p>
					)}
					<ParameterProblems problems={custom.diagnostics} className="mt-2" />
				</div>
			)}
			<p className="ws-help">
				Follows the template. Pick a built or imported image, or enter any image
				the cluster can pull.
			</p>
			<ParameterProblems problems={parameter.diagnostics} className="mt-2" />
		</div>
	);
};

const StartFolder: React.FC<{
	params: BuildParameters;
	parameter: PreviewParameter;
	saving: boolean;
}> = ({ params, parameter, saving }) => {
	const error = params.fieldError(parameter.name);
	return (
		<div data-testid={`parameter-field-${parameter.name}`}>
			<label
				htmlFor="ws-folder"
				className="flex items-center gap-2 font-medium"
			>
				<FolderGlyph className="text-(--ws-soft)" />
				Start folder
			</label>
			<input
				id="ws-folder"
				type="text"
				className="ws-input ws-input-mono mt-2"
				spellCheck={false}
				value={params.value(parameter.name)}
				disabled={!editable(params, parameter, saving)}
				aria-invalid={Boolean(error)}
				onChange={(event) => void params.change(parameter, event.target.value)}
			/>
			{error ? (
				<p className="ws-error">{error}</p>
			) : (
				<p className="ws-help">
					Where the terminal and File Browser open. Created at start if missing.
				</p>
			)}
			<ParameterProblems problems={parameter.diagnostics} className="mt-2" />
		</div>
	);
};

/**
 * Environment: the desktop's theme, the workspace image, the start folder - and any other parameter the template has
 * (More from the template), as its own field. Applied with a restart.
 */
export const EnvironmentCard: React.FC<{
	params: BuildParameters;
	saving: boolean;
}> = ({ params, saving }) => {
	const theme = params.parameter("desktop_theme");
	const image = params.parameter("workspace_image");
	const folder = params.parameter("start_directory");
	const more = params.parameters.filter(
		(p) =>
			!RESOURCE_PARAMETERS.includes(p.name) &&
			!ENVIRONMENT_PARAMETERS.includes(p.name),
	);
	return (
		<SettingsCard
			id="environment"
			title="Environment"
			description="Desktop look, image and where you land"
			icon={<MonitorGlyph size={18} />}
		>
			{params.ready ? (
				<div className="flex flex-col gap-7 p-6">
					{theme && (
						<DesktopTheme params={params} parameter={theme} saving={saving} />
					)}
					{(image || folder) && (
						<div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-5">
							{image && (
								<WorkspaceImage
									params={params}
									parameter={image}
									saving={saving}
								/>
							)}
							{folder && (
								<StartFolder
									params={params}
									parameter={folder}
									saving={saving}
								/>
							)}
						</div>
					)}
					{more.length > 0 && (
						<div className="flex flex-col gap-6 border-0 border-t border-solid border-(--ws-row-line) pt-6">
							<div className="ws-eyebrow">More from the template</div>
							{more.map((parameter) => (
								<DynamicParameter
									key={parameter.name}
									parameter={parameter}
									value={params.value(parameter.name)}
									onChange={(value) => void params.change(parameter, value)}
									disabled={!editable(params, parameter, saving)}
								/>
							))}
						</div>
					)}
					{!theme && !image && !folder && more.length === 0 && (
						<p className="m-0 text-[13px] text-(--ws-muted)">
							This template has nothing to set here.
						</p>
					)}
				</div>
			) : (
				<CardLoader />
			)}
		</SettingsCard>
	);
};
