import { Navigate } from "react-router";
import { useTemplateLayoutContext } from "#/pages/TemplatePage/TemplateLayout";

/**
 * Platform: a template's page has no Overview any more (its latency and activity by user are on the Accounts table,
 * its apps at the top of Source Code). Its address, and the old tabs' (Overview, Docs, Resources, Details, Versions),
 * open Source Code for those who may edit the template, New workspace for the others. from: the template's own
 * address ("index"), or one of the old tabs' ("tab", a level down).
 */
export const TemplateHomeRedirect: React.FC<{ from: "index" | "tab" }> = ({
	from,
}) => {
	const { permissions } = useTemplateLayoutContext();
	const up = from === "tab" ? "../" : "";
	return (
		<Navigate
			to={`${up}${permissions.canUpdateTemplate ? "files" : "workspace"}`}
			replace
		/>
	);
};
