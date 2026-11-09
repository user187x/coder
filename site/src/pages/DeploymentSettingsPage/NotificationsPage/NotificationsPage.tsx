import { useQueries } from "react-query";
import {
	customNotificationTemplates,
	notificationDispatchMethods,
	selectTemplatesByGroup,
	systemNotificationTemplates,
} from "#/api/queries/notifications";
import { Loader } from "#/components/Loader/Loader";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useSearchParamsKey } from "#/hooks/useSearchParamsKey";
import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { InboxView } from "#/modules/notifications/NotificationsInbox/InboxView";
import { castNotificationMethod } from "#/modules/notifications/utils";
import { deploymentGroupHasParent } from "#/utils/deployOptions";
import { pageTitle } from "#/utils/page";
import OptionsTable from "../OptionsTable";
import { NotificationEvents } from "./NotificationEvents";
import { ToastComposer } from "./ToastComposer";

const NOTIFICATION_TABS = [
	"inbox",
	"toast",
	"events",
	"configuration",
] as const;

function isNotificationTab(
	value: string,
): value is (typeof NOTIFICATION_TABS)[number] {
	return (NOTIFICATION_TABS as readonly string[]).includes(value);
}

const NotificationsPage: React.FC = () => {
	const { permissions } = useAuthenticated();
	const { deploymentConfig } = useDeploymentConfig();
	const canEditDeploymentConfig = permissions.editDeploymentConfig;
	const [systemTemplatesByGroup, customTemplatesByGroup, dispatchMethods] =
		useQueries({
			queries: [
				{
					...systemNotificationTemplates(),
					select: selectTemplatesByGroup,
				},
				{
					...customNotificationTemplates(),
					select: selectTemplatesByGroup,
				},
				notificationDispatchMethods(),
			],
		});
	const tabState = useSearchParamsKey({
		key: "tab",
		defaultValue: "inbox",
	});

	const activeTab = isNotificationTab(tabState.value)
		? tabState.value
		: NOTIFICATION_TABS[0];

	const ready =
		systemTemplatesByGroup.data != null &&
		customTemplatesByGroup.data != null &&
		dispatchMethods.data != null;
	// Combine system and custom notification templates
	const allTemplatesByGroup = {
		...systemTemplatesByGroup.data,
		...customTemplatesByGroup.data,
	};
	return (
		<>
			<title>{pageTitle("Notifications Settings")}</title>

			<h1 className="sr-only">Notifications</h1>

			{!ready ? (
				<Loader />
			) : (
				// One card with its views as tabs along the top, as the Chat console
				<Tabs
					value={activeTab}
					onValueChange={tabState.setValue}
					className="flex min-w-0 w-full flex-col overflow-hidden rounded-lg border border-solid border-border bg-surface-primary"
					data-testid="notifications-card"
				>
					<div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-border px-3">
						<TabsList
							aria-label="Notifications views"
							className="min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0 border-0"
						>
							<TabsTrigger value="inbox">Inbox</TabsTrigger>
							<TabsTrigger value="toast">Toast</TabsTrigger>
							<TabsTrigger value="events">Events</TabsTrigger>
							<TabsTrigger value="configuration">Configuration</TabsTrigger>
						</TabsList>
					</div>
					<TabsContent value="inbox" className="p-4">
						<InboxView />
					</TabsContent>
					<TabsContent value="toast" className="p-4">
						<ToastComposer canEdit={canEditDeploymentConfig} />
					</TabsContent>
					<TabsContent value="events" className="p-4">
						<NotificationEvents
							templatesByGroup={allTemplatesByGroup}
							deploymentConfig={deploymentConfig.config}
							canEdit={canEditDeploymentConfig}
							defaultMethod={castNotificationMethod(
								dispatchMethods.data.default,
							)}
							availableMethods={dispatchMethods.data.available.map(
								castNotificationMethod,
							)}
						/>
					</TabsContent>
					<TabsContent value="configuration" className="p-4">
						<OptionsTable
							options={deploymentConfig.options.filter((o) =>
								deploymentGroupHasParent(o.group, "Notifications"),
							)}
						/>
					</TabsContent>
				</Tabs>
			)}
		</>
	);
};

export default NotificationsPage;
