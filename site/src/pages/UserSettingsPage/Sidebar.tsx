import {
	Sidebar as BaseSidebar,
	SettingsSidebarNavItem,
} from "#/components/Sidebar/Sidebar";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { settingsSections } from "./settingsSections";

export const Sidebar: React.FC = () => {
	const { entitlements, buildInfo } = useDashboard();
	return (
		<BaseSidebar className="lg:sticky lg:top-[calc(var(--dashboard-navigation-height,72px)+var(--admin-breadcrumb-height,0px)+16px+var(--coder-classification-h,0px))] lg:self-start [@media(max-height:640px)]:static">
			{/* Inset like the admin list's rows, which leave room for their drag handles. */}
			<div className="flex flex-col gap-1 pl-4">
				{Object.entries(settingsSections).map(
					([path, { label, icon: Icon }]) => {
						if (
							path === "appearance" ||
							(path === "oauth2-provider" && !buildInfo.oauth2_provider) ||
							(path === "schedule" &&
								!entitlements.features.advanced_template_scheduling.enabled)
						)
							return null;
						return (
							<SettingsSidebarNavItem key={path} href={path}>
								<span className="inline-flex items-center gap-2">
									<Icon aria-hidden className="size-4 shrink-0" />
									{label}
								</span>
							</SettingsSidebarNavItem>
						);
					},
				)}
			</div>
		</BaseSidebar>
	);
};
