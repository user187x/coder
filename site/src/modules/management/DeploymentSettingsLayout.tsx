import { cn } from "cn";
import {
	PanelLeftIcon,
	PanelRightIcon,
	PanelTopIcon,
	SettingsIcon,
} from "lucide-react";
import { Suspense, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { INTRO_DURATION } from "#/api/platform";
import {
	banner as bannerQuery,
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	BreadcrumbItem,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import {
	ContextMenu,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
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
	BreadcrumbContextMenuContent,
	BreadcrumbMenuPanel,
	BreadcrumbViewMenu,
	breadcrumbMenuClass,
} from "#/modules/dashboard/Navbar/BreadcrumbMenu";
import { CategoryDefaultMenu } from "#/modules/dashboard/Navbar/DefaultViewOption";
import {
	NavbarActionTarget,
	NavbarStart,
} from "#/modules/dashboard/Navbar/NavbarAction";
import {
	TemplateDestinations,
	WorkspaceDestinations,
} from "#/modules/dashboard/Navbar/SettingsDestinationMenu";
import {
	navbarSettingsSide,
	settingsMenuSlot,
	useRegisterPageSettingsBreadcrumb,
	useSettingsMenuPresent,
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
import { AdminCategoryMenu } from "./AdminCategoryMenu";
import { CategoryBreadcrumbButton } from "./CategoryBreadcrumbButton";
import { DeploymentSidebar } from "./DeploymentSidebar";
import { useSettingsDefaultView } from "./settingsDefaultView";
import "#/modules/dashboard/Navbar/settingsMenuSkeuo.css";
import "#/modules/dashboard/Navbar/skeuoPopover.css";

const DeploymentSettingsLayout: React.FC = () => {
	const { permissions } = useAuthenticated();
	const location = useLocation();
	const sidebarId = useId();
	const [sidebarOpen, setSidebarOpen] = useState(true);
	// Shown or hidden from the breadcrumb: its toggle keeps the focus where the breadcrumb moves to.
	const [toggled, setToggled] = useState(false);
	const defaultView = useSettingsDefaultView();
	// The breadcrumb and categories in the navbar's top left (the user's choice), the categories then in a popover.
	const queryClient = useQueryClient();
	const preferences = useQuery(userUIPreferences());
	const placement = useMutation(updateUserUIPreferences(queryClient));
	const inNavbar = Boolean(preferences.data?.admin_nav_in_navbar);
	// The navbar's end it sits at; on the right its popover hangs to the left.
	const side = navbarSettingsSide(preferences.data);
	const [categoriesOpen, setCategoriesOpen] = useState(false);
	// In the navbar, the page's action button (NavbarAction) gets its own segment before the category.
	const [actionHost, setActionHost] = useState<HTMLElement | null>(null);
	// In the navbar, the Settings chevron opens the navbar's Settings menu, where there is one.
	const settingsMenu = useSettingsMenuPresent();
	// The navbar shows its own Settings chevron on every other page; here this breadcrumb holds it.
	useRegisterPageSettingsBreadcrumb(inNavbar);
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

	const togglePlacement = (
		<ContextMenuItem
			disabled={placement.isPending}
			onSelect={() => placement.mutate({ admin_nav_in_navbar: !inNavbar })}
		>
			{inNavbar ? <PanelLeftIcon aria-hidden /> : <PanelTopIcon aria-hidden />}
			{inNavbar ? "Beside Page" : "Navbar"}
		</ContextMenuItem>
	);
	const placementOptions = inNavbar
		? (
				[
					["left", "Left Side", PanelLeftIcon],
					["right", "Right Side", PanelRightIcon],
				] as const
			).map(([position, label, Icon]) => (
				<ContextMenuItem
					key={position}
					disabled={placement.isPending || position === side}
					onSelect={() => placement.mutate({ navbar_settings_side: position })}
				>
					<Icon aria-hidden />
					{label}
				</ContextMenuItem>
			))
		: togglePlacement;

	// Right-click outside the category segment to move the navigation.
	const placementMenu = (children: React.ReactElement) => (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<BreadcrumbContextMenuContent aria-label="Settings navigation placement">
				{placementOptions}
				{inNavbar && togglePlacement}
			</BreadcrumbContextMenuContent>
		</ContextMenu>
	);

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
	) : category?.id === "workspaces" ? (
		<WorkspaceDestinations />
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
		<NavbarStart>
			{placementMenu(
				<AdminBreadcrumb
					variant="connected"
					inline
					className="deployment-breadcrumb admin-navbar-breadcrumb"
				>
					<BreadcrumbList>
						{settingsMenu ? (
							<BreadcrumbItem ref={settingsMenuSlot} />
						) : (
							<BreadcrumbItem>
								<AdminCategoryMenu />
							</BreadcrumbItem>
						)}
						<BreadcrumbItem
							ref={setActionHost}
							className="category-action-host"
						/>
						<CategoryDefaultMenu
							path={category?.path}
							actions={
								<>
									<ContextMenuSeparator />
									{placementOptions}
								</>
							}
						>
							<BreadcrumbItem>
								{categoryDestinations ? (
									<BreadcrumbViewMenu
										label={category?.label ?? "General"}
										trigger={<CategoryIcon aria-hidden />}
									>
										{categoryDestinations}
									</BreadcrumbViewMenu>
								) : (
									<Popover
										open={categoriesOpen}
										onOpenChange={setCategoriesOpen}
									>
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
							</BreadcrumbItem>
						</CategoryDefaultMenu>
					</BreadcrumbList>
				</AdminBreadcrumb>,
			)}
		</NavbarStart>
	);

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
				<CategoryDefaultMenu
					path={category?.path}
					actions={
						<>
							<ContextMenuSeparator />
							{placementOptions}
						</>
					}
				>
					<BreadcrumbItem>
						{chat ? (
							<BreadcrumbViewMenu
								label="Chat"
								trigger={<CategoryIcon aria-hidden />}
							>
								{chatDestinations}
							</BreadcrumbViewMenu>
						) : (
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
						)}
					</BreadcrumbItem>
				</CategoryDefaultMenu>
			</BreadcrumbList>
		</AdminBreadcrumb>
	);

	return (
		<RequirePermission isFeatureVisible={canViewDeploymentSettingsPage}>
			<div
				data-admin-layout=""
				className={cn(
					// Auto margins center pages that fit below the navbar and let taller pages start at the top.
					(inNavbar || chat) && "flex flex-1 flex-col",
				)}
			>
				{/* With the categories open the breadcrumb heads their list, in place of its "Settings" label; collapsed
				    (or on a small screen's Chat, where the list is hidden), it keeps a row of its own. */}
				{inNavbar
					? navbarBreadcrumb
					: !sidebarOpen
						? placementMenu(breadcrumb(false))
						: chat && breadcrumb(false, "lg:hidden")}
				{/* With the navigation in the navbar there is no categories list beside the page: the page sits centred. */}
				<section
					className={cn(
						"max-w-[1920px] px-4 sm:px-6",
						inNavbar || chat
							? "mx-auto my-auto w-full lg:px-10"
							: "lg:pr-10 lg:pl-4",
					)}
				>
					<div
						className={cn(
							"flex flex-col gap-4 py-3 lg:flex-row lg:gap-8",
							// Centred in the window, a page needs less room above and below it.
							inNavbar ? "lg:py-3" : "lg:py-5",
						)}
					>
						<div
							id={sidebarId}
							hidden={!sidebarOpen || inNavbar}
							className={
								sidebarOpen
									? chat
										? "hidden lg:contents"
										: "contents"
									: undefined
							}
						>
							{sidebarOpen && !inNavbar && (
								<DeploymentSidebar header={placementMenu(breadcrumb(true))} />
							)}
						</div>
						<div className={cn("grow min-w-0", inNavbar && "[&>*]:mx-auto")}>
							<Suspense fallback={<PageLoader />}>
								{inNavbar ? (
									<NavbarActionTarget.Provider value={actionHost}>
										<Outlet />
									</NavbarActionTarget.Provider>
								) : (
									<Outlet />
								)}
							</Suspense>
						</div>
					</div>
				</section>
			</div>
		</RequirePermission>
	);
};

export default DeploymentSettingsLayout;
