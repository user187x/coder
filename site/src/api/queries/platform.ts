import {
	keepPreviousData,
	type Query,
	type QueryClient,
	type UseQueryOptions,
} from "react-query";
import {
	type AnnouncementReceiptStatus,
	type Banner,
	type BannerFields,
	type BannerState,
	type ClassificationSettings,
	type CloudDriveConnections,
	type CloudDriveEncryption,
	type CloudDrivePeers,
	type HudRange,
	type KeycloakFix,
	type KeycloakReport,
	type KeycloakSettings,
	type LoginPageSettings,
	type PersistenceFix,
	type PersistenceSettings,
	PlatformAPI,
	type QuotaSettings,
	type SchedulerSettings,
} from "#/api/platform";
import {
	ATTACHMENT_REFRESH_MS,
	pendingAttachments,
} from "#/modules/platform/cloudDrive/attachment";

const platformKey = ["platform"] as const;

export const dashboardAddress = () => ({
	queryKey: [...platformKey, "dashboard-address"],
	queryFn: PlatformAPI.getDashboardAddress,
	staleTime: 60_000,
	retry: false,
});

export const classificationKey = [...platformKey, "classification"] as const;
const logoKey = [...platformKey, "logo"] as const;
const myAvatarKey = [...platformKey, "avatar", "me"] as const;
const avatarDefaultsKey = [...platformKey, "avatar", "defaults"] as const;
export const announcementReportKey = [...platformKey, "announcements"] as const;
export const announcementStatusKey = (id: string) =>
	[...announcementReportKey, id, "me"] as const;
export const clusterUsageKey = [...platformKey, "cluster", "usage"] as const;
export const safeKey = [...platformKey, "safe"] as const;
export const networkReportKey = [...platformKey, "network"] as const;
export const monitoringKey = [...platformKey, "monitoring"] as const;
export const keycloakReportKey = [...platformKey, "keycloak"] as const;
export const persistenceReportKey = [...platformKey, "persistence"] as const;
export const templateIconsKey = [...platformKey, "icons"] as const;
const keycloakStatusKey = [...platformKey, "keycloak", "status"] as const;
export const quotaReportKey = [...platformKey, "quota"] as const;
export const quotaMeKey = [...platformKey, "quota", "me"] as const;
const schedulerReportKey = [...platformKey, "scheduler"] as const;
export const schedulerMeKey = [...platformKey, "scheduler", "me"] as const;
const certificatesKey = [...platformKey, "certificates"] as const;
const chatAdminsKey = [...platformKey, "chat", "admins"] as const;
export const bannerKey = ["banner"] as const;
export const bannerStateKey = [...bannerKey, "state"] as const;

/** The classification marking is re-read this often, so a change reaches every open page. */
const CLASSIFICATION_REFRESH_MS = 30_000;

export const classification = (
	initialData?: ClassificationSettings,
): UseQueryOptions<ClassificationSettings> => ({
	queryKey: classificationKey,
	queryFn: PlatformAPI.getClassification,
	initialData,
	refetchInterval: CLASSIFICATION_REFRESH_MS,
	refetchOnWindowFocus: true,
});

export const updateClassification = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.updateClassification,
	onSuccess: (settings: ClassificationSettings) => {
		queryClient.setQueryData(classificationKey, settings);
	},
});

export const loginPageKey = [...platformKey, "login-page"] as const;

/** The sign-in page's settings (public: the page reads them before anyone signs in). */
export const loginPage = (
	initialData?: LoginPageSettings,
): UseQueryOptions<LoginPageSettings> => ({
	queryKey: loginPageKey,
	queryFn: PlatformAPI.getLoginPage,
	initialData,
	staleTime: 30_000,
});

export const updateLoginPage = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.updateLoginPage,
	onSuccess: (settings: LoginPageSettings) => {
		queryClient.setQueryData(loginPageKey, settings);
	},
});

export const logo = () => ({
	queryKey: logoKey,
	queryFn: PlatformAPI.getLogo,
});

