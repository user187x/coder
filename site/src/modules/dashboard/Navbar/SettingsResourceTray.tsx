import {
	BellIcon,
	CheckIcon,
	ContainerIcon,
	GaugeIcon,
	HourglassIcon,
	LayoutDashboardIcon,
	LayoutTemplateIcon,
	LogOutIcon,
	MessagesSquareIcon,
	MonitorIcon,
	PlusIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import { inboxNotifications } from "#/api/queries/notifications";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import type { BuildInfoResponse, LinkConfig, User } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { NotificationsInbox } from "#/modules/notifications/NotificationsInbox/NotificationsInbox";
import { UnreadBadge } from "#/modules/notifications/NotificationsInbox/UnreadBadge";
import { AccountShortcutMenu } from "./AccountShortcutMenu";
import type { AdminPage } from "./adminQuickLinks";
import { SettingsDrawerHandle } from "./SettingsDrawerHandle";
import { ShortcutCarousel } from "./ShortcutCarousel";
import { SortableTrayLinks } from "./SortableTrayLinks";
import type { SettingsPanelPlacement } from "./settingsPanelLayout";
import { UserDropdownContent } from "./UserDropdown/UserDropdownContent";
import "./settingsResourceTray.css";

const permanentShortcutIds = new Set([
	"account",
	"dashboard",
	"workspaces",
	"templates",
	"chat",
]);

const destinations: readonly AdminPage[] = [
	{ id: "hud", label: "HUD", path: "/hud", icon: GaugeIcon },
];

export const SettingsResourceTray = ({
	images,
	hud = true,
	chatExpanded,
	onChatToggle,
	user,
	buildInfo,
	supportLinks,
	onSignOut,
	pages = [],
	placement,
	onElement,
}: {
	images: boolean;
	hud?: boolean;
	chatExpanded?: boolean;
	onChatToggle?: () => void;
	user: User;
	buildInfo?: BuildInfoResponse;
	supportLinks: readonly LinkConfig[];
	onSignOut: () => void;
	pages?: readonly AdminPage[];
	placement?: SettingsPanelPlacement;
	onElement?: React.RefCallback<HTMLDivElement>;
}) => {
	const inbox = useQuery(inboxNotifications());
	const [visible, setVisible] = useState<boolean | null>(null);
	const [adding, setAdding] = useState(false);
	const [accountOpen, setAccountOpen] = useState(false);
	const accountLink = useRef<HTMLDivElement>(null);
	const accountMenuId = useId();
	const closeAccountMenu = () => {
		setAccountOpen(false);
		accountLink.current?.focus();
	};
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const setPanel = useCallback(
		(element: HTMLDivElement | null) => {
			setContainer(element);
			onElement?.(element);
		},
		[onElement],
	);
	const [addButton, setAddButton] = useState<HTMLDivElement | null>(null);
	const id = useId();
	const client = useQueryClient();
	const preferences = useQuery({ ...userUIPreferences(), retry: false });
	const save = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save resource shortcuts.")),
	});
	const locked = preferences.data?.resource_tray;
	const expanded = visible ?? locked?.expanded ?? true;
	const busy = save.isPending;
	const toggle = () => {
		if (busy) return;
		setAccountOpen(false);
		setAdding(false);
		setVisible(!expanded);
		if (locked) {
			save.mutate(
				{ resource_tray: { ...locked, expanded: !expanded } },
				{ onError: () => setVisible(expanded) },
			);
		}
	};
	const lock = (open: boolean | null) => {
		if (busy) return;
		if (preferences.isLoading || preferences.isError) {
			toast.error(
				"Load resource preferences before locking the tray. Try again.",
			);
			void preferences.refetch();
			return;
		}
		setVisible(open ?? expanded);
		save.mutate(
			{
				resource_tray:
					open === null ? null : { expanded: open, lock: open ? "up" : "down" },
			},
			{ onError: () => setVisible(expanded) },
		);
	};
	const savedShortcuts = preferences.data?.resource_shortcuts ?? [];
	const choices = [
		...new Map(
			[
				...(hud ? destinations : []),
				...(images
					? [
							{
								id: "images",
								label: "Images",
								path: "/images",
								icon: ContainerIcon,
							},
							{
								id: "leases",
								label: "Leases",
								path: "/deployment/users#short-term-leases",
								icon: HourglassIcon,
							},
						]
					: []),
				...pages,
				{ id: "logout", label: "Sign out", icon: LogOutIcon, path: "" },
			].map((page) => [page.id, page]),
		).values(),
	].filter((page) => !permanentShortcutIds.has(page.id));
	const custom = [...new Set(savedShortcuts)]
		.flatMap((id) => choices.find((page) => page.id === id) ?? [])
		.slice(0, 3);
	const chosen = custom.map((page) => page.id);
	const links: AdminPage[] = [
		{
			id: "dashboard",
			label: "Dashboard",
			path: "/dashboard",
			icon: LayoutDashboardIcon,
		},
		{
			id: "workspaces",
			label: "Workspaces",
			path: "/workspaces",
			icon: MonitorIcon,
		},
		{
			id: "templates",
			label: "Templates",
			path: "/templates",
			icon: LayoutTemplateIcon,
		},
		...custom,
	];
	const accountShortcut = (
		<div className="relative mb-2 size-8 shrink-0">
			<AccountShortcutMenu onSignOut={onSignOut}>
				<DropdownMenuItem
					ref={accountLink}
					className="justify-center size-8 p-0"
					title="User menu. Right-click for account actions."
					aria-label="Account"
					aria-expanded={accountOpen}
					aria-controls={accountOpen ? accountMenuId : undefined}
					onSelect={(event) => {
						event.preventDefault();
						setAdding(false);
						setAccountOpen(!accountOpen);
					}}
				>
					<Avatar
						src={user.avatar_url}
						fallback={user.username}
						className="size-6"
					/>
				</DropdownMenuItem>
			</AccountShortcutMenu>
			{Boolean(inbox.data?.unread_count) && (
				<span className="pointer-events-none absolute -right-1.5 -top-1.5 scale-75 origin-top-right">
					<UnreadBadge count={inbox.data?.unread_count ?? 0} />
				</span>
			)}
			<NotificationsInbox
				fetchNotifications={API.getInboxNotifications}
				markAllAsRead={API.markAllInboxNotificationsAsRead}
				clearAll={PlatformAPI.clearInbox}
				markNotificationAsRead={(id) =>
					API.updateInboxNotificationReadStatus(id, { is_read: true })
				}
				trigger={
					<button
						type="button"
						aria-label="Open notification inbox"
						title="Notifications"
						className="absolute -bottom-1 -left-1 flex size-5 cursor-pointer items-center justify-center rounded-full border border-solid border-border bg-surface-primary text-content-secondary hover:text-content-primary"
					>
						<BellIcon className="size-3" />
					</button>
				}
			/>
		</div>
	);
	const chatShortcut = (
		<DropdownMenuItem
			className="justify-center size-8 shrink-0 p-0"
			aria-label="Open quick chat"
			aria-expanded={chatExpanded}
			title="Chat"
			onSelect={(event) => {
				event.preventDefault();
				setAdding(false);
				onChatToggle?.();
			}}
		>
			<MessagesSquareIcon aria-hidden />
		</DropdownMenuItem>
	);
	const resourceLinks = links.map((page) => {
		const shortcut =
			page.id === "logout" ? (
				<DropdownMenuItem
					aria-label={page.label}
					title={page.label}
					className="justify-center size-8 shrink-0 p-0"
					onSelect={onSignOut}
				>
					<LogOutIcon aria-hidden />
				</DropdownMenuItem>
			) : (
				<DropdownMenuItem
					key={page.id}
					asChild
					className="justify-center size-8 shrink-0 p-0"
					title={page.label}
				>
					<Link to={page.path} aria-label={page.label}>
						<page.icon aria-hidden />
					</Link>
				</DropdownMenuItem>
			);
		if (permanentShortcutIds.has(page.id))
			return { id: page.id, content: shortcut };
		return {
			id: page.id,
			content: (
				<ContextMenu key={page.id}>
					<ContextMenuTrigger
						asChild
						onContextMenu={(event) => event.stopPropagation()}
					>
						{shortcut}
					</ContextMenuTrigger>
					<ContextMenuContent
						aria-label={`${page.label} shortcut actions`}
						className="z-[2147483647]"
						onContextMenu={(event) => event.stopPropagation()}
					>
						<ContextMenuItem
							disabled={busy}
							aria-label={`Remove ${page.label} shortcut`}
							onSelect={() =>
								save.mutate({
									resource_shortcuts: chosen.filter((id) => id !== page.id),
								})
							}
						>
							<Trash2Icon aria-hidden />
							Remove shortcut
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			),
		};
	});

	return (
		<div
			ref={setPanel}
			className="settings-resource-tray"
			style={{
				top: placement?.top,
				maxHeight: placement?.maxHeight,
				minHeight: Math.min(164, placement?.maxHeight ?? 164),
			}}
			data-expanded={expanded}
			data-choosing={adding || undefined}
			data-account-open={accountOpen || undefined}
		>
			<SettingsDrawerHandle
				position={{ x: 0, y: placement?.top ?? 56 }}
				limits={{
					minY: placement?.minTop ?? 56,
					maxY: placement?.maxTop ?? 56,
				}}
				onChange={({ y }) => placement?.onMove(y)}
				onCommit={({ y }) => placement?.onCommit(y)}
				label="Resource shortcuts"
				expanded={expanded}
				locked={Boolean(locked)}
				busy={busy}
				controls={id}
				toggle={toggle}
				lock={lock}
			/>
			<div
				aria-hidden={!expanded}
				inert={!expanded}
				className="settings-resource-tray-panel"
				id={id}
				role="group"
				aria-label="Resource shortcuts"
			>
				<div className="settings-resource-tray-outline" aria-hidden />
				<div className="settings-resource-tray-links">
					<SortableTrayLinks
						items={
							accountOpen
								? [{ id: "account", content: accountShortcut }]
								: [
										{ id: "account", content: accountShortcut },
										...(onChatToggle
											? [{ id: "chat", content: chatShortcut }]
											: []),
										...resourceLinks,
									]
						}
						order={preferences.data?.resource_shortcut_order ?? []}
						disabled={accountOpen || busy || !preferences.data}
						onReorder={(resource_shortcut_order) =>
							save.mutate({ resource_shortcut_order })
						}
					/>
					{accountOpen && (
						<div
							id={accountMenuId}
							role="group"
							aria-label="User menu"
							className="settings-account-menu"
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									closeAccountMenu();
								}
							}}
						>
							<DropdownMenuItem
								className="justify-center size-8 p-0"
								aria-label="Close user menu"
								onSelect={(event) => {
									event.preventDefault();
									closeAccountMenu();
								}}
							>
								<XIcon />
							</DropdownMenuItem>
							<UserDropdownContent
								compact
								user={user}
								buildInfo={buildInfo}
								supportLinks={supportLinks}
								onSignOut={onSignOut}
							/>
						</div>
					)}

					{!accountOpen && (
						<DropdownMenuItem
							ref={setAddButton}
							aria-label={
								adding ? "Close resource shortcuts" : "Add resource shortcut"
							}
							title={adding ? "Close shortcut picker" : "Add a quick link"}
							aria-expanded={adding}
							className="relative z-[6] justify-center size-8 shrink-0 rounded-full p-0"
							onSelect={(event) => {
								event.preventDefault();
								setAdding(!adding);
							}}
						>
							{adding ? <XIcon aria-hidden /> : <PlusIcon aria-hidden />}
						</DropdownMenuItem>
					)}
				</div>
			</div>
			{expanded && adding && addButton && container && (
				<ShortcutCarousel
					anchor={addButton}
					container={container}
					onClose={() => setAdding(false)}
				>
					{preferences.isError ? (
						<Button
							size="icon"
							variant="outline"
							title="Retry loading shortcuts"
							aria-label="Retry loading shortcuts"
							onClick={() => void preferences.refetch()}
						>
							<PlusIcon />
						</Button>
					) : (
						choices.map((page) => (
							<Button
								key={page.id}
								size="icon"
								variant="subtle"
								className="relative"
								aria-label={page.label}
								title={`${chosen.includes(page.id) ? "Remove" : "Add"} ${page.label}`}
								aria-pressed={chosen.includes(page.id)}
								disabled={
									preferences.isLoading ||
									save.isPending ||
									(!chosen.includes(page.id) && chosen.length >= 3)
								}
								onClick={() =>
									save.mutate(
										{
											resource_shortcuts: chosen.includes(page.id)
												? chosen.filter((id) => id !== page.id)
												: [...chosen, page.id],
										},
										{
											onSuccess: () => {
												setAdding(false);
												addButton.focus();
											},
										},
									)
								}
							>
								<page.icon aria-hidden />
								{chosen.includes(page.id) && (
									<CheckIcon className="absolute bottom-0 right-0 size-3 rounded-full bg-surface-primary text-content-link" />
								)}
							</Button>
						))
					)}
				</ShortcutCarousel>
			)}
		</div>
	);
};
