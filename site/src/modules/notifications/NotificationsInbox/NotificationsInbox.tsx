import { useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { watchInboxNotifications } from "#/api/api";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import { inboxNotificationsKey as NOTIFICATIONS_QUERY_KEY } from "#/api/queries/notifications";
import type {
	ListInboxNotificationsResponse,
	UpdateInboxNotificationReadStatusResponse,
} from "#/api/typesGenerated";
import { InboxPopover } from "./InboxPopover";

const NOTIFICATIONS_LIMIT = 25; // This is hard set in the API

type NotificationsInboxProps = {
	defaultOpen?: boolean;
	fetchNotifications: (
		startingBeforeId?: string,
	) => Promise<ListInboxNotificationsResponse>;
	markAllAsRead: () => Promise<void>;
	/** Platform: every notification deleted (PlatformAPI.clearInbox); without it there is no Clear all. */
	clearAll?: () => Promise<{ cleared: number } | unknown>;
	markNotificationAsRead: (
		notificationId: string,
	) => Promise<UpdateInboxNotificationReadStatusResponse>;
};

const WATCH_FAILURES_BEFORE_WARNING = 3;
const WATCH_TOAST_ID = "inbox-watch-unavailable";

export const NotificationsInbox: React.FC<NotificationsInboxProps> = ({
	defaultOpen,
	fetchNotifications,
	markAllAsRead,
	clearAll,
	markNotificationAsRead,
}) => {
	const queryClient = useQueryClient();

	const {
		data: inboxRes,
		error,
		refetch,
	} = useQuery({
		queryKey: NOTIFICATIONS_QUERY_KEY,
		queryFn: () => fetchNotifications(),
	});

	const updateNotificationsCache = useCallback(
		async (
			callback: (
				res: ListInboxNotificationsResponse,
			) => ListInboxNotificationsResponse,
		) => {
			await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
			queryClient.setQueryData<ListInboxNotificationsResponse>(
				NOTIFICATIONS_QUERY_KEY,
				(prev) => {
					if (!prev) {
						return { notifications: [], unread_count: 0 };
					}
					return callback(prev);
				},
			);
		},
		[queryClient],
	);

	// Platform: the live channel reconnects by itself (with backoff) and fetches
	// what it missed. A single failed attempt - a sign-in redirect or a Coder
	// restart cutting connections - is not an error worth telling the user
	// about; only several failures in a row are, and that message goes away
	// once the channel is back.
	useEffect(() => {
		let socket: ReturnType<typeof watchInboxNotifications> | undefined;
		let retryTimer: number | undefined;
		let failures = 0;
		let stopped = false;
		let warned = false;

		const scheduleReconnect = () => {
			socket?.close();
			socket = undefined;
			if (stopped || retryTimer !== undefined) {
				return;
			}
			failures++;
			if (failures >= WATCH_FAILURES_BEFORE_WARNING && !warned) {
				warned = true;
				toast.error("Unable to retrieve latest inbox notifications.", {
					id: WATCH_TOAST_ID,
					description: "Reconnecting...",
				});
			}
			const delay = Math.min(30_000, 1000 * 2 ** (failures - 1));
			retryTimer = window.setTimeout(() => {
				retryTimer = undefined;
				connect();
			}, delay);
		};

		const connect = () => {
			if (stopped) {
				return;
			}
			const ws = watchInboxNotifications({ read_status: "unread" });
			socket = ws;
			ws.addEventListener("open", () => {
				if (failures > 0) {
					// Back after a gap: fetch what arrived meanwhile.
					void queryClient.invalidateQueries({
						queryKey: NOTIFICATIONS_QUERY_KEY,
					});
				}
				failures = 0;
				if (warned) {
					warned = false;
					toast.dismiss(WATCH_TOAST_ID);
				}
			});
			ws.addEventListener("message", (e) => {
				if (e.parseError) {
					console.warn("Error parsing inbox notification: ", e.parseError);
					return;
				}

				const msg = e.parsedMessage;
				updateNotificationsCache((current) => {
					return {
						unread_count: msg.unread_count,
						notifications: [msg.notification, ...current.notifications],
					};
				});
			});
			ws.addEventListener("error", () => {
				if (socket === ws) {
					scheduleReconnect();
				}
			});
			ws.addEventListener("close", () => {
				if (socket === ws) {
					scheduleReconnect();
				}
			});
		};

		connect();
		return () => {
			stopped = true;
			window.clearTimeout(retryTimer);
			socket?.close();
			socket = undefined;
			if (warned) {
				toast.dismiss(WATCH_TOAST_ID);
			}
		};
	}, [updateNotificationsCache, queryClient]);

	const {
		mutate: loadMoreNotifications,
		isPending: isLoadingMoreNotifications,
	} = useMutation({
		mutationFn: async () => {
			if (!inboxRes || inboxRes.notifications.length === 0) {
				return;
			}
			const lastNotification =
				inboxRes.notifications[inboxRes.notifications.length - 1];
			const newRes = await fetchNotifications(lastNotification.id);
			updateNotificationsCache((prev) => {
				return {
					unread_count: newRes.unread_count,
					notifications: [...prev.notifications, ...newRes.notifications],
				};
			});
		},
		onError: (error) => {
			toast.error(getErrorMessage(error, "Error loading more notifications."), {
				description: getErrorDetail(error),
			});
		},
	});

	const markAllAsReadMutation = useMutation({
		mutationFn: markAllAsRead,
		onSuccess: () => {
			const unread = inboxRes?.unread_count ?? 0;
			updateNotificationsCache((prev) => {
				return {
					unread_count: 0,
					notifications: prev.notifications.map((n) => ({
						...n,
						read_at: new Date().toISOString(),
					})),
				};
			});
			// Platform: say it, so the click is seen to work
			toast.success(
				`${unread} notification${unread === 1 ? "" : "s"} marked as read.`,
			);
		},
		onError: (error) => {
			toast.error(
				getErrorMessage(error, "Error on marking all notifications as read."),
				{ description: getErrorDetail(error) },
			);
		},
	});

	// Platform: Clear all empties the Inbox (the notifications are deleted).
	const clearAllMutation = useMutation({
		mutationFn: () => (clearAll ? clearAll() : Promise.resolve()),
		onSuccess: (res) => {
			updateNotificationsCache(() => ({ unread_count: 0, notifications: [] }));
			const n = (res as { cleared?: number } | undefined)?.cleared;
			toast.success(
				typeof n === "number"
					? `Inbox cleared: ${n} notification${n === 1 ? "" : "s"} deleted.`
					: "Inbox cleared.",
			);
		},
		onError: (error) => {
			toast.error(getErrorMessage(error, "Error on clearing the Inbox."), {
				description: getErrorDetail(error),
			});
		},
	});

	const markNotificationAsReadMutation = useMutation({
		mutationFn: markNotificationAsRead,
		onSuccess: (res) => {
			updateNotificationsCache((prev) => {
				return {
					unread_count: res.unread_count,
					notifications: prev.notifications.map((n) => {
						if (n.id !== res.notification.id) {
							return n;
						}
						return res.notification;
					}),
				};
			});
		},
		onError: (error) => {
			toast.error(
				getErrorMessage(error, "Error on marking notification as read."),
				{ description: getErrorDetail(error) },
			);
		},
	});

	return (
		<InboxPopover
			defaultOpen={defaultOpen}
			notifications={inboxRes?.notifications}
			unreadCount={inboxRes?.unread_count ?? 0}
			error={error}
			isLoadingMoreNotifications={isLoadingMoreNotifications}
			hasMoreNotifications={Boolean(
				inboxRes && inboxRes.notifications.length % NOTIFICATIONS_LIMIT === 0,
			)}
			onRetry={refetch}
			onMarkAllAsRead={markAllAsReadMutation.mutate}
			onClearAll={clearAll ? () => clearAllMutation.mutate() : undefined}
			isClearing={clearAllMutation.isPending}
			onMarkNotificationAsRead={markNotificationAsReadMutation.mutate}
			onLoadMoreNotifications={loadMoreNotifications}
		/>
	);
};