export const uploadLogo = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.uploadLogo,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: logoKey });
	},
});

export const resetLogo = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.resetLogo,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: logoKey });
	},
});

export const myAvatar = () => ({
	queryKey: myAvatarKey,
	queryFn: PlatformAPI.getMyAvatar,
});

export const avatarDefaults = () => ({
	queryKey: avatarDefaultsKey,
	queryFn: PlatformAPI.getAvatarDefaults,
	staleTime: Number.POSITIVE_INFINITY,
	retry: false,
});

export const uploadAvatar = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.uploadAvatar,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: myAvatarKey });
	},
});

export const resetAvatar = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.resetAvatar,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: myAvatarKey });
	},
});

export const announcementStatus = (
	id: string,
): UseQueryOptions<AnnouncementReceiptStatus> => ({
	queryKey: announcementStatusKey(id),
	queryFn: () => PlatformAPI.getAnnouncementStatus(id),
	staleTime: Number.POSITIVE_INFINITY,
});

export const markAnnouncementViewed = (queryClient?: QueryClient) => ({
	mutationFn: PlatformAPI.markAnnouncementViewed,
	// The view is on record now: fetch its time for the banner's "Viewed" box.
	onSuccess: (_data: unknown, id: string) =>
		queryClient?.invalidateQueries({ queryKey: announcementStatusKey(id) }),
});

export const confirmAnnouncement = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.confirmAnnouncement,
	onMutate: (id: string) => {
		const previous = queryClient.getQueryData<AnnouncementReceiptStatus>(
			announcementStatusKey(id),
		);
		if (previous?.signedIn) {
			queryClient.setQueryData<AnnouncementReceiptStatus>(
				announcementStatusKey(id),
				{
					...previous,
					acked: true,
					ackedAt: previous.ackedAt ?? new Date().toISOString(),
				},
			);
		}
		return { previous };
	},
	onError: (
		_error: unknown,
		id: string,
		context: { previous: AnnouncementReceiptStatus | undefined } | undefined,
	) => {
		queryClient.setQueryData(announcementStatusKey(id), context?.previous);
	},
});

const ANNOUNCEMENT_REPORT_REFRESH_MS = 15_000;

export const announcementReport = () => ({
	queryKey: announcementReportKey,
	queryFn: PlatformAPI.getAnnouncementReport,
	refetchInterval: ANNOUNCEMENT_REPORT_REFRESH_MS,
});

export const deleteAnnouncementEvent = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.deleteAnnouncementEvent,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: announcementReportKey });
	},
});

export const clearAnnouncementEvents = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.clearAnnouncementEvents,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: announcementReportKey });
	},
});

const CLUSTER_USAGE_REFRESH_MS = 3_000;

/** The caller's Cloud Drive; no retry on 404 (the deployment has none). */
export const safe = () => ({
	queryKey: safeKey,
	queryFn: PlatformAPI.getSafe,
	retry: false,
	staleTime: 30_000,
});

/** The Cloud Drive's backend and its connection, checked again every half minute. */
export const cloudDriveSettings = () => ({
	queryKey: [...safeKey, "settings"],
	queryFn: () => PlatformAPI.cloudDriveSettings(),
	retry: false,
	refetchInterval: 30_000,
});

/** The caller's own drive's transfers, asked every second (the pill's light flashing while it transfers). */
export const cloudDriveActivity = (enabled: boolean) => ({
	queryKey: [...safeKey, "activity"],
	queryFn: PlatformAPI.getCloudDriveActivity,
	enabled,
	retry: false,
	refetchInterval: 1000,
});

const cloudDriveConnectionsKey = [...safeKey, "connections"] as const;
/** Which of the caller's workspaces are disconnected from their Cloud Drive, and how it is in each started one: every
 * two seconds while one of them waits for it to attach. */
export const cloudDriveConnections = (enabled = true) => ({
	queryKey: cloudDriveConnectionsKey,
	queryFn: PlatformAPI.getCloudDriveConnections,
	enabled,
	retry: false,
	refetchInterval: (query: Query<CloudDriveConnections>) =>
		pendingAttachments(query.state.data).length > 0
			? ATTACHMENT_REFRESH_MS
			: 30_000,
});

