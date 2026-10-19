import * as Yup from "yup";
import {
	CORSBehaviors,
	type Template,
	type UpdateTemplateMeta,
	WorkspaceAppSharingLevels,
} from "#/api/typesGenerated";
import {
	displayNameValidator,
	iconValidator,
	nameValidator,
} from "#/utils/formUtils";

export const MAX_DESCRIPTION_CHAR_LIMIT = 128;
const MAX_DESCRIPTION_MESSAGE = `Please enter a description that is no longer than ${MAX_DESCRIPTION_CHAR_LIMIT} characters.`;

/**
 * The template's own settings (General, Operations, Port sharing, Deprecate on its settings page): saved together,
 * as the template's metadata.
 */
export const validationSchema = Yup.object({
	name: nameValidator("Name"),
	display_name: displayNameValidator("Display name"),
	description: Yup.string().max(
		MAX_DESCRIPTION_CHAR_LIMIT,
		MAX_DESCRIPTION_MESSAGE,
	),
	allow_user_cancel_workspace_jobs: Yup.boolean(),
	allow_workspace_renames: Yup.boolean(),
	icon: iconValidator,
	require_active_version: Yup.boolean(),
	disable_module_cache: Yup.boolean(),
	deprecation_message: Yup.string(),
	max_port_sharing_level: Yup.string().oneOf(WorkspaceAppSharingLevels),
	cors_behavior: Yup.string().oneOf(Object.values(CORSBehaviors)),
});

export const metaInitialValues = (template: Template): UpdateTemplateMeta => ({
	name: template.name,
	display_name: template.display_name,
	description: template.description,
	icon: template.icon,
	allow_user_cancel_workspace_jobs: template.allow_user_cancel_workspace_jobs,
	update_workspace_last_used_at: false,
	update_workspace_dormant_at: false,
	require_active_version: template.require_active_version,
	deprecation_message: template.deprecation_message,
	disable_everyone_group_access: false,
	max_port_share_level: template.max_port_share_level,
	cors_behavior: template.cors_behavior,
	disable_module_cache: template.disable_module_cache,
	allow_workspace_renames: template.allow_workspace_renames,
});
