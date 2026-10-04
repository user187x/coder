import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import {
	Link,
	NavLink,
	type To,
	useLocation,
	useMatch,
	useSearchParams,
} from "react-router";
import { aiSpendOrganizations } from "#/api/queries/aiBridge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { SettingsSidebarNavItem as SidebarNavItem } from "#/components/Sidebar/Sidebar";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import {
	canAccessAnyChatModelConfig,
	type Permissions,
} from "#/modules/permissions";
import { useCanShareOrganizationMCPServers } from "#/pages/AISettingsPage/MCPServersPage/organizationSharing";
import {
	modelOrganizationSearchParam,
	useAccessibleModelOrganizations,
} from "#/pages/AISettingsPage/ModelsPage/organizationModels";
import { canViewAISpend } from "#/pages/AISettingsPage/SpendPage/spendAccess";

const SubNavItem: React.FC<{ href: To; children?: React.ReactNode }> = ({
	href,
	children,
}) => (
	<NavLink
		to={href}
		className={({ isActive }) =>
			cn(
				"relative -ml-px text-sm text-content-secondary no-underline font-medium py-2 pl-4 pr-3 transition-colors",
				"border-0 border-solid border-l border-l-transparent hover:text-content-primary",
				isActive &&
					"border-l-content-primary font-semibold text-content-primary",
			)
		}
	>
		{children}
	</NavLink>
);

const SubNavGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div className="flex flex-col gap-1 ml-3 border-0 border-solid border-l border-l-border">
		{children}
	</div>
);

const organizationScopedPath = (
	pathname: string,
	organizationName: string | null,
): To => ({
	pathname,
	search: organizationName
		? new URLSearchParams({
				[modelOrganizationSearchParam]: organizationName,
			}).toString()
		: "",
});

const ModelsNavItem: React.FC<{ href: To }> = ({ href }) => {
	const legacyMatch = useMatch("/ai/settings/models/*");
	const organizationMatch = useMatch(
		"/ai/settings/organizations/:organization/models/*",
	);
	const isActive = legacyMatch !== null || organizationMatch !== null;

	return (
		<Link
			to={href}
			aria-current={isActive ? "page" : undefined}
			className={cn(
				"relative text-sm text-content-secondary no-underline font-medium py-2 px-3 hover:bg-surface-secondary rounded-md transition ease-in-out duration-150",
				isActive && "font-semibold text-content-primary",
			)}
		>
			Models
		</Link>
	);
};

type AISettingsTreeViewProps = {
	/** Site-wide permissions. */
	permissions: Permissions;
	canViewAISpend?: boolean;
	canAccessOrganizationModels?: boolean;
	canShareOrganizationMCPServers?: boolean;
};

/**
 * General's "AI" entry: a collapsible tree with Coder Agents (embedded in
 * General) and Coder's own AI settings pages, with the same permissions as
 * Coder's AI settings sidebar. AI Governance and AI Gateway keys are left
 * out; their pages still answer. Open while one of its pages is shown.
 */
