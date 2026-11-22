import {
	ArrowUpRightIcon,
	GaugeIcon,
	SlidersHorizontalIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useQuery } from "react-query";
import { Link, useLocation } from "react-router";
import { API } from "#/api/api";
import { type NavbarLayout, PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import type * as TypesGen from "#/api/typesGenerated";
import {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbPage,
} from "#/components/Breadcrumb/Breadcrumb";
import { Button } from "#/components/Button/Button";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { useProductLogoURL } from "#/components/Icons/ProductLogo";
import type { ProxyContextValue } from "#/contexts/ProxyContext";
import { pingLatencyPath } from "#/modules/navigation";
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
import { DefaultViewOption } from "./DefaultViewOption";
import { MobileMenu } from "./MobileMenu";
import { NavbarLogo } from "./NavbarLogo";
import { NavbarMoveMenu, NavbarMoveScope } from "./NavbarMoveMenu";
import { NavbarResizableGroup } from "./NavbarResizableGroup";
import { navbarInk, navbarStripColor } from "./navbarStrip";
import { ProxyMenu } from "./ProxyMenu";
import { SettingsBreadcrumbRoot } from "./SettingsBreadcrumbRoot";
import { SettingsCategoryTrigger } from "./SettingsCategoryTrigger";
import {
	TemplateDestinations,
	WorkspacePicker,
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
	/** The Settings breadcrumb slot for a page that provides its own navigation. */
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
	onEditAnnouncement?: () => void;
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
	onEditAnnouncement,
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
					if (
						item === bannerItem ||
						!rect.width ||
						!rect.height ||
						rect.bottom <= bannerRect.top ||
						rect.top >= bannerRect.bottom
					) {
						continue;
					}
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
			const settingsRootEdge =
				navbar.dataset.navbarSettingsSide === "right" ? "right" : "left";
			for (const item of items) {
				const join = item === before ? "right" : item === after ? "left" : null;
				// The cutout fits the category end of Settings. Leave room for the
				// hamburger when the root sits next to the banner.
				const clipsSettingsRoot =
					item.classList.contains("navbar-start") && join === settingsRootEdge;
				if (
					join &&
					!clipsSettingsRoot &&
					!item.hasAttribute("data-navbar-divider")
				) {
					item.dataset.bannerEdge = join;
				} else {
					item.removeAttribute("data-banner-edge");
				}
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
	const { pathname, search } = useLocation();
	const pageLabel = navbarPageLabel(pathname);
	const categoryLabel = pageLabel ?? "Settings";
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

	const settingsBreadcrumb = settingsInNavbar &&
		(settingsMenuPresent || preferences.data?.settings_sidebar) &&
		!pageCrumb && (
			<NavbarMoveScope.Provider value>
				<NavbarMoveMenu label="Breadcrumb options">
					<Breadcrumb
						variant="connected"
						data-inline=""
						className="deployment-breadcrumb admin-navbar-breadcrumb navbar-settings-crumb"
					>
						<BreadcrumbList>
							<SettingsBreadcrumbRoot />
							<SettingsCategoryTrigger
								label={categoryLabel}
								path={adminCategory(pathname)?.path}
							>
								{pageLabel === "Template" || pageLabel === "Templates" ? (
									<BreadcrumbViewMenu label={pageLabel}>
										<TemplateDestinations />
									</BreadcrumbViewMenu>
								) : pageLabel === "Workspace" || pageLabel === "Workspaces" ? (
									<WorkspacePicker label={pageLabel} />
								) : (
									<BreadcrumbPage>{categoryLabel}</BreadcrumbPage>
								)}
							</SettingsCategoryTrigger>
						</BreadcrumbList>
					</Breadcrumb>
				</NavbarMoveMenu>
			</NavbarMoveScope.Provider>
		);

	return (
		<div
			ref={navbarRef}
			data-dashboard-background={floating || stripOff ? "" : undefined}
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
			// Mirror the Settings breadcrumb when its menu is aligned to the right.
			data-navbar-settings-side={
				navbarSettingsSide(preferences.data) === "right" ? "right" : undefined
			}
			className="navbar-soft sticky top-0 z-40 border-0 border-b border-solid h-[72px] min-h-[72px] flex items-center leading-none"
		>
			{/* Platform: the logo in a tile like the user's avatar. */}
			<NavbarMoveMenu label="Logo">
				<div className="@[48rem]/dashboard:hidden">
					<NavbarLogo />
				</div>
			</NavbarMoveMenu>
			{/* Resizable: the Settings chevron group and the bar's items in one pill */}
			<NavbarResizableGroup resizable={floating}>
				{/* Platform: Workspaces, the banner, latency and HUD, in the user's order (NavbarArrange). */}
				<NavbarArrange
					defaultLayout={defaultLayout}
					settingsRef={startRef}
					settings={settingsBreadcrumb || null}
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
								onEdit={onEditAnnouncement}
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
							<div className="navbar-action-group flex items-center">
								<div
									ref={actionRef}
									className="navbar-action flex items-center"
								/>
								<div className="navbar-action-fallback">
									<BreadcrumbViewMenu
										label={pageLabel ? `${pageLabel} actions` : "Action"}
										trigger={
											<>
												<SlidersHorizontalIcon aria-hidden />
												{pageLabel ?? "Action"}
											</>
										}
									>
										{(pathname === "/hud" || pathname === pingLatencyPath) && (
											<DropdownMenuItem asChild>
												<Link
													to={pathname === "/hud" ? pingLatencyPath : "/hud"}
												>
													<GaugeIcon aria-hidden />
													{pathname === "/hud" ? "Ping and Latency" : "HUD"}
												</Link>
											</DropdownMenuItem>
										)}
										<DropdownMenuItem asChild>
											<Link
												to={pathname + search}
												target="_blank"
												rel="noopener"
											>
												<ArrowUpRightIcon aria-hidden />
												Open this view in a new tab
											</Link>
										</DropdownMenuItem>
										<DefaultViewOption path={pathname} />
									</BreadcrumbViewMenu>
								</div>
							</div>
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
					<NavbarMoveMenu key={link.name} label={link.name}>
						<div className="hidden @[48rem]/dashboard:block">
							<SupportButton
								name={link.name}
								target={link.target}
								icon={link.icon}
							/>
						</div>
					</NavbarMoveMenu>
				))}

				<NavbarMoveMenu label="Navigation options">
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
				</NavbarMoveMenu>
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
