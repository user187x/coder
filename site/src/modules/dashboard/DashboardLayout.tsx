import { cn } from "cn";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "react-query";
import { Outlet } from "react-router";
import { globalLockdown } from "#/api/queries/globalLockdown";
import { terminateSignoffs } from "#/api/queries/workspacePower";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { PageLoader } from "#/components/Loader/Loader";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { AnnouncementBanners } from "#/modules/dashboard/AnnouncementBanners/AnnouncementBanners";
import { LicenseBanner } from "#/modules/dashboard/LicenseBanner/LicenseBanner";
import { AnnouncementBanner } from "#/modules/platform/announcement/AnnouncementBanner";
import { AnnouncementExpiry } from "#/modules/platform/announcement/AnnouncementExpiry";
import { DashboardAddons } from "#/modules/platform/DashboardAddons";
import { GlobalLockdownGate } from "#/modules/platform/globalLockdown/GlobalLockdown";
import { useTerminateFlash } from "#/modules/platform/globalLockdown/TerminateSignoff";
import { WorkspaceScheduleGate } from "#/modules/platform/scheduler/WorkspaceScheduleGate";
import { DashboardBackgroundMenu } from "./DashboardBackgroundMenu";
import { Navbar } from "./Navbar/Navbar";
import { NavbarActionTarget, NavbarStartTarget } from "./Navbar/NavbarAction";
import { UpdateCheckNotice } from "./UpdateCheckNotice/UpdateCheckNotice";
import { useUpdateCheck } from "./useUpdateCheck";

const AnnouncementSettingsView = lazy(async () => ({
	default: (
		await import(
			"#/pages/DeploymentSettingsPage/AnnouncementSettingsPage/AnnouncementSettingsPage"
		)
	).AnnouncementSettingsView,
}));

export const DashboardLayout: React.FC = () => {
	const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
	const [startTarget, setStartTarget] = useState<HTMLDivElement | null>(null);
	const [editingAnnouncement, setEditingAnnouncement] = useState(false);
	const { permissions, user } = useAuthenticated();
	const { data: lockdown } = useQuery(globalLockdown());
	const updateCheck = useUpdateCheck(permissions.viewDeploymentConfig);
	const canViewDeployment = Boolean(permissions.viewDeploymentConfig);
	// Platform: a page in another dashboard page's frame (the workspace grid) is that page alone - the page round it
	// has the navigation bar, the banners and the deployment's bar.
	const embedded = isEmbeddedFrame();
	const canEditDeployment =
		!embedded && Boolean(permissions.editDeploymentConfig);
	const editAnnouncement = canEditDeployment
		? () => setEditingAnnouncement(true)
		: undefined;
	const { data: terminateRound } = useQuery({
		...terminateSignoffs(),
		enabled: canEditDeployment,
	});
	useTerminateFlash(canEditDeployment ? terminateRound : undefined);

	return (
		<NavbarActionTarget.Provider value={embedded ? undefined : actionTarget}>
			<NavbarStartTarget.Provider value={embedded ? undefined : startTarget}>
				{canViewDeployment && !embedded && <LicenseBanner />}
				{!embedded && <AnnouncementBanners />}
				{!embedded && <AnnouncementExpiry />}
				{(!lockdown?.enabled || lockdown.admin) && <WorkspaceScheduleGate />}

				<DashboardBackgroundMenu
					enabled={canEditDeployment}
					className="dashboard-frame @container/dashboard flex min-h-screen min-w-0 flex-col justify-between"
				>
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
					{!embedded && (
						<Navbar
							actionRef={setActionTarget}
							startRef={setStartTarget}
							onEditAnnouncement={editAnnouncement}
						/>
					)}
					{/* On narrow screens the announcement is not docked in the navbar. */}
					<div
						data-dashboard-mobile-announcement
						className="@[48rem]/dashboard:hidden sticky top-[calc(72px+var(--coder-classification-h,0px))] z-39 empty:hidden"
					>
						<AnnouncementBanner
							placement="page"
							onEdit={editAnnouncement}
							terminateAlertViewerId={
								permissions.editDeploymentConfig ? user.id : undefined
							}
						/>
					</div>

					{/* Pages that scroll end with room to spare, so their last line clears
				    the Chats dock; full-height pages
				    (their root grows to fill main) do not. */}
					<main
						id="main-content"
						data-dashboard-background=""
						tabIndex={-1}
						className={cn(
							"relative flex flex-col flex-1 min-h-0",
							!embedded && "pb-20 has-[>.flex-1]:pb-0",
							"focus:outline-hidden",
						)}
					>
						<Suspense fallback={<PageLoader />}>
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
				</DashboardBackgroundMenu>

				{canEditDeployment && (
					<Dialog
						open={editingAnnouncement}
						onOpenChange={setEditingAnnouncement}
					>
						<DialogContent
							className="max-w-6xl p-5 sm:p-8"
							overlayClassName="backdrop-blur-md"
						>
							<div className="flex items-center justify-between gap-3">
								<DialogTitle>Announcement banner</DialogTitle>
								<DialogClose asChild>
									<Button variant="outline" size="sm">
										Close
									</Button>
								</DialogClose>
							</div>
							<DialogDescription className="sr-only">
								Edit the deployment announcement and view acknowledgements.
							</DialogDescription>
							<Suspense fallback={<PageLoader />}>
								<AnnouncementSettingsView />
							</Suspense>
						</DialogContent>
					</Dialog>
				)}
				<DashboardAddons />
			</NavbarStartTarget.Provider>
		</NavbarActionTarget.Provider>
	);
};

export const DashboardFullPage: React.FC<React.ComponentProps<"div">> = ({
	children,
	...attrs
}) => {
	return (
		<div
			{...attrs}
			data-dashboard-background=""
			className="flex-1 flex flex-col basis-0 min-h-full"
		>
			{children}
		</div>
	);
};
