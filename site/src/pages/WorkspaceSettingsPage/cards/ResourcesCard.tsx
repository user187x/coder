import { useState } from "react";
import type { PreviewParameter, Workspace } from "#/api/typesGenerated";
import type { WorkspaceVolume } from "#/api/workspaceVolumes";
import { DynamicParameter } from "#/modules/workspaces/DynamicParameter/DynamicParameter";
import { ExpandDiskDialog } from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceVolumeDialogs";
import {
	ChipGlyph,
	DiskGlyph,
	ExpandGlyph,
	GpuGlyph,
	RestartGlyph,
} from "../settingsIcons";
import {
	CardLoader,
	OptionTiles,
	ParameterProblems,
	PressSwitch,
	SettingsCard,
} from "../settingsParts";
import type { BuildParameters } from "../useBuildParameters";

/** The template's parameters this card shows (the others: Environment, or its More settings). */
export const RESOURCE_PARAMETERS = ["cpu", "memory", "gpus", "home_disk_size"];

/** A parameter can be changed here: mutable, not disabled by its template, the form not held. */
export const editable = (
	params: BuildParameters,
	parameter: PreviewParameter,
	saving: boolean,
) =>
	parameter.mutable &&
	!parameter.styling?.disabled &&
	!params.disabled &&
	!saving;

const hasOptions = (parameter: PreviewParameter | undefined) =>
	Boolean(parameter && parameter.options.length > 0);

/** A choice of the template's options as tiles; anything else the template's own field. */
const TilesOrField: React.FC<{
	params: BuildParameters;
	name: string;
	legend: string;
	hint: string;
	saving: boolean;
}> = ({ params, name, legend, hint, saving }) => {
	const parameter = params.parameter(name);
	if (!parameter) {
		return null;
	}
	if (!hasOptions(parameter)) {
		return (
			<DynamicParameter
				parameter={parameter}
				value={params.value(name)}
				onChange={(value) => void params.change(parameter, value)}
				disabled={!editable(params, parameter, saving)}
			/>
		);
	}
	return (
		<OptionTiles
			legend={legend}
			hint={hint}
			testId={`parameter-field-${name}`}
			options={parameter.options.map((o) => ({
				value: o.value.value,
				name: o.name,
			}))}
			value={params.value(name)}
			onChange={(value) => void params.change(parameter, value)}
			disabled={!editable(params, parameter, saving)}
			error={
				<ParameterProblems problems={parameter.diagnostics} className="mt-2" />
			}
		/>
	);
};

/** GPUs: on or off - the template's GPU parameter (none: the CPU); greyed where the template disables it. */
const GpuStrip: React.FC<{ params: BuildParameters; saving: boolean }> = ({
	params,
	saving,
}) => {
	const parameter = params.parameter("gpus");
	const value = params.value("gpus") || "0";
	const on = value !== "0";
	const offered = Boolean(parameter && !parameter.styling?.disabled);
	const canChange = Boolean(
		parameter && offered && editable(params, parameter, saving),
	);
	// The counts the template offers beyond none (1, 2, 4 GPUs)
	const counts = parameter?.options.filter((o) => o.value.value !== "0") ?? [];
	// What turning it on again picks: the count it had, else the first offered
	const [last, setLast] = useState(() =>
		on ? value : (counts[0]?.value.value ?? "1"),
	);

	return (
		<div
			className="ws-strip"
			data-testid="gpu"
			data-disabled={!offered || undefined}
		>
			<div className="ws-strip-icon">
				<GpuGlyph />
			</div>
			<div className="min-w-0 flex-auto">
				<div id="gpu-label" className="font-medium">
					GPU
				</div>
				<p id="gpu-help" className="ws-desc">
					{offered
						? "Attach a GPU to this workspace."
						: "Not available with this template."}
				</p>
				{on && offered && counts.length > 1 && (
					<div
						className="mt-2.5 flex flex-wrap gap-1.5"
						role="group"
						aria-label="How many GPUs"
					>
						{counts.map((o) => (
							<button
								key={o.value.value}
								type="button"
								className="ws-day ws-hit px-3"
								aria-pressed={value === o.value.value}
								disabled={!canChange}
								onClick={() => {
									setLast(o.value.value);
									if (parameter) {
										void params.change(parameter, o.value.value);
									}
								}}
							>
								{o.name}
							</button>
						))}
					</div>
				)}
				{parameter && <ParameterProblems problems={parameter.diagnostics} />}
			</div>
			<PressSwitch
				pressed={on && offered}
				labelledBy="gpu-label"
				describedBy="gpu-help"
				disabled={!canChange}
				testId="gpu-switch"
				onChange={(pressed) => {
					if (parameter) {
						void params.change(parameter, pressed ? last : "0");
					}
				}}
			/>
		</div>
	);
};

/** The home disk: its size now (the parameter is only the size it was made with), and Expand disk. */
const DiskStrip: React.FC<{
	workspace: Workspace;
	volume: WorkspaceVolume["volume"] | undefined;
	sizeGB: string;
}> = ({ workspace, volume, sizeGB }) => {
	const [expanding, setExpanding] = useState(false);
	return (
		<div className="ws-strip flex-wrap" data-testid="home-disk">
			<div className="ws-strip-icon">
				<DiskGlyph />
			</div>
			<div className="min-w-0 flex-[1_1_240px]">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-medium">Home disk</span>
				</div>
				<p className="ws-desc">
					{volume
						? `On ${volume.storageClass || "the default storage class"}. ${
								volume.expandable
									? "Expanding grows it in place."
									: "Expanding copies it onto a bigger disk."
							}`
						: "Where your home folder is kept."}
				</p>
			</div>
			<div className="flex items-baseline gap-1">
				<span className="ws-mono text-[26px] font-semibold">
					{volume?.sizeGB ?? sizeGB}
				</span>
				<span className="text-(--ws-muted)">GB</span>
			</div>
			<button
				type="button"
				className="ws-btn ws-btn-sm ws-hit"
				disabled={!volume}
				onClick={() => setExpanding(true)}
			>
				<ExpandGlyph />
				Expand disk…
			</button>
			<ExpandDiskDialog
				workspace={workspace}
				open={expanding}
				onClose={() => setExpanding(false)}
			/>
		</div>
	);
};

/** Resources: CPU and memory (tiles of the template's options), the GPU, the home disk. Applied with a restart. */
export const ResourcesCard: React.FC<{
	workspace: Workspace;
	params: BuildParameters;
	volume: WorkspaceVolume["volume"] | undefined;
	saving: boolean;
}> = ({ workspace, params, volume, saving }) => {
	const disk = params.parameter("home_disk_size");
	return (
		<SettingsCard
			id="resources"
			title="Resources"
			description="Compute and storage for this workspace"
			icon={<ChipGlyph size={18} />}
			aside={
				<span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-(--ws-warn-bg) px-2.5 text-xs font-medium text-(--ws-warn)">
					<RestartGlyph />
					Changes apply on restart
				</span>
			}
		>
			{params.ready ? (
				<div className="flex flex-col gap-7 p-6">
					<TilesOrField
						params={params}
						name="cpu"
						legend="CPU"
						hint="Number of cores"
						saving={saving}
					/>
					<TilesOrField
						params={params}
						name="memory"
						legend="Memory"
						hint="Amount in GB"
						saving={saving}
					/>
					<GpuStrip params={params} saving={saving} />
					{(disk || volume) && (
						<DiskStrip
							workspace={workspace}
							volume={volume}
							sizeGB={params.value("home_disk_size") || "–"}
						/>
					)}
				</div>
			) : (
				<CardLoader />
			)}
		</SettingsCard>
	);
};
