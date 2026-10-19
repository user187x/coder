import { useEffect } from "react";
import { useMutation } from "react-query";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { API } from "#/api/api";
import { Alert } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { SaveBar } from "#/modules/platform/settingsPage/SaveBar";
import {
	type GlanceRow,
	SettingsNav,
	type SettingsNavLink,
} from "#/modules/platform/settingsPage/SettingsNav";
import {
	ChipGlyph,
	ClockGlyph,
	GearGlyph,
	MonitorGlyph,
	PeopleGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import { useWorkspaceVolume } from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceVolumeDialogs";
import { EnvironmentCard } from "./cards/EnvironmentCard";
import { GeneralCard } from "./cards/GeneralCard";
import { ResourcesCard } from "./cards/ResourcesCard";
import { ScheduleCard } from "./cards/ScheduleCard";
import { SharingCard } from "./cards/SharingCard";
import { useWorkspaceSettings } from "./useWorkspaceSettings";
import { useWorkspaceSettingsForm } from "./useWorkspaceSettingsForm";

const FORM_ID = "workspace-settings-form";

/** The page's cards, in order: their ids (anchors), the left list's links. */
const LINKS: SettingsNavLink[] = [
	{ id: "general", label: "General", icon: <GearGlyph /> },
	{ id: "resources", label: "Resources", icon: <ChipGlyph /> },
	{ id: "environment", label: "Environment", icon: <MonitorGlyph /> },
	{ id: "schedule", label: "Schedule", icon: <ClockGlyph /> },
	{ id: "sharing", label: "Sharing", icon: <PeopleGlyph /> },
];
const SECTIONS = LINKS.map((link) => link.id);

/** The former sections' names that still lead here (settings#parameters: the update dialog, the ⋮ menu). */
const ALIASES: Record<string, string> = { parameters: "resources" };

/**
 * Platform: the workspace's settings on one page - General, Resources, Environment, Schedule and Sharing, each a
 * card, with a list of them (and the workspace At a glance) on the left. One form: whatever is changed waits in the
 * save bar, which saves each group through its own endpoint (General, the schedule) and applies the build
 * parameters (Resources, Environment) with a new build. Sharing changes at once, as before. A link to a card
 * (settings#schedule) scrolls to it.
 */
const WorkspaceSettingsCardsPage: React.FC = () => {
	const { owner, workspace, permissions } = useWorkspaceSettings();
	const { hash } = useLocation();
	const [searchParams] = useSearchParams();
	const templateVersionId = searchParams.get("templateVersionId") ?? undefined;
	const settings = useWorkspaceSettingsForm({
		owner,
		workspace,
		permissions,
		templateVersionId,
	});
	const { params } = settings;
	const volume = useWorkspaceVolume(workspace, true).data?.volume ?? undefined;
	const restart = useMutation({
		mutationFn: () => API.restartWorkspace({ workspace }),
	});

	useEffect(() => {
		const raw = hash.replace(/^#/, "");
		const id = ALIASES[raw] ?? raw;
		if (!id || !SECTIONS.includes(id)) {
			return;
		}
		const scroll = () =>
			document.getElementById(id)?.scrollIntoView({ block: "start" });
		scroll();
		// Again once the cards above it have loaded and taken their height.
		const timer = window.setTimeout(scroll, 600);
		return () => window.clearTimeout(timer);
	}, [hash]);

	const option = (name: string) => {
		const parameter = params.parameter(name);
		const value = params.value(name);
		return parameter?.options.find((o) => o.value.value === value)?.name;
	};
	const gpus = params.value("gpus");
	const glance: GlanceRow[] = [
		{
			label: "CPU",
			value: params.value("cpu") ? `${params.value("cpu")} cores` : "–",
			mono: true,
		},
		{
			label: "Memory",
			value: params.value("memory") ? `${params.value("memory")} GB` : "–",
			mono: true,
		},
		{
			label: "GPU",
			value:
				!gpus || gpus === "0" ? "Off" : gpus === "1" ? "On" : `On · ${gpus}`,
		},
		{
			label: "Disk",
			value: volume
				? `${volume.sizeGB} GB`
				: params.value("home_disk_size")
					? `${params.value("home_disk_size")} GB`
					: "–",
			mono: true,
		},
		{ label: "Theme", value: option("desktop_theme") ?? "–" },
	];

	const canShare = Boolean(permissions?.shareWorkspace);
	const canUpdate = permissions?.updateWorkspace !== false;
	const label =
		params.applyingLabel ??
		(settings.paramsChanged
			? params.running
				? "Update and restart"
				: "Update and start"
			: "Save changes");
	const note = settings.paramsChanged
		? params.running
			? "Resource and environment changes restart the workspace."
			: "Resource and environment changes start the workspace."
		: "Saved as they are: nothing restarts.";

	return (
		<>
			<div className="mx-auto flex max-w-(--ws-content) flex-wrap items-start gap-8 p-8">
				<SettingsNav
					links={
						canShare ? LINKS : LINKS.filter((link) => link.id !== "sharing")
					}
					glance={glance}
				/>

				<main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
					{params.error ? <ErrorAlert error={params.error} /> : null}
					{settings.templateError ? (
						<ErrorAlert error={settings.templateError} />
					) : null}
					{params.disabled && (
						<Alert severity="warning" prominent>
							The template for this workspace requires automatic updates. Update
							the workspace to edit its resources and environment.
						</Alert>
					)}
					{params.incompatible && (
						<Alert severity="error" prominent>
							<p className="m-0 font-bold">Workspace update blocked</p>
							<p className="mb-0">
								The new template version includes parameter changes that are
								incompatible with this workspace's existing parameter values:
								new <strong>required</strong> parameters, changed{" "}
								<strong>options or validations</strong>, or logic that conflicts
								with earlier choices. Please contact the{" "}
								<strong>template administrator</strong>.
							</p>
						</Alert>
					)}
					{params.diagnostics.map((d, i) => (
						<Alert
							key={i}
							severity={d.severity === "error" ? "error" : "warning"}
						>
							{d.summary}
							{d.detail ? `: ${d.detail}` : ""}
						</Alert>
					))}

					<form
						id={FORM_ID}
						data-testid="form"
						className="contents"
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							if (!settings.blocked) {
								void settings.save();
							}
						}}
					>
						<GeneralCard workspace={workspace} settings={settings} />
						<ResourcesCard
							workspace={workspace}
							params={params}
							volume={volume}
							saving={settings.saving}
						/>
						<EnvironmentCard params={params} saving={settings.saving} />
						<ScheduleCard
							workspace={workspace}
							settings={settings}
							canUpdate={canUpdate}
						/>
					</form>
					{canShare && (
						<SharingCard workspace={workspace} canUpdate={canUpdate} />
					)}
					<div className="h-2" />
				</main>
			</div>

			{settings.changed && (
				<SaveBar
					form={FORM_ID}
					label={label}
					note={note}
					saving={settings.saving}
					disabled={settings.blocked}
					onDiscard={settings.discard}
				/>
			)}

			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={settings.confirmingRestart}
				onConfirm={() => {
					settings.setConfirmingRestart(false);
					void settings.saveAll();
				}}
				onClose={() => settings.setConfirmingRestart(false)}
				title="Restart your workspace?"
				confirmText="Restart"
				description={
					<>
						Restarting your workspace will stop all running processes and{" "}
						<strong>delete non-persistent data</strong>.
					</>
				}
			/>
			<ConfirmDialog
				open={settings.askingAutostopRestart}
				title="Restart workspace?"
				description="Would you like to restart your workspace now to apply your new autostop setting, or let it apply after your next workspace start?"
				confirmText="Restart"
				cancelText="Apply later"
				hideCancel={false}
				onConfirm={() => {
					restart.mutate();
					settings.setAskingAutostopRestart(false);
				}}
				onClose={() => settings.setAskingAutostopRestart(false)}
			/>
		</>
	);
};

/**
 * Platform: the former settings pages' addresses (settings/parameters, ...)
 * open the one page at their card, their query kept (?templateVersionId=).
 */
export const WorkspaceSettingsSectionRedirect: React.FC<{
	section: "general" | "parameters" | "schedule" | "sharing";
}> = ({ section }) => {
	const { search } = useLocation();
	return <Navigate replace to={{ pathname: "..", search, hash: section }} />;
};

export default WorkspaceSettingsCardsPage;
