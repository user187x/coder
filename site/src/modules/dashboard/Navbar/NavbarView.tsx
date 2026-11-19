import { useLayoutEffect, useRef } from "react";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import { API } from "#/api/api";
import { type NavbarLayout, PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import type * as TypesGen from "#/api/typesGenerated";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "#/components/Breadcrumb/Breadcrumb";
import { Button } from "#/components/Button/Button";
import { useProductLogoURL } from "#/components/Icons/ProductLogo";
import type { ProxyContextValue } from "#/contexts/ProxyContext";
import { NotificationsInbox } from "#/modules/notifications/NotificationsInbox/NotificationsInbox";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { ChatInboxIndicator } from "#/modules/platform/chat/ChatInboxIndicator";
import { ChatGate } from "#/modules/platform/chat/useChatEnabled";
import { NavbarArrange } from "#/modules/platform/navbarOrder/NavbarArrange";
import {
	startNavbarArrange,
	useNavbarOrder,
} from "#/modules/platform/navbarOrder/navbarOrder";
import type {
	AdminQuickLinks,
	AdminSettingsPermissions,
} from "./AdminSettings";
import { canViewAdminSettings } from "./AdminSettings";
import {
	addableAdminPages,
	adminCategory,
	navbarPageLabel,
} from "./adminQuickLinks";
import { BreadcrumbViewMenu } from "./BreadcrumbMenu";
import { CategoryDefaultMenu } from "./DefaultViewOption";
import { MobileMenu } from "./MobileMenu";
import { NavbarLogo } from "./NavbarLogo";
import { NavbarResizableGroup } from "./NavbarResizableGroup";
import { navbarInk, navbarStripColor } from "./navbarStrip";
import { ProxyMenu } from "./ProxyMenu";
import { SettingsBreadcrumbRoot } from "./SettingsBreadcrumbRoot";
import {
	TemplateDestinations,
	WorkspaceDestinations,
} from "./SettingsDestinationMenu";
import { SupportIcon } from "./SupportIcon";
import {
	navbarSettingsSide,
	usePageSettingsBreadcrumb,
	useSettingsMenuPresent,
} from "./settingsMenuHost";
import { UserDropdown } from "./UserDropdown/UserDropdown";
import { WorkspacesDropdown } from "./WorkspacesDropdown";
import "./navbarSkeuo.css";
import "./navbarSoft.css";

type NavbarViewProps = {
	actionRef?: React.Ref<HTMLDivElement>;
	/** The top-left slot after the logo, for a page's navigation moved into the navbar (NavbarStart). */
	startRef?: React.Ref<HTMLDivElement>;
	defaultLayout?: NavbarLayout;
	transparency?: number;
	/** The backstrip's own colour (#rrggbb); the theme's without one. */
	stripColor?: string | null;
	scale?: number;
	wireframe?: boolean;
	user: TypesGen.User;
	buildInfo?: TypesGen.BuildInfoResponse;
	supportLinks: readonly TypesGen.LinkConfig[];
	onSignOut: () => void;
	adminPermissions: AdminSettingsPermissions;
	/** The admin's quick links; without it the Admin menu has none (and no add row). */
	adminQuickLinks?: AdminQuickLinks;
	proxyContextValue?: ProxyContextValue;
};

export const NavbarView: React.FC<NavbarViewProps> = ({
	actionRef,
	startRef,
	defaultLayout,
	transparency = 0,
	stripColor,
	scale = 100,
	wireframe = true,
	user,
	buildInfo,
	supportLinks,
	onSignOut,
	adminPermissions,
	adminQuickLinks,
	proxyContextValue,
}) => {
	const logoURL = useProductLogoURL();
	const navbarRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const navbar = navbarRef.current;
		if (!navbar) return;

		let frame = 0;
		const observed = new Set<HTMLElement>();
		const updateNeighbors = () => {
			const items = navbar.querySelectorAll<HTMLElement>(
				".navbar-start:not(.navbar-resize-handle), .navbar-arrange > [data-navbar-item]:not(.navbar-resize-handle)",
			);
			const currentItems = new Set(items);
			for (const item of observed) {
				if (!currentItems.has(item)) {
					item.removeAttribute("data-banner-edge");
					resize.unobserve(item);
					observed.delete(item);
				}
			}
			for (const item of items) {
				if (!observed.has(item)) {
					resize.observe(item);
					observed.add(item);
				}
			}
			const bannerItem = navbar.querySelector(
				'[data-navbar-item="banner"]:has(#coder-system-banner)',
			);
			const bannerRect = bannerItem?.getBoundingClientRect();
			let before: HTMLElement | undefined;
			let after: HTMLElement | undefined;
			let beforeEdge = Number.NEGATIVE_INFINITY;
			let afterEdge = Number.POSITIVE_INFINITY;
			if (bannerRect?.width && !navbar.querySelector("[data-arranging]")) {
				const bannerCenter = bannerRect.left + bannerRect.width / 2;
				// Sortable items retain their DOM order while flex order places them.
				for (const item of items) {
					const rect = item.getBoundingClientRect();
					if (item === bannerItem || !rect.width || !rect.height) continue;
					const center = rect.left + rect.width / 2;
					if (center < bannerCenter && rect.right > beforeEdge) {
						before = item;
						beforeEdge = rect.right;
					}
					if (center > bannerCenter && rect.left < afterEdge) {
						after = item;
						afterEdge = rect.left;
					}
				}
			}
			for (const item of items) {
				if (item === before) item.dataset.bannerEdge = "right";
				else if (item === after) item.dataset.bannerEdge = "left";
				else item.removeAttribute("data-banner-edge");
			}
		};

		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(updateNeighbors);
		};
		const resize = new ResizeObserver(schedule);
		const mutations = new MutationObserver(schedule);
		resize.observe(navbar);
		mutations.observe(navbar, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["style", "data-arranging", "data-navbar-settings-side"],
		});
		navbar.addEventListener("transitionend", schedule);
		updateNeighbors();
		return () => {
			navbar.removeEventListener("transitionend", schedule);
			cancelAnimationFrame(frame);
			mutations.disconnect();
			resize.disconnect();
		};
	}, []);

	// Appearance > Navigation bar: the backstrip's corners, or no backstrip.
	const preferences = useQuery(userUIPreferences());
	const stripRadius = preferences.data?.navbar_strip_radius ?? 10;
	const stripOff = Boolean(preferences.data?.navbar_strip_off);
	const floating = Boolean(preferences.data?.navbar_floating);
	// The items taken off the navbar: the notification bell among them or not (the Settings badge leaves the inbox
	// and chats to the bell while it shows).
	const { hidden: navbarHidden } = useNavbarOrder(defaultLayout);
	// The admin settings' navigation in the navbar: the Settings menu opens from the
	// Settings chevron on every page, never the navbar's own Settings button; settings pages put the chevron in their
	// breadcrumb, every other page in the navbar's own.
	const settingsInNavbar = canViewAdminSettings(adminPermissions);
	const pageCrumb = usePageSettingsBreadcrumb();
	const { pathname } = useLocation();
	const pageLabel = navbarPageLabel(pathname);
	const settingsMenuPresent = useSettingsMenuPresent();
	// Editable where there is anything to link to.
	const quickLinksEditor =
		adminQuickLinks && adminQuickLinks.pages.length > 0
			? {
					addable: addableAdminPages(
						adminQuickLinks.links,
						adminQuickLinks.pages,
					),
					onChange: adminQuickLinks.onChange,
				}
			: undefined;

	const arrangeFromBackstrip = (event: React.MouseEvent<HTMLDivElement>) => {
		const { target, currentTarget } = event;
		if (
			stripOff ||
			!(target instanceof Element) ||
			!currentTarget.contains(target)
		) {
			return;
		}
		// Match the hit element itself so controls above the backstrip keep their own menus.
		if (
			target.matches(".navbar-arrange, .navbar-resizable-group") ||
			(!floating && target === currentTarget)
		) {
			event.preventDefault();
			startNavbarArrange();
		}
	};

	// The latency and Settings menu; with the navbar's item hidden, still the settings breadcrumb's Settings chevron menu.
	const settingsMenu = (breadcrumbOnly: boolean) => (
		<ProxyMenu
			breadcrumbOnly={breadcrumbOnly}
			user={user}
			buildInfo={buildInfo}
			onSignOut={onSignOut}
			tunnelActorId={user.id}
			canManageTunnels={user.roles.some((role) => role.name === "owner")}
			proxyContextValue={proxyContextValue}
			hud={adminPermissions.canViewHud}
			controls={{
				permissions: adminPermissions,
				quickLinks: adminQuickLinks?.links,
				categories: adminQuickLinks?.categories,
				pages: adminQuickLinks?.pages,
				quickLinksEditor,
				bellShown: !navbarHidden.includes("notifications"),
			}}
		/>
	);

	return (
		<div
			ref={navbarRef}
			onContextMenu={arrangeFromBackstrip}
			style={
				{
					"--navbar-zoom": `var(--navbar-preview-scale, ${scale / 100})`,
					zoom: "var(--navbar-zoom)",
					borderBottomColor: `var(--navbar-preview-border, ${wireframe ? "hsl(var(--border-default))" : "transparent"})`,
					// the Appearance page's unsaved choice, while it previews one
					"--navbar-strip-bg": `var(--navbar-preview-strip, ${navbarStripColor(stripColor, transparency)})`,
					"--navbar-strip-radius": `${stripRadius}px`,
				} as React.CSSProperties
			}
			// Controls without a surface of their own take the ink that reads on the strip (navbarSoft.css)
			data-navbar-ink={
				stripOff
					? undefined
					: (navbarInk(stripColor, transparency) ?? undefined)
			}
			data-navbar-strip={stripOff ? "off" : undefined}
			data-navbar-floating={floating || undefined}
			// The Settings chevron group at the bar's right end, its breadcrumb mirrored (navbarSoft.css)
			data-navbar-settings-side={
				navbarSettingsSide(preferences.data) === "right" ? "right" : undefined
			}
			className="navbar-soft sticky top-0 z-40 border-0 border-b border-solid h-[72px] min-h-[72px] flex items-center leading-none"
		>
			{/* Platform: the logo in a tile like the user's avatar. */}
			<div className="@[48rem]/dashboard:hidden">
				<NavbarLogo />
			</div>
			{/* Resizable: the Settings chevron group and the bar's items in one pill */}
			<NavbarResizableGroup resizable={floating}>
				{/* A page's own navigation, when its user moved it up here (the admin settings' breadcrumb and categories) */}
				<div
					ref={startRef}
					data-testid="navbar-start"
					className="navbar-start flex shrink-0 items-center empty:hidden"
				>
					{/* Pages without a breadcrumb of their own use the navbar’s section label. */}
					{settingsInNavbar &&
						(settingsMenuPresent || preferences.data?.settings_sidebar) &&
						!pageCrumb && (
							<Breadcrumb
								variant="connected"
								data-inline=""
								className="deployment-breadcrumb admin-navbar-breadcrumb navbar-settings-crumb"
							>
								<BreadcrumbList>
									<SettingsBreadcrumbRoot />
									{pageLabel && (
										<CategoryDefaultMenu path={adminCategory(pathname)?.path}>
											<BreadcrumbItem>
												{pageLabel === "Template" ||
												pageLabel === "Templates" ? (
													<BreadcrumbViewMenu label={pageLabel}>
														<TemplateDestinations />
													</BreadcrumbViewMenu>
												) : pageLabel === "Workspace" ||
													pageLabel === "Workspaces" ? (
													<BreadcrumbViewMenu label={pageLabel}>
														<WorkspaceDestinations />
													</BreadcrumbViewMenu>
												) : (
													<BreadcrumbPage>{pageLabel}</BreadcrumbPage>
												)}
											</BreadcrumbItem>
										</CategoryDefaultMenu>
									)}
								</BreadcrumbList>
							</Breadcrumb>
						)}
				</div>

				{/* Platform: Workspaces, the banner, latency and HUD, in the user's order (NavbarArrange). */}
				<NavbarArrange
					defaultLayout={defaultLayout}
					showSettingsChevrons
					settingsDocked={Boolean(preferences.data?.settings_sidebar)}
					canSetDefault={adminPermissions.canEditDeployment}
					className="navbar-arrange relative flex flex-1 min-w-0 items-center gap-(--navbar-control-gap) h-full"
					items={{
						logo: logoURL ? <NavbarLogo /> : null,
						workspaces: (
							<nav className="flex items-center h-full">
								<WorkspacesDropdown
									images={Boolean(adminPermissions.canEditDeployment)}
									templates={Boolean(adminPermissions.canViewTemplates)}
								/>
							</nav>
						),
						banner: (
							<AnnouncementBanner
								placement="navbar"
								terminateAlertViewerId={
									adminPermissions.canEditDeployment ? user.id : undefined
								}
							/>
						),
						// the latency and the Controls in one menu, the HUD joined on as one split button (admins)
						latency: settingsInNavbar ? null : settingsMenu(false),
						notifications: (
							<div className="relative">
								<NotificationsInbox
									fetchNotifications={API.getInboxNotifications}
									markAllAsRead={API.markAllInboxNotificationsAsRead}
									clearAll={PlatformAPI.clearInbox}
									markNotificationAsRead={(notificationId) =>
										API.updateInboxNotificationReadStatus(notificationId, {
											is_read: true,
										})
									}
								/>
								<ChatGate>
									<ChatInboxIndicator />
								</ChatGate>
							</div>
						),
						account: (
							<UserDropdown
								user={user}
								buildInfo={buildInfo}
								supportLinks={supportLinks?.filter(
									(link) => !isNavbarLink(link),
								)}
								onSignOut={onSignOut}
							/>
						),
						// never alone: always joined to the latency menu
						hud: null,
						action: (
							<div
								ref={actionRef}
								className="navbar-action flex items-center"
							/>
						),
					}}
				/>
			</NavbarResizableGroup>
			{(settingsInNavbar || navbarHidden.includes("latency")) &&
				settingsMenu(true)}

			<div
				className={`flex items-center justify-end gap-3 ml-auto ${supportLinks.some(isNavbarLink) ? "@[48rem]/dashboard:ml-3" : "@[48rem]/dashboard:hidden"}`}
			>
				{supportLinks.filter(isNavbarLink).map((link) => (
					<div key={link.name} className="hidden @[48rem]/dashboard:block">
						<SupportButton
							name={link.name}
							target={link.target}
							icon={link.icon}
						/>
					</div>
				))}

				<div className="@[48rem]/dashboard:hidden">
					<div className="flex items-center gap-3">
						<div className="relative">
							<NotificationsInbox
								fetchNotifications={API.getInboxNotifications}
								markAllAsRead={API.markAllInboxNotificationsAsRead}
								clearAll={PlatformAPI.clearInbox}
								markNotificationAsRead={(notificationId) =>
									API.updateInboxNotificationReadStatus(notificationId, {
										is_read: true,
									})
								}
							/>
							<ChatGate>
								<ChatInboxIndicator />
							</ChatGate>
						</div>
						<MobileMenu
							proxyContextValue={proxyContextValue}
							adminPermissions={adminPermissions}
							adminQuickLinks={adminQuickLinks?.links}
							quickLinksEditor={quickLinksEditor}
							user={user}
							supportLinks={supportLinks}
							onSignOut={onSignOut}
						/>
					</div>
				</div>
			</div>
		</div>
	);
};

function isNavbarLink(link: TypesGen.LinkConfig): boolean {
	return link.location === "navbar";
}

type SupportButtonProps = {
	name: string;
	target: string;
	icon: string;
	location?: string;
};

const SupportButton: React.FC<SupportButtonProps> = ({
	name,
	target,
	icon,
}) => {
	return (
		<Button asChild variant="outline">
			<a
				href={target}
				target="_blank"
				rel="noreferrer"
				className="inline-block"
			>
				{icon && <SupportIcon icon={icon} className="text-content-secondary" />}
				{name}
				<span className="sr-only"> (link opens in new tab)</span>
			</a>
		</Button>
	);
};
