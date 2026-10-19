import type { FormikProps } from "formik";
import { LockIcon } from "lucide-react";
import type { Template, UpdateTemplateMeta } from "#/api/typesGenerated";
import { Badge } from "#/components/Badge/Badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	ArchiveGlyph,
	IdCardGlyph,
	PortGlyph,
	ResetGlyph,
	SmileGlyph,
	TargetGlyph,
	ToggleGlyph,
	UploadGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	SettingsCard,
	ToggleRow,
} from "#/modules/platform/settingsPage/settingsParts";
import { InlineIconEditor } from "#/modules/platform/templateIcons/IconEditor";
import { getFormHelpers } from "#/utils/formUtils";
import { MAX_DESCRIPTION_CHAR_LIMIT } from "../templateMetaForm";

type MetaCardProps = {
	template: Template;
	form: FormikProps<UpdateTemplateMeta>;
	/** The last save's error (its fields' messages from the API). */
	error: unknown;
	/** Saving, or no permission to update the template. */
	disabled: boolean;
};

/** A row of a card: its name and what it is for on the left, its control on the right. */
const Row: React.FC<{
	label: React.ReactNode;
	htmlFor?: string;
	description: React.ReactNode;
	children: React.ReactNode;
}> = ({ label, htmlFor, description, children }) => (
	<div className="ws-row">
		<div className="ws-row-label">
			{htmlFor ? (
				<label htmlFor={htmlFor} className="block font-medium">
					{label}
				</label>
			) : (
				<div className="font-medium">{label}</div>
			)}
			<p className="ws-desc">{description}</p>
		</div>
		<div className="ws-row-control">{children}</div>
	</div>
);

const FieldMessage: React.FC<{
	id: string;
	error: boolean;
	text: React.ReactNode;
}> = ({ id, error, text }) =>
	text ? (
		<p id={id} className={error ? "ws-error" : "ws-help"}>
			{text}
		</p>
	) : null;

/** General: the template's name (its URL), display name, description and icon. */
export const TemplateGeneralCard: React.FC<MetaCardProps> = ({
	template,
	form,
	error,
	disabled,
}) => {
	const field = getFormHelpers(form, error);
	const name = field("name");
	const displayName = field("display_name");
	const description = field("description", {
		maxLength: MAX_DESCRIPTION_CHAR_LIMIT,
	});
	const icon = field("icon");
	return (
		<SettingsCard
			id="general"
			title="General"
			description="Name, display name, description and icon"
			icon={<IdCardGlyph />}
		>
			<div className="px-6 py-2">
				<Row
					label="Name"
					htmlFor="tpl-name"
					description="Identifies the template in URLs and the API."
				>
					<input
						id="tpl-name"
						name="name"
						type="text"
						className="ws-input max-w-[420px]"
						value={form.values.name ?? ""}
						disabled={disabled}
						spellCheck={false}
						aria-invalid={name.error}
						aria-describedby="tpl-name-help"
						onChange={(e) =>
							void form.setFieldValue("name", e.target.value.trim())
						}
						onBlur={() => void form.setFieldTouched("name", true)}
					/>
					<FieldMessage
						id="tpl-name-help"
						error={name.error}
						text={name.error ? name.helperText : undefined}
					/>
				</Row>
				<Row
					label="Display name"
					htmlFor="tpl-display-name"
					description="What developers see: in the template list, on their workspaces."
				>
					<input
						id="tpl-display-name"
						name="display_name"
						type="text"
						className="ws-input max-w-[420px]"
						value={form.values.display_name ?? ""}
						disabled={disabled}
						aria-invalid={displayName.error}
						aria-describedby="tpl-display-name-help"
						onChange={(e) =>
							void form.setFieldValue("display_name", e.target.value)
						}
						onBlur={() => void form.setFieldTouched("display_name", true)}
					/>
					<FieldMessage
						id="tpl-display-name-help"
						error={displayName.error}
						text={displayName.error ? displayName.helperText : undefined}
					/>
				</Row>
				<Row
					label="Description"
					htmlFor="tpl-description"
					description="A line about what workspaces from it are for."
				>
					<textarea
						id="tpl-description"
						name="description"
						rows={3}
						className="ws-input max-w-[420px] resize-y py-2.5"
						style={{ height: "auto" }}
						value={form.values.description ?? ""}
						disabled={disabled}
						aria-invalid={description.error}
						aria-describedby="tpl-description-help"
						onChange={(e) =>
							void form.setFieldValue("description", e.target.value)
						}
						onBlur={() => void form.setFieldTouched("description", true)}
					/>
					<FieldMessage
						id="tpl-description-help"
						error={description.error}
						text={
							description.helperText ??
							`${(form.values.description ?? "").length} of ${MAX_DESCRIPTION_CHAR_LIMIT} characters`
						}
					/>
				</Row>
				<Row
					label="Icon"
					description="Shown beside its name, and on its workspaces that have none of their own."
				>
					<div role="group" aria-label="Icon">
						<InlineIconEditor
							value={form.values.icon ?? ""}
							onChange={(value) => void form.setFieldValue("icon", value)}
							resetLabel="No icon"
							uploadName={template.name}
							disabled={disabled}
							previewClassName="size-[46px] rounded-(--ws-r-lg) border border-solid border-(--ws-well-line) bg-(--ws-well)"
							buttonClassName="ws-btn"
							placeholder={<TargetGlyph className="text-(--ws-text-2)" />}
							uploadIcon={<UploadGlyph />}
							pickIcon={<SmileGlyph />}
							resetIcon={<ResetGlyph />}
						/>
					</div>
					<FieldMessage
						id="tpl-icon-help"
						error={icon.error}
						text={icon.error ? icon.helperText : undefined}
					/>
				</Row>
			</div>
		</SettingsCard>
	);
};

