import type { QueryClient, UseQueryOptions } from "react-query";
import {
	type AnnouncementReceiptStatus,
	type Banner,
	type BannerFields,
	type BannerState,
	type ClassificationSettings,
	type KeycloakFix,
	type KeycloakReport,
	type KeycloakSettings,
	type PersistenceFix,
	type PersistenceSettings,
	PlatformAPI,
	type QuotaSettings,
	type SchedulerSettings,
} from "#/api/platform";

const platformKey = ["platform"] as const;

export const classificationKey = [...platformKey, "classification"] as const;
const logoKey = [...platformKey, "logo"] as const;
const myAvatarKey = [...platformKey, "avatar", "me"] as const;
const avatarDefaultsKey = [...platformKey, "avatar", "defaults"] as const;
export const announcementReportKey = [...platformKey, "announcements"] as const;
export const announcementStatusKey = (id: string) =>
	[...announcementReportKey, id, "me"] as const;
export const clusterUsageKey = [...platformKey, "cluster", "usage"] as const;
export const networkReportKey = [...platformKey, "network"] as const;
export const monitoringKey = [...platformKey, "monitoring"] as const;
export const keycloakReportKey = [...platformKey, "keycloak"] as const;
export const persistenceReportKey = [...platformKey, "persistence"] as const;
export const templateIconsKey = [...platformKey, "icons"] as const;
const keycloakStatusKey = [...platformKey, "keycloak", "status"] as const;
const quotaReportKey = [...platformKey, "quota"] as const;
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

export const markAnnouncementViewed = () => ({
	mutationFn: PlatformAPI.markAnnouncementViewed,
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
				{ ...previous, acked: true },
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

const CLUSTER_USAGE_REFRESH_MS = 3_000;

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
		queryClient.setQueryData(bannerKey, state.banner);
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

export const updateQuota = (queryClient: QueryClient) => ({
	mutationFn: (settings: QuotaSettings) => PlatformAPI.updateQuota(settings),
	onSuccess: async () => {
		await queryClient.invalidateQueries({ queryKey: quotaReportKey });
	},
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
