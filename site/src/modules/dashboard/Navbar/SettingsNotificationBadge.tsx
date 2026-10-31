import { useQuery } from "react-query";
import { adminNotes } from "#/api/queries/adminNotes";
import { inboxNotifications } from "#/api/queries/notifications";
import { organizations } from "#/api/queries/organizations";
import { UnreadBadge } from "#/modules/notifications/NotificationsInbox/UnreadBadge";
import {
	unreadTotal,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";
import { usePlatformHealth } from "#/modules/platform/health/usePlatformHealth";
import type { AdminSettingsPermissions } from "./AdminSettings";

/** Remains mounted while Settings is closed, sharing the inbox and notes query caches. */
export const SettingsNotificationBadge = ({
	permissions,
}: {
	permissions?: AdminSettingsPermissions;
}) => {
	const admin = Boolean(permissions?.canEditDeployment);
	const chat = useChatSnapshot();
	const chats = unreadTotal(chat);
	const inbox = useQuery({ ...inboxNotifications(), retry: false });
	const orgs = useQuery({ ...organizations(), enabled: admin });
	const org =
		(orgs.data?.find((org) => org.is_default) ?? orgs.data?.[0])?.id ?? "";
	const notes = useQuery({
		...adminNotes(org),
		enabled: admin && Boolean(org),
		retry: false,
	});
	const report = usePlatformHealth(Boolean(permissions?.canViewHealth), admin);
	const noteCount = admin
		? (notes.data?.notes.filter((note) => note.unread).length ?? 0)
		: 0;
	const total =
		chats + (inbox.data?.unread_count ?? 0) + noteCount + report.issues.length;
	const unknown =
		inbox.isError ||
		(admin && (orgs.isError || notes.isError)) ||
		report.unavailable.length > 0 ||
		report.checks.some((check) => check.severity === "unknown");
	const loading =
		inbox.isLoading ||
		(admin && (orgs.isLoading || (Boolean(org) && notes.isLoading))) ||
		report.loading;
	const label = [
		`${total} Settings notifications`,
		`${chats} unread chats`,
		`${inbox.data?.unread_count ?? 0} unread inbox messages`,
		...(admin ? [`${noteCount} unread shared admin notes`] : []),
		...(admin || permissions?.canViewHealth
			? [`${report.issues.length} infrastructure alerts`]
			: []),
		...report.issues.map(
			(issue) => `${issue.name}: ${issue.detail || issue.severity}`,
		),
		...(unknown
			? ["Some checks unavailable; count includes last known readings."]
			: []),
		...(loading ? ["Checking for updates..."] : []),
	].join("\n");
	if (!total && !unknown && !loading) return null;
	const className = "absolute -top-2 right-0 z-10 pointer-events-auto";
	return total > 0 ? (
		<UnreadBadge
			className={className}
			count={total}
			role="img"
			aria-label={label}
			title={label}
		/>
	) : (
		<span
			className={`${className} rounded bg-surface-secondary px-1 text-2xs text-content-secondary`}
			role="img"
			aria-label={label}
			title={label}
		>
			{unknown ? "?" : "..."}
		</span>
	);
};
