import { lazy, Suspense } from "react";
import {
	createBrowserRouter,
	createRoutesFromChildren,
	Navigate,
	Outlet,
	Route,
	ScrollRestoration,
} from "react-router";
import { GlobalErrorBoundary } from "./components/ErrorBoundary/GlobalErrorBoundary";
import { Loader } from "./components/Loader/Loader";
import { RequireAuth } from "./contexts/auth/RequireAuth";
import { DashboardLayout } from "./modules/dashboard/DashboardLayout";
import AuditPage from "./pages/AuditPage/AuditPage";
import ConnectionLogPage from "./pages/ConnectionLogPage/ConnectionLogPage";
import { HealthLayout } from "./pages/HealthPage/HealthLayout";
import { HEALTH_CARD_IDS } from "./pages/HealthPage/healthSections";
import LoginOAuthDevicePage from "./pages/LoginOAuthDevicePage/LoginOAuthDevicePage";
import LoginPage from "./pages/LoginPage/LoginPage";
import { SetupPage } from "./pages/SetupPage/SetupPage";
import { TemplateLayout } from "./pages/TemplatePage/TemplateLayout";
import { TemplateRedirectController } from "./pages/TemplatePage/TemplateRedirectController";
import { TemplateSettingsLayout } from "./pages/TemplateSettingsPage/TemplateSettingsLayout";
import TemplatesPage from "./pages/TemplatesPage/TemplatesPage";
import UserSettingsLayout from "./pages/UserSettingsPage/Layout";
import UsersPage from "./pages/UsersPage/UsersPage";
import { WorkspaceSettingsSectionRedirect } from "./pages/WorkspaceSettingsPage/WorkspaceSettingsCardsPage";
import { WorkspaceSettingsLayout } from "./pages/WorkspaceSettingsPage/WorkspaceSettingsLayout";
import WorkspacesPage from "./pages/WorkspacesPage/WorkspacesPage";

