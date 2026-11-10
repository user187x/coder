import { cn } from "cn";
import {
	GaugeIcon,
	MonitorIcon,
	PanelRightCloseIcon,
	PanelRightDashedIcon,
	RadioIcon,
	SettingsIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { NavLink } from "react-router";
import { toast } from "sonner";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import type { BuildInfoResponse, User } from "#/api/typesGenerated";
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
import { CompactQuickLinks } from "./CompactQuickLinkMenu";
import { InlineMenuPanel, OpenMenuItem, useInlineMenu } from "./InlineMenu";
import { sortProxiesByLatency } from "./proxyUtils";
import { type SettingsFace, SettingsFacePanel } from "./SettingsFacePanel";
import "./settingsMenuSkeuo.css";
import { SettingsMetricGraphs } from "./SettingsMetricGraphs";
import { SettingsNotificationBadge } from "./SettingsNotificationBadge";
import { SettingsSidePanels } from "./SettingsSidePanels";
import {
	useRegisterSettingsMenu,
	useSettingsMenuHost,
} from "./settingsMenuHost";
import { UserSettingsShortcut } from "./UserSettingsShortcut";
import "./navbarSoft.css";

/** Platform: the Controls menu's items, as its own button had them (AdminSettingsItems). */
type ProxyMenuControls = {
	permissions: AdminSettingsPermissions;
	quickLinks?: readonly AdminPage[];
	quickLinksEditor?: AdminQuickLinksEditor;
	/** Every page a quick link can be (the thin strip's right-click menus offer the others in a link's place). */
	pages?: readonly AdminPage[];
	/** The admin settings' categories, listed (each hideable under Controls) with the settings navigation in the navbar. */
	categories?: readonly AdminPage[];
	/** The navbar's notification bell is shown: it badges the inbox and chats, Settings does not. */
	bellShown?: boolean;
};

type ProxyMenuProps = {
	user: User;
	buildInfo?: BuildInfoResponse;
	onSignOut: () => void;
	/** The regions and the latency to them; without it (or when it cannot be had) the button has no latency pill. */
	proxyContextValue?: ProxyContextValue;
	canManageTunnels?: boolean;
	tunnelActorId?: string;
	/** Whether the user can open the HUD from Settings. */
	hud?: boolean;
	/** Only for the settings breadcrumb's Settings chevron: no navbar button (the navbar's Settings item is hidden). */
	breadcrumbOnly?: boolean;
	/** Platform: the Controls menu, under the Workspaces row; the button then says "Settings". */
	controls?: ProxyMenuControls;
};

/** The Settings dropdown and dock share workspace, notification and region controls. */
export const ProxyMenu: React.FC<ProxyMenuProps> = ({
	user,
	buildInfo,
	onSignOut,
	proxyContextValue,
	canManageTunnels = false,
	tunnelActorId,
	hud = false,
	controls,
	breadcrumbOnly = false,
}) => {
	const [open, setOpen] = useState(false);
	// The side of the screen the menu opens on, from where its button is: on the left it hangs from the button's left
	// edge and its trays and slide-outs open to its right; on the right, the mirror. Docked, always the right.
	const trigger = useRef<HTMLButtonElement>(null);
	const [openEdge, setOpenEdge] = useState<"left" | "right">("right");
	// The bottom panel's face (SettingsFacePanel); chat open is its Chat face.
	const [face, setFace] = useState<SettingsFace>("metrics");
	// The Chat face expanded over the menu's room below its header row.
	const [chatFull, setChatFull] = useState(false);
	const chatExpanded = face === "chat";
	const setChatExpanded = (next: boolean | ((open: boolean) => boolean)) => {
		setFace((current) => {
			const open = typeof next === "function" ? next(current === "chat") : next;
			return open ? "chat" : current === "chat" ? "metrics" : current;
		});
	};
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
	// The admin settings' navigation in the navbar: on a settings page this menu opens from the breadcrumb's Settings
	// chevron, in place of the navbar's Settings button, its panel's left edge on the chevron's.
	const settingsInNavbar = Boolean(
		controls &&
			prefs.data?.admin_nav_in_navbar &&
			canViewAdminSettings(controls.permissions),
	);
	// Docked, it stays at the screen's side: the breadcrumb then keeps its own Settings link.
	useRegisterSettingsMenu(settingsInNavbar && !docked);
	const menuHost = useSettingsMenuHost();
	const breadcrumbHost = settingsInNavbar && !docked ? menuHost : null;
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
			<SettingsNotificationBadge
				permissions={controls?.permissions}
				bellShown={controls?.bellShown}
			/>
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
				"min-h-8 justify-center px-1",
				compact
					? "settings-strip-key mx-auto shrink-0 rounded-full"
					: "flex-1 rounded-none border-0 border-l border-solid border-border",
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

	const changeOpen = (next: boolean) => {
		if (docked && !next) return;
		if (next) {
			const button = trigger.current?.getBoundingClientRect();
			setOpenEdge(
				button && button.left + button.width / 2 < window.innerWidth / 2
					? "left"
					: "right",
			);
		}
		setOpen(next);
		if (!next) {
			setChatExpanded(false);
			setChatFull(false);
		}
		// The menu's old "Refresh latencies" row, now each time it opens.
		if (next) {
			proxy?.refetchProxyLatencies();
		}
	};
	const edge = docked ? "right" : openEdge;
	// Only for the breadcrumb: nothing to show until a breadcrumb takes its button, unless it is docked at the side.
	if (breadcrumbOnly && !breadcrumbHost && !docked) return null;

	return (
		<>
			<DropdownMenu
				modal={false}
				open={open || docked}
				onOpenChange={changeOpen}
			>
				<div
					role="group"
					aria-label="Dashboard navigation"
					className={docked || breadcrumbHost ? "hidden" : "navbar-split"}
					hidden={docked || Boolean(breadcrumbHost)}
					data-testid={hud ? "navbar-hud-latency" : undefined}
				>
					{!breadcrumbHost && (
						<DropdownMenuTrigger asChild>
							<button
								ref={trigger}
								type="button"
								className="navbar-split-menu relative"
								title="Settings"
								data-testid="navbar-latency-controls"
							>
								{reading}
							</button>
						</DropdownMenuTrigger>
					)}
				</div>
				{breadcrumbHost &&
					createPortal(
						<DropdownMenuTrigger asChild>
							<button
								ref={trigger}
								type="button"
								className="settings-breadcrumb-trigger"
								title="Settings"
								data-testid="navbar-latency-controls"
								// One click opens it, and another closes it (the menu's own outside-click is told to leave
								// this button to it).
								onPointerDown={(event) => event.preventDefault()}
								onClick={() => changeOpen(!open)}
							>
								<SettingsIcon aria-hidden className="size-4 shrink-0" />
								Settings
							</button>
						</DropdownMenuTrigger>,
						breadcrumbHost,
					)}
				<DropdownMenuContent
					ref={setMenuElement}
					data-settings-docked={docked || undefined}
					onInteractOutside={(e) => {
						if (
							docked ||
							(e.target instanceof Node &&
								trigger.current?.contains(e.target)) ||
							// a window the menu opened (the Cloud Drive face's files) keeps the menu, and so itself, open
							(e.target instanceof Element &&
								e.target.closest('[role="dialog"]'))
						)
							e.preventDefault();
					}}
					onEscapeKeyDown={(e) => {
						if (docked) e.preventDefault();
					}}
					align={edge === "left" ? "start" : "end"}
					sideOffset={8}
					// Clear of the classification banners fixed at the window's top and bottom, so the panel's foot shows.
					collisionPadding={{
						top: 8,
						bottom:
							8 +
							(Number.parseFloat(
								getComputedStyle(document.documentElement).getPropertyValue(
									"--coder-classification-h",
								),
							) || 0),
					}}
					data-settings-edge={edge}
					data-testid="navbar-latency-controls-menu"
					// The floating menu reserves space for the slide-out trays.
					className={cn(
						"relative w-max min-w-[240px] max-w-[calc(calc(100vw/var(--app-zoom,1))-32px)] overflow-visible border-0 bg-transparent p-0 shadow-none",
						"settings-menu",
						!docked && (edge === "left" ? "pr-16" : "pl-16"),
					)}
				>
					{!compact && (
						<SettingsSidePanels
							container={menuElement}
							surface={menuSurface}
							anchor={metricsElement}
							images={Boolean(controls?.permissions.canEditDeployment)}
						/>
					)}

					<div
						ref={setMenuSurface}
						// No scrollbar of its own: its top part (quick links) and its bottom panel scroll inside themselves
						// (the thin strip, compact, still scrolls as a whole).
						className={cn(
							"settings-menu-surface flex flex-col rounded-2xl border border-solid border-border bg-surface-primary p-2 shadow-md max-h-[calc(var(--radix-dropdown-menu-content-available-height)/var(--app-zoom,1))] scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]",
							compact ? "overflow-y-auto" : "overflow-hidden",
						)}
					>
						{!compact && (
							<div
								role="group"
								aria-label="Settings navigation"
								className="settings-menu-header mx-1 mb-1 flex flex-wrap items-center gap-1"
							>
								<UserSettingsShortcut
									user={user}
									buildInfo={buildInfo}
									onSignOut={onSignOut}
								/>
								{hud && (
									<DropdownMenuItem
										asChild
										{...hudMenu.trigger}
										className="settings-pill min-h-8 flex-1 justify-center gap-1 rounded-full border border-solid border-border px-1 text-xs"
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
									// The docking buttons together in one pill, each doing its own
									<div
										role="group"
										aria-label="Docking"
										className="settings-pill flex min-h-8 flex-1 items-stretch overflow-hidden rounded-full border border-solid border-border"
									>
										<DropdownMenuItem
											{...dockMenu.trigger}
											aria-label={dockLabel}
											title={dockLabel}
											disabled={docking.isPending || !prefs.data}
											className="min-h-8 flex-1 justify-center rounded-none px-1"
											onSelect={(event) => {
												event.preventDefault();
												toggleDock();
											}}
										>
											{docked ? (
												<PanelRightCloseIcon
													aria-hidden
													className="-rotate-90"
												/>
											) : (
												// undocked: its arrow points right, where Settings docks; docked, up to the dropdown it returns to
												<PanelRightCloseIcon aria-hidden />
											)}
										</DropdownMenuItem>
										{!compact && compactToggle}
									</div>
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
								{!controls && compactToggle}
								{compactOptions}
							</div>
						)}
						{compact ? (
							<>
								{compactToggle}
								{compactOptions}
								{/* The account as in the dropdown, between thin dividers */}
								<DropdownMenuSeparator className="mx-auto my-1 w-6 shrink-0" />
								<span className="flex justify-center">
									<UserSettingsShortcut
										user={user}
										buildInfo={buildInfo}
										onSignOut={onSignOut}
									/>
								</span>
								<DropdownMenuSeparator className="mx-auto my-1 w-6 shrink-0" />
								{/* The quick links as matte keys in one recessed well, as the panel's Controls */}
								<div className="settings-strip-well">
									{!controls?.quickLinks?.some(
										(link) => link.id === "workspaces",
									) && (
										<DropdownMenuItem asChild className="settings-strip-key">
											<NavLink
												to="/workspaces"
												aria-label="Workspaces"
												title="Workspaces"
											>
												<MonitorIcon aria-hidden />
											</NavLink>
										</DropdownMenuItem>
									)}
									<CompactQuickLinks
										links={controls?.quickLinks ?? []}
										pages={controls?.pages ?? []}
										onChange={controls?.quickLinksEditor?.onChange}
										onChat={() => {
											docking.mutate({ settings_sidebar_compact: false });
											setChatExpanded(true);
										}}
									/>
								</div>
								{controls && canViewAdminSettings(controls.permissions) && (
									<>
										{/* A little mark between the quick links and the metrics */}
										<DropdownMenuSeparator className="mx-auto my-1 w-3 shrink-0" />
										<SettingsMetricGraphs compact chatExpanded={false} />
									</>
								)}
							</>
						) : (
							<>
								{/* With the Chat face expanded, it takes the menu's room below the header row */}
								{!chatFull && regions && proxy && (
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

											<div className="max-h-[calc(calc(100vh/var(--app-zoom,1))-22rem)] -mr-2 pr-2 overflow-y-auto scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]">
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
								{!chatFull && (
									<WorkspacesLatencyMenu
										open={open || docked}
										chatExpanded={chatExpanded}
										onExpand={() => setChatExpanded(false)}
										onOpenGrid={(ids, layout) => {
											setOpen(false);
											// after the menu has handed the focus back, so the grid keeps it
											window.setTimeout(() =>
												setWorkspaceView({ ids, layout }),
											);
										}}
									/>
								)}

								{/* Platform: the whole Controls menu, its graphs last, in a rounded box of its own */}
								{!chatFull && controls && (
									<nav
										aria-label="Settings"
										data-testid="controls-group"
										className="mx-1 mt-2 mb-1 flex min-h-0 flex-auto flex-col rounded-lg border border-solid border-border p-1 bg-surface-primary"
									>
										<AdminSettingsItems
											externalMetrics
											chatExpanded={chatExpanded}
											onChatToggle={() => setChatExpanded(!chatExpanded)}
											permissions={controls.permissions}
											quickLinks={controls.quickLinks}
											quickLinksEditor={controls.quickLinksEditor}
											categories={
												settingsInNavbar ? controls.categories : undefined
											}
										/>
									</nav>
								)}
								<SettingsFacePanel
									face={face}
									onFaceChange={(next) => {
										setChatFull(false);
										setFace(next);
									}}
									chatFull={chatFull}
									onChatFull={setChatFull}
									metrics={
										controls && canViewAdminSettings(controls.permissions) ? (
											<SettingsMetricGraphs
												anchor={setMetricsElement}
												latency={clusterLatency}
												chatExpanded={false}
											/>
										) : null
									}
								/>
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
