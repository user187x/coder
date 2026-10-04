import type { LinkConfig } from "#/api/typesGenerated";

/**
 * Coder's default support links that this deployment does not offer. Matched
 * by name, case-insensitively, wherever support links are listed.
 */
const HIDDEN_SUPPORT_LINKS = new Set([
	"documentation",
	"star the repo",
	"join the coder discord",
	"report a bug",
]);

export const isOfferedSupportLink = (link: LinkConfig): boolean =>
	!HIDDEN_SUPPORT_LINKS.has(link.name.trim().toLowerCase());