// Lazy load pages
// - Pages that are secondary, not in the main navigation or not usually accessed
// - Pages that use heavy dependencies like charts or time libraries
const NotFoundPage = lazy(() => import("./pages/NotFoundPage/NotFoundPage"));
const DeploymentSettingsLayout = lazy(
	() => import("./modules/management/DeploymentSettingsLayout"),
);
const DeploymentConfigProvider = lazy(
	() => import("./modules/management/DeploymentConfigProvider"),
);
const OrganizationSidebarLayout = lazy(
	() => import("./modules/management/OrganizationSidebarLayout"),
);
const OrganizationSettingsLayout = lazy(
	() => import("./modules/management/OrganizationSettingsLayout"),
);
const CliAuthPage = lazy(() => import("./pages/CliAuthPage/CliAuthPage"));
const CliInstallPage = lazy(
	() => import("./pages/CliInstallPage/CliInstallPage"),
);
const AccountPage = lazy(
	() => import("./pages/UserSettingsPage/AccountPage/AccountPage"),
);
const AppearancePage = lazy(
	() => import("./pages/UserSettingsPage/AppearancePage/AppearancePage"),
);
const SchedulePage = lazy(
	() => import("./pages/UserSettingsPage/SchedulePage/SchedulePage"),
);
const SecurityPage = lazy(
	() => import("./pages/UserSettingsPage/SecurityPage/SecurityPage"),
);
const SSHKeysPage = lazy(
	() => import("./pages/UserSettingsPage/SSHKeysPage/SSHKeysPage"),
);
const TokensPage = lazy(
	() => import("./pages/UserSettingsPage/TokensPage/TokensPage"),
);
const SecretsPage = lazy(
	() => import("./pages/UserSettingsPage/SecretsPage/SecretsPage"),
);
const WorkspaceProxyPage = lazy(
	() =>
		import("./pages/UserSettingsPage/WorkspaceProxyPage/WorkspaceProxyPage"),
);
const CreateUserPage = lazy(
	() => import("./pages/CreateUserPage/CreateUserPage"),
);
const EditUserPage = lazy(() => import("./pages/EditUserPage/EditUserPage"));
const WorkspaceBuildPage = lazy(
	() => import("./pages/WorkspaceBuildPage/WorkspaceBuildPage"),
);
const WorkspacePage = lazy(() => import("./pages/WorkspacePage/WorkspacePage"));
const TerminalPage = lazy(() => import("./pages/TerminalPage/TerminalPage"));
const TemplatePermissionsPage = lazy(
	() =>
		import(
			"./pages/TemplateSettingsPage/TemplatePermissionsPage/TemplatePermissionsPage"
		),
);
const TemplateOverviewPage = lazy(
	() =>
		import("./pages/TemplatePage/TemplateOverviewPage/TemplateOverviewPage"),
);
const TemplateVersionsRedirect = lazy(() =>
	import("./pages/TemplatePage/TemplateOverviewPage/TemplateOverviewPage").then(
		(m) => ({ default: m.TemplateVersionsRedirect }),
	),
);
const CreateWorkspacePage = lazy(
	() => import("./pages/CreateWorkspacePage/CreateWorkspacePage"),
);
const OverviewPage = lazy(
	() => import("./pages/DeploymentSettingsPage/OverviewPage/OverviewPage"),
);
const SecuritySettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/SecuritySettingsPage/SecuritySettingsPage"
		),
);
const AppearanceSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/AppearanceSettingsPage/AppearanceSettingsPage"
		),
);
const UserAuthSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/UserAuthSettingsPage/UserAuthSettingsPage"
		),
);
const ExternalAuthSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/ExternalAuthSettingsPage/ExternalAuthSettingsPage"
		),
);
const OAuth2AppsSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/OAuth2AppsSettingsPage/OAuth2AppsSettingsPage"
		),
);
const EditOAuth2AppPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/OAuth2AppsSettingsPage/EditOAuth2AppPage"
		),
);
const CreateOAuth2AppPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/OAuth2AppsSettingsPage/CreateOAuth2AppPage"
		),
);
const NetworkSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/NetworkSettingsPage/NetworkSettingsPage"
		),
);
const ChatSettingsPage = lazy(
	() =>
		import("./pages/DeploymentSettingsPage/ChatSettingsPage/ChatSettingsPage"),
);
const OnlineUsersPage = lazy(
	() =>
		import("./pages/DeploymentSettingsPage/OnlineUsersPage/OnlineUsersPage"),
);
const AnnouncementSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/AnnouncementSettingsPage/AnnouncementSettingsPage"
		),
);
const ClassificationSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/ClassificationSettingsPage/ClassificationSettingsPage"
		),
);
const KeycloakSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/KeycloakSettingsPage/KeycloakSettingsPage"
		),
);
const PersistenceSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/PersistenceSettingsPage/PersistenceSettingsPage"
		),
);
const CustomizeSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/CustomizeSettingsPage/CustomizeSettingsPage"
		),
);
const MonitoringSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/MonitoringSettingsPage/MonitoringSettingsPage"
		),
);
const HudPage = lazy(() => import("./pages/HudPage/HudPage"));
const CertificatesPage = lazy(
	() => import("./pages/UserSettingsPage/CertificatesPage/CertificatesPage"),
);
const ObservabilitySettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/ObservabilitySettingsPage/ObservabilitySettingsPage"
		),
);
const ExternalAuthPage = lazy(
	() => import("./pages/ExternalAuthPage/ExternalAuthPage"),
);
const UserOAuth2ProviderSettingsPage = lazy(
	() =>
		import("./pages/UserSettingsPage/OAuth2ProviderPage/OAuth2ProviderPage"),
);
const TemplateVersionPage = lazy(
	() => import("./pages/TemplateVersionPage/TemplateVersionPage"),
);
const TemplateVersionEditorPage = lazy(
	() => import("./pages/TemplateVersionEditorPage/TemplateVersionEditorPage"),
);
const CreateTemplateGalleryPage = lazy(
	() => import("./pages/CreateTemplateGalleryPage/CreateTemplateGalleryPage"),
);
const StarterTemplatePage = lazy(
	() => import("./pages/StarterTemplatePage/StarterTemplatePage"),
);
const CreateTemplatePage = lazy(
	() => import("./pages/CreateTemplatePage/CreateTemplatePage"),
);
const TemplateBuilderPage = lazy(
	() => import("./pages/TemplateBuilder/TemplateBuilderPage"),
);
const TemplateVariablesPage = lazy(
	() =>
		import(
			"./pages/TemplateSettingsPage/TemplateVariablesPage/TemplateVariablesPage"
		),
);
// Platform: the workspace's settings on one page of cards (General, Parameters, Schedule, Sharing).
const WorkspaceSettingsCardsPage = lazy(
	() => import("./pages/WorkspaceSettingsPage/WorkspaceSettingsCardsPage"),
);
const CreateTokenPage = lazy(
	() => import("./pages/CreateTokenPage/CreateTokenPage"),
);
const TemplateFilesPage = lazy(
	() => import("./pages/TemplatePage/TemplateFilesPage/TemplateFilesPage"),
);
const TemplateSchedulePage = lazy(
	() =>
		import(
			"./pages/TemplateSettingsPage/TemplateSchedulePage/TemplateSchedulePage"
		),
);
const TemplateParametersPage = lazy(
	() =>
		import(
			"./pages/TemplateSettingsPage/TemplateParametersPage/TemplateParametersPage"
		),
);
const TemplateSettingsPage = lazy(
	() =>
		import(
			"./pages/TemplateSettingsPage/TemplateGeneralSettingsPage/TemplateSettingsPage"
		),
);
const LicensesSettingsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/LicensesSettingsPage/LicensesSettingsPage"
		),
);
const AddNewLicensePage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/LicensesSettingsPage/AddNewLicensePage"
		),
);
const OrganizationRedirect = lazy(
	() => import("./pages/OrganizationSettingsPage/OrganizationRedirect"),
);