export const setCloudDriveConnection = (queryClient: QueryClient) => ({
	mutationFn: ({
		workspaceId,
		connected,
	}: {
		workspaceId: string;
		connected: boolean;
	}) => PlatformAPI.setCloudDriveConnection(workspaceId, connected),
	onMutate: async ({
		workspaceId,
		connected,
	}: {
		workspaceId: string;
		connected: boolean;
	}) => {
		// The cable moved already: the list says so at once.
		await queryClient.cancelQueries({ queryKey: cloudDriveConnectionsKey });
		const before = queryClient.getQueryData<CloudDriveConnections>(
			cloudDriveConnectionsKey,
		);
		if (before) {
			const others = before.disconnected.filter((id) => id !== workspaceId);
			queryClient.setQueryData<CloudDriveConnections>(
				cloudDriveConnectionsKey,
				{
					...before,
					disconnected: connected ? others : [...others, workspaceId],
				},
			);
		}
		return { before };
	},
	onError: (
		_error: unknown,
		_vars: unknown,
		context?: { before?: CloudDriveConnections },
	) => {
		if (context?.before) {
			queryClient.setQueryData(cloudDriveConnectionsKey, context.before);
		}
	},
	onSuccess: (result: CloudDriveConnections) => {
		const {
			workspace: _w,
			connected: _c,
			applied: _a,
			...connections
		} = result as CloudDriveConnections & Record<string, unknown>;
		queryClient.setQueryData<CloudDriveConnections>(
			cloudDriveConnectionsKey,
			connections,
		);
	},
});

const cloudDriveEncryptionKey = [...safeKey, "encryption"] as const;
/** The caller's Cloud Drive encryption; every two seconds while it re-encrypts. */
export const cloudDriveEncryption = (enabled = true) => ({
	queryKey: cloudDriveEncryptionKey,
	queryFn: PlatformAPI.getCloudDriveEncryption,
	enabled,
	retry: false,
	refetchInterval: (query: { state: { data?: CloudDriveEncryption } }) =>
		query.state.data?.state === "encrypting" ||
		query.state.data?.state === "decrypting"
			? 2_000
			: 30_000,
});

/** Cloud Drives shared between users: the settings, the caller's shares, and (admins) everyone's. */
export const cloudDrivePeersKey = [...safeKey, "peers"] as const;
export const cloudDrivePeers = (enabled = true) => ({
	queryKey: cloudDrivePeersKey,
	queryFn: PlatformAPI.getCloudDrivePeers,
	enabled,
	retry: false,
	refetchInterval: 15_000,
});

export const setCloudDriveShareConnection = (queryClient: QueryClient) => ({
	mutationFn: ({ id, connected }: { id: string; connected: boolean }) =>
		PlatformAPI.setCloudDriveShareConnection(id, connected),
	onSuccess: (result: CloudDrivePeers) => {
		queryClient.setQueryData(cloudDrivePeersKey, result);
	},
	onSettled: () => queryClient.invalidateQueries({ queryKey: safeKey }),
});

/** After an encryption or source change: everything about the Cloud Drive read again. */
export const invalidateCloudDrive = (queryClient: QueryClient) =>
	queryClient.invalidateQueries({ queryKey: safeKey });

export const cloudDriveSourceGuard = (
	workspaceId: string,
	enabled: boolean,
) => ({
	queryKey: [...safeKey, "source-guard", workspaceId],
	queryFn: () => PlatformAPI.getCloudDriveSourceGuard(workspaceId),
	enabled,
	retry: false,
});

/** drive: a Cloud Drive shared with the caller (its owner's id), else theirs. */
export const safeListing = (path: string, enabled: boolean, drive = "") => ({
	queryKey: [...safeKey, "list", drive, path],
	queryFn: () => PlatformAPI.listSafe(path, drive || undefined),
	enabled,
	retry: false,
});

