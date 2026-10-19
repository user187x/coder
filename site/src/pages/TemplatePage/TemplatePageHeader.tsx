import {
	CopyIcon,
	DownloadIcon,
	EditIcon,
	EllipsisVerticalIcon,
	PlusIcon,
	SettingsIcon,
	TrashIcon,
} from "lucide-react";
import { useQuery } from "react-query";
import { Link as RouterLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorDetail } from "#/api/errors";
import { workspaces } from "#/api/queries/workspaces";
import type {
	AuthorizationResponse,
	Template,
	TemplateVersion,
} from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { DeprecatedBadge } from "#/components/Badge/PresetBadges";
import { Button, Button as ShadcnButton } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { DeleteDialog } from "#/components/Dialog/DeleteDialog/DeleteDialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Margins } from "#/components/Margins/Margins";
import { MemoizedInlineMarkdown } from "#/components/Markdown/InlineMarkdown";
import {
	PageHeader,
	PageHeaderSubtitle,
	PageHeaderTitle,
} from "#/components/PageHeader/PageHeader";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import type { WorkspacePermissions } from "#/modules/permissions/workspaces";
import {
	buildTemplateExport,
	fetchDeploymentIcon,
} from "#/modules/platform/templateExport/templateExport";
import { TemplateStats } from "./TemplateStats";
import { useDeletionDialogState } from "./useDeletionDialogState";

type TemplateMenuProps = {
	template: Template;
	/** Only editors get the menu. */
	canUpdate: boolean;
	organizationName: string;
	templateName: string;
	templateVersion: string;
	templateId: string;
	fileId: string;
	onDelete: () => void;
};

const TemplateMenu: React.FC<TemplateMenuProps> = ({
	template,
	canUpdate,
	organizationName,
	templateName,
	templateVersion,
	templateId,
	fileId,
	onDelete,
}) => {
	const dialogState = useDeletionDialogState(
		templateId,
		onDelete,
		templateName,
	);
	const navigate = useNavigate();
	const getLink = useLinks();
	const queryText = `organization:${organizationName} template:${templateName}`;
	const workspaceCountQuery = useQuery({
		...workspaces({ q: queryText }),
		select: (res) => res.count,
		enabled: canUpdate,
	});
	const safeToDeleteTemplate = workspaceCountQuery.data === 0;

	const templateLink = getLink(linkToTemplate(organizationName, templateName));

	// Platform: the whole template in one ZIP: its Terraform, scripts and other files, and the icons it uses
	const handleExport = async () => {
		try {
			const source = await API.downloadTemplateVersion(fileId, "zip");
			const { zip, missing } = await buildTemplateExport(
				source,
				template.icon,
				fetchDeploymentIcon,
			);
			const url = window.URL.createObjectURL(zip);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${templateName}-${templateVersion}.zip`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);
			if (missing.length > 0) {
				toast.warning(
					`Exported without ${missing.length} icon${missing.length === 1 ? "" : "s"} this deployment does not serve.`,
					{ description: missing.join(", ") },
				);
			}
		} catch (error) {
			console.error("Failed to export template:", error);
			toast.error("Failed to export template.", {
				description: getErrorDetail(error),
			});
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<ShadcnButton size="icon-lg" variant="subtle" aria-label="Open menu">
						<EllipsisVerticalIcon aria-hidden="true" />
						<span className="sr-only">Open menu</span>
					</ShadcnButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{canUpdate && (
						<>
							<DropdownMenuItem asChild>
								<RouterLink to={`${templateLink}/settings`}>
									<SettingsIcon className="size-icon-sm" />
									Settings
								</RouterLink>
							</DropdownMenuItem>

							<DropdownMenuItem asChild>
								<RouterLink
									to={`${templateLink}/versions/${templateVersion}/edit`}
								>
									<EditIcon />
									Edit files
								</RouterLink>
							</DropdownMenuItem>

							<DropdownMenuItem asChild>
								<RouterLink to={`/templates/new?fromTemplate=${templateId}`}>
									<CopyIcon className="size-icon-sm" />
									Duplicate&hellip;
								</RouterLink>
							</DropdownMenuItem>

							<DropdownMenuItem
								onClick={() => handleExport()}
								title="The template's Terraform, scripts and other files, and the icons it uses"
							>
								<DownloadIcon className="size-icon-sm" />
								Export as ZIP
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-content-destructive focus:text-content-destructive"
								onClick={dialogState.openDeleteConfirmation}
							>
								<TrashIcon />
								Delete&hellip;
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{safeToDeleteTemplate ? (
				<DeleteDialog
					isOpen={dialogState.isDeleteDialogOpen}
					onConfirm={dialogState.confirmDelete}
					onCancel={dialogState.cancelDeleteConfirmation}
					entity="template"
					name={templateName}
					info={
						// Platform: shown by its display name, it is deleted by its name (its ID)
						template.display_name && template.display_name !== templateName
							? `"${template.display_name}" is this template's display name; its name (its ID) is "${templateName}".`
							: undefined
					}
				/>
			) : (
				<ConfirmDialog
					type="info"
					title="Unable to delete"
					hideCancel={false}
					open={dialogState.isDeleteDialogOpen}
					onClose={dialogState.cancelDeleteConfirmation}
					confirmText="See workspaces"
					confirmLoading={workspaceCountQuery.status !== "success"}
					onConfirm={() => {
						navigate({
							pathname: "/workspaces",
							search: new URLSearchParams({ filter: queryText }).toString(),
						});
					}}
					description={
						<>
							{workspaceCountQuery.isSuccess && (
								<>
									This template is used by{" "}
									<strong>
										{workspaceCountQuery.data} workspace
										{workspaceCountQuery.data === 1 ? "" : "s"}
									</strong>
									. Please delete all related workspaces before deleting this
									template.
								</>
							)}

							{workspaceCountQuery.isLoading &&
								"Loading information about workspaces used by this template."}

							{workspaceCountQuery.isError &&
								"Unable to determine workspaces used by this template."}
						</>
					}
				/>
			)}
		</>
	);
};

