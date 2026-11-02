import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, spyOn, userEvent, within } from "storybook/test";
import { AdminNotesAPI } from "#/api/adminNotes";
import { API } from "#/api/api";
import { PlatformAPI, type UserUIPreferences } from "#/api/platform";
import { getAuthorizationKey } from "#/api/queries/authCheck";
import {
	clusterUsageKey,
	hudHistory,
	userUIPreferences,
} from "#/api/queries/platform";
import { myAppearanceKey } from "#/api/queries/users";
import { workspaces } from "#/api/queries/workspaces";
import { ScreenShareAPI } from "#/api/screenShare";
import type * as TypesGen from "#/api/typesGenerated";
import { AuthProvider } from "#/contexts/auth/AuthProvider";
import { getPreferredProxy } from "#/contexts/ProxyContext";
import { permissionChecks } from "#/modules/permissions";
import { closePanelView } from "#/modules/platform/chat/chatStore";
import { MockAdminNote, MockUnreadAdminNote } from "#/testHelpers/adminNotes";
import { MockLavaAvatar } from "#/testHelpers/avatar";
import {
	MockChatPeer,
	MockChatPerson,
	MockChatState,
} from "#/testHelpers/chat";
import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import {
	MockAuthMethodsAll,
	MockBuildInfo,
	MockHealth,
	MockNotification,
	MockOrganization,
	MockPermissions,
	MockProxyLatencies,
	MockUserAppearanceSettings,
	MockUserOwner,
	MockWorkspace,
	MockWorkspaceProxies,
} from "#/testHelpers/entities";
import { MockHudHistory } from "#/testHelpers/hud";
import { MockBanner, MockClusterUsage } from "#/testHelpers/platform";
import { withDesktopViewport } from "#/testHelpers/storybook";
import { adminPagesFor } from "./adminQuickLinks";
import { ProxyMenu } from "./ProxyMenu";

const buildProxies = (count: number): TypesGen.WorkspaceProxy[] => {
	const seedProxy = MockWorkspaceProxies[0];
	const proxies: TypesGen.WorkspaceProxy[] = [];

	for (let index = 0; index < count; index++) {
		const suffix = String(index + 1).padStart(12, "0");
		const id = `10000000-0000-4000-8000-${suffix}`;
		const isHealthy = index % 7 !== 0;

		proxies.push({
			...seedProxy,
			id,
			name: `region-${index + 1}`,
			display_name: `Region ${index + 1}`,
			healthy: isHealthy,
		});
	}

	return proxies;
};

const buildLatencies = (
	proxies: TypesGen.WorkspaceProxy[],
): typeof MockProxyLatencies => {
	const latencies: typeof MockProxyLatencies = {};

	for (const [index, proxy] of proxies.entries()) {
		if (!proxy.healthy) {
			continue;
		}

		latencies[proxy.id] = {
			accurate: true,
			latencyMS: 20 + index * 3,
			at: new Date(),
			nextHopProtocol: "h2",
		};
	}

	return latencies;
};

const manyProxies = buildProxies(45);

const defaultProxyContextValue = {
	latenciesLoaded: true,
	proxyLatencies: MockProxyLatencies,
	proxy: getPreferredProxy(MockWorkspaceProxies, undefined),
	proxies: MockWorkspaceProxies,
	isLoading: false,
	isFetched: true,
	setProxy: fn(),
	clearProxy: fn(),
	refetchProxyLatencies: () => new Date(),
};

