import { ChevronDownIcon, UserRoundCogIcon } from "lucide-react";
import { Suspense } from "react";
import { Navigate, Outlet, useMatch } from "react-router";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	BreadcrumbItem,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { PageLoader } from "#/components/Loader/Loader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { BreadcrumbDropdownContent } from "#/modules/dashboard/Navbar/BreadcrumbMenu";
import {
	NavbarAction,
	NavbarStart,
} from "#/modules/dashboard/Navbar/NavbarAction";
import { SettingsBreadcrumbRoot } from "#/modules/dashboard/Navbar/SettingsBreadcrumbRoot";
import { SettingsCategoryTrigger } from "#/modules/dashboard/Navbar/SettingsCategoryTrigger";
import { useRegisterPageSettingsBreadcrumb } from "#/modules/dashboard/Navbar/settingsMenuHost";
import { AdminBreadcrumb } from "#/modules/management/AdminBreadcrumb";
import "#/modules/platform/settingsPage/settingsPage.css";
import { pageTitle } from "#/utils/page";
import { Sidebar } from "./Sidebar";
import { settingsSections } from "./settingsSections";
import "./userSettings.css";
import "#/modules/dashboard/Navbar/settingsMenuSkeuo.css";

function UserSettingsMenu({ trigger }: { trigger: React.ReactElement }) {
	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
			<BreadcrumbDropdownContent aria-label="User Settings sections">
				<Sidebar menu />
			</BreadcrumbDropdownContent>
		</DropdownMenu>
	);
}

const Layout: React.FC = () => {
	const { user: me } = useAuthenticated();
	const match = useMatch("/settings/:section/*");
	useRegisterPageSettingsBreadcrumb(true);
	if (!match) return <Navigate to="/settings/account" replace />;
	const section =
		Object.entries(settingsSections).find(
			([path]) => path === match.params.section,
		)?.[1] ?? settingsSections.account;
	const SectionIcon = section.icon;
	const navbarBreadcrumb = (
		<NavbarStart inlineWithoutNavbar>
			<AdminBreadcrumb
				variant="connected"
				inline
				className="deployment-breadcrumb admin-navbar-breadcrumb"
			>
				<BreadcrumbList>
					<SettingsBreadcrumbRoot />
					<SettingsCategoryTrigger label="User Settings">
						<span>
							<Avatar
								size="sm"
								fallback={me.username}
								src={me.avatar_url}
								className="size-4 shrink-0"
							/>
							User Settings
						</span>
					</SettingsCategoryTrigger>
					<BreadcrumbItem>
						<UserSettingsMenu
							trigger={
								<button
									type="button"
									aria-current="page"
									aria-label={section.label}
									title={`${section.label}: User Settings sections`}
								>
									<SectionIcon aria-hidden className="size-4 shrink-0" />
								</button>
							}
						/>
					</BreadcrumbItem>
				</BreadcrumbList>
			</AdminBreadcrumb>
		</NavbarStart>
	);
	const page = (
		<section
			aria-label={`${section.label} settings`}
			className="ws-settings ws-card user-settings-card user-settings-card-sized min-w-0 max-w-full"
		>
			<Suspense fallback={<PageLoader />}>
				<Outlet />
			</Suspense>
		</section>
	);
	return (
		<>
			<title>{pageTitle("Settings")}</title>
			{navbarBreadcrumb}
			<NavbarAction>
				<UserSettingsMenu
					trigger={
						<Button
							size="lg"
							variant="outline"
							data-navbar-ink-follow=""
							aria-label="User Settings actions"
						>
							<UserRoundCogIcon aria-hidden />
							User Settings
							<ChevronDownIcon aria-hidden />
						</Button>
					}
				/>
			</NavbarAction>
			{/* Centred in the window, and filling the page's room so a page that fits does not scroll */}
			<div
				data-admin-layout=""
				data-dashboard-background=""
				className="flex flex-1 flex-col"
			>
				<div data-dashboard-background="" className="my-auto w-full">
					<div
						data-dashboard-background=""
						className="flex flex-col gap-4 py-3"
					>
						{/* The Dashboard's panel round the section's card (dashboardPanel.css) */}
						<div className="dashboard-panel min-w-0">{page}</div>
					</div>
				</div>
			</div>
		</>
	);
};
export default Layout;
