import { cn } from "cn";
import { GaugeIcon, RadioIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import type { BuildInfoResponse, LinkConfig, User } from "#/api/typesGenerated";
import { Abbr } from "#/components/Abbr/Abbr";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { Latency } from "#/components/Latency/Latency";
import type { ProxyContextValue } from "#/contexts/ProxyContext";
import { WorkspaceGrid } from "#/modules/platform/workspaceGrid/WorkspaceGrid";
import { WorkspacesLatencyMenu } from "#/modules/platform/workspaceLatency/WorkspacesLatencyMenu";
import { getLatencyColor } from "#/utils/latency";
import {
	type AdminQuickLinksEditor,
	AdminSettingsItems,
	type AdminSettingsPermissions,
} from "./AdminSettings";
import type { AdminPage } from "./adminQuickLinks";
import { sortProxiesByLatency } from "./proxyUtils";
import { SettingsChatPanel } from "./SettingsChatPanel";
import { SettingsNotificationBadge } from "./SettingsNotificationBadge";
import { SettingsSidePanels } from "./SettingsSidePanels";
import "./navbarSoft.css";

/** Platform: the Controls menu's items, as its own button had them (AdminSettingsItems). */
type ProxyMenuControls = {
	permissions: AdminSettingsPermissions;
	quickLinks?: readonly AdminPage[];
	quickLinksEditor?: AdminQuickLinksEditor;
};

type ProxyMenuProps = {
	user: User;
	buildInfo?: BuildInfoResponse;
	supportLinks: readonly LinkConfig[];
	onSignOut: () => void;
	/** The regions and the latency to them; without it (or when it cannot be had) the button has no latency pill. */
	proxyContextValue?: ProxyContextValue;
	canManageTunnels?: boolean;
	tunnelActorId?: string;
	/**
	 * Platform: the HUD's link joined on its left (admins): one split button - HUD, then the latency, "Settings" and
	 * the menu's chevron - in the place of three buttons.
	 */
	hud?: boolean;
	/** Platform: the Controls menu, under the Workspaces row; the button then says "Settings". */
	controls?: ProxyMenuControls;
};

/**
 * Platform: the top bar's latency and Controls menu, one button where there were two. The button shows the latency
 * to the selected region in a pill (the antenna in the latency's colour), then "Settings" and the chevron. The menu
 * holds the Workspaces row, which shows the latency to each workspace while it is pressed (WorkspacesLatencyMenu),
 * and under it the whole Controls menu, its graphs last, in a rounded box. With more than one region, a Region row comes first
 * (Coder's region picker). Each opening measures the latency again. The workspaces chosen in the locked Workspaces
 * list open here together, in the workspace grid (the menu closes for it).
 */
export const ProxyMenu: React.FC<ProxyMenuProps> = ({
	user,
	buildInfo,
	supportLinks,
	onSignOut,
	proxyContextValue,
	canManageTunnels = false,
	tunnelActorId,
	hud = false,
	controls,
}) => {
	const [open, setOpen] = useState(false);
	const [chatExpanded, setChatExpanded] = useState(false);
	const closeMenu = () => setOpen(false);
	// The workspaces in the grid (their ids), while it is open.
	const [workspaceView, setWorkspaceView] = useState<{
		ids: string[];
		layout: "list" | "grid";
	} | null>(null);
	const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null);
	const [metricsElement, setMetricsElement] = useState<HTMLDivElement | null>(
		null,
	);
	// The regions' endpoint answers 404 without enterprise: no latency then, but the menu stays.
	const proxy = proxyContextValue?.error ? undefined : proxyContextValue;
	const selectedProxy = proxy?.proxy.proxy;
	const latencies = proxy?.proxyLatencies ?? {};
	const isLoading =
		proxy !== undefined &&
		(proxy.isLoading || Object.keys(latencies).length === 0);
	const selectedLatency = selectedProxy
		? latencies[selectedProxy.id]?.latencyMS
		: undefined;
	const regions =
		proxy?.proxies && proxy.proxies.length > 1 ? proxy.proxies : undefined;

	const pill = proxy && (
		<span
			data-testid="navbar-latency-pill"
			className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full border border-solid border-border bg-surface-secondary"
		>
			<span className="sr-only">
				Latency for {selectedProxy?.display_name ?? "your region"}
			</span>

			{selectedProxy || isLoading ? (
				<>
					<RadioIcon
						aria-hidden="true"
						className={getLatencyColor(isLoading ? undefined : selectedLatency)}
					/>

					<Latency
						className={selectedLatency ? "text-content-primary" : undefined}
						latency={selectedLatency}
						isLoading={isLoading}
					/>
				</>
			) : (
				"Select Proxy"
			)}
		</span>
	);

	const reading = (
		<>
			{pill}
			<span className="inline-flex items-center gap-1.5">
				<SettingsIcon aria-hidden className="size-3.5" />
				Settings
			</span>
			<ChevronDownIcon className="text-content-primary" />
			<SettingsNotificationBadge permissions={controls?.permissions} />
		</>
	);

	const title = [
		selectedProxy && `Latency to ${selectedProxy.display_name}`,
		"your workspaces",
		controls && "the Settings",
	]
		.filter(Boolean)
		.join(", ");

	return (
		<>
			<DropdownMenu
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					// The menu's old "Refresh latencies" row, now each time it opens.
					if (next) {
						proxy?.refetchProxyLatencies();
					}
				}}
			>
				{hud ? (
					<div
						role="group"
						aria-label={
							controls ? "HUD, latency and Settings" : "HUD and latency"
						}
						className={cn("navbar-split", controls && "settings-navbar-width")}
						data-testid="navbar-hud-latency"
					>
						<NavLink
							to="/hud"
							className="navbar-split-main"
							title="HUD: the platform at a glance"
						>
							<GaugeIcon aria-hidden />
							HUD
						</NavLink>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="navbar-split-menu relative"
								title={title}
								data-testid="navbar-latency-controls"
							>
								{reading}
							</button>
						</DropdownMenuTrigger>
					</div>
				) : (
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="lg"
							title={title}
							data-testid="navbar-latency-controls"
							className={cn("relative", controls && "settings-navbar-width")}
						>
							{reading}
						</Button>
					</DropdownMenuTrigger>
				)}
				<DropdownMenuContent
					ref={setMenuElement}
					align="end"
					data-testid="navbar-latency-controls-menu"
					// Reserve only exterior space for the tray; the menu body retains its own width and scrolling.
					className={cn(
						"relative w-max min-w-[240px] max-w-[calc(100vw-32px)] overflow-visible border-0 bg-transparent p-0 shadow-none",
						"settings-menu pl-16",
					)}
				>
					<SettingsSidePanels
						container={menuElement}
						anchor={metricsElement}
						hud={hud}
						chatExpanded={chatExpanded}
						onChatToggle={() => setChatExpanded((open) => !open)}
						images={Boolean(controls?.permissions.canEditDeployment)}
						user={user}
						buildInfo={buildInfo}
						supportLinks={supportLinks}
						onSignOut={onSignOut}
						pages={[
							...(controls?.quickLinks ?? []),
							...(controls?.quickLinksEditor?.addable ?? []),
						]}
					/>

					<div className="flex flex-col rounded-md border border-solid border-border bg-surface-primary p-2 shadow-md max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]">
						{regions && proxy && (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger data-testid="navbar-region">
									<RadioIcon aria-hidden />
									Region
									<span className="ml-auto truncate text-xs text-content-secondary">
										{selectedProxy?.display_name}
									</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="w-80">
									<DropdownMenuItem
										disabled
										className="flex flex-col gap-1 items-start data-disabled:opacity-100"
									>
										<div className="text-content-primary font-semibold text-left">
											Select a region nearest to you
										</div>
										<div className="text-xs text-content-secondary leading-relaxed">
											Workspace proxies improve terminal and web app
											connections.{" "}
											<Abbr
												title="Command-Line Interface"
												pronunciation="initialism"
											>
												CLI
											</Abbr>{" "}
											connections are unaffected. If no region is selected, the
											primary region will be used.
										</div>
									</DropdownMenuItem>

									<DropdownMenuSeparator />

									<div className="max-h-[calc(100vh-22rem)] -mr-2 pr-2 overflow-y-auto scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]">
										<DropdownMenuRadioGroup value={selectedProxy?.id}>
											{sortProxiesByLatency(regions, latencies).map(
												(region) => (
													<DropdownMenuRadioItem
														value={region.id}
														key={region.id}
														onClick={(e) => {
															e.preventDefault();
															if (!region.healthy) {
																toast.error(
																	`Failed to select proxy "${region.display_name}".`,
																	{
																		description:
																			"Please select a healthy workspace proxy.",
																	},
																);
																closeMenu();
																return;
															}

															proxy.setProxy(region);
															closeMenu();
														}}
													>
														<div className="flex gap-3 items-center w-full">
															<div className="leading-none size-4">
																<ExternalImage
																	src={region.icon_url}
																	alt=""
																	className="object-contain size-full"
																/>
															</div>

															{region.display_name}

															<Latency
																className="ml-auto"
																latency={latencies[region.id]?.latencyMS}
															/>
														</div>
													</DropdownMenuRadioItem>
												),
											)}
										</DropdownMenuRadioGroup>
									</div>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						)}

						{/* Platform: the latency to each of your workspaces, live, while it is pressed; locked, the grid's choice. */}
						<WorkspacesLatencyMenu
							open={open}
							onOpenGrid={(ids, layout) => {
								setOpen(false);
								// after the menu has handed the focus back, so the grid keeps it
								window.setTimeout(() => setWorkspaceView({ ids, layout }));
							}}
						/>

						{/* Platform: the whole Controls menu, its graphs last, in a rounded box of its own */}
						{controls && (
							<nav
								aria-label="Settings"
								data-testid="controls-group"
								className="mx-1 mt-2 mb-1 flex flex-auto flex-col rounded-lg border border-solid border-border p-1"
							>
								<AdminSettingsItems
									metricsRef={setMetricsElement}
									chatExpanded={chatExpanded}
									onChatToggle={() => setChatExpanded(!chatExpanded)}
									permissions={controls.permissions}
									quickLinks={controls.quickLinks}
									quickLinksEditor={controls.quickLinksEditor}
								/>
							</nav>
						)}
						{chatExpanded && (
							<SettingsChatPanel onClose={() => setChatExpanded(false)} />
						)}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
			<WorkspaceGrid
				ids={workspaceView?.ids ?? []}
				initialLayout={workspaceView?.layout}
				canManageTunnels={canManageTunnels}
				tunnelActorId={tunnelActorId}
				open={workspaceView !== null}
				onOpenChange={(next) => {
					if (!next) {
						setWorkspaceView(null);
					}
				}}
			/>
		</>
	);
};