type TemplatePageHeaderProps = {
	template: Template;
	activeVersion: TemplateVersion;
	permissions: AuthorizationResponse;
	workspacePermissions: WorkspacePermissions;
	onDeleteTemplate: () => void;
};

export const TemplatePageHeader: React.FC<TemplatePageHeaderProps> = ({
	template,
	activeVersion,
	permissions,
	workspacePermissions,
	onDeleteTemplate,
}) => {
	const getLink = useLinks();
	const templateLink = getLink(
		linkToTemplate(template.organization_name, template.name),
	);

	return (
		<Margins>
			<PageHeader
				actions={
					<>
						{!template.deprecated &&
							workspacePermissions.createWorkspaceForUserID && (
								<Button asChild>
									<RouterLink to={`${templateLink}/workspace`}>
										<PlusIcon />
										Create Workspace
									</RouterLink>
								</Button>
							)}

						{permissions.canUpdateTemplate && (
							<TemplateMenu
								template={template}
								canUpdate={permissions.canUpdateTemplate}
								organizationName={template.organization_name}
								templateId={template.id}
								templateName={template.name}
								templateVersion={activeVersion.name}
								fileId={activeVersion.job.file_id}
								onDelete={onDeleteTemplate}
							/>
						)}
					</>
				}
			>
				<div className="flex flex-row gap-4">
					<Avatar
						size="lg"
						variant="icon"
						src={template.icon}
						fallback={template.name}
					/>
					<div>
						<div className="flex flex-row items-center gap-2">
							<PageHeaderTitle>
								{template.display_name.length > 0
									? template.display_name
									: template.name}
							</PageHeaderTitle>
							{template.deprecated && <DeprecatedBadge />}
						</div>

						{template.deprecation_message !== "" ? (
							<PageHeaderSubtitle>
								<MemoizedInlineMarkdown>
									{template.deprecation_message}
								</MemoizedInlineMarkdown>
							</PageHeaderSubtitle>
						) : (
							template.description !== "" && (
								<PageHeaderSubtitle>{template.description}</PageHeaderSubtitle>
							)
						)}
					</div>
				</div>
			</PageHeader>
			<div className="pb-8">
				<TemplateStats template={template} activeVersion={activeVersion} />
			</div>
		</Margins>
	);
};