const meta: Meta<typeof ProxyMenu> = {
	title: "modules/dashboard/ProxyMenu",
	component: ProxyMenu,
	args: {
		user: MockUserOwner,
		supportLinks: [],
		onSignOut: fn(),
		proxyContextValue: defaultProxyContextValue,
	},
	decorators: [
		(Story) => (
			<AuthProvider>
				<div className="flex justify-end">
					<Story />
				</div>
			</AuthProvider>
		),
		withDesktopViewport,
	],
	parameters: {
		queries: [
			{ key: ["me"], data: MockUserOwner },
			{ key: ["authMethods"], data: MockAuthMethodsAll },
			{ key: ["hasFirstUser"], data: true },
			{
				key: getAuthorizationKey({ checks: permissionChecks }),
				data: MockPermissions,
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof ProxyMenu>;

export const Closed: Story = {};

export const ClosedWarningLatency: Story = {
	args: {
		proxyContextValue: {
			...defaultProxyContextValue,
			proxyLatencies: {
				...MockProxyLatencies,
				[MockWorkspaceProxies[0].id]: {
					accurate: true,
					latencyMS: 224,
					at: new Date(),
					nextHopProtocol: "h2",
				},
			},
		},
	},
};

export const ClosedCriticalLatency: Story = {
	args: {
		proxyContextValue: {
			...defaultProxyContextValue,
			proxyLatencies: {
				...MockProxyLatencies,
				[MockWorkspaceProxies[0].id]: {
					accurate: true,
					latencyMS: 471,
					at: new Date(),
					nextHopProtocol: "h2",
				},
			},
		},
	},
};

export const ClosedNoLatency: Story = {
	args: {
		proxyContextValue: {
			...defaultProxyContextValue,
			proxyLatencies: Object.fromEntries(
				Object.entries(MockProxyLatencies).filter(
					([id]) => id !== MockWorkspaceProxies[0].id,
				),
			),
		},
	},
};

export const Opened: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
	},
};

export const SingleProxy: Story = {
	args: {
		proxyContextValue: {
			...defaultProxyContextValue,
			proxies: [MockWorkspaceProxies[0]],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
	},
};

export const ManyProxiesOpened: Story = {
	args: {
		proxyContextValue: {
			...defaultProxyContextValue,
			proxies: manyProxies,
			proxyLatencies: buildLatencies(manyProxies),
			proxy: getPreferredProxy(manyProxies, undefined),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
		// Platform: the regions are in the Region row's submenu.
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(await body.findByTestId("navbar-region"));
	},
};

export const LongWorkspaceNames: Story = {
	parameters: {
		queries: [
			...(meta.parameters?.queries ?? []),
			{
				key: workspaces({ q: "owner:me" }).queryKey,
				data: {
					workspaces: [
						{
							...MockWorkspace,
							name: "amethyst-sparrow-workspace",
							template_display_name: "DATAFLOW",
						},
						{
							...MockWorkspace,
							id: "short-workspace",
							name: "ahh",
							template_display_name: "DEFAULT",
						},
					],
					count: 2,
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("button"));
		const trigger = within(document.body).getByTestId("workspaces-latency");
		trigger.focus();
		await userEvent.keyboard("{Enter}");
	},
};

export const ResourceTrayOpened: Story = {
	args: {
		hud: true,
		controls: {
			permissions: {
				canEditDeployment: true,
				canViewDeployment: true,
				canViewUsers: true,
			},
		},
	},
	parameters: {
		queries: [
			...(meta.parameters?.queries ?? []),
			{ key: clusterUsageKey, data: MockClusterUsage },
			{ key: userUIPreferences().queryKey, data: {} },
			{
				key: hudHistory("15m").queryKey,
				data: {
					...MockHudHistory,
					start: MockHudHistory.end - 900,
					points: MockHudHistory.points.slice(-30),
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /Settings/ }),
		);
	},
};
export const ResourceTrayHidden: Story = {
	...ResourceTrayOpened,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /Settings/ }),
		);
		await userEvent.dblClick(
			within(canvasElement.ownerDocument.body).getByRole("menuitem", {
				name: "Hide resource shortcuts",
			}),
		);
	},
};
export const ResourceTrayWithShortcuts: Story = {
	...ResourceTrayOpened,
	parameters: {
		queries: [
			...(ResourceTrayOpened.parameters?.queries ?? []),
			{
				key: userUIPreferences().queryKey,
				data: { resource_shortcuts: ["workspaces", "hud"] },
			},
		],
	},
};
export const TemplatesOnly: Story = {
	...ResourceTrayOpened,
	args: {
		controls: {
			permissions: { canViewDeployment: true, canEditDeployment: false },
		},
	},
};

export const ResourceTrayLockedOpen: Story = {
	...ResourceTrayOpened,
	parameters: {
		queries: [
			...(ResourceTrayOpened.parameters?.queries ?? []),
			{
				key: userUIPreferences().queryKey,
				data: {
					resource_tray: { expanded: true, lock: "up" },
					admin_notes_tray: { expanded: false, lock: "down" },
				},
			},
		],
	},
};
export const ResourceTrayLockedClosed: Story = {
	...ResourceTrayOpened,
	parameters: {
		queries: [
			...(ResourceTrayOpened.parameters?.queries ?? []),
			{
				key: userUIPreferences().queryKey,
				data: {
					resource_tray: { expanded: false, lock: "down" },
					admin_notes_tray: { expanded: false, lock: "up" },
				},
			},
		],
	},
};

export const HiddenChatMenu: Story = {
	...ResourceTrayOpened,
	args: { ...ResourceTrayOpened.args, controls: undefined },
	parameters: {
		queries: [
			...(ResourceTrayOpened.parameters?.queries ?? []),
			{ key: userUIPreferences().queryKey, data: { chat_hidden: true } },
		],
	},
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /Settings/ }),
		);
		const chat = within(canvasElement.ownerDocument.body).getByRole(
			"menuitem",
			{ name: "Chat" },
		);
		const rect = chat.getBoundingClientRect();
		await userEvent.pointer({
			target: chat,
			keys: "[MouseRight]",
			coords: { x: rect.left + 30, y: rect.top + 12 },
		});
	},
};

