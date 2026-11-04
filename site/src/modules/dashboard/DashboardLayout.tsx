import { cn } from "cn";
import { Suspense, useState } from "react";
import { useQuery } from "react-query";
import { Outlet } from "react-router";
import { globalLockdown } from "#/api/queries/globalLockdown";
import { Loader } from "#/components/Loader/Loader";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { AnnouncementBanners } from "#/modules/dashboard/AnnouncementBanners/AnnouncementBanners";
import { LicenseBanner } from "#/modules/dashboard/LicenseBanner/LicenseBanner";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { AnnouncementExpiry } from "#/modules/platform/announcement/AnnouncementExpiry";
import { DashboardAddons } from "#/modules/platform/DashboardAddons";
import { GlobalLockdownGate } from "#/modules/platform/globalLockdown/GlobalLockdown";
import { WorkspaceScheduleGate } from "#/modules/platform/scheduler/WorkspaceScheduleGate";
import { Navbar } from "./Navbar/Navbar";
import { NavbarActionTarget } from "./Navbar/NavbarAction";
import { UpdateCheckNotice } from "./UpdateCheckNotice/UpdateCheckNotice";
import { useUpdateCheck } from "./useUpdateCheck";

export const DashboardLayout: React.FC = () => {
	const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
	const { permissions } = useAuthenticated();
	const { data: lockdown } = useQuery(globalLockdown());
	const updateCheck = useUpdateCheck(permissions.viewDeploymentConfig);
	const canViewDeployment = Boolean(permissions.viewDeploymentConfig);
	// Platform: a page in another dashboard page's frame (the workspace grid) is that page alone - the page round it
	// has the navigation bar, the banners and the deployment's bar.
	const embedded = isEmbeddedFrame();

	return (
		<NavbarActionTarget.Provider value={embedded ? undefined : actionTarget}>
			{canViewDeployment && !embedded && <LicenseBanner />}
			{!embedded && <AnnouncementBanners />}
			{!embedded && <AnnouncementExpiry />}
			{(!lockdown?.enabled || lockdown.admin) && <WorkspaceScheduleGate />}

			<div className="flex flex-col min-h-screen justify-between">
				{/* biome-ignore lint/a11y/useValidAnchor: Skip links use fragment anchors by design. */}
				<a
					href="#main-content"
					onClick={(e) => {
						e.preventDefault();
						const main = document.getElementById("main-content");
						main?.focus();
					}}
					className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:z-50 focus-visible:p-4 focus-visible:bg-surface-primary focus-visible:text-content-primary"
				>
					Skip to main content
				</a>
				{!embedded && <Navbar actionRef={setActionTarget} />}
				{/* On narrow screens the announcement is not docked in the navbar. */}
				<div
					data-dashboard-mobile-announcement
					className="md:hidden sticky top-[calc(72px+var(--coder-classification-h,0px))] z-39 empty:hidden"
				>
					<AnnouncementBanner placement="page" />
				</div>

				{/* Pages that scroll end with room to spare, so their last line clears
				    the Chats dock; full-height pages
				    (their root grows to fill main) do not. */}
				<main
					id="main-content"
					tabIndex={-1}
					className={cn(
						"relative flex flex-col flex-1 min-h-0",
						!embedded && "pb-20 has-[>.flex-1]:pb-0",
						"focus:outline-hidden",
					)}
				>
					<Suspense fallback={<Loader />}>
						<GlobalLockdownGate>
							<Outlet />
						</GlobalLockdownGate>
					</Suspense>
				</main>

				{!embedded && updateCheck.isVisible && updateCheck.data && (
					<UpdateCheckNotice
						version={updateCheck.data.version}
						releaseNotesUrl={updateCheck.data.url}
						onDismiss={updateCheck.dismiss}
					/>
				)}
			</div>

			<DashboardAddons />
		</NavbarActionTarget.Provider>
	);
};

export const DashboardFullPage: React.FC<React.ComponentProps<"div">> = ({
	children,
	...attrs
}) => {
	return (
		<div {...attrs} className="flex-1 flex flex-col basis-0 min-h-full">
			{children}
		</div>
	);
};