/** What is shared with the caller at a glance (a card of it; share: one share, else the owner's entire drive). */
export const cloudDriveGlance = (
	drive: string,
	enabled: boolean,
	share?: string,
) => ({
	queryKey: [...safeKey, "glance", drive, share ?? ""],
	queryFn: () => PlatformAPI.getCloudDriveGlance(drive, share),
	enabled,
	retry: false,
	staleTime: 15_000,
});

/** Whom one can share with (the share dialog, while it is open). */
export const cloudDrivePeople = (enabled: boolean) => ({
	queryKey: [...safeKey, "people"],
	queryFn: PlatformAPI.getCloudDrivePeople,
	enabled,
	retry: false,
	staleTime: 60_000,
});

export const clusterUsage = () => ({
	queryKey: clusterUsageKey,
	queryFn: PlatformAPI.getClusterUsage,
	refetchInterval: CLUSTER_USAGE_REFRESH_MS,
	retry: false,
});

const NETWORK_REFRESH_MS = 5_000;

export const networkReport = (paused: boolean) => ({
	queryKey: networkReportKey,
	queryFn: PlatformAPI.getNetworkReport,
	refetchInterval: paused ? (false as const) : NETWORK_REFRESH_MS,
});

const MONITORING_REFRESH_MS = 20_000;

export const monitoring = () => ({
	queryKey: monitoringKey,
	queryFn: PlatformAPI.getMonitoring,
	refetchInterval: MONITORING_REFRESH_MS,
});

const KEYCLOAK_SETTLING_POLL_MS = 8_000;

/** Coder is restarting with new sign-in settings. */
const isKeycloakSettling = (report: KeycloakReport | undefined) =>
	Boolean(
		report?.checks.some(
			(c) =>
				c.id === "coder.rollout" ||
				(c.id === "coder.live" && c.status !== "ok"),
		),
	);

/** While Coder restarts with new settings, the report is re-read every few seconds. */
export const keycloakReport = (): UseQueryOptions<KeycloakReport> => ({
	queryKey: keycloakReportKey,
	queryFn: PlatformAPI.getKeycloakReport,
	refetchInterval: (query) =>
		isKeycloakSettling(query.state.data) ? KEYCLOAK_SETTLING_POLL_MS : false,
});

export const applyKeycloakFixes = (queryClient: QueryClient) => ({
	mutationFn: ({
		fixes,
		settings,
	}: {
		fixes: readonly KeycloakFix[];
		settings: KeycloakSettings;
	}) => PlatformAPI.applyKeycloakFixes(fixes, settings),
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: keycloakReportKey });
	},
});

export const connectKeycloak = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.connectKeycloak,
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: keycloakReportKey });
	},
});

export const undoKeycloakChange = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.undoKeycloakChange,
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: keycloakReportKey });
	},
});

const CHAT_ADMINS_STALE_MS = 60_000;

/**
 * The admins a developer may write to. `availabilityVersion` changes whenever
 * an admin turns chat on or off, which makes the list stale at once.
 */
export const chatAdmins = (availabilityVersion: number) => ({
	queryKey: [...chatAdminsKey, availabilityVersion],
	queryFn: async () => (await PlatformAPI.getChatAdmins()).admins,
	staleTime: CHAT_ADMINS_STALE_MS,
});

const CHAT_PEOPLE_REFRESH_MS = 20_000;
const chatPeopleKey = [...platformKey, "chat", "people"] as const;

/** Who is online or active today (peer-to-peer chat; admins: everyone, the invisible marked). */
/** The People list: asked again when availability changes, and whenever someone comes, goes idle or leaves. */
export const chatPeople = (
	availabilityVersion: number,
	presenceVersion = 0,
) => ({
	queryKey: [...chatPeopleKey, availabilityVersion, presenceVersion],
	queryFn: PlatformAPI.getChatPeople,
	refetchInterval: CHAT_PEOPLE_REFRESH_MS,
	placeholderData: (
		previous?: Awaited<ReturnType<typeof PlatformAPI.getChatPeople>>,
	) => previous,
});