export const CentralAdminMenu: Story = {
	...ResourceTrayOpened,
	args: {
		...ResourceTrayOpened.args,
		user: { ...MockUserOwner, avatar_url: MockLavaAvatar },
		controls: {
			permissions: { canEditDeployment: true, canViewHealth: true },
			quickLinks: adminPagesFor({
				permissions: MockPermissions,
				oauth2Provider: true,
			}).filter((p) => ["accounts", "announcement", "chat"].includes(p.id)),
			quickLinksEditor: {
				addable: adminPagesFor({
					permissions: MockPermissions,
					oauth2Provider: true,
				}).filter((p) => !["accounts", "announcement", "chat"].includes(p.id)),
				onChange: fn(),
			},
		},
	},
	beforeEach: () => {
		closePanelView();
		let preferences: UserUIPreferences = {};
		spyOn(PlatformAPI, "getUserUIPreferences").mockImplementation(
			async () => preferences,
		);
		spyOn(PlatformAPI, "setUserUIPreferences").mockImplementation(
			async (changes) => {
				preferences = { ...preferences, ...changes };
				return preferences;
			},
		);
		spyOn(PlatformAPI, "getBanner").mockResolvedValue(MockBanner);
		spyOn(API, "getHealth").mockResolvedValue(MockHealth);
		spyOn(PlatformAPI, "getNetworkReport").mockResolvedValue(
			MockClusterNetworkReport,
		);
		spyOn(API, "getOrganizations").mockResolvedValue([MockOrganization]);
		spyOn(API, "getWorkspaces").mockResolvedValue({
			workspaces: [MockWorkspace],
			count: 1,
		});
		spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [MockNotification],
			unread_count: 1,
		});
		spyOn(AdminNotesAPI, "list").mockResolvedValue({ notes: [MockAdminNote] });
		spyOn(PlatformAPI, "getChatState").mockResolvedValue({
			...MockChatState,
			me: { ...MockChatState.me, admin: true },
		});
		spyOn(PlatformAPI, "getChatPeople").mockResolvedValue({
			enabled: true,
			people: [MockChatPerson],
		});
		spyOn(PlatformAPI, "pollChat").mockReturnValue(new Promise(() => {}));
		spyOn(PlatformAPI, "getChatAdmins").mockResolvedValue({
			admins: [MockChatPeer],
		});
		spyOn(PlatformAPI, "getChatMessages").mockResolvedValue({
			messages: [MockChatState.conversations[0].last],
			readUpTo: 1,
		});
		spyOn(PlatformAPI, "chatActivity").mockResolvedValue({ ok: true });
		spyOn(PlatformAPI, "markChatRead").mockResolvedValue({ ok: true });
	},
};
export const CentralAdminNotes: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.dblClick(
			await within(document.body).findByRole("menuitem", {
				name: "Show admin notes",
			}),
		);
	},
};
export const AdjustedAdminNotes: Story = {
	...CentralAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
		const grip = within(document.body).getByRole("menuitem", {
			name: "Hide admin notes",
		});
		const rect = grip.getBoundingClientRect();
		await userEvent.pointer([
			{
				target: grip,
				keys: "[MouseLeft>]",
				coords: { x: rect.x, y: rect.y },
			},
			{ target: grip, coords: { x: rect.x - 1500, y: rect.y - 1000 } },
			{ keys: "[/MouseLeft]" },
		]);
	},
};
export const CentralAdminSettingsExpanded: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", { name: "Controls" }),
		);
	},
};
export const CentralAdminWorkspacesExpanded: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		(await within(document.body).findByTestId("workspaces-latency")).focus();
		await userEvent.keyboard("{Enter}");
	},
};
export const WorkspaceLayoutChoices: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.dblClick(
			await within(document.body).findByRole("menuitem", {
				name: /^Workspaces.*running/,
			}),
		);
	},
};
export const WorkspaceListView: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await WorkspaceLayoutChoices.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", { name: "List view" }),
		);
	},
};
export const WorkspaceGridView: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await WorkspaceLayoutChoices.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", { name: "Grid view" }),
		);
	},
};
export const CentralAdminChat: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", { name: "Chat" }),
		);
		await userEvent.click(
			await within(document.body).findByRole("button", {
				name: /Can you help/,
			}),
		);
	},
};
export const AdminRequestControlMenu: Story = {
	...CentralAdminChat,
	beforeEach: async (context) => {
		if (typeof CentralAdminMenu.beforeEach === "function")
			await CentralAdminMenu.beforeEach(context);
		spyOn(ScreenShareAPI, "state").mockResolvedValue({
			canShare: true,
			sessions: [],
			iceServers: [],
		});
	},
	play: async (context) => {
		await CentralAdminChat.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("button", { name: "More" }),
		);
	},
};

