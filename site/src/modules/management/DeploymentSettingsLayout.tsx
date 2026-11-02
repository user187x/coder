import { cn } from "cn";
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
	BreadcrumbPage,
} from "#/components/Breadcrumb/Breadcrumb";
import { Button } from "#/components/Button/Button";
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
					className="flex items-center justify-between"
				>
					<BreadcrumbList>
						<BreadcrumbItem>
							<AdminCategoryMenu />
						</BreadcrumbItem>
						<BreadcrumbItem>
							<BreadcrumbPage className="text-content-primary">
								<CategoryIcon aria-hidden className="size-4 shrink-0" />
								{category?.label ?? "General"}
							</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
					<Button
						type="button"
						variant="subtle"
						size="sm"
						className={cn("mr-4 shrink-0", chat && "hidden lg:inline-flex")}
						aria-expanded={sidebarOpen}
						aria-controls={sidebarId}
						aria-label={sidebarOpen ? "Hide categories" : "Show categories"}
						title={sidebarOpen ? "Hide categories" : "Show categories"}
						onClick={() => setSidebarOpen((open) => !open)}
					>
						{sidebarOpen ? (
							<PanelLeftCloseIcon aria-hidden />
						) : (
							<PanelLeftOpenIcon aria-hidden />
						)}
						<span className="hidden sm:inline">Categories</span>
					</Button>
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
