import { cn } from "cn";
import { NavLink } from "react-router";
import { API } from "#/api/api";
import type * as TypesGen from "#/api/typesGenerated";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ProductLogo } from "#/components/Icons/ProductLogo";
import type { ProxyContextValue } from "#/contexts/ProxyContext";
import { NotificationsInbox } from "#/modules/notifications/NotificationsInbox/NotificationsInbox";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { ChatInboxIndicator } from "#/modules/platform/chat/ChatInboxIndicator";
import { getPrereleaseFlag } from "#/utils/buildInfo";
import {
	type AdminSettingsPermissions,
	canViewAdminSettings,
} from "./AdminSettings";
import { AdminSettingsDropdown } from "./DeploymentDropdown";
import { MobileMenu } from "./MobileMenu";
import { ProxyMenu } from "./ProxyMenu";
import { SupportIcon } from "./SupportIcon";
import { UserDropdown } from "./UserDropdown/UserDropdown";
import { WorkspacesDropdown } from "./WorkspacesDropdown";

type NavbarViewProps = {
	user: TypesGen.User;
	buildInfo?: TypesGen.BuildInfoResponse;
	supportLinks: readonly TypesGen.LinkConfig[];
	onSignOut: () => void;
	adminPermissions: AdminSettingsPermissions;
	canViewLicenses: boolean;
	proxyContextValue?: ProxyContextValue;
};

export const NavbarView: React.FC<NavbarViewProps> = ({
	user,
	buildInfo,
	supportLinks,
	onSignOut,
	adminPermissions,
	canViewLicenses,
	proxyContextValue,
}) => {
	const prerelease = getPrereleaseFlag(buildInfo);

	return (
		<div
			className={cn(
				"sticky top-0 bg-surface-primary z-40 border-0 border-b border-solid h-[72px] min-h-[72px] flex items-center leading-none px-6",
				prerelease &&
					cn(
						"[&:before]:content-[''] [&:before]:absolute [&:before]:left-0",
						"[&:before]:right-0 [&:before]:h-1 [&:before]:top-0",
						"[&:before]:bg-[repeating-linear-gradient(-45deg,transparent,transparent_4px,hsl(var(--stripe-color)/0.5)_4px,hsl(var(--stripe-color)/0.5)_8px)]",
					),
			)}
			style={{
				"--stripe-color":
					prerelease === "rc"
						? "var(--border-sky)"
						: prerelease === "devel"
							? "var(--content-warning)"
							: undefined,
			}}
		>
			<NavLink to="/workspaces">
				<ProductLogo className="h-7" />
			</NavLink>

			<nav className="ml-4 hidden md:flex items-center h-full">
				<WorkspacesDropdown />
			</nav>

			{prerelease && buildInfo?.version && (
				<a
					href={buildInfo.external_url}
					target="_blank"
					rel="noreferrer"
					className="absolute top-0 left-1/2 -translate-x-1/2 no-underline z-10"
				>
					<Badge
						variant={prerelease === "rc" ? "info" : "warning"}
						size="sm"
						className="font-mono rounded-t-none border-t-0"
					>
						{buildInfo.version}
					</Badge>
				</a>
			)}

			<div className="flex flex-1 min-w-0 items-center justify-end gap-3 ml-auto">
				<div className="hidden md:flex flex-1 min-w-0 empty:hidden">
					<AnnouncementBanner placement="navbar" />
				</div>

				{supportLinks.filter(isNavbarLink).map((link) => (
					<div key={link.name} className="hidden md:block">
						<SupportButton
							name={link.name}
							target={link.target}
							icon={link.icon}
						/>
					</div>
				))}

				{proxyContextValue && (
					<div className="hidden md:block">
						<ProxyMenu proxyContextValue={proxyContextValue} />
					</div>
				)}

				{canViewAdminSettings(adminPermissions) && (
					<div className="hidden md:block">
						<AdminSettingsDropdown permissions={adminPermissions} />
					</div>
				)}

				<div className="relative">
					<NotificationsInbox
						fetchNotifications={API.getInboxNotifications}
						markAllAsRead={API.markAllInboxNotificationsAsRead}
						markNotificationAsRead={(notificationId) =>
							API.updateInboxNotificationReadStatus(notificationId, {
								is_read: true,
							})
						}
					/>
					<ChatInboxIndicator />
				</div>

				<div className="hidden md:block">
					<UserDropdown
						user={user}
						buildInfo={buildInfo}
						supportLinks={supportLinks?.filter((link) => !isNavbarLink(link))}
						onSignOut={onSignOut}
						canViewLicenses={canViewLicenses}
					/>
				</div>

				<div className="md:hidden">
					<MobileMenu
						proxyContextValue={proxyContextValue}
						adminPermissions={adminPermissions}
						user={user}
						supportLinks={supportLinks}
						onSignOut={onSignOut}
					/>
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