export const QuickChatPersonActions: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", {
				name: "Chat",
			}),
		);
		const person = await within(document.body).findByRole("button", {
			name: /Alex.*online/,
		});
		const rect = person.getBoundingClientRect();
		await userEvent.pointer({
			target: person,
			keys: "[MouseRight]",
			coords: { x: rect.left + 30, y: rect.top + 12 },
		});
	},
};

export const QuickChatForceFocus: Story = {
	...QuickChatPersonActions,
	play: async (context) => {
		await QuickChatPersonActions.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", {
				name: "Force focus",
			}),
		);
	},
};

export const QuickAnnouncement: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.pointer({
			target: await within(document.body).findByRole("menuitem", {
				name: "Announcement",
			}),
			keys: "[MouseRight]",
		});
	},
};

export const ShortcutPicker: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", {
				name: "Add resource shortcut",
			}),
		);
	},
};

export const TrayUserMenu: Story = {
	...CentralAdminMenu,
	args: { ...CentralAdminMenu.args, buildInfo: MockBuildInfo },
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", { name: "Account" }),
		);
	},
};
export const ShortcutLimitReached: Story = {
	...ShortcutPicker,
	parameters: {
		queries: [
			...(CentralAdminMenu.parameters?.queries ?? []),
			{
				key: userUIPreferences().queryKey,
				data: { resource_shortcuts: ["hud", "images", "leases"] },
			},
		],
	},
};
export const TrayUserAppearance: Story = {
	...TrayUserMenu,
	play: async (context) => {
		await TrayUserMenu.play?.(context);
		await userEvent.click(
			await within(document.body).findByRole("menuitem", {
				name: "Appearance",
			}),
		);
	},
};

export const UnreadAdminNotes: Story = {
	...CentralAdminMenu,
	beforeEach: async (context) => {
		if (typeof CentralAdminMenu.beforeEach === "function") {
			await CentralAdminMenu.beforeEach(context);
		}
		let note = MockUnreadAdminNote;
		spyOn(AdminNotesAPI, "list").mockImplementation(async () => ({
			notes: [note],
		}));
		spyOn(AdminNotesAPI, "change").mockImplementation(async (_org, change) => {
			if (change.action === "read") note = { ...note, unread: false };
			return { notes: [note] };
		});
	},
};
export const UnreadAdminNotesOpened: Story = {
	...UnreadAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
	},
};

export const CombinedNotifications: Story = {
	...UnreadAdminNotes,
	play: async () => {},
};
export const NotificationsUnavailable: Story = {
	...CentralAdminMenu,
	beforeEach: async (context) => {
		if (typeof CentralAdminMenu.beforeEach === "function")
			await CentralAdminMenu.beforeEach(context);
		spyOn(API, "getInboxNotifications").mockRejectedValue(
			new Error("Inbox unavailable"),
		);
		spyOn(API, "getHealth").mockRejectedValue(new Error("Health unavailable"));
		spyOn(PlatformAPI, "getNetworkReport").mockRejectedValue(
			new Error("Cluster unavailable"),
		);
	},
	play: async () => {},
};
export const NoNotifications: Story = {
	...CentralAdminMenu,
	beforeEach: async (context) => {
		if (typeof CentralAdminMenu.beforeEach === "function")
			await CentralAdminMenu.beforeEach(context);
		spyOn(API, "getHealth").mockResolvedValue({
			...MockHealth,
			workspace_proxy: {
				...MockHealth.workspace_proxy,
				healthy: true,
				severity: "ok",
				warnings: [],
				error: undefined,
			},
		});
		spyOn(API, "getInboxNotifications").mockResolvedValue({
			notifications: [],
			unread_count: 0,
		});
		spyOn(PlatformAPI, "getNetworkReport").mockResolvedValue({
			...MockClusterNetworkReport,
			coder: MockClusterNetworkReport.coder.map((pod) => ({
				...pod,
				ready: true,
			})),
			services: MockClusterNetworkReport.services?.map((service) => ({
				...service,
				ready: 1,
			})),
		});
	},
	play: async () => {},
};

