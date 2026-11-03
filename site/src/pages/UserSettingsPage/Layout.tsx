import { Suspense, useId, useState } from "react";
import { Navigate, Outlet, useMatch } from "react-router";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
} from "#/components/Breadcrumb/Breadcrumb";
import { Loader } from "#/components/Loader/Loader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
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
	if (!match) return <Navigate to="/settings/account" replace />;
	const section =
		Object.entries(settingsSections).find(
			([path]) => path === match.params.section,
		)?.[1] ?? settingsSections.account;
	return (
		<>
			<title>{pageTitle("Settings")}</title>
			<div>
				<AdminBreadcrumb
					variant="connected"
					data-categories-collapsed={!open || undefined}
				>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink to="/settings/account" end title={me.username}>
								<Avatar size="sm" fallback={me.username} src={me.avatar_url} />
								User Settings
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbItem>
							<CategoryBreadcrumbButton
								label={section.label}
								icon={section.icon}
								controls={sidebarId}
								sidebarOpen={open}
								onToggle={() => setOpen((value) => !value)}
							/>
						</BreadcrumbItem>
					</BreadcrumbList>
				</AdminBreadcrumb>
				<div className="mx-auto max-w-[1920px] px-4 sm:px-6 lg:px-10">
					<div className="flex flex-col gap-4 py-3 lg:flex-row lg:gap-8 lg:py-5">
						<div
							id={sidebarId}
							hidden={!open}
							className={open ? "contents" : undefined}
						>
							{open && <Sidebar />}
						</div>
						<section
							aria-label={`${section.label} settings`}
							className="ws-settings ws-card user-settings-card grow min-w-0 self-stretch lg:self-start"
						>
							<Suspense fallback={<Loader />}>
								<Outlet />
							</Suspense>
						</section>
					</div>
				</div>
			</div>
		</>
	);
};
export default Layout;
