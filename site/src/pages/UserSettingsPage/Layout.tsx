import { Suspense, useId, useState } from "react";
import { useQuery } from "react-query";
import { Navigate, Outlet, useMatch } from "react-router";
import { userUIPreferences } from "#/api/queries/platform";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import { PageLoader } from "#/components/Loader/Loader";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "#/components/Popover/Popover";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import {
	NavbarActionTarget,
	NavbarStart,
} from "#/modules/dashboard/Navbar/NavbarAction";
import {
	settingsMenuSlot,
	useRegisterPageSettingsBreadcrumb,
	useSettingsMenuPresent,
} from "#/modules/dashboard/Navbar/settingsMenuHost";
import { AdminBreadcrumb } from "#/modules/management/AdminBreadcrumb";
import { CategoryBreadcrumbButton } from "#/modules/management/CategoryBreadcrumbButton";
import "#/modules/platform/settingsPage/settingsPage.css";
import { pageTitle } from "#/utils/page";
import { Sidebar } from "./Sidebar";
import { settingsSections } from "./settingsSections";
import "./userSettings.css";

const Layout: React.FC = () => {
	const { user: me } = useAuthenticated();
	const match = useMatch("/settings/:section/*");
	const sidebarId = useId();
	const [open, setOpen] = useState(true);
	// Shown or hidden from the breadcrumb: its toggle keeps the focus where the breadcrumb moves to.
	const [toggled, setToggled] = useState(false);
	// With the admin settings navigation in the navbar (the user's choice), this breadcrumb joins the navbar's: the
	// Settings chevron first, then User Settings and the section, whose list opens in a popover and whose chevron holds
	// a page's action button (NavbarAction); the page sits centred without the sections list beside it.
	const preferences = useQuery(userUIPreferences());
	const inNavbar = Boolean(preferences.data?.admin_nav_in_navbar);
	const settingsMenu = useSettingsMenuPresent();
	useRegisterPageSettingsBreadcrumb(inNavbar);
	const [sectionsOpen, setSectionsOpen] = useState(false);
	const [actionHost, setActionHost] = useState<HTMLSpanElement | null>(null);
	if (!match) return <Navigate to="/settings/account" replace />;
	const section =
		Object.entries(settingsSections).find(
			([path]) => path === match.params.section,
		)?.[1] ?? settingsSections.account;
	const breadcrumb = (inline: boolean) => (
		<AdminBreadcrumb
			variant="connected"
			inline={inline}
			className="deployment-breadcrumb"
			data-categories-collapsed={!open || undefined}
		>
			<BreadcrumbList>
				<BreadcrumbItem>
					<BreadcrumbLink to="/settings/account" end title={me.username}>
						<Avatar
							size="sm"
							fallback={me.username}
							src={me.avatar_url}
							className="size-4 shrink-0"
						/>
						User Settings
					</BreadcrumbLink>
				</BreadcrumbItem>
				<BreadcrumbItem>
					<CategoryBreadcrumbButton
						label={section.label}
						icon={section.icon}
						controls={sidebarId}
						sidebarOpen={open}
						focusOnMount={toggled}
						onToggle={() => {
							setToggled(true);
							setOpen((value) => !value);
						}}
					/>
				</BreadcrumbItem>
			</BreadcrumbList>
		</AdminBreadcrumb>
	);
	const userCrumb = (
		<BreadcrumbItem>
			<BreadcrumbLink to="/settings/account" end title={me.username}>
				<Avatar
					size="sm"
					fallback={me.username}
					src={me.avatar_url}
					className="size-4 shrink-0"
				/>
				User Settings
			</BreadcrumbLink>
		</BreadcrumbItem>
	);
	const navbarBreadcrumb = (
		<NavbarStart>
			<AdminBreadcrumb
				variant="connected"
				inline
				className="deployment-breadcrumb admin-navbar-breadcrumb"
			>
				<BreadcrumbList>
					{settingsMenu && <BreadcrumbItem ref={settingsMenuSlot} />}
					{userCrumb}
					<BreadcrumbItem>
						<Popover open={sectionsOpen} onOpenChange={setSectionsOpen}>
							<PopoverAnchor asChild>
								<span className="inline-flex">
									<CategoryBreadcrumbButton
										label={section.label}
										icon={section.icon}
										controls={sidebarId}
										sidebarOpen={sectionsOpen}
										onToggle={() => setSectionsOpen((value) => !value)}
									/>
									<span ref={setActionHost} className="category-action-host" />
								</span>
							</PopoverAnchor>
							<PopoverContent
								id={sidebarId}
								align="start"
								className="max-h-[70vh] w-72 overflow-y-auto p-2"
								// A section picked from it closes it.
								onClick={(event) => {
									if (
										event.target instanceof Element &&
										event.target.closest("a")
									) {
										setSectionsOpen(false);
									}
								}}
							>
								<Sidebar />
							</PopoverContent>
						</Popover>
					</BreadcrumbItem>
				</BreadcrumbList>
			</AdminBreadcrumb>
		</NavbarStart>
	);
	const page = (
		<section
			aria-label={`${section.label} settings`}
			className="ws-settings ws-card user-settings-card grow min-w-0 self-stretch lg:self-start"
		>
			<Suspense fallback={<PageLoader />}>
				<Outlet />
			</Suspense>
		</section>
	);
	if (inNavbar) {
		return (
			<>
				<title>{pageTitle("Settings")}</title>
				{navbarBreadcrumb}
				{/* Centred in the window, and filling the page's room so a page that fits does not scroll */}
				<div data-admin-layout="" className="flex flex-1 flex-col">
					<div className="mx-auto my-auto w-full max-w-[1920px] px-4 sm:px-6 lg:px-10">
						<div className="flex flex-col gap-4 py-3">
							<NavbarActionTarget.Provider value={actionHost}>
								{page}
							</NavbarActionTarget.Provider>
						</div>
					</div>
				</div>
			</>
		);
	}
	return (
		<>
			<title>{pageTitle("Settings")}</title>
			<div data-admin-layout="">
				{/* As the admin settings: with the sections open the breadcrumb heads their list; hidden, it keeps a row of
				    its own. */}
				{!open && breadcrumb(false)}
				<div className="max-w-[1920px] px-4 sm:px-6 lg:pr-10 lg:pl-4">
					<div className="flex flex-col gap-4 py-3 lg:flex-row lg:gap-8 lg:py-5">
						<div
							id={sidebarId}
							hidden={!open}
							className={open ? "contents" : undefined}
						>
							{open && <Sidebar header={breadcrumb(true)} />}
						</div>
						{page}
					</div>
				</div>
			</div>
		</>
	);
};
export default Layout;
