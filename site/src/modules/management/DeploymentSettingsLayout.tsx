import {
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
	SettingsIcon,
} from "lucide-react";
import { Suspense, useId, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import {
	BreadcrumbItem,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import { Loader } from "#/components/Loader/Loader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { adminCategory } from "#/modules/dashboard/Navbar/adminQuickLinks";
import { canViewDeploymentSettings } from "#/modules/permissions";
import { RequirePermission } from "#/modules/permissions/RequirePermission";
import { AdminBreadcrumb } from "./AdminBreadcrumb";
import { AdminCategoryMenu } from "./AdminCategoryMenu";
import { DeploymentSidebar } from "./DeploymentSidebar";

const DeploymentSettingsLayout: React.FC = () => {
	const { permissions } = useAuthenticated();
	const location = useLocation();
	const sidebarId = useId();
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const SidebarIcon = sidebarOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon;

	if (location.pathname === "/deployment") {
		return (
			<Navigate
				to={
					permissions.viewDeploymentConfig
						? "/deployment/network"
						: "/deployment/users"
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
		canViewDeploymentSettings(permissions) ||
		location.pathname.startsWith("/ai/settings") ||
		(location.pathname.startsWith("/health") && canViewHealth);

	// the category's quick-link icon in the breadcrumb (General: the Admin menu's Settings icon)
	const chat = location.pathname === "/deployment/chat";
	const category = adminCategory(location.pathname);
	const CategoryIcon = category?.icon ?? SettingsIcon;

	return (
		<RequirePermission isFeatureVisible={canViewDeploymentSettingsPage}>
			<div className={chat ? "flex-1 min-h-0" : undefined}>
				<AdminBreadcrumb
					variant="connected"
					data-categories-collapsed={!sidebarOpen || undefined}
				>
					<BreadcrumbList>
						<BreadcrumbItem>
							<AdminCategoryMenu />
						</BreadcrumbItem>
						<BreadcrumbItem>
							<button
								type="button"
								aria-current="page"
								aria-controls={sidebarId}
								aria-expanded={sidebarOpen}
								title={
									sidebarOpen
										? "Double-click to hide categories"
										: "Double-click to show categories"
								}
								onDoubleClick={(event) => {
									if (
										!(
											event.target instanceof Element &&
											event.target.closest("[data-category-toggle]")
										)
									)
										setSidebarOpen((open) => !open);
								}}
								onClick={(event) => {
									if (
										event.detail === 0 ||
										(event.detail === 1 &&
											event.target instanceof Element &&
											event.target.closest("[data-category-toggle]"))
									)
										setSidebarOpen((open) => !open);
								}}
							>
								<CategoryIcon aria-hidden className="size-4 shrink-0" />
								{category?.label ?? "General"}
								<span
									data-category-toggle=""
									aria-hidden="true"
									title={sidebarOpen ? "Hide categories" : "Show categories"}
									className="inline-flex size-6 items-center justify-center rounded-sm opacity-70 hover:opacity-100"
								>
									<SidebarIcon className="size-3.5" />
								</span>
							</button>
						</BreadcrumbItem>
					</BreadcrumbList>
				</AdminBreadcrumb>
				<section className="px-4 sm:px-6 lg:px-10 max-w-[1920px] mx-auto">
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
							{sidebarOpen && <DeploymentSidebar />}
						</div>
						<div className="grow min-w-0">
							<Suspense fallback={<Loader />}>
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
