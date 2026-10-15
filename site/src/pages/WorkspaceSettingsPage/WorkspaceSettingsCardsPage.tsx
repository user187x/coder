import { lazy, Suspense, useEffect } from "react";
import { Navigate, useLocation } from "react-router";
import { Loader } from "#/components/Loader/Loader";
import { useWorkspaceSettings } from "./useWorkspaceSettings";

const WorkspaceSettingsPage = lazy(() => import("./WorkspaceSettingsPage"));
const WorkspaceParametersPage = lazy(
	() => import("./WorkspaceParametersPage/WorkspaceParametersPage"),
);
const WorkspaceSchedulePage = lazy(
	() => import("./WorkspaceSchedulePage/WorkspaceSchedulePage"),
);
const WorkspaceSharingPage = lazy(
	() => import("./WorkspaceSharingPage/WorkspaceSharingPage"),
);

/** The cards, by the id each is linked with (settings#parameters). */
type WorkspaceSettingsSection =
	| "general"
	| "parameters"
	| "schedule"
	| "sharing";

const Card: React.FC<{
	id: WorkspaceSettingsSection;
	children: React.ReactNode;
}> = ({ id, children }) => (
	<section
		id={id}
		data-testid={`workspace-settings-${id}`}
		className="min-w-0 scroll-mt-6 rounded-xl border border-solid border-border bg-surface-primary p-6 shadow-sm"
	>
		<Suspense fallback={<Loader />}>{children}</Suspense>
	</section>
);

/**
 * Platform: the workspace's settings on one page, each former page (General,
 * Parameters, Schedule, Sharing) a card: General and Schedule on the left,
 * Parameters and Sharing on the right (one column on narrow screens). Each
 * card keeps its own form and buttons. A link to a card (settings#schedule)
 * scrolls to it.
 */
const WorkspaceSettingsCardsPage: React.FC = () => {
	const { permissions } = useWorkspaceSettings();
	const { hash } = useLocation();

	useEffect(() => {
		const id = hash.replace(/^#/, "");
		if (!id) {
			return;
		}
		const scroll = () =>
			document.getElementById(id)?.scrollIntoView({ block: "start" });
		scroll();
		// Again once the cards above it have loaded and taken their height.
		const timer = window.setTimeout(scroll, 600);
		return () => window.clearTimeout(timer);
	}, [hash]);

	return (
		<div className="grid items-start gap-6 xl:grid-cols-2">
			<div className="flex min-w-0 flex-col gap-6">
				<Card id="general">
					<WorkspaceSettingsPage />
				</Card>
				<Card id="schedule">
					<WorkspaceSchedulePage />
				</Card>
			</div>
			<div className="flex min-w-0 flex-col gap-6">
				<Card id="parameters">
					<WorkspaceParametersPage />
				</Card>
				{permissions?.shareWorkspace && (
					<Card id="sharing">
						<WorkspaceSharingPage />
					</Card>
				)}
			</div>
		</div>
	);
};

/**
 * Platform: the former settings pages' addresses (settings/parameters, ...)
 * open the one page at their card, their query kept (the parameters card
 * reads ?templateVersionId=).
 */
export const WorkspaceSettingsSectionRedirect: React.FC<{
	section: WorkspaceSettingsSection;
}> = ({ section }) => {
	const { search } = useLocation();
	return <Navigate replace to={{ pathname: "..", search, hash: section }} />;
};

export default WorkspaceSettingsCardsPage;