const chatSettingsKey = [...platformKey, "chat", "settings"] as const;
export const chatSettings = () => ({
	queryKey: chatSettingsKey,
	queryFn: PlatformAPI.getChatSettings,
	refetchInterval: 30_000,
});

export const saveChatSettings = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.saveChatSettings,
	onSuccess: (
		settings: Awaited<ReturnType<typeof PlatformAPI.getChatSettings>>,
	) => {
		queryClient.setQueryData(chatSettingsKey, settings);
	},
});

export const purgeChats = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.purgeChats,
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: chatSettingsKey });
		await queryClient.invalidateQueries({ queryKey: chatPairsKey });
	},
});

const chatPairsKey = [...platformKey, "chat", "pairs"] as const;
/** How many pairs a page of Who talks to whom shows. */
export const CHAT_PAIRS_PAGE = 25;
/** Which developers talk to each other (never what they wrote): a page of them, newest first (page 1: the latest). */
export const chatPairs = (page = 1) => ({
	queryKey: [...chatPairsKey, page],
	queryFn: () => PlatformAPI.getChatPairs((page - 1) * CHAT_PAIRS_PAGE),
	refetchInterval: 30_000,
	placeholderData: keepPreviousData,
});

/** The workspace's network traffic so far (the last minutes): read once, the page goes on from the live readings. */
export const workspaceNetwork = (workspaceId: string) => ({
	queryKey: [...platformKey, "network", workspaceId] as const,
	queryFn: () => PlatformAPI.getWorkspaceNetwork(workspaceId),
	staleTime: Number.POSITIVE_INFINITY,
	refetchOnWindowFocus: false,
	retry: false,
});

/** Admin Controls > Online Users: asked again every few seconds while the page is open. */
export const onlineUsers = () => ({
	queryKey: [...platformKey, "presence"] as const,
	queryFn: PlatformAPI.getPresence,
	refetchInterval: 3_000,
	refetchIntervalInBackground: false,
});

// While the live channel is up, polling only guards against a missed push.
const BANNER_SLOW_POLL_MS = 300_000;
const BANNER_MIN_POLL_SECONDS = 15;

/**
 * The live announcement. Pushed changes (bannerLiveURL) are written into this
 * query; without the live channel it is polled as often as the admin set.
 */
export const banner = (live: boolean): UseQueryOptions<Banner> => ({
	queryKey: bannerKey,
	queryFn: PlatformAPI.getBanner,
	refetchInterval: (query) =>
		live
			? BANNER_SLOW_POLL_MS
			: Math.max(
					BANNER_MIN_POLL_SECONDS,
					Number(query.state.data?.refreshSeconds) || 60,
				) * 1000,
	refetchOnWindowFocus: true,
});

export const bannerState = () => ({
	queryKey: bannerStateKey,
	queryFn: PlatformAPI.getBannerState,
	refetchInterval: 15_000,
});

const onBannerChange =
	(queryClient: QueryClient) => async (state: BannerState) => {
		queryClient.setQueryData(bannerStateKey, state);
		await queryClient.invalidateQueries({ queryKey: bannerKey, exact: true });
		await queryClient.invalidateQueries({ queryKey: announcementReportKey });
	};

export const publishBanner = (queryClient: QueryClient) => ({
	mutationFn: (fields: BannerFields) => PlatformAPI.publishBanner(fields),
	onSuccess: onBannerChange(queryClient),
});

export const reshowBanner = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.reshowBanner,
	onSuccess: onBannerChange(queryClient),
});

export const resetBanner = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.resetBanner,
	onSuccess: onBannerChange(queryClient),
});

const PERSISTENCE_REFRESH_MS = 10_000;

/** The database map is live: re-read every 10 seconds unless paused. */
export const persistenceReport = (paused: boolean) => ({
	queryKey: persistenceReportKey,
	queryFn: PlatformAPI.getPersistenceReport,
	refetchInterval: paused ? (false as const) : PERSISTENCE_REFRESH_MS,
});

