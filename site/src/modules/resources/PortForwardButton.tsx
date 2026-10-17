import { cn } from "cn";
import { useFormik } from "formik";
import {
	BuildingIcon,
	ExternalLinkIcon,
	LockIcon,
	LockOpenIcon,
	ShareIcon,
	XIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { useMutation } from "react-query";
import * as Yup from "yup";
import { getErrorMessage } from "#/api/errors";
import {
	deleteWorkspacePortShare,
	upsertWorkspacePortShare,
} from "#/api/queries/workspaceportsharing";
import {
	type Template,
	type Workspace,
	type WorkspaceAgent,
	type WorkspaceAgentListeningPort,
	type WorkspaceAgentPortShare,
	type WorkspaceAgentPortShareLevel,
	WorkspaceAgentPortShareLevels,
	type WorkspaceAgentPortShareProtocol,
} from "#/api/typesGenerated";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { SearchField } from "#/components/SearchField/SearchField";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { usePortsData } from "#/modules/resources/usePortsData";
import { getFormHelpers } from "#/utils/formUtils";
import {
	getWorkspaceListeningPortsProtocol,
	portForwardURL,
	saveWorkspaceListeningPortsProtocol,
} from "#/utils/portForward";

type PortForwardButtonProps = {
	host: string;
	workspace: Workspace;
	agent: WorkspaceAgent;
	template: Template;
};

export const PortForwardButton: React.FC<PortForwardButtonProps> = ({
	host,
	workspace,
	template,
	agent,
}) => {
	const { entitlements } = useDashboard();

	const { listeningPorts, sharedPorts, refetchSharedPorts } = usePortsData(
		workspace,
		agent,
		agent.status === "connected",
	);

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button disabled={!listeningPorts} size="sm" variant="subtle">
					<Spinner loading={!listeningPorts}>
						<span className="text-xs font-medium h-5 min-w-5 px-1 rounded-full flex items-center justify-center bg-surface-tertiary">
							{listeningPorts?.length}
						</span>
					</Spinner>
					Open ports
					<ChevronDownIcon />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="p-0 w-[300px] mt-1 text-content-secondary bg-surface-secondary border-surface-quaternary"
			>
				<PortForwardPopoverView
					host={host}
					agent={agent}
					workspace={workspace}
					template={template}
					sharedPorts={sharedPorts ?? []}
					listeningPorts={listeningPorts ?? []}
					portSharingControlsEnabled={
						entitlements.features.control_shared_ports.enabled
					}
					refetchSharedPorts={refetchSharedPorts}
				/>
			</PopoverContent>
		</Popover>
	);
};

type OpenPortFormValues = {
	agent_name: string;
	port: string;
	protocol: WorkspaceAgentPortShareProtocol;
	share_level: WorkspaceAgentPortShareLevel;
};

// Port range accepted by coderd for port shares and forwards.
const MIN_PORT = 9;
const MAX_PORT = 65535;

// Number() rejects trailing text such as "8080abc" that parseInt would accept,
// keeping the Connect button in step with the list filter.
const parsePort = (value: string): number | undefined => {
	const port = Number(value);
	return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT
		? port
		: undefined;
};

const openPortSchema = () =>
	Yup.object({
		port: Yup.number().required().min(MIN_PORT).max(MAX_PORT),
		share_level: Yup.string().required().oneOf(WorkspaceAgentPortShareLevels),
	});

type PortForwardPopoverViewProps = {
	host: string;
	workspace: Workspace;
	agent: WorkspaceAgent;
	template: Template;
	sharedPorts: readonly WorkspaceAgentPortShare[];
	listeningPorts: readonly WorkspaceAgentListeningPort[];
	portSharingControlsEnabled: boolean;
	refetchSharedPorts: () => void;
};

const isPortShareProtocol = (
	value: string,
): value is WorkspaceAgentPortShareProtocol =>
	value === "http" || value === "https";

const isPortShareLevel = (
	value: string,
): value is WorkspaceAgentPortShareLevel =>
	WorkspaceAgentPortShareLevels.some((level) => level === value);

type ShareLevelOptionsProps = {
	canShareAuthenticated: boolean;
	canSharePublic: boolean;
};