export const TrayAccountActions: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.pointer({
			target: await within(document.body).findByRole("menuitem", {
				name: "Account",
			}),
			keys: "[MouseRight]",
		});
	},
};
export const AdjustedResourceTray: Story = {
	...CentralAdminMenu,
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		const grip = await within(document.body).findByRole("menuitem", {
			name: "Hide resource shortcuts",
		});
		grip.focus();
		await userEvent.keyboard("{Alt>}{ArrowDown>40/}{/Alt}");
	},
};

export const NotesAtBottom: Story = {
	...CentralAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
		within(document.body)
			.getByRole("menuitem", { name: "Hide admin notes" })
			.focus();
		await userEvent.keyboard("{Alt>}{ArrowDown>50/}{/Alt}");
	},
};
export const BothPanelsAtTop: Story = {
	...CentralAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
		for (const name of ["Hide resource shortcuts", "Hide admin notes"]) {
			within(document.body).getByRole("menuitem", { name }).focus();
			await userEvent.keyboard("{Alt>}{ArrowUp>50/}{/Alt}");
		}
	},
};

export const AnchoredPanelsAfterToggle: Story = {
	...CentralAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
		for (const label of ["resource shortcuts", "admin notes"]) {
			await userEvent.dblClick(
				within(document.body).getByRole("menuitem", { name: `Hide ${label}` }),
			);
			await userEvent.dblClick(
				within(document.body).getByRole("menuitem", { name: `Show ${label}` }),
			);
		}
	},
};

export const AnchoredPanelsHidden: Story = {
	...CentralAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
		for (const label of ["resource shortcuts", "admin notes"]) {
			await userEvent.dblClick(
				within(document.body).getByRole("menuitem", { name: `Hide ${label}` }),
			);
		}
	},
};

export const ShortcutPickerAboveClosedNotes: Story = {
	...CentralAdminNotes,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /Settings/ }),
		);
		const body = within(canvasElement.ownerDocument.body);
		await userEvent.click(
			body.getByRole("menuitem", { name: "Add resource shortcut" }),
		);
	},
};

export const RemoveAddedResourceShortcut: Story = {
	...ResourceTrayWithShortcuts,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: /Settings/ }),
		);
		await userEvent.pointer({
			target: await within(canvasElement.ownerDocument.body).findByRole(
				"menuitem",
				{ name: "HUD" },
			),
			keys: "[MouseRight]",
		});
	},
};

export const PersonalAppearanceExpanded: Story = {
	...CentralAdminMenu,
	args: {
		...CentralAdminMenu.args,
		controls: {
			...CentralAdminMenu.args?.controls,
			permissions: { canEditDeployment: true, canViewHealth: true },
			quickLinks: adminPagesFor({
				permissions: MockPermissions,
				oauth2Provider: true,
			}).filter((page) =>
				["accounts", "announcement", "customize", "chat"].includes(page.id),
			),
		},
	},
	parameters: {
		...CentralAdminMenu.parameters,
		queries: [
			...(CentralAdminMenu.parameters?.queries ?? []),
			{ key: myAppearanceKey, data: MockUserAppearanceSettings },
		],
	},
	play: async (context) => {
		await CentralAdminMenu.play?.(context);
		await userEvent.click(
			await within(context.canvasElement.ownerDocument.body).findByRole(
				"menuitem",
				{ name: "Appearance" },
			),
		);
	},
};

export const PanelHandleLockMenu: Story = {
	...CentralAdminNotes,
	play: async (context) => {
		await CentralAdminNotes.play?.(context);
		const grip = within(document.body).getByRole("menuitem", {
			name: "Hide admin notes",
		});
		const rect = grip.getBoundingClientRect();
		await userEvent.pointer({
			target: grip,
			keys: "[MouseRight]",
			coords: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
		});
	},
};