const CreateOrganizationPage = lazy(
	() => import("./pages/OrganizationSettingsPage/CreateOrganizationPage"),
);
const OrganizationSettingsPage = lazy(
	() => import("./pages/OrganizationSettingsPage/OrganizationSettingsPage"),
);
const GroupsPageProvider = lazy(
	() => import("./pages/GroupsPage/GroupsPageProvider"),
);
const GroupsPage = lazy(() => import("./pages/GroupsPage/GroupsPage"));
const CreateGroupPage = lazy(
	() => import("./pages/GroupsPage/CreateGroupPage"),
);
const GroupPage = lazy(() => import("./pages/GroupsPage/GroupPage"));
const GroupMembersPage = lazy(
	() => import("./pages/GroupsPage/GroupMembersPage"),
);
const GroupSettingsPage = lazy(
	() => import("./pages/GroupsPage/GroupSettingsPage"),
);
const OrganizationMembersPage = lazy(
	() => import("./pages/OrganizationSettingsPage/OrganizationMembersPage"),
);
const OrganizationCustomRolesPage = lazy(
	() =>
		import("./pages/OrganizationSettingsPage/CustomRolesPage/CustomRolesPage"),
);
const OrganizationIdPSyncPage = lazy(
	() => import("./pages/OrganizationSettingsPage/IdpSyncPage/IdpSyncPage"),
);
const CreateEditRolePage = lazy(
	() =>
		import(
			"./pages/OrganizationSettingsPage/CustomRolesPage/CreateEditRolePage"
		),
);
const ProvisionersPage = lazy(
	() =>
		import(
			"./pages/OrganizationSettingsPage/OrganizationProvisionersPage/OrganizationProvisionersPage"
		),
);
const TemplatePrebuildsPage = lazy(
	() =>
		import("./pages/TemplatePage/TemplatePrebuildsPage/TemplatePrebuildsPage"),
);
const IconsPage = lazy(() => import("./pages/IconsPage/IconsPage"));
const DERPRegionPage = lazy(() => import("./pages/HealthPage/DERPRegionPage"));
const HealthOverviewPage = lazy(
	() => import("./pages/HealthPage/HealthOverviewPage"),
);
const UserNotificationsPage = lazy(
	() => import("./pages/UserSettingsPage/NotificationsPage/NotificationsPage"),
);
const DeploymentNotificationsPage = lazy(
	() =>
		import(
			"./pages/DeploymentSettingsPage/NotificationsPage/NotificationsPage"
		),
);
const RequestOTPPage = lazy(
	() => import("./pages/ResetPasswordPage/RequestOTPPage"),
);
const ChangePasswordPage = lazy(
	() => import("./pages/ResetPasswordPage/ChangePasswordPage"),
);
const IdpOrgSyncPage = lazy(
	() => import("./pages/DeploymentSettingsPage/IdpOrgSyncPage/IdpOrgSyncPage"),
);
const ProvisionerKeysPage = lazy(
	() =>
		import(
			"./pages/OrganizationSettingsPage/OrganizationProvisionerKeysPage/OrganizationProvisionerKeysPage"
		),
);
const ProvisionerJobsPage = lazy(
	() =>
		import(
			"./pages/OrganizationSettingsPage/OrganizationProvisionerJobsPage/OrganizationProvisionerJobsPage"
		),
);

