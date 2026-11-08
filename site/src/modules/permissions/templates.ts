/**
 * Platform: who may open the Templates pages - those who make or change templates (template admins, owners).
 * Everyone else reaches a template only by choosing it for a new workspace.
 */
export const canSeeTemplates = (permissions: {
	createTemplates?: boolean;
	updateTemplates?: boolean;
}): boolean =>
	Boolean(permissions.createTemplates || permissions.updateTemplates);
