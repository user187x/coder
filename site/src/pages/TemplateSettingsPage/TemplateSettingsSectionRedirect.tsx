import { Navigate, useLocation } from "react-router";

/**
 * Platform: the former settings pages' addresses (settings/schedule, settings/permissions, ...) open the one page at
 * their card.
 */
export const TemplateSettingsSectionRedirect: React.FC<{
	section: "permissions" | "variables" | "parameters" | "schedule";
}> = ({ section }) => {
	const { search } = useLocation();
	return <Navigate replace to={{ pathname: "..", search, hash: section }} />;
};
