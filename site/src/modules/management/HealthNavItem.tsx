import { useQuery } from "react-query";
import { health } from "#/api/queries/debug";
import { SettingsSidebarNavItem as SidebarNavItem } from "#/components/Sidebar/Sidebar";
import { HealthIcon } from "#/pages/HealthPage/Content";
import { AdminCategoryLabel } from "./AdminCategoryLabel";

/** General's "Health" entry: one page with every part of the deployment's health on its own card, marked with the overall severity. */
export const HealthNavItem: React.FC = () => {
	const { data: report } = useQuery(health());
	return (
		<SidebarNavItem href="/health">
			<AdminCategoryLabel id="health">
				Health
				{report && <HealthIcon size={14} severity={report.severity} />}
			</AdminCategoryLabel>
		</SidebarNavItem>
	);
};
