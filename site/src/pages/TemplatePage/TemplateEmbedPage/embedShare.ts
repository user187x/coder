import type { Template } from "#/api/typesGenerated";

/**
 * What the template's ⋮ menu › Share copies: the "Open in Coder" button and
 * link, with the settings chosen on its Embed tab (creation mode, parameter
 * values) while that tab is open in this browser, else the defaults.
 */
const chosen = new Map<string, Record<string, string>>();

export const setEmbedValues = (
	templateId: string,
	values: Record<string, string>,
) => {
	chosen.set(templateId, values);
};

const deploymentUrl = () => `${location.protocol}//${location.host}`;

export const shareLink = (template: Template) => {
	const params = new URLSearchParams(
		chosen.get(template.id) ?? { mode: "manual" },
	);
	return `${deploymentUrl()}/templates/${template.organization_name}/${template.name}/workspace?${params.toString()}`;
};

export const shareMarkdown = (template: Template) =>
	`[![Open in Coder](${deploymentUrl()}/open-in-coder.svg)](${shareLink(template)})`;

export const shareHtml = (template: Template) =>
	`<a href="${shareLink(template).replace(/&/g, "&amp;")}"><img src="${deploymentUrl()}/open-in-coder.svg" alt="Open in Coder"></a>`;
