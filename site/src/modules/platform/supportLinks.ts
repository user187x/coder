import type { LinkConfig } from "#/api/typesGenerated";

/**
 * Coder's default support links that this deployment does not offer (all on
 * the internet, unreachable air-gapped). Matched by name, case-insensitively,
 * wherever support links are listed; a link into Coder's online docs is never
 * offered, whatever its name.
 */
const HIDDEN_SUPPORT_LINKS = new Set([
	"documentation",
	"star the repo",
	"join the coder discord",
	"report a bug",
]);

const ONLINE_DOCS = /^https?:\/\/(www\.)?coder\.com\/docs/i;

export const isOfferedSupportLink = (link: LinkConfig): boolean =>
	!HIDDEN_SUPPORT_LINKS.has(link.name.trim().toLowerCase()) &&
	!ONLINE_DOCS.test(link.target.trim());