export const applyPersistenceFixes = (queryClient: QueryClient) => ({
	mutationFn: ({
		fixes,
		settings,
	}: {
		fixes: readonly PersistenceFix[];
		settings: PersistenceSettings;
	}) => PlatformAPI.applyPersistenceFixes(fixes, settings),
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: persistenceReportKey });
	},
});

/** Icons uploaded for templates; empty (not an error to show) where the platform service is absent. */
export const templateIcons = () => ({
	queryKey: templateIconsKey,
	queryFn: PlatformAPI.getTemplateIcons,
	staleTime: 60_000,
	retry: false,
});

export const uploadTemplateIcon = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.uploadTemplateIcon,
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: templateIconsKey });
	},
});

export const deleteTemplateIcon = (queryClient: QueryClient) => ({
	mutationFn: PlatformAPI.deleteTemplateIcon,
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: templateIconsKey });
	},
});

const KEYCLOAK_STATUS_REFRESH_MS = 60_000;

/** Whether the add-on service is connected to Keycloak (a check next to Authentication). */
export const keycloakStatus = () => ({
	queryKey: keycloakStatusKey,
	queryFn: PlatformAPI.getKeycloakStatus,
	refetchInterval: KEYCLOAK_STATUS_REFRESH_MS,
	retry: false,
});

const QUOTA_REFRESH_MS = 30_000;

export const quotaReport = () => ({
	queryKey: quotaReportKey,
	queryFn: PlatformAPI.getQuotaReport,
	refetchInterval: QUOTA_REFRESH_MS,
});

/** The signed-in user's own limits and what their workspaces take (the Workspaces page's quota pill). */
export const quotaMe = () => ({
	queryKey: quotaMeKey,
	queryFn: PlatformAPI.getQuotaMe,
	refetchInterval: 10_000, // the Workspaces table's own idle refresh
	retry: false,
});

const provisionersKey = [...platformKey, "provisioners"] as const;

/** Coder's provisioner daemons, their jobs and terraform processes, refreshed while shown. */
export const provisioners = () => ({
	queryKey: provisionersKey,
	queryFn: PlatformAPI.getProvisioners,
	refetchInterval: 15_000,
});

export const rekickProvisioners = (queryClient: QueryClient) => ({
	mutationFn: (jobs: string[]) => PlatformAPI.rekickProvisioners(jobs),
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: provisionersKey });
	},
});

export const restartCoderPod = (queryClient: QueryClient) => ({
	mutationFn: (pod: string) => PlatformAPI.restartCoderPod(pod),
	onSettled: async () => {
		await queryClient.invalidateQueries({ queryKey: provisionersKey });
	},
});

export const updateQuota = (queryClient: QueryClient) => ({
	mutationFn: (settings: QuotaSettings) => PlatformAPI.updateQuota(settings),
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: quotaReportKey });
		await queryClient.invalidateQueries({ queryKey: quotaMeKey });
	},
});

export const HUD_REFRESH_MS = 10_000;

/** The HUD's figures, refreshed while the page is open. */
export const hudHistory = (range: HudRange) => ({
	queryKey: [...platformKey, "hud", "history", range] as const,
	queryFn: () => PlatformAPI.getHudHistory(range),
	refetchInterval: HUD_REFRESH_MS,
	placeholderData: keepPreviousData,
});

export const hud = () => ({
	queryKey: [...platformKey, "hud"] as const,
	queryFn: PlatformAPI.getHud,
	refetchInterval: HUD_REFRESH_MS,
	refetchIntervalInBackground: false,
});

/** General > Monitoring's zero-trust checks; the service caches them for 30 seconds. */
export const monitoringPosture = () => ({
	queryKey: [...platformKey, "monitoring", "posture"] as const,
	queryFn: PlatformAPI.getMonitoringPosture,
	refetchInterval: 60_000,
});

export const schedulerReport = () => ({
	queryKey: schedulerReportKey,
	queryFn: PlatformAPI.getSchedulerReport,
	refetchInterval: QUOTA_REFRESH_MS,
});

