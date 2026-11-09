import { cn } from "cn";
import { SettingsIcon } from "lucide-react";
import { Suspense, useId, useState } from "react";
import { useQuery } from "react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { INTRO_DURATION } from "#/api/platform";
import { banner as bannerQuery } from "#/api/queries/platform";
import {
	BreadcrumbItem,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import { PageLoader } from "#/components/Loader/Loader";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { adminCategory } from "#/modules/dashboard/Navbar/adminQuickLinks";
import { canViewDeploymentSettings } from "#/modules/permissions";
import { RequirePermission } from "#/modules/permissions/RequirePermission";
import { useAnnounceSection } from "#/modules/platform/announcement/sectionIntroductions";
import { AdminBreadcrumb } from "./AdminBreadcrumb";
import { AdminCategoryMenu } from "./AdminCategoryMenu";
import { CategoryBreadcrumbButton } from "./CategoryBreadcrumbButton";
import { DeploymentSidebar } from "./DeploymentSidebar";
import { useSettingsDefaultView } from "./settingsDefaultView";

const DeploymentSettingsLayout: React.FC = () => {
	const { permissions } = useAuthenticated();
	const location = useLocation();
	const sidebarId = useId();
	const [sidebarOpen, setSidebarOpen] = useState(true);
	// Shown or hidden from the breadcrumb: its toggle keeps the focus where the breadcrumb moves to.
	const [toggled, setToggled] = useState(false);
	const defaultView = useSettingsDefaultView();
	const { data: introduction } = useQuery({
		...bannerQuery(false),
		enabled: !isEmbeddedFrame(),
		select: (banner) => ({
			enabled: banner.introductions === true,
			durationMs: banner.introDurationMs ?? INTRO_DURATION.default,
		}),
	});
	const category = adminCategory(location.pathname);
	useAnnounceSection(
		category,
		introduction?.enabled === true,
		introduction?.durationMs,
	);

	if (location.pathname === "/deployment") {
		// The user's Default View, else the usual first page
		if (defaultView.loading) return <PageLoader />;
		return (
			<Navigate
				to={
					defaultView.path ??
					(permissions.viewDeploymentConfig
						? "/deployment/network"
						: "/deployment/users")
				}
				replace
			/>
		);
	}

	// The deployment settings page also contains users and groups and more so
	// this page must be visible if you can see any of these. The AI settings
	// pages render in this layout too and check their own permissions, and so
	// do the Health pages (the health report).
	const canViewHealth = permissions.viewDebugInfo;
	const canViewDeploymentSettingsPage =
		(["images", "templates", "workspaces"].includes(category?.id ?? "") &&
			permissions.editDeploymentConfig) ||
		canViewDeploymentSettings(permissions) ||
		location.pathname.startsWith("/ai/settings") ||
		(location.pathname.startsWith("/health") && canViewHealth);

	// the category's quick-link icon in the breadcrumb (General: the Admin menu's Settings icon)
	const chat = location.pathname === "/deployment/chat";

	const CategoryIcon = category?.icon ?? SettingsIcon;

	const breadcrumb = (inline: boolean, className?: string) => (
		<AdminBreadcrumb
			variant="connected"
			inline={inline}
			className={cn("deployment-breadcrumb", className)}
			data-categories-collapsed={!sidebarOpen || undefined}
		>
			<BreadcrumbList>
				<BreadcrumbItem>
					<AdminCategoryMenu />
				</BreadcrumbItem>
				<BreadcrumbItem>
					<CategoryBreadcrumbButton
						label={category?.label ?? "General"}
						icon={CategoryIcon}
						controls={sidebarId}
						sidebarOpen={sidebarOpen}
						focusOnMount={toggled}
						onToggle={() => {
							setToggled(true);
							setSidebarOpen((open) => !open);
						}}
					/>
				</BreadcrumbItem>
			</BreadcrumbList>
		</AdminBreadcrumb>
	);

	return (
		<RequirePermission isFeatureVisible={canViewDeploymentSettingsPage}>
			<div data-admin-layout="" className={chat ? "flex-1 min-h-0" : undefined}>
				{/* With the categories open the breadcrumb heads their list, in place of its "Settings" label; collapsed
				    (or on a small screen's Chat, where the list is hidden), it keeps a row of its own. */}
				{!sidebarOpen
					? breadcrumb(false)
					: chat && breadcrumb(false, "lg:hidden")}
				<section className="max-w-[1920px] px-4 sm:px-6 lg:pr-10 lg:pl-4">
					<div className="flex flex-col gap-4 py-3 lg:flex-row lg:gap-8 lg:py-5">
						<div
							id={sidebarId}
							hidden={!sidebarOpen}
							className={
								sidebarOpen
									? chat
										? "hidden lg:contents"
										: "contents"
									: undefined
							}
						>
							{sidebarOpen && <DeploymentSidebar header={breadcrumb(true)} />}
						</div>
						<div className="grow min-w-0">
							<Suspense fallback={<PageLoader />}>
								<Outlet />
							</Suspense>
						</div>
					</div>
				</section>
			</div>
		</RequirePermission>
	);
};

export default DeploymentSettingsLayout;