export const AISettingsTreeView: React.FC<AISettingsTreeViewProps> = ({
	permissions,
	canViewAISpend = false,
	canAccessOrganizationModels = false,
	canShareOrganizationMCPServers = false,
}) => {
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const [open, setOpen] = useState(() =>
		/^\/(ai\/settings|deployment\/agents)/.test(location.pathname),
	);
	const organizationName = searchParams.get(modelOrganizationSearchParam);
	const path = (pathname: string) =>
		organizationScopedPath(pathname, organizationName);

	const canViewModels =
		canAccessAnyChatModelConfig(permissions) || canAccessOrganizationModels;
	const canViewCoderAgents =
		permissions.editDeploymentConfig || canAccessOrganizationModels;
	const mcpServerHref =
		permissions.viewAnyMCPServerConfigs ||
		permissions.updateAnyMCPServerConfig ||
		permissions.deleteAnyMCPServerConfig ||
		canShareOrganizationMCPServers
			? path("/ai/settings/mcp-servers")
			: path("/ai/settings/mcp-servers/add");
	const canManageMCPServers =
		!permissions.editDeploymentConfig &&
		(permissions.viewAnyMCPServerConfigs ||
			permissions.createAnyMCPServerConfig ||
			permissions.updateAnyMCPServerConfig ||
			permissions.deleteAnyMCPServerConfig ||
			canShareOrganizationMCPServers);
	const canManageTemplates =
		!permissions.editDeploymentConfig && permissions.updateAnyTemplate;

	const visible =
		permissions.createChat ||
		canViewAISpend ||
		permissions.viewAnyAIProvider ||
		canViewModels ||
		canViewCoderAgents ||
		canManageMCPServers ||
		canManageTemplates;
	if (!visible) {
		return null;
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger
				className={cn(
					"flex w-full cursor-pointer items-center justify-between rounded-md border-0 bg-transparent py-2 px-3 text-left text-sm font-medium transition ease-in-out duration-150 hover:bg-surface-secondary",
					open ? "text-content-primary" : "text-content-secondary",
				)}
			>
				AI
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-icon-sm transition-transform duration-150 motion-reduce:transition-none",
						open && "rotate-90",
					)}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="ml-3 mt-1 flex flex-col gap-1 border-0 border-l border-solid border-l-border pl-1">
					{permissions.createChat && (
						<SidebarNavItem href="/deployment/agents">Agents</SidebarNavItem>
					)}
					{canViewAISpend && (
						<SidebarNavItem href={path("/ai/settings/spend")}>
							Spend
						</SidebarNavItem>
					)}
					{permissions.viewAnyAIProvider && (
						<SidebarNavItem href="/ai/settings/providers">
							Providers
						</SidebarNavItem>
					)}
					{canViewModels && (
						<ModelsNavItem href={path("/ai/settings/models")} />
					)}
					{canViewCoderAgents && (
						<SidebarNavItem href={path("/ai/settings/coder-agents")}>
							Coder Agents
						</SidebarNavItem>
					)}
					{permissions.editDeploymentConfig && (
						<SubNavGroup>
							<SubNavItem href={path("/ai/settings/mcp-servers")}>
								MCP servers
							</SubNavItem>
							{permissions.updateAnyTemplate && (
								<SubNavItem href="/ai/settings/templates">Templates</SubNavItem>
							)}
							<SubNavItem href="/ai/settings/instructions">
								Instructions
							</SubNavItem>
							<SubNavItem href="/ai/settings/lifecycle">Lifecycle</SubNavItem>
						</SubNavGroup>
					)}
					{canManageMCPServers && (
						<SubNavGroup>
							<SubNavItem href={mcpServerHref}>MCP servers</SubNavItem>
						</SubNavGroup>
					)}
					{canManageTemplates && (
						<SubNavGroup>
							<SubNavItem href="/ai/settings/templates">Templates</SubNavItem>
						</SubNavGroup>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};

/** General's AI tree for the signed-in user. */
export const AISettingsTree: React.FC = () => {
	const { permissions } = useAuthenticated();
	const { entitlements, organizations } = useDashboard();
	const accessibleOrgsQuery = useAccessibleModelOrganizations(organizations);
	const organizationMCPSharing = useCanShareOrganizationMCPServers(
		organizations,
		{ enabled: !permissions.editDeploymentConfig },
	);
	const spendOrganizationsQuery = useQuery({
		...aiSpendOrganizations(),
		enabled: entitlements.features.aibridge.enabled,
	});

	return (
		<AISettingsTreeView
			permissions={permissions}
			canViewAISpend={canViewAISpend(
				entitlements,
				spendOrganizationsQuery.data,
			)}
			canAccessOrganizationModels={
				(accessibleOrgsQuery.organizations.length ?? 0) > 0
			}
			canShareOrganizationMCPServers={organizationMCPSharing.canShare}
		/>
	);
};