export const updateScheduler = (queryClient: QueryClient) => ({
	mutationFn: (settings: SchedulerSettings) =>
		PlatformAPI.updateScheduler(settings),
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: schedulerReportKey });
		await queryClient.invalidateQueries({ queryKey: schedulerMeKey });
	},
});

/** The scheduler's rules for the signed-in user and their workspaces (the dashboard's gate). */
export const schedulerMe = () => ({
	queryKey: schedulerMeKey,
	queryFn: PlatformAPI.getSchedulerMe,
	refetchInterval: 60_000,
	retry: false,
});

/** The probes take several seconds; the service caches the result for 10 minutes. */
export const certificates = () => ({
	queryKey: certificatesKey,
	queryFn: () => PlatformAPI.getCertificates(),
	staleTime: 5 * 60_000,
	retry: false,
});

export const refreshCertificates = (queryClient: QueryClient) => ({
	mutationFn: () => PlatformAPI.getCertificates(true),
	onSuccess: (
		data: Awaited<ReturnType<typeof PlatformAPI.getCertificates>>,
	) => {
		queryClient.setQueryData(certificatesKey, data);
	},
});

export const notesByUserKey = [...platformKey, "notes", "by-user"] as const;
export const notesByUser = () => ({
	queryKey: notesByUserKey,
	queryFn: PlatformAPI.getNotesByUser,
	refetchInterval: 60_000,
	retry: false,
});

export const enableCloudDriveSharing = (client: QueryClient) => ({
	mutationFn: () => PlatformAPI.saveCloudDrivePeerSettings({ enabled: true }),
	onSuccess: (data: CloudDrivePeers) =>
		client.setQueryData(cloudDrivePeersKey, data),
});

export type CloudDriveRecipient = {
	key: string;
	label: string;
	userId: string;
	workspaceId?: string;
};

export const shareCloudDriveItems = (client: QueryClient) => ({
	mutationFn: async ({
		recipients,
		path,
		access,
	}: {
		recipients: CloudDriveRecipient[];
		path: string;
		access: "read" | "write";
	}) => {
		const failed: { recipient: CloudDriveRecipient; error: unknown }[] = [];
		for (const recipient of recipients) {
			try {
				if (recipient.workspaceId) {
					await PlatformAPI.shareCloudDrive(
						recipient.userId,
						path,
						access,
						recipient.workspaceId,
					);
				} else {
					await PlatformAPI.shareCloudDrive(recipient.userId, path, access);
				}
			} catch (error) {
				failed.push({ recipient, error });
			}
		}
		return { failed, succeeded: recipients.length - failed.length };
	},
	onSettled: () => client.invalidateQueries({ queryKey: cloudDrivePeersKey }),
});

export const revokeCloudDriveShare = (client: QueryClient) => ({
	mutationFn: PlatformAPI.endCloudDriveShare,
	onSuccess: (data: CloudDrivePeers) =>
		client.setQueryData(cloudDrivePeersKey, data),
	onSettled: () => client.invalidateQueries({ queryKey: cloudDrivePeersKey }),
});

export const workspaceResourceHistory = (
	workspaceId: string,
	seconds = 300,
	buckets = 12,
) => ({
	queryKey: [
		...platformKey,
		"workspace-resources",
		workspaceId,
		seconds,
		buckets,
	] as const,
	queryFn: () =>
		PlatformAPI.getWorkspaceResourceHistory(workspaceId, seconds, buckets),
	refetchInterval: 5000,
});
export const userUIPreferences = () => ({
	queryKey: [...platformKey, "user-ui-preferences"] as const,
	queryFn: PlatformAPI.getUserUIPreferences,
});
export const updateUserUIPreferences = (client: QueryClient) => ({
	mutationFn: PlatformAPI.setUserUIPreferences,
	onSuccess: (
		settings: Awaited<ReturnType<typeof PlatformAPI.getUserUIPreferences>>,
	) => client.setQueryData(userUIPreferences().queryKey, settings),
});
