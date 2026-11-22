import { cn } from "cn";
import { SettingsIcon } from "lucide-react";
import { Suspense, useId, useState } from "react";
import { useQuery } from "react-query";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { INTRO_DURATION } from "#/api/platform";
import {
	banner as bannerQuery,
	userUIPreferences,
} from "#/api/queries/platform";
import { BreadcrumbList } from "#/components/Breadcrumb/Breadcrumb";
import { ContextMenuSeparator } from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { PageLoader } from "#/components/Loader/Loader";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/Popover/Popover";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { adminCategory } from "#/modules/dashboard/Navbar/adminQuickLinks";
import {
	BreadcrumbMenuPanel,
	BreadcrumbViewMenu,
	breadcrumbMenuClass,
} from "#/modules/dashboard/Navbar/BreadcrumbMenu";
import { NavbarStart } from "#/modules/dashboard/Navbar/NavbarAction";
import { SettingsBreadcrumbRoot } from "#/modules/dashboard/Navbar/SettingsBreadcrumbRoot";
import { SettingsCategoryTrigger } from "#/modules/dashboard/Navbar/SettingsCategoryTrigger";
import { TemplateDestinations } from "#/modules/dashboard/Navbar/SettingsDestinationMenu";
import { SettingsPlacementOptions } from "#/modules/dashboard/Navbar/SettingsRootMenu";
import {
	navbarSettingsSide,
	useRegisterPageSettingsBreadcrumb,
} from "#/modules/dashboard/Navbar/settingsMenuHost";
import { canViewDeploymentSettings } from "#/modules/permissions";
import { RequirePermission } from "#/modules/permissions/RequirePermission";
import { useAnnounceSection } from "#/modules/platform/announcement/sectionIntroductions";
import {
	CHAT_CONSOLE_PAGE,
	chatConsoleViews,
} from "#/modules/platform/chat/consolePlaces";
import { AccountCreationMenuItems } from "#/modules/users/AccountCreationMenuItems";
import { HEALTH_SECTIONS } from "#/pages/HealthPage/healthSections";
import { AdminBreadcrumb } from "./AdminBreadcrumb";
import { CategoryBreadcrumbButton } from "./CategoryBreadcrumbButton";
import { DeploymentSidebar } from "./DeploymentSidebar";
import { useSettingsDefaultView } from "./settingsDefaultView";
import "#/modules/dashboard/Navbar/settingsMenuSkeuo.css";
import "#/modules/dashboard/Navbar/skeuoPopover.css";

const DeploymentSettingsLayout: React.FC = () => {
	const { permissions } = useAuthenticated();
	const location = useLocation();
	const sidebarId = useId();
	const defaultView = useSettingsDefaultView();
	const preferences = useQuery(userUIPreferences());
	// The navbar's end it sits at; on the right its popover hangs to the left.
	const side = navbarSettingsSide(preferences.data);
	const [categoriesOpen, setCategoriesOpen] = useState(false);
	// In the navbar, the Settings chevron opens the navbar's Settings menu, where there is one.
	// The navbar shows its own Settings chevron on every other page; here this breadcrumb holds it.
	useRegisterPageSettingsBreadcrumb(true);
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
	const chat = location.pathname === CHAT_CONSOLE_PAGE;

	const CategoryIcon = category?.icon ?? SettingsIcon;

	const chatDestinations = chatConsoleViews.map(({ id, label }) => (
		<DropdownMenuItem key={id} asChild>
			<Link to={`${CHAT_CONSOLE_PAGE}#${id}`} preventScrollReset>
				{label}
			</Link>
		</DropdownMenuItem>
	));

	const categoryDestinations = chat ? (
		chatDestinations
	) : category?.id === "templates" ? (
		<TemplateDestinations />
	) : category?.id === "accounts" && permissions.createUser ? (
		<AccountCreationMenuItems
			canCreateLease={permissions.editDeploymentConfig}
		/>
	) : category?.id === "health" ? (
		<>
			<DropdownMenuItem asChild>
				<Link to="/health#workspace-health">Workspace Health</Link>
			</DropdownMenuItem>
			{HEALTH_SECTIONS.map(({ key, label, path }) => (
				<DropdownMenuItem key={key} asChild>
					<Link to={`/health#${path.slice("/health/".length)}`}>{label}</Link>
				</DropdownMenuItem>
			))}
		</>
	) : null;

	const navbarBreadcrumb = (
		<NavbarStart inlineWithoutNavbar>
			<AdminBreadcrumb
				variant="connected"
				inline
				className="deployment-breadcrumb admin-navbar-breadcrumb"
			>
				<BreadcrumbList>
					<SettingsBreadcrumbRoot />
					<SettingsCategoryTrigger
						label={category?.label ?? "General"}
						iconOnly
						path={category?.path}
						actions={
							preferences.data?.settings_sidebar && (
								<>
									<ContextMenuSeparator />
									<SettingsPlacementOptions />
								</>
							)
						}
					>
						{categoryDestinations ? (
							<BreadcrumbViewMenu
								label={category?.label ?? "General"}
								trigger={<CategoryIcon aria-hidden />}
							>
								{categoryDestinations}
							</BreadcrumbViewMenu>
						) : (
							<Popover open={categoriesOpen} onOpenChange={setCategoriesOpen}>
								<PopoverAnchor asChild>
									<span className="category-breadcrumb-anchor">
										<CategoryBreadcrumbButton
											label={category?.label ?? "General"}
											icon={CategoryIcon}
											controls={sidebarId}
											sidebarOpen={categoriesOpen}
											onToggle={() => setCategoriesOpen((open) => !open)}
										/>
									</span>
								</PopoverAnchor>
								<PopoverContent
									id={sidebarId}
									align={side === "right" ? "end" : "start"}
									sideOffset={8}
									collisionPadding={8}
									className={cn(
										breadcrumbMenuClass,
										"settings-menu-category-links",
									)}
									// A category picked from it closes it.
									onClick={(event) => {
										if (
											event.target instanceof Element &&
											event.target.closest("a")
										) {
											setCategoriesOpen(false);
										}
									}}
								>
									<BreadcrumbMenuPanel>
										<DeploymentSidebar />
									</BreadcrumbMenuPanel>
								</PopoverContent>
							</Popover>
						)}
					</SettingsCategoryTrigger>
				</BreadcrumbList>
			</AdminBreadcrumb>
		</NavbarStart>
	);

	return (
		<RequirePermission isFeatureVisible={canViewDeploymentSettingsPage}>
			<div
				data-admin-layout=""
				data-dashboard-background=""
				className="flex flex-1 flex-col"
			>
				{navbarBreadcrumb}
				<section
					data-dashboard-background=""
					className="mx-auto my-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-10"
				>
					<div
						data-dashboard-background=""
						className="flex flex-col gap-4 py-3 lg:flex-row lg:gap-8"
					>
						<div
							data-dashboard-background=""
							className="grow min-w-0 [&>*]:mx-auto"
						>
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
