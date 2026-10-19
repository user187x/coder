import { useEffect } from "react";
import { useLocation } from "react-router";
import { SaveBar } from "#/modules/platform/settingsPage/SaveBar";
import {
	type GlanceRow,
	SettingsNav,
	type SettingsNavLink,
} from "#/modules/platform/settingsPage/SettingsNav";
import {
	ArchiveGlyph,
	BracesGlyph,
	ClockGlyph,
	GearGlyph,
	PortGlyph,
	ShieldGlyph,
	SlidersGlyph,
	ToggleGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import { pageTitle } from "#/utils/page";
import {
	TemplateDeprecateCard,
	TemplateGeneralCard,
	TemplateOperationsCard,
	TemplatePortsCard,
} from "./cards/TemplateMetaCards";
import { TemplateParametersCard } from "./cards/TemplateParametersCard";
import { TemplatePermissionsCard } from "./cards/TemplatePermissionsCard";
import { TemplateScheduleCard } from "./cards/TemplateScheduleCard";
import { TemplateVariablesCard } from "./cards/TemplateVariablesCard";
import { useTemplateSettings } from "./TemplateSettingsLayout";
import { useTemplateSettingsForm } from "./useTemplateSettingsForm";

const FORM_ID = "template-settings-form";

/** The page's cards, in order: their ids (anchors), the left list's links. */
const LINKS: SettingsNavLink[] = [
	{ id: "general", label: "General", icon: <GearGlyph /> },
	{ id: "operations", label: "Operations", icon: <ToggleGlyph /> },
	{ id: "ports", label: "Port sharing", icon: <PortGlyph /> },
	{ id: "deprecate", label: "Deprecate", icon: <ArchiveGlyph /> },
	{ id: "schedule", label: "Schedule", icon: <ClockGlyph /> },
	{ id: "variables", label: "Variables", icon: <BracesGlyph /> },
	{ id: "permissions", label: "Permissions", icon: <ShieldGlyph /> },
	{ id: "parameters", label: "Parameters", icon: <SlidersGlyph /> },
];
const SECTIONS = LINKS.map((link) => link.id);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Platform: the template's settings on one page, in the workspace settings page's look - General, Operations, Port
 * sharing, Deprecate, Schedule, Variables, Permissions and Parameters, each a card, with a list of them (and the
 * template At a glance) on the left. Whatever is changed waits in one save bar; Permissions and Parameters act at
 * once, as before. A link to a card (settings#schedule, or the former settings/schedule) scrolls to it.
 */
const TemplateSettingsCardsPage: React.FC = () => {
	const { template, permissions } = useTemplateSettings();
	const canUpdate = Boolean(permissions.canUpdateTemplate);
	const { hash } = useLocation();
	const settings = useTemplateSettingsForm(template);
	const { meta, schedule, variables, flags } = settings;
	const disabled = settings.saving || !canUpdate;

	useEffect(() => {
		const id = hash.replace(/^#/, "");
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

	const ttl = schedule.form.values.default_ttl_ms;
	const glance: GlanceRow[] = [
		{ label: "Version", value: variables.version?.name ?? "–", mono: true },
		{
			label: "Status",
			value: meta.values.deprecation_message ? "Deprecated" : "Active",
		},
		{ label: "Autostop", value: ttl ? `${ttl} h` : "Off", mono: true },
		{
			label: "Port sharing",
			value: capitalize(meta.values.max_port_share_level ?? "public"),
		},
		{
			label: "Active users",
			value: String(template.active_user_count ?? 0),
			mono: true,
		},
	];

	return (
		<>
			<title>{pageTitle(template.name, "Template Settings")}</title>
			<div className="mx-auto flex max-w-(--ws-content) flex-wrap items-start gap-8 p-8">
				<SettingsNav links={LINKS} glance={glance} />

				<main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
					{!canUpdate && (
						<p className="m-0 text-[13px] text-(--ws-muted)">
							You can see this template's settings; only its admins change them.
						</p>
					)}
					<form
						id={FORM_ID}
						data-testid="form"
						aria-label="Template settings form"
						className="contents"
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							void settings.save();
						}}
					>
						<TemplateGeneralCard
							template={template}
							form={meta}
							error={settings.metaError}
							disabled={disabled}
						/>
						<TemplateOperationsCard
							template={template}
							form={meta}
							error={settings.metaError}
							disabled={disabled}
							advancedSchedulingEnabled={flags.advancedSchedulingEnabled}
						/>
						<TemplatePortsCard
							template={template}
							form={meta}
							error={settings.metaError}
							disabled={disabled}
							portSharingControlsEnabled={flags.portSharingControlsEnabled}
						/>
						<TemplateDeprecateCard
							template={template}
							form={meta}
							error={settings.metaError}
							disabled={disabled}
							accessControlEnabled={flags.accessControlEnabled}
						/>
						<TemplateScheduleCard
							schedule={schedule}
							error={undefined}
							disabled={disabled}
							allowAdvancedScheduling={flags.advancedSchedulingEnabled}
						/>
						<TemplateVariablesCard variables={variables} disabled={disabled} />
					</form>
					<TemplatePermissionsCard template={template} canUpdate={canUpdate} />
					<TemplateParametersCard template={template} canUpdate={canUpdate} />
					<div className="h-2" />
				</main>
			</div>

			{canUpdate && settings.changed && (
				<SaveBar
					form={FORM_ID}
					label={
						settings.variablesChanged ? "Save and publish" : "Save changes"
					}
					note={
						settings.variablesChanged
							? "Changed variables publish a new version of the template."
							: "Saved to the template at once."
					}
					saving={settings.saving}
					disabled={settings.saving}
					onDiscard={settings.discard}
				/>
			)}
		</>
	);
};

export default TemplateSettingsCardsPage;
