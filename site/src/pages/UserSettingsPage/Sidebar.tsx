import {
	AppWindowIcon,
	BellIcon,
	CalendarClockIcon,
	CircleUserIcon,
	FileKeyIcon,
	KeySquareIcon,
	LockIcon,
	type LucideIcon,
	TicketIcon,
	VaultIcon,
} from "lucide-react";
import {
	Sidebar as BaseSidebar,
	SettingsSidebarNavItem,
} from "#/components/Sidebar/Sidebar";
import { useDashboard } from "#/modules/dashboard/useDashboard";

/** A page of the account view, with its icon before its name (as in the Admin menu and General's sidebar). */
const Item: React.FC<{ href: string; icon: LucideIcon; children: string }> = ({
	href,
	icon: Icon,
	children,
}) => (
	<SettingsSidebarNavItem href={href}>
		<span className="inline-flex items-center gap-2">
			<Icon aria-hidden className="size-4 shrink-0" />
			{children}
		</span>
	</SettingsSidebarNavItem>
);

export const Sidebar: React.FC = () => {
	const { entitlements, buildInfo } = useDashboard();
	const showSchedulePage =
		entitlements.features.advanced_template_scheduling.enabled;
	const showOAuth2Page = buildInfo.oauth2_provider;

	return (
		<BaseSidebar>
			<div className="flex flex-col gap-1">
				<Item href="account" icon={CircleUserIcon}>
					Account
				</Item>
				{showOAuth2Page && (
					<Item href="oauth2-provider" icon={AppWindowIcon}>
						OAuth2 Applications
					</Item>
				)}
				{showSchedulePage && (
					<Item href="schedule" icon={CalendarClockIcon}>
						Schedule
					</Item>
				)}
				<Item href="security" icon={LockIcon}>
					Security
				</Item>
				<Item href="ssh-keys" icon={KeySquareIcon}>
					SSH Keys
				</Item>
				<Item href="tokens" icon={TicketIcon}>
					Tokens
				</Item>
				<Item href="secrets" icon={VaultIcon}>
					Secrets
				</Item>
				<Item href="certificates" icon={FileKeyIcon}>
					Certificates
				</Item>
				<Item href="notifications" icon={BellIcon}>
					Notifications
				</Item>
			</div>
		</BaseSidebar>
	);
};