const ShareLevelOptions: React.FC<ShareLevelOptionsProps> = ({
	canShareAuthenticated,
	canSharePublic,
}) => (
	<>
		<SelectItem value="organization">Organization</SelectItem>
		{canShareAuthenticated ? (
			<SelectItem value="authenticated">Authenticated</SelectItem>
		) : (
			<SelectItem
				value="authenticated"
				disabled
				title="This workspace template does not allow sharing ports outside of its organization."
			>
				Authenticated
			</SelectItem>
		)}
		{canSharePublic ? (
			<SelectItem value="public">Public</SelectItem>
		) : (
			<SelectItem
				value="public"
				disabled
				title="This workspace template does not allow sharing ports publicly."
			>
				Public
			</SelectItem>
		)}
	</>
);

export const PortForwardPopoverView: React.FC<PortForwardPopoverViewProps> = ({
	host,
	workspace,
	agent,
	template,
	sharedPorts,
	listeningPorts,
	portSharingControlsEnabled,
	refetchSharedPorts,
}) => {
	const [listeningPortProtocol, setListeningPortProtocol] = useState(
		getWorkspaceListeningPortsProtocol(workspace.id),
	);
	const [portQuery, setPortQuery] = useState("");
	const protocolFieldId = useId();
	const shareLevelFieldId = useId();

	const upsertSharedPortMutation = useMutation({
		...upsertWorkspacePortShare(workspace.id),
		onSuccess: refetchSharedPorts,
	});

	const deleteSharedPortMutation = useMutation({
		...deleteWorkspacePortShare(workspace.id),
		onSuccess: refetchSharedPorts,
	});

	const {
		mutateAsync: upsertWorkspacePortShareForm,
		isPending: isSubmitting,
		error: submitError,
	} = useMutation({
		...upsertWorkspacePortShare(workspace.id),
		onSuccess: refetchSharedPorts,
	});

	const form = useFormik<OpenPortFormValues>({
		initialValues: {
			agent_name: agent.name,
			port: "",
			protocol: "http",
			share_level: "authenticated",
		},
		validationSchema: openPortSchema(),
		onSubmit: async (values, { resetForm }) => {
			resetForm();
			await upsertWorkspacePortShareForm({
				agent_name: values.agent_name,
				port: Number(values.port),
				share_level: values.share_level,
				protocol: values.protocol,
			});
		},
	});
	const getFieldHelpers = getFormHelpers(form, submitError);
	const protocolField = getFieldHelpers("protocol");
	const shareLevelField = getFieldHelpers("share_level");

	// usePortsData already filters shared ports down to this agent, so only
	// hide listening ports that are also shared.
	const unsharedListeningPorts = listeningPorts.filter((port) =>
		sharedPorts.every((sharedPort) => sharedPort.port !== port.port),
	);
	const filteredListeningPorts = unsharedListeningPorts.filter((port) =>
		port.port.toString().includes(portQuery),
	);
	const typedPort = parsePort(portQuery);
	// only disable the form if shared port controls are entitled and the template doesn't allow sharing ports
	const canSharePorts = !(
		portSharingControlsEnabled && template.max_port_share_level === "owner"
	);
	const canSharePortsPublic =
		canSharePorts && template.max_port_share_level === "public";
	const canSharePortsAuthenticated =
		canSharePorts &&
		(template.max_port_share_level === "authenticated" || canSharePortsPublic);

	const defaultShareLevel =
		template.max_port_share_level === "organization"
			? "organization"
			: "authenticated";

	let emptyListMessage: string | undefined;
	if (unsharedListeningPorts.length === 0) {
		emptyListMessage = "No open ports were detected.";
	} else if (filteredListeningPorts.length === 0) {
		emptyListMessage =
			typedPort !== undefined
				? `No listening port matches "${portQuery}". Connect to it anyway if it is not detected yet.`
				: `No listening port matches "${portQuery}". Enter a port from ${MIN_PORT} to ${MAX_PORT} to connect.`;
	}

	const levelIcon = (level: WorkspaceAgentPortShareLevel) =>
		level === "public" ? (
			<LockOpenIcon className="size-3.5 shrink-0" aria-label="Public" />
		) : level === "organization" ? (
			<BuildingIcon className="size-3.5 shrink-0" aria-label="Organization" />
		) : (
			<LockIcon className="size-3.5 shrink-0" aria-label="Authenticated" />
		);
	const portBadge = (port: number) => (
		<span className="flex h-[18px] min-w-11 items-center justify-center rounded-full bg-surface-tertiary px-1.5 text-[11px] font-medium tabular-nums text-content-primary">
			{port}
		</span>
	);
	const small = "h-7 w-auto gap-1 px-2 text-xs";

	// Platform: compact, like the Metrics Interval menu beside it: a title and one line each, the ports as badges,
	// sharing in one row.
	return (
		<>
			<div className="px-3 pt-2.5 pb-2">
				<div className="flex items-center justify-between gap-2">
					<div className="text-[13px] font-semibold text-content-primary">
						Open ports
					</div>
					<div
						role="radiogroup"
						aria-label="Listening port protocol"
						className="flex rounded-full bg-surface-tertiary p-0.5"
					>
						{(["http", "https"] as const).map((protocol) => (
							<button
								key={protocol}
								type="button"
								role="radio"
								aria-checked={listeningPortProtocol === protocol}
								title={`Open the listening ports over ${protocol.toUpperCase()}`}
								onClick={() => {
									setListeningPortProtocol(protocol);
									saveWorkspaceListeningPortsProtocol(workspace.id, protocol);
								}}
								className={cn(
									"cursor-pointer rounded-full border-0 bg-transparent px-2 py-px text-[11px] font-medium text-content-secondary",
									listeningPortProtocol === protocol &&
										"bg-surface-primary text-content-primary shadow-sm",
								)}
							>
								{protocol.toUpperCase()}
							</button>
						))}
					</div>
				</div>
				<div className="text-[11px] leading-snug">Only you can open these.</div>
				<form
					className="mt-2 flex items-center gap-1.5"
					onSubmit={(event) => {
						event.preventDefault();
						if (typedPort === undefined) {
							return;
						}
						window.open(
							portForwardURL(
								host,
								typedPort,
								agent.name,
								workspace.name,
								workspace.owner_name,
								listeningPortProtocol,
							),
							"_blank",
						);
					}}
				>
					<SearchField
						className="h-7 flex-1 text-xs [&_input]:h-7"
						value={portQuery}
						onChange={(query) => setPortQuery(query.trim())}
						placeholder="Filter, or a port to open"
						aria-label="Filter ports"
					/>
					<Button
						type="submit"
						size="icon"
						variant="outline"
						className="size-7"
						aria-label="Connect"
						title="Open the typed port in a new tab"
						disabled={typedPort === undefined}
					>
						<ExternalLinkIcon />
					</Button>
				</form>
			</div>
			<div className="max-h-60 overflow-y-auto border-0 border-y border-solid border-surface-quaternary py-1">
				{emptyListMessage && (
					<p className="m-0 px-3 py-1.5 text-[11px] leading-snug">
						{emptyListMessage}
					</p>
				)}
				{filteredListeningPorts.map((port) => {
					const url = portForwardURL(
						host,
						port.port,
						agent.name,
						workspace.name,
						workspace.owner_name,
						listeningPortProtocol,
					);
					return (
						<div
							key={port.port}
							className="group flex items-center gap-2 px-3 py-0.5 hover:bg-surface-tertiary"
						>
							<a
								className="flex min-w-0 flex-1 items-center gap-2 py-1 text-[13px] text-content-primary no-underline"
								href={url}
								target="_blank"
								rel="noreferrer"
								title={`Open port ${port.port} in a new tab`}
							>
								{portBadge(port.port)}
								<span className="truncate">{port.process_name || "—"}</span>
							</a>
							{canSharePorts && (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											size="icon"
											variant="subtle"
											className="size-6"
											onClick={() => {
												upsertSharedPortMutation.mutate({
													agent_name: agent.name,
													port: port.port,
													protocol: listeningPortProtocol,
													share_level: defaultShareLevel,
												});
											}}
										>
											<ShareIcon />
											<span className="sr-only">Share</span>
										</Button>
									</TooltipTrigger>
									<TooltipContent disablePortal>Share this port</TooltipContent>
								</Tooltip>
							)}
						</div>
					);
				})}
			</div>
			<div className="px-3 pt-2 pb-2.5">
				<div className="text-[13px] font-semibold text-content-primary">
					Shared ports
				</div>
				<div className="text-[11px] leading-snug">
					{canSharePorts
						? "With your organization, Coder users or anyone."
						: "This template does not allow sharing ports."}
				</div>
				{canSharePorts && (
					<>
						{sharedPorts.map((share) => {
							const url = portForwardURL(
								host,
								share.port,
								agent.name,
								workspace.name,
								workspace.owner_name,
								share.protocol,
							);
							return (
								// two lines in the compact menu: the port and its removal, then how it is shared
								<div
									key={share.port}
									className="mt-1.5 flex flex-col gap-1 rounded-md border border-solid border-surface-quaternary px-2 py-1.5"
									data-testid="shared-port"
								>
									<div className="flex items-center gap-1.5">
										<a
											className="flex min-w-0 flex-1 items-center gap-1.5 text-content-secondary no-underline"
											href={url}
											target="_blank"
											rel="noreferrer"
											title={`Open shared port ${share.port}`}
										>
											{levelIcon(share.share_level)}
											{portBadge(share.port)}
										</a>
										<Button
											size="icon"
											variant="subtle"
											className="size-6"
											aria-label="Delete shared port"
											onClick={() => {
												deleteSharedPortMutation.mutate({
													agent_name: agent.name,
													port: share.port,
												});
											}}
										>
											<XIcon />
										</Button>
									</div>
									<div className="flex items-center gap-1">
										<Select
											value={share.protocol}
											onValueChange={(value) => {
												if (!isPortShareProtocol(value)) {
													return;
												}
												upsertSharedPortMutation.mutate({
													agent_name: agent.name,
													port: share.port,
													protocol: value,
													share_level: share.share_level,
												});
											}}
										>
											<SelectTrigger
												aria-label={`Protocol for port ${share.port}`}
												className={cn(small, "w-[84px] shrink-0")}
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="http">HTTP</SelectItem>
												<SelectItem value="https">HTTPS</SelectItem>
											</SelectContent>
										</Select>
										<Select
											value={share.share_level}
											onValueChange={(value) => {
												if (!isPortShareLevel(value)) {
													return;
												}
												upsertSharedPortMutation.mutate({
													agent_name: agent.name,
													port: share.port,
													protocol: share.protocol,
													share_level: value,
												});
											}}
										>
											<SelectTrigger
												aria-label={`Sharing level for port ${share.port}`}
												className={cn(small, "min-w-0 flex-1")}
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<ShareLevelOptions
													canShareAuthenticated={canSharePortsAuthenticated}
													canSharePublic={canSharePortsPublic}
												/>
											</SelectContent>
										</Select>
									</div>
								</div>
							);
						})}
						<form
							onSubmit={form.handleSubmit}
							className="mt-2 flex flex-col gap-1"
						>
							<div className="flex items-center gap-1">
								<Input
									{...form.getFieldProps("port")}
									aria-label="Port"
									aria-invalid={Boolean(form.touched.port && form.errors.port)}
									placeholder="Port"
									type="number"
									min={MIN_PORT}
									max={MAX_PORT}
									disabled={isSubmitting}
									className="h-7 min-w-0 flex-1 px-2 text-xs"
								/>
								<Select
									value={form.values.protocol}
									onValueChange={(value) => {
										if (!isPortShareProtocol(value)) {
											return;
										}
										void form.setFieldValue("protocol", value);
									}}
									disabled={isSubmitting}
								>
									<SelectTrigger
										id={protocolFieldId}
										aria-label="Protocol"
										aria-invalid={protocolField.error}
										className={cn(
											small,
											"w-[84px] shrink-0",
											protocolField.error && "border-border-destructive",
										)}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="http">HTTP</SelectItem>
										<SelectItem value="https">HTTPS</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center gap-1">
								<Select
									value={form.values.share_level}
									onValueChange={(value) => {
										if (!isPortShareLevel(value)) {
											return;
										}
										void form.setFieldValue("share_level", value);
									}}
									disabled={isSubmitting}
								>
									<SelectTrigger
										id={shareLevelFieldId}
										aria-label="Sharing Level"
										aria-invalid={shareLevelField.error}
										className={cn(
											small,
											"min-w-0 flex-1",
											shareLevelField.error && "border-border-destructive",
										)}
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<ShareLevelOptions
											canShareAuthenticated={canSharePortsAuthenticated}
											canSharePublic={canSharePortsPublic}
										/>
									</SelectContent>
								</Select>
								<Button
									type="submit"
									size="sm"
									className="h-7 shrink-0 px-2.5 text-xs"
									aria-label="Share Port"
									title="Share this port"
									disabled={!form.isValid || isSubmitting}
								>
									<Spinner loading={isSubmitting}>
										<ShareIcon />
									</Spinner>
									Share
								</Button>
							</div>
						</form>
						{submitError ? (
							<p
								role="alert"
								className="m-0 mt-1 text-[11px] text-content-destructive"
							>
								{getErrorMessage(submitError, "The port could not be shared.")}
							</p>
						) : null}
					</>
				)}
			</div>
		</>
	);
};