const CoderCupPage = lazy(() => import("./pages/CoderCupPage/CoderCupPage"));
const ImagesPage = lazy(() => import("./pages/ImagesPage/ImagesPage"));
const ImageDetailPage = lazy(
	() => import("./pages/ImagesPage/ImageDetailPage"),
);
const ImageEditorPage = lazy(
	() => import("./pages/ImagesPage/ImageEditorPage"),
);
const ImageBuildPage = lazy(() => import("./pages/ImagesPage/ImageBuildPage"));

const GlobalLayout = () => {
	return (
		<Suspense fallback={<Loader fullscreen />}>
			<Outlet />
			<ScrollRestoration />
		</Suspense>
	);
};

const templateRouter = () => {
	return (
		<Route path=":template">
			<Route element={<TemplateRedirectController />}>
				<Route element={<TemplateLayout />}>
					<Route index element={<Navigate to="overview" replace />} />
					<Route path="overview" element={<TemplateOverviewPage />} />
					{/* Docs and Resources are Overview now, Versions part of Source Code */}
					<Route path="docs" element={<Navigate to="../overview" replace />} />
					<Route
						path="resources"
						element={<Navigate to="../overview" replace />}
					/>
					<Route path="files" element={<TemplateFilesPage />} />
					<Route path="versions" element={<TemplateVersionsRedirect />} />
					{/* Platform: no Embed tab any more; old links land on the overview */}
					<Route path="embed" element={<Navigate to=".." replace />} />
					{/* Details (Insights) is part of Overview now */}
					<Route
						path="insights"
						element={<Navigate to="../overview#details" replace />}
					/>
					<Route path="prebuilds" element={<TemplatePrebuildsPage />} />
				</Route>

				<Route path="workspace" element={<CreateWorkspacePage />} />

				<Route path="settings" element={<TemplateSettingsLayout />}>
					<Route index element={<TemplateSettingsPage />} />
					<Route path="permissions" element={<TemplatePermissionsPage />} />
					<Route path="variables" element={<TemplateVariablesPage />} />
					<Route path="parameters" element={<TemplateParametersPage />} />
					<Route path="schedule" element={<TemplateSchedulePage />} />
				</Route>

				<Route path="versions">
					<Route path=":version">
						<Route index element={<TemplateVersionPage />} />
					</Route>
				</Route>
			</Route>
		</Route>
	);
};

const groupsRouter = () => {
	return (
		<Route path="groups">
			<Route element={<GroupsPageProvider />}>
				<Route index element={<GroupsPage />} />

				<Route path="create" element={<CreateGroupPage />} />
				<Route path=":groupName" element={<GroupPage />}>
					<Route index element={<GroupMembersPage />} />
					<Route path="settings" element={<GroupSettingsPage />} />
				</Route>
			</Route>
		</Route>
	);
};

