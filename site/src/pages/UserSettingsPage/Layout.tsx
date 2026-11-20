import { Suspense, useRef, useState } from "react";
import { Navigate, Outlet, useMatch } from "react-router";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	BreadcrumbItem,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { PageLoader } from "#/components/Loader/Loader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { BreadcrumbDropdownContent } from "#/modules/dashboard/Navbar/BreadcrumbMenu";
import { NavbarStart } from "#/modules/dashboard/Navbar/NavbarAction";
import { SettingsBreadcrumbRoot } from "#/modules/dashboard/Navbar/SettingsBreadcrumbRoot";
import { useRegisterPageSettingsBreadcrumb } from "#/modules/dashboard/Navbar/settingsMenuHost";
import { AdminBreadcrumb } from "#/modules/management/AdminBreadcrumb";
import { CategoryBreadcrumbButton } from "#/modules/management/CategoryBreadcrumbButton";
import "#/modules/platform/settingsPage/settingsPage.css";
import { pageTitle } from "#/utils/page";
import { Sidebar } from "./Sidebar";
import { settingsSections } from "./settingsSections";
import "./userSettings.css";
import "#/modules/dashboard/Navbar/settingsMenuSkeuo.css";

const Layout: React.FC = () => {
	const { user: me } = useAuthenticated();
	const match = useMatch("/settings/:section/*");
	useRegisterPageSettingsBreadcrumb(true);
	const [sectionsOpen, setSectionsOpen] = useState(false);
	const sectionTrigger = useRef<HTMLSpanElement>(null);
	if (!match) return <Navigate to="/settings/account" replace />;
	const section =
		Object.entries(settingsSections).find(
			([path]) => path === match.params.section,
		)?.[1] ?? settingsSections.account;
	// In the navbar, one click on User Settings or on its section opens the sections, hanging from User Settings.
	const navbarBreadcrumb = (
		<NavbarStart inlineWithoutNavbar>
			<AdminBreadcrumb
				variant="connected"
				inline
				className="deployment-breadcrumb admin-navbar-breadcrumb"
			>
				<BreadcrumbList>
					<SettingsBreadcrumbRoot />
					<DropdownMenu
						modal={false}
						open={sectionsOpen}
						onOpenChange={setSectionsOpen}
					>
						<BreadcrumbItem>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									title={`${me.username}: User Settings sections`}
								>
									<Avatar
										size="sm"
										fallback={me.username}
										src={me.avatar_url}
										className="size-4 shrink-0"
									/>
									User Settings
								</button>
							</DropdownMenuTrigger>
						</BreadcrumbItem>
						<BreadcrumbItem>
							<span ref={sectionTrigger} className="inline-flex">
								<CategoryBreadcrumbButton
									label={section.label}
									icon={section.icon}
									hasMenu
									sidebarOpen={sectionsOpen}
									onToggle={() => setSectionsOpen((value) => !value)}
								/>
							</span>
						</BreadcrumbItem>
						<BreadcrumbDropdownContent
							aria-label="User Settings sections"
							onInteractOutside={(event) => {
								if (
									event.target instanceof Node &&
									sectionTrigger.current?.contains(event.target)
								) {
									event.preventDefault();
								}
							}}
						>
							<Sidebar menu />
						</BreadcrumbDropdownContent>
					</DropdownMenu>
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
			{/* Centred in the window, and filling the page's room so a page that fits does not scroll */}
			<div
				data-admin-layout=""
				data-dashboard-background=""
				className="flex flex-1 flex-col"
			>
				<div
					data-dashboard-background=""
					className="mx-auto my-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-10"
				>
					<div
						data-dashboard-background=""
						className="flex flex-col gap-4 py-3"
					>
						{/* The Dashboard's panel round the section's card (dashboardPanel.css) */}
						<div className="dashboard-panel min-w-0 max-w-full self-center">
							{page}
						</div>
					</div>
				</div>
			</div>
		</>
	);
};
export default Layout;
