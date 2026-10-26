import type { QueryClient, UseMutationOptions } from "react-query";
import { API } from "#/api/api";
import { PlatformAPI } from "#/api/platform";
import type {
	NotificationPreference,
	NotificationTemplate,
	UpdateNotificationTemplateMethod,
	UpdateUserNotificationPreferences,
} from "#/api/typesGenerated";

export const userNotificationPreferencesKey = (userId: string) => [
	"users",
	userId,
	"notifications",
	"preferences",
];

export const userNotificationPreferences = (userId: string) => {
	return {
		queryKey: userNotificationPreferencesKey(userId),
		queryFn: () => API.getUserNotificationPreferences(userId),
	};
};

export const updateUserNotificationPreferences = (
	userId: string,
	queryClient: QueryClient,
) => {
	return {
		mutationFn: (req) => {
			return API.putUserNotificationPreferences(userId, req);
		},
		onMutate: (data) => {
			queryClient.setQueryData(
				userNotificationPreferencesKey(userId),
				Object.entries(data.template_disabled_map).map(
					([id, disabled]) =>
						({
							id,
							disabled,
							updated_at: new Date().toISOString(),
						}) satisfies NotificationPreference,
				),
			);
		},
	} satisfies UseMutationOptions<
		NotificationPreference[],
		unknown,
		UpdateUserNotificationPreferences
	>;
};

export const systemNotificationTemplatesKey = [
	"notifications",
	"templates",
	"system",
];

export const systemNotificationTemplates = () => {
	return {
		queryKey: systemNotificationTemplatesKey,
		queryFn: () => API.getSystemNotificationTemplates(),
	};
};

export const customNotificationTemplatesKey = [
	"notifications",
	"templates",
	"custom",
];

export const customNotificationTemplates = () => {
	return {
		queryKey: customNotificationTemplatesKey,
		queryFn: () => API.getCustomNotificationTemplates(),
	};
};

export function selectTemplatesByGroup(
	data: NotificationTemplate[],
): Record<string, NotificationTemplate[]> {
	const grouped: Record<string, NotificationTemplate[]> = {};
	for (const template of data) {
		if (!grouped[template.group]) {
			grouped[template.group] = [];
		}
		grouped[template.group].push(template);
	}

	// Sort groups by name, and sort templates within each group
	const sortedGroups = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
	const sortedGrouped: Record<string, NotificationTemplate[]> = {};
	for (const group of sortedGroups) {
		sortedGrouped[group] = grouped[group].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	}

	return sortedGrouped;
}

export const notificationDispatchMethodsKey = [
	"notifications",
	"dispatchMethods",
];

export const notificationDispatchMethods = () => {
	return {
		staleTime: Number.POSITIVE_INFINITY,
		queryKey: notificationDispatchMethodsKey,
		queryFn: () => API.getNotificationDispatchMethods(),
	};
};

export const updateNotificationTemplateMethod = (
	templateId: string,
	queryClient: QueryClient,
) => {
	return {
		mutationFn: (req: UpdateNotificationTemplateMethod) =>
			API.updateNotificationTemplateMethod(templateId, req),
		onMutate: (data) => {
			const keys = [
				systemNotificationTemplatesKey,
				customNotificationTemplatesKey,
			];

			for (const key of keys) {
				const prev = queryClient.getQueryData<NotificationTemplate[]>(key);
				if (!prev) {
					continue;
				}

				queryClient.setQueryData(
					key,
					prev.map((tpl) =>
						tpl.id === templateId ? { ...tpl, method: data.method } : tpl,
					),
				);
			}
		},
	} satisfies UseMutationOptions<
		void,
		unknown,
		UpdateNotificationTemplateMethod
	>;
};

export const disableNotification = (
	userId: string,
	queryClient: QueryClient,
) => {
	return {
		mutationFn: async (templateId: string) => {
			const result = await API.putUserNotificationPreferences(userId, {
				template_disabled_map: {
					[templateId]: true,
				},
			});
			return result;
		},
		onSuccess: (data) => {
			queryClient.setQueryData(userNotificationPreferencesKey(userId), data);
		},
	} satisfies UseMutationOptions<NotificationPreference[], unknown, string>;
};

export const inboxNotificationsKey = ["notifications"];
export const inboxNotifications = () => ({
	queryKey: inboxNotificationsKey,
	queryFn: () => API.getInboxNotifications(),
	refetchInterval: 15000,
});
export const deleteInboxNotifications = (client: QueryClient) => ({
	mutationFn: async (ids: string[] | null) => {
		if (ids === null) return PlatformAPI.clearInbox();
		let cleared = 0;
		for (let offset = 0; offset < ids.length; offset += 100)
			cleared += (
				await PlatformAPI.deleteInboxNotifications(
					ids.slice(offset, offset + 100),
				)
			).cleared;
		return { cleared };
	},
	onSettled: () =>
		client.invalidateQueries({ queryKey: inboxNotificationsKey }),
});
export const markInboxNotificationRead = (client: QueryClient) => ({
	mutationFn: (id: string) =>
		API.updateInboxNotificationReadStatus(id, { is_read: true }),
	onSettled: () =>
		client.invalidateQueries({ queryKey: inboxNotificationsKey }),
});

export const loadAllInboxNotifications = (client: QueryClient) => ({
	mutationFn: async () => {
		const result = await API.getInboxNotifications();
		const notifications = [...result.notifications];
		const ids = new Set(result.notifications.map((n) => n.id));
		let page = result.notifications;
		while (page.length === 25) {
			const last = page.at(-1);
			if (!last) break;
			const next = await API.getInboxNotifications(last.id);
			page = next.notifications.filter((n) => !ids.has(n.id));
			for (const n of page) ids.add(n.id);
			notifications.push(...page);
		}
		return { ...result, notifications };
	},
	onSuccess: (result: Awaited<ReturnType<typeof API.getInboxNotifications>>) =>
		client.setQueryData(inboxNotificationsKey, result),
});