export const router = createBrowserRouter(
	createRoutesFromChildren(
		<Route element={<GlobalLayout />} errorElement={<GlobalErrorBoundary />}>
			<Route path="login" element={<LoginPage />} />
			<Route path="login/device" element={<LoginOAuthDevicePage />} />
			<Route path="setup" element={<SetupPage />} />
			<Route path="reset-password">
				<Route index element={<RequestOTPPage />} />
				<Route path="change" element={<ChangePasswordPage />} />
			</Route>

			{/* Dashboard routes */}
			<Route element={<RequireAuth />}>
				<Route element={<DashboardLayout />}>
					<Route index element={<Navigate to="/workspaces" replace />} />

					<Route
						path="/external-auth/:provider"
						element={<ExternalAuthPage />}
					/>

					<Route path="/workspaces" element={<WorkspacesPage />} />
					<Route path="/hud" element={<HudPage />} />

					<Route path="/starter-templates">
						<Route index element={<CreateTemplateGalleryPage />} />
						<Route path=":exampleId" element={<StarterTemplatePage />} />
					</Route>

					<Route path="/templates">
						<Route index element={<TemplatesPage />} />
						<Route path="new">
							<Route index element={<CreateTemplatePage />} />
							<Route path="builder" element={<TemplateBuilderPage />} />
						</Route>
						<Route path=":organization">{templateRouter()}</Route>
						{templateRouter()}
					</Route>

					<Route path="/images">
						<Route index element={<ImagesPage />} />
						<Route path=":image">
							<Route index element={<ImageDetailPage />} />
							<Route path="edit" element={<ImageEditorPage />} />
							<Route path="builds/:build" element={<ImageBuildPage />} />
						</Route>
					</Route>

					<Route
						path="/users/*"
						element={<Navigate to="/deployment/users" replace />}
					/>

					<Route
						path="/groups/*"
						element={<Navigate to="/deployment/groups" replace />}
					/>

					<Route path="/audit" element={<AuditPage />} />

					<Route path="/connectionlog" element={<ConnectionLogPage />} />

					<Route path="/organizations" element={<OrganizationSettingsLayout />}>
						<Route path="new" element={<CreateOrganizationPage />} />

						{/* General settings for the default org can omit the organization name */}
						<Route index element={<OrganizationRedirect />} />

						<Route path=":organization" element={<OrganizationSidebarLayout />}>
							<Route index element={<OrganizationMembersPage />} />
							{groupsRouter()}
							<Route path="roles">
								<Route index element={<OrganizationCustomRolesPage />} />
								<Route path="create" element={<CreateEditRolePage />} />
								<Route path=":roleName" element={<CreateEditRolePage />} />
							</Route>
							<Route path="provisioners" element={<ProvisionersPage />} />
							<Route
								path="provisioner-jobs"
								element={<ProvisionerJobsPage />}
							/>
							<Route
								path="provisioner-keys"
								element={<ProvisionerKeysPage />}
							/>
							<Route path="idp-sync" element={<OrganizationIdPSyncPage />} />
							<Route path="settings" element={<OrganizationSettingsPage />} />
						</Route>
					</Route>

					<Route path="/deployment" element={<DeploymentSettingsLayout />}>
						<Route element={<DeploymentConfigProvider />}>
							<Route path="overview" element={<OverviewPage />} />
							<Route path="security" element={<SecuritySettingsPage />} />
							<Route
								path="observability"
								element={<ObservabilitySettingsPage />}
							/>

							<Route path="network" element={<NetworkSettingsPage />} />
							<Route path="userauth" element={<UserAuthSettingsPage />} />
							<Route
								path="external-auth"
								element={<ExternalAuthSettingsPage />}
							/>

							<Route
								path="notifications"
								element={<DeploymentNotificationsPage />}
							/>
						</Route>

						<Route path="licenses">
							<Route index element={<LicensesSettingsPage />} />
							<Route path="add" element={<AddNewLicensePage />} />
						</Route>
						<Route path="appearance" element={<AppearanceSettingsPage />} />
						<Route path="announcement" element={<AnnouncementSettingsPage />} />
						<Route path="chat" element={<ChatSettingsPage />} />
						<Route path="online" element={<OnlineUsersPage />} />
						<Route
							path="classification"
							element={<ClassificationSettingsPage />}
						/>
						<Route path="keycloak" element={<KeycloakSettingsPage />} />
						<Route path="customize" element={<CustomizeSettingsPage />} />
						<Route path="monitoring" element={<MonitoringSettingsPage />} />
						<Route path="persistence" element={<PersistenceSettingsPage />} />
						<Route path="workspace-proxies" element={<WorkspaceProxyPage />} />
						<Route path="oauth2-provider">
							<Route index element={<NotFoundPage />} />
							<Route path="apps">
								<Route index element={<OAuth2AppsSettingsPage />} />
								<Route path="add" element={<CreateOAuth2AppPage />} />
								<Route path=":appId" element={<EditOAuth2AppPage />} />
							</Route>
						</Route>

						<Route path="users">
							<Route index element={<UsersPage />} />
							<Route path="create" element={<CreateUserPage />} />
							<Route path=":user" element={<EditUserPage />} />
						</Route>

						{groupsRouter()}

						<Route path="idp-org-sync" element={<IdpOrgSyncPage />} />
					</Route>

					<Route path="/settings" element={<UserSettingsLayout />}>
						<Route path="account" element={<AccountPage />} />
						<Route path="appearance" element={<AppearancePage />} />
						<Route path="schedule" element={<SchedulePage />} />
						<Route path="security" element={<SecurityPage />} />
						<Route path="ssh-keys" element={<SSHKeysPage />} />
						<Route
							path="oauth2-provider"
							element={<UserOAuth2ProviderSettingsPage />}
						/>
						<Route path="tokens">
							<Route index element={<TokensPage />} />
							<Route path="new" element={<CreateTokenPage />} />
						</Route>
						<Route path="secrets" element={<SecretsPage />} />
						<Route path="certificates" element={<CertificatesPage />} />
						<Route path="notifications" element={<UserNotificationsPage />} />
					</Route>

					{/* In order for the 404 page to work properly the routes that start with
              top level parameter must be fully qualified. */}
					<Route path="/:username/:workspace">
						<Route index element={<WorkspacePage />} />
						<Route
							path="builds/:buildNumber"
							element={<WorkspaceBuildPage />}
						/>
						<Route path="settings" element={<WorkspaceSettingsLayout />}>
							<Route index element={<WorkspaceSettingsCardsPage />} />
							<Route
								path="parameters"
								element={
									<WorkspaceSettingsSectionRedirect section="parameters" />
								}
							/>
							<Route
								path="schedule"
								element={
									<WorkspaceSettingsSectionRedirect section="schedule" />
								}
							/>
							<Route
								path="sharing"
								element={<WorkspaceSettingsSectionRedirect section="sharing" />}
							/>
						</Route>
					</Route>

					{/* The health pages open inside General, with its sidebar. */}
					<Route path="/health" element={<DeploymentSettingsLayout />}>
						<Route element={<HealthLayout />}>
							<Route index element={<HealthOverviewPage />} />
							{/* Health's sections had pages of their own: now cards on its one page. */}
							{HEALTH_CARD_IDS.map((id) => (
								<Route
									key={id}
									path={id}
									element={<Navigate to={`/health#${id}`} replace />}
								/>
							))}
							<Route
								path="derp/regions/:regionId"
								element={<DERPRegionPage />}
							/>
						</Route>
						{/* User Quota is at the top of Accounts now. */}
						<Route
							path="user-quota"
							element={<Navigate to="/deployment/users" replace />}
						/>
					</Route>

					<Route path="/install" element={<CliInstallPage />} />

					{/* Using path="*"" means "match anything", so this route
              acts like a catch-all for URLs that we don't have explicit
              routes for. */}
					<Route path="*" element={<NotFoundPage />} />
				</Route>

				{/* Pages that don't have the dashboard layout */}
				<Route
					path="/templates/:template/versions/:version/edit"
					element={<TemplateVersionEditorPage />}
				/>
				<Route
					path="/templates/:organization/:template/versions/:version/edit"
					element={<TemplateVersionEditorPage />}
				/>
				<Route
					path="/:username/:workspace/terminal"
					element={<TerminalPage />}
				/>
				<Route path="/cli-auth" element={<CliAuthPage />} />
				<Route path="/coder-cup" element={<CoderCupPage />} />
				<Route path="/icons" element={<IconsPage />} />
			</Route>
		</Route>,
	),
);
