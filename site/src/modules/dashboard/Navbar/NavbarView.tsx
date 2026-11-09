import { useEffect, useRef } from "react";
import { useQuery } from "react-query";
import { API } from "#/api/api";
import { type NavbarLayout, PlatformAPI } from "#/api/platform";
import { userUIPreferences } from "#/api/queries/platform";
import type * as TypesGen from "#/api/typesGenerated";
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
import { addableAdminPages } from "./adminQuickLinks";
import { MobileMenu } from "./MobileMenu";
import { NavbarLogo } from "./NavbarLogo";
import { navbarInk, navbarStripColor } from "./navbarStrip";
import { ProxyMenu } from "./ProxyMenu";
import { SupportIcon } from "./SupportIcon";
import { UserDropdown } from "./UserDropdown/UserDropdown";
import { WorkspacesDropdown } from "./WorkspacesDropdown";
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
	// Appearance > Navigation bar: the backstrip's corners, or no backstrip.
	const preferences = useQuery(userUIPreferences());
	const stripRadius = preferences.data?.navbar_strip_radius ?? 10;
	const stripOff = Boolean(preferences.data?.navbar_strip_off);
	const floating = Boolean(preferences.data?.navbar_floating);
	// The items taken off the navbar: the notification bell among them or not (the Settings badge leaves the inbox
	// and chats to the bell while it shows).
	const { hidden: navbarHidden } = useNavbarOrder(defaultLayout);
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

	// A native listener: the page's action button is portaled in, so React
	// would bubble its events to the page and never through this element.
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		const onContextMenu = (event: MouseEvent) => {
			// Portaled dropdowns are not inside the navbar.
			if (
				event.target instanceof Element &&
				element.contains(event.target) &&
				!event.target.closest("[role=menu]")
			) {
				event.preventDefault();
				startNavbarArrange();
			}
		};
		element.addEventListener("contextmenu", onContextMenu);
		return () => element.removeEventListener("contextmenu", onContextMenu);
	}, []);

	return (
		<div
			ref={root}
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
			className="navbar-soft sticky top-0 z-40 border-0 border-b border-solid h-[72px] min-h-[72px] flex items-center leading-none"
		>
			{/* Platform: the logo in a tile like the user's avatar. */}
			<div className="@[48rem]/dashboard:hidden">
				<NavbarLogo />
			</div>
			{/* A page's own navigation, when its user moved it up here (the admin settings' breadcrumb and categories) */}
			<div
				ref={startRef}
				data-testid="navbar-start"
				className="navbar-start flex shrink-0 items-center empty:hidden"
			/>

			{/* Platform: Workspaces, the banner, latency and HUD, in the user's order (NavbarArrange). */}
			<NavbarArrange
				defaultLayout={defaultLayout}
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
					banner: <AnnouncementBanner placement="navbar" />,
					// the latency and the Controls in one menu, the HUD joined on as one split button (admins)
					latency: (
						<ProxyMenu
							user={user}
							buildInfo={buildInfo}
							supportLinks={supportLinks.filter((link) => !isNavbarLink(link))}
							onSignOut={onSignOut}
							tunnelActorId={user.id}
							canManageTunnels={user.roles.some(
								(role) => role.name === "owner",
							)}
							proxyContextValue={proxyContextValue}
							hud={adminPermissions.canViewHud}
							controls={{
								permissions: adminPermissions,
								quickLinks: adminQuickLinks?.links,
								quickLinksEditor,
								bellShown: !navbarHidden.includes("notifications"),
							}}
						/>
					),
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
							supportLinks={supportLinks?.filter((link) => !isNavbarLink(link))}
							onSignOut={onSignOut}
						/>
					),
					// never alone: always joined to the latency menu
					hud: null,
					action: (
						<div ref={actionRef} className="navbar-action flex items-center" />
					),
				}}
			/>

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