/** Operations: what workspaces from the template may do. */
export const TemplateOperationsCard: React.FC<
	MetaCardProps & { advancedSchedulingEnabled: boolean }
> = ({ template, form, disabled, advancedSchedulingEnabled }) => {
	const lockedCache = template.module_cache_disabled_by_deployment;
	const set = (name: keyof UpdateTemplateMeta) => (pressed: boolean) =>
		void form.setFieldValue(name, pressed);
	return (
		<SettingsCard
			id="operations"
			title="Operations"
			description="What workspaces from this template may do"
			icon={<ToggleGlyph size={18} />}
		>
			<div className="px-6 py-1">
				<ToggleRow
					id="allow_user_cancel_workspace_jobs"
					label="Allow users to cancel in-progress workspace jobs."
					description="Depending on your template, canceling builds may leave workspaces in an unhealthy state. This option isn't recommended for most use cases. If on, users may be able to corrupt their workspace."
					pressed={Boolean(form.values.allow_user_cancel_workspace_jobs)}
					onChange={set("allow_user_cancel_workspace_jobs")}
					disabled={disabled}
				/>
				<ToggleRow
					id="require_active_version"
					label="Require workspaces automatically update when started."
					description="Workspaces that are manually started or auto-started will use the active template version. This setting is not enforced for template admins."
					pressed={Boolean(form.values.require_active_version)}
					onChange={set("require_active_version")}
					disabled={
						disabled ||
						(!template.require_active_version && !advancedSchedulingEnabled)
					}
					note={
						!advancedSchedulingEnabled
							? "Not enabled on this deployment."
							: undefined
					}
				/>
				<ToggleRow
					id="disable_module_cache"
					label="Disable Terraform module caching"
					description="Terraform modules are re-downloaded for each workspace build instead of using cached versions. This makes workspace builds less predictable and is not recommended for production templates."
					pressed={lockedCache || Boolean(form.values.disable_module_cache)}
					onChange={set("disable_module_cache")}
					disabled={disabled || lockedCache}
					badge={
						lockedCache && (
							<Badge variant="warning" size="sm" svgSize="sm">
								<LockIcon />
								Set deployment wide
							</Badge>
						)
					}
					note={
						lockedCache && (
							<>
								Locked: module caching is disabled for every template by the
								deployment option{" "}
								<code>CODER_PROVISIONER_DISABLE_MODULE_CACHE</code>. Ask a
								deployment admin to clear it to change this here.
							</>
						)
					}
				/>
				<ToggleRow
					id="allow_workspace_renames"
					label="Allow users to rename their workspaces."
					description="Only enable this if your template does not use the workspace name in such a way that changing it may destroy/recreate a resource."
					pressed={Boolean(form.values.allow_workspace_renames)}
					onChange={set("allow_workspace_renames")}
					disabled={disabled}
				/>
			</div>
		</SettingsCard>
	);
};

