import { API } from "#/api/api";
import { type NavbarLayout, PlatformAPI } from "#/api/platform";
import type * as TypesGen from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { useProductLogoURL } from "#/components/Icons/ProductLogo";
import type { ProxyContextValue } from "#/contexts/ProxyContext";
import { NotificationsInbox } from "#/modules/notifications/NotificationsInbox/NotificationsInbox";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { ChatInboxIndicator } from "#/modules/platform/chat/ChatInboxIndicator";
import { NavbarArrange } from "#/modules/platform/navbarOrder/NavbarArrange";
import { startNavbarArrange } from "#/modules/platform/navbarOrder/navbarOrder";
import type {
	AdminQuickLinks,
	AdminSettingsPermissions,
} from "./AdminSettings";
import { addableAdminPages } from "./adminQuickLinks";
import { MobileMenu } from "./MobileMenu";
import { NavbarLogo } from "./NavbarLogo";
import { ProxyMenu } from "./ProxyMenu";
import { SupportIcon } from "./SupportIcon";
import { UserDropdown } from "./UserDropdown/UserDropdown";
import { WorkspacesDropdown } from "./WorkspacesDropdown";
import "./navbarSoft.css";

type NavbarViewProps = {
	actionRef?: React.Ref<HTMLDivElement>;
	defaultLayout?: NavbarLayout;
	transparency?: number;
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
	defaultLayout,
	transparency = 0,
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

	return (
		<div
			onContextMenu={(event) => {
				// Portaled dropdowns bubble through React without being inside the navbar.
				if (
					event.target instanceof Element &&
					event.currentTarget.contains(event.target) &&
					!event.target.closest("[role=menu]")
				) {
					event.preventDefault();
					startNavbarArrange();
				}
			}}
			style={
				{
					"--navbar-zoom": `var(--navbar-preview-scale, ${scale / 100})`,
					zoom: "var(--navbar-zoom)",
					borderBottomColor: `var(--navbar-preview-border, ${wireframe ? "hsl(var(--border-default))" : "transparent"})`,
					"--navbar-strip-bg": `hsl(var(--surface-primary) / var(--navbar-preview-alpha, ${1 - transparency / 100}))`,
				} as React.CSSProperties
			}
			className="navbar-soft sticky top-0 z-40 border-0 border-b border-solid h-[72px] min-h-[72px] flex items-center leading-none"
		>
			{/* Platform: the logo in a tile like the user's avatar. */}
			<div className="@[48rem]/dashboard:hidden">
				<NavbarLogo />
			</div>

			{/* Platform: Workspaces, the banner, latency and HUD, in the user's order (NavbarArrange). */}
			<NavbarArrange
				defaultLayout={defaultLayout}
				canSetDefault={adminPermissions.canEditDeployment}
				className="relative flex flex-1 min-w-0 items-center gap-(--navbar-control-gap) h-full"
				items={{
					logo: logoURL ? <NavbarLogo /> : null,
					workspaces: (
						<nav className="flex items-center h-full">
							<WorkspacesDropdown
								images={Boolean(adminPermissions.canEditDeployment)}
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
							<ChatInboxIndicator />
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
							<ChatInboxIndicator />
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
