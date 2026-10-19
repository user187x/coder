import type { Workspace } from "#/api/typesGenerated";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	IdCardGlyph,
	LockGlyph,
	ResetGlyph,
	SmileGlyph,
	TargetGlyph,
	UploadGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import { SettingsCard } from "#/modules/platform/settingsPage/settingsParts";
import { InlineIconEditor } from "#/modules/platform/templateIcons/IconEditor";
import { getFormHelpers } from "#/utils/formUtils";
import type { WorkspaceSettingsForm } from "../useWorkspaceSettingsForm";

/** The update policies, as the design lists them. */
const POLICIES = [
	{ value: "never", label: "Never" },
	{ value: "always", label: "Always" },
] as const;

/** General: the workspace's name (renaming as the template allows), its icon, its update policy. */
export const GeneralCard: React.FC<{
	workspace: Workspace;
	settings: WorkspaceSettingsForm;
}> = ({ workspace, settings }) => {
	const { general, generalError, saving } = settings;
	const field = getFormHelpers(general, generalError)("name");
	const renamable = workspace.allow_renames;
	const required = workspace.template_require_active_version;
	const nameHelp = !renamable
		? "Renaming is disabled by the template — it can be destructive."
		: general.values.name !== general.initialValues.name
			? "Depending on the template, renaming your workspace may be destructive."
			: undefined;

	return (
		<SettingsCard
			id="general"
			title="General"
			description="Name, icon and update behavior"
			icon={<IdCardGlyph />}
		>
			<div className="px-6 py-2">
				<div className="ws-row">
					<div className="ws-row-label">
						<label htmlFor="ws-name" className="block font-medium">
							Workspace name
						</label>
						<p className="ws-desc">Shown in the workspace list and URL.</p>
					</div>
					<div className="ws-row-control">
						<div className="relative max-w-[420px]">
							<input
								id="ws-name"
								name="name"
								type="text"
								className={renamable ? "ws-input" : "ws-input ws-input-locked"}
								value={general.values.name}
								disabled={!renamable || saving}
								aria-invalid={field.error}
								aria-describedby="ws-name-help"
								spellCheck={false}
								onChange={(event) =>
									void general.setFieldValue("name", event.target.value.trim())
								}
								onBlur={() => void general.setFieldTouched("name", true)}
							/>
							{!renamable && (
								<LockGlyph className="absolute right-3.5 top-3.5 text-(--ws-faint)" />
							)}
						</div>
						{field.error ? (
							<p id="ws-name-help" className="ws-error">
								{field.helperText}
							</p>
						) : (
							nameHelp && (
								<p
									id="ws-name-help"
									className={
										renamable ? "ws-help text-content-warning" : "ws-help"
									}
								>
									{nameHelp}
								</p>
							)
						)}
					</div>
				</div>

				<div className="ws-row">
					<div className="ws-row-label">
						<div className="font-medium" id="ws-icon-label">
							Icon
						</div>
						<p className="ws-desc">
							Its own icon; until you pick one, it uses the template's.
						</p>
					</div>
					<div
						className="ws-row-control"
						role="group"
						aria-labelledby="ws-icon-label"
					>
						<InlineIconEditor
							value={general.values.icon}
							onChange={(value) => void general.setFieldValue("icon", value)}
							fallback={workspace.template_icon || undefined}
							resetLabel="Use the template's"
							disabled={saving}
							previewClassName="size-[46px] rounded-(--ws-r-lg) border border-solid border-(--ws-well-line) bg-(--ws-well)"
							buttonClassName="ws-btn"
							placeholder={<TargetGlyph className="text-(--ws-text-2)" />}
							uploadIcon={<UploadGlyph />}
							pickIcon={<SmileGlyph />}
							resetIcon={<ResetGlyph />}
						/>
					</div>
				</div>

				<div className="ws-row">
					<div className="ws-row-label">
						<label htmlFor="ws-policy" className="block font-medium">
							Automatic updates
						</label>
						<p className="ws-desc">
							Update to the latest template version when started.
						</p>
					</div>
					<div className="ws-row-control">
						<Select
							value={required ? "always" : general.values.automatic_updates}
							onValueChange={(value) =>
								void general.setFieldValue("automatic_updates", value)
							}
							disabled={saving || required}
						>
							<SelectTrigger
								id="ws-policy"
								className="ws-input ws-select max-w-[420px]"
								aria-describedby={required ? "ws-policy-help" : undefined}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{POLICIES.map((policy) => (
									<SelectItem key={policy.value} value={policy.value}>
										{policy.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{required && (
							<p id="ws-policy-help" className="ws-help">
								The template for this workspace requires automatic updates.
							</p>
						)}
					</div>
				</div>
			</div>
		</SettingsCard>
	);
};