const PORT_LEVELS = [
	{ value: "owner", label: "Owner" },
	{ value: "organization", label: "Organization" },
	{ value: "authenticated", label: "Authenticated" },
	{ value: "public", label: "Public" },
];

/** Port sharing: how far workspaces' ports may be shared, and how cross-origin requests to them are handled. */
export const TemplatePortsCard: React.FC<
	MetaCardProps & { portSharingControlsEnabled: boolean }
> = ({ form, disabled, portSharingControlsEnabled }) => (
	<SettingsCard
		id="ports"
		title="Port sharing"
		description="Who may open workspaces' shared ports, and their CORS"
		icon={<PortGlyph size={18} />}
	>
		<div className="px-6 py-2">
			<Row
				label="Maximum port sharing level"
				htmlFor="tpl-port-share"
				description="Public: anyone; Authenticated: any Coder user; Organization: its members; Owner: the workspace's owner only."
			>
				<Select
					value={
						portSharingControlsEnabled
							? form.values.max_port_share_level
							: "public"
					}
					onValueChange={(value) =>
						void form.setFieldValue("max_port_share_level", value)
					}
					disabled={disabled || !portSharingControlsEnabled}
				>
					<SelectTrigger
						id="tpl-port-share"
						className="ws-input ws-select max-w-[420px]"
						aria-describedby="tpl-port-share-help"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PORT_LEVELS.map((level) => (
							<SelectItem key={level.value} value={level.value}>
								{level.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p id="tpl-port-share-help" className="ws-help">
					{portSharingControlsEnabled
						? "The maximum level of port sharing allowed for workspaces."
						: "Controlling the maximum port sharing level is not enabled on this deployment."}
				</p>
			</Row>
			<Row
				label="CORS behavior"
				htmlFor="tpl-cors"
				description="How cross-origin requests to shared ports are handled."
			>
				<Select
					value={form.values.cors_behavior}
					onValueChange={(value) =>
						void form.setFieldValue("cors_behavior", value)
					}
					disabled={disabled}
				>
					<SelectTrigger
						id="tpl-cors"
						className="ws-input ws-select max-w-[420px]"
						aria-describedby="tpl-cors-help"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="simple">Simple (recommended)</SelectItem>
						<SelectItem value="passthru">Passthru</SelectItem>
					</SelectContent>
				</Select>
				<p id="tpl-cors-help" className="ws-help">
					Use Passthru to bypass Coder's built-in CORS protection.
				</p>
			</Row>
		</div>
	</SettingsCard>
);

/** Deprecate: a message that marks the template deprecated (no new workspaces from it). */
export const TemplateDeprecateCard: React.FC<
	MetaCardProps & { accessControlEnabled: boolean }
> = ({ template, form, error, disabled, accessControlEnabled }) => {
	const message = getFormHelpers(form, error)("deprecation_message");
	return (
		<SettingsCard
			id="deprecate"
			title="Deprecate"
			description="Stop new workspaces from being made from it"
			icon={<ArchiveGlyph size={18} />}
		>
			<div className="px-6 py-2">
				<Row
					label="Deprecation message"
					htmlFor="tpl-deprecation"
					description="Existing workspaces keep working; nobody can create a new one from it."
				>
					<input
						id="tpl-deprecation"
						name="deprecation_message"
						type="text"
						className="ws-input max-w-[420px]"
						value={form.values.deprecation_message ?? ""}
						disabled={
							disabled || (!template.deprecated && !accessControlEnabled)
						}
						aria-invalid={message.error}
						aria-describedby="tpl-deprecation-help"
						onChange={(e) =>
							void form.setFieldValue("deprecation_message", e.target.value)
						}
					/>
					<p id="tpl-deprecation-help" className="ws-help">
						Leave it empty to keep the template active. Any message marks the
						template as deprecated: tell its users why, and how to move to
						another template.
						{!accessControlEnabled && (
							<>
								{" "}
								Deprecating templates is not enabled on this deployment.
								{template.deprecated &&
									" You cannot change the message, but you may remove it to mark this template as no longer deprecated."}
							</>
						)}
					</p>
				</Row>
			</div>
		</SettingsCard>
	);
};
