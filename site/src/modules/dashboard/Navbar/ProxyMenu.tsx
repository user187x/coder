import { cn } from "cn";
import {
	GaugeIcon,
	MonitorIcon,
	PanelRightCloseIcon,
	PanelRightDashedIcon,
	RadioIcon,
	SettingsIcon,
} from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link, NavLink } from "react-router";
import { toast } from "sonner";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import type { BuildInfoResponse, LinkConfig, User } from "#/api/typesGenerated";
import { Abbr } from "#/components/Abbr/Abbr";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
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
	canViewAdminSettings,
} from "./AdminSettings";
import type { AdminPage } from "./adminQuickLinks";
import { InlineMenuPanel, OpenMenuItem, useInlineMenu } from "./InlineMenu";
import { sortProxiesByLatency } from "./proxyUtils";
import { SettingsChatPanel } from "./SettingsChatPanel";
import { SettingsMetricGraphs } from "./SettingsMetricGraphs";
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
	/** Whether the user can open the HUD from Settings. */
	hud?: boolean;
	/** Platform: the Controls menu, under the Workspaces row; the button then says "Settings". */
	controls?: ProxyMenuControls;
};

/** The Settings dropdown and dock share workspace, notification and region controls. */
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
	// Each entry's right-click options (InlineMenu).
	const hudMenu = useInlineMenu();
	const dockMenu = useInlineMenu();
	const compactMenu = useInlineMenu();
	const regionMenu = useInlineMenu();
	const [regionOpen, setRegionOpen] = useState(false);
	const client = useQueryClient();
	const prefs = useQuery({
		...userUIPreferences(),
		enabled: Boolean(controls),
	});
	const docking = useMutation({
		...updateUserUIPreferences(client),
		onError: () => toast.error("Could not save Settings sidebar preference."),
	});
	const docked = Boolean(controls && prefs.data?.settings_sidebar);
	const compact = Boolean(docked && prefs.data?.settings_sidebar_compact);
	useLayoutEffect(() => {
		if (!docked) return;
		document.documentElement.dataset.settingsSide = compact
			? "compact"
			: "expanded";
		const navbar = document.querySelector<HTMLElement>(".navbar-soft");
		const root = document.documentElement;
		const measure = () => {
			if (!navbar) return;
			root.style.setProperty(
				"--settings-navbar-scale",
				getComputedStyle(navbar).zoom || "1",
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (navbar) observer.observe(navbar);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			root.style.removeProperty("--settings-navbar-scale");
			delete root.dataset.settingsSide;
		};
	}, [docked, compact]);
	const closeMenu = () => setOpen(false);
	// The workspaces in the grid (their ids), while it is open.
	const [workspaceView, setWorkspaceView] = useState<{
		ids: string[];
		layout: "list" | "grid";
	} | null>(null);
	const [menuElement, setMenuElement] = useState<HTMLDivElement | null>(null);
	const [menuSurface, setMenuSurface] = useState<HTMLDivElement | null>(null);
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

	const clusterLatency = (
		<DropdownMenuItem
			onSelect={(event) => {
				event.preventDefault();
				proxy?.refetchProxyLatencies();
			}}
			disabled={!proxy}
			title="Refresh latency"
			data-testid="navbar-latency-pill"
			className="h-4 min-w-0 shrink-0 gap-0.5 rounded-full border border-solid border-border px-1 py-0 text-2xs leading-none tabular-nums text-content-secondary [&_svg]:size-2.5!"
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
						className={cn(
							"text-2xs leading-none",
							selectedLatency && "text-content-primary",
						)}
						latency={selectedLatency}
						isLoading={isLoading}
					/>
				</>
			) : proxy ? (
				"Select Proxy"
			) : (
				"Unavailable"
			)}
		</DropdownMenuItem>
	);

	const reading = (
		<>
			<span className="inline-flex items-center gap-1.5">
				<SettingsIcon aria-hidden className="size-3.5" />
				Settings
			</span>
			<ChevronDownIcon className="text-content-primary" />
			<SettingsNotificationBadge permissions={controls?.permissions} />
		</>
	);

	const dockLabel = docked ? "Return to dropdown" : "Dock Settings";

	const compactLabel = compact
		? "Expand Settings sidebar"
		: "Collapse Settings to shortcut icons";
	const toggleCompact = () =>
		docking.mutate({ settings_sidebar_compact: !compact });
	const toggleDock = () => {
		setOpen(true);
		docking.mutate({
			settings_sidebar: !docked,
			settings_sidebar_compact: false,
		});
	};
	const compactToggle = docked && (
		<DropdownMenuItem
			{...compactMenu.trigger}
			aria-label={compactLabel}
			title={compactLabel}
			disabled={docking.isPending}
			className={cn(
				"min-h-8 justify-center rounded-full border border-solid border-border px-1",
				compact ? "mx-auto size-8 shrink-0 p-0" : "flex-1",
			)}
			onSelect={(event) => {
				event.preventDefault();
				toggleCompact();
			}}
		>
			<PanelRightDashedIcon aria-hidden />
		</DropdownMenuItem>
	);
	const compactOptions = compactMenu.open && (
		<InlineMenuPanel
			id={compactMenu.id}
			label={`${compactLabel} options`}
			className="order-last"
		>
			<OpenMenuItem
				onOpen={() => {
					compactMenu.close();
					toggleCompact();
				}}
			/>
		</InlineMenuPanel>
	);

	return (
		<>
			<DropdownMenu
				modal={false}
				open={open || docked}
				onOpenChange={(next) => {
					if (docked && !next) return;
					setOpen(next);
					if (!next) setChatExpanded(false);
					// The menu's old "Refresh latencies" row, now each time it opens.
					if (next) {
						proxy?.refetchProxyLatencies();
					}
				}}
			>
				<div
					role="group"
					aria-label="Dashboard navigation"
					className={docked ? "hidden" : "navbar-split"}
					hidden={docked}
					data-testid={hud ? "navbar-hud-latency" : undefined}
				>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="navbar-split-menu relative"
							title="Settings"
							data-testid="navbar-latency-controls"
						>
							{reading}
						</button>
					</DropdownMenuTrigger>
				</div>
				<DropdownMenuContent
					ref={setMenuElement}
					data-settings-docked={docked || undefined}
					onInteractOutside={(e) => {
						if (docked) e.preventDefault();
					}}
					onEscapeKeyDown={(e) => {
						if (docked) e.preventDefault();
					}}
					align="end"
					data-testid="navbar-latency-controls-menu"
					// The floating menu reserves space for the slide-out trays.
					className={cn(
						"relative w-max min-w-[240px] max-w-[calc(100vw-32px)] overflow-visible border-0 bg-transparent p-0 shadow-none",
						"settings-menu",
						!docked && "pl-16",
					)}
				>
					{!compact && (
						<SettingsSidePanels
							container={menuElement}
							surface={menuSurface}
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
					)}

					<div
						ref={setMenuSurface}
						className="settings-menu-surface flex flex-col rounded-2xl border border-solid border-border bg-surface-primary p-2 shadow-md max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]"
					>
						{!compact && (
							<div
								role="group"
								aria-label="Settings navigation"
								className="mx-1 mb-1 flex flex-wrap items-center gap-1"
							>
								{hud && (
									<DropdownMenuItem
										asChild
										{...hudMenu.trigger}
										className="min-h-8 flex-2 justify-center gap-1 rounded-full border border-solid border-border px-1 text-xs"
									>
										<NavLink to="/hud" title="HUD">
											<GaugeIcon aria-hidden />
											HUD
										</NavLink>
									</DropdownMenuItem>
								)}
								{hud && hudMenu.open && (
									<InlineMenuPanel
										id={hudMenu.id}
										label="HUD options"
										className="order-last"
									>
										<OpenMenuItem to="/hud" />
									</InlineMenuPanel>
								)}
								{controls && (
									<DropdownMenuItem
										{...dockMenu.trigger}
										aria-label={dockLabel}
										title={dockLabel}
										disabled={docking.isPending || !prefs.data}
										className="min-h-8 flex-1 justify-center rounded-full border border-solid border-border px-1"
										onSelect={(event) => {
											event.preventDefault();
											toggleDock();
										}}
									>
										{docked ? (
											<PanelRightCloseIcon aria-hidden className="-rotate-90" />
										) : (
											// undocked: its arrow points right, where Settings docks; docked, up to the dropdown it returns to
											<PanelRightCloseIcon aria-hidden />
										)}
									</DropdownMenuItem>
								)}
								{controls && dockMenu.open && (
									<InlineMenuPanel
										id={dockMenu.id}
										label={`${dockLabel} options`}
										className="order-last"
									>
										<OpenMenuItem
											onOpen={() => {
												dockMenu.close();
												toggleDock();
											}}
										/>
									</InlineMenuPanel>
								)}
								{compactToggle}
								{compactOptions}
							</div>
						)}
						{compact ? (
							<>
								{compactToggle}
								{compactOptions}
								{!controls?.quickLinks?.some(
									(link) => link.id === "workspaces",
								) && (
									<DropdownMenuItem asChild className="justify-center">
										<Link
											to="/workspaces"
											aria-label="Workspaces"
											title="Workspaces"
										>
											<MonitorIcon aria-hidden />
										</Link>
									</DropdownMenuItem>
								)}
								{controls?.quickLinks?.map((link) =>
									link.id === "chat" ? (
										<DropdownMenuItem
											key={link.id}
											aria-label="Chat"
											title="Chat"
											className="justify-center"
											onSelect={(event) => {
												event.preventDefault();
												docking.mutate({ settings_sidebar_compact: false });
												setChatExpanded(true);
											}}
										>
											<link.icon aria-hidden />
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											key={link.id}
											asChild
											className="justify-center"
										>
											<Link
												to={link.path}
												title={link.label}
												aria-label={link.label}
											>
												<link.icon aria-hidden />
											</Link>
										</DropdownMenuItem>
									),
								)}
								{controls && canViewAdminSettings(controls.permissions) && (
									<SettingsMetricGraphs compact chatExpanded={false} />
								)}
							</>
						) : (
							<>
								{regions && proxy && (
									<DropdownMenuSub
										open={regionOpen}
										onOpenChange={setRegionOpen}
									>
										<DropdownMenuSubTrigger
											// the submenu's own aria-expanded stays: only the right-click and its keys
											onContextMenu={regionMenu.trigger.onContextMenu}
											onKeyDown={regionMenu.trigger.onKeyDown}
											data-testid="navbar-region"
										>
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
													connections are unaffected. If no region is selected,
													the primary region will be used.
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
								{regions && proxy && regionMenu.open && (
									<InlineMenuPanel id={regionMenu.id} label="Region options">
										<OpenMenuItem
											onOpen={() => {
												regionMenu.close();
												setRegionOpen(true);
											}}
										/>
									</InlineMenuPanel>
								)}

								{/* Platform: the latency to each of your workspaces, live, while it is pressed; locked, the grid's choice. */}
								<WorkspacesLatencyMenu
									open={open || docked}
									chatExpanded={chatExpanded}
									onExpand={() => setChatExpanded(false)}
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
											externalMetrics
											chatExpanded={chatExpanded}
											onChatToggle={() => setChatExpanded(!chatExpanded)}
											permissions={controls.permissions}
											quickLinks={controls.quickLinks}
											quickLinksEditor={controls.quickLinksEditor}
										/>
									</nav>
								)}
								{controls && canViewAdminSettings(controls.permissions) && (
									<SettingsMetricGraphs
										anchor={setMetricsElement}
										latency={clusterLatency}
										chatExpanded={chatExpanded}
									/>
								)}
								{chatExpanded && (
									<SettingsChatPanel onClose={() => setChatExpanded(false)} />
								)}
							</>
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
