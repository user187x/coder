import { useMemo } from "react";
import { useQuery } from "react-query";
import type { OnlineUser } from "#/api/platform";
import { onlineUsers } from "#/api/queries/platform";
import type { User } from "#/api/typesGenerated";
import { useChatSnapshot } from "#/modules/platform/chat/chatStore";

export function useAccountPresence(enabled: boolean) {
	const { presenceVersion } = useChatSnapshot();
	const query = useQuery({ ...onlineUsers(presenceVersion), enabled });
	const users = useMemo(() => {
		const peers = new Map<string, OnlineUser>();
		for (const peer of [
			...(query.data?.recent ?? []),
			...(query.data?.online ?? []),
		])
			peers.set(peer.id, peer);
		return peers;
	}, [query.data]);
	return {
		users,
		generatedAt: query.data?.generatedAt,
		loading: enabled && query.isLoading,
		stale: query.isError,
	};
}

export const AccountPresence: React.FC<{
	user: Pick<User, "id" | "status" | "last_seen_at">;
	presence: ReturnType<typeof useAccountPresence>;
}> = ({ user, presence }) => {
	const peer = presence.users.get(user.id);
	const online = peer !== undefined && peer.status !== "offline";
	const lastSeen = peer?.lastSeen ?? user.last_seen_at;
	const date = lastSeen ? new Date(lastSeen) : null;
	const timestamp =
		date && Number.isFinite(date.getTime()) && date.getFullYear() > 1970
			? date.toLocaleString("en-US", {
					month: "short",
					day: "numeric",
					hour: "numeric",
					minute: "2-digit",
				})
			: "Never";
	const accountDisabled = user.status !== "active" && user.status !== "dormant";
	const status = online
		? peer.status === "idle"
			? "Idle"
			: "Online"
		: "Offline";
	return (
		<div className="flex flex-col gap-0.5 text-xs normal-case">
			<span>
				{accountDisabled
					? user.status
					: presence.loading
						? "Checking…"
						: !presence.generatedAt
							? "Presence unavailable"
							: presence.stale
								? `Last known: ${status}`
								: status}
			</span>
			{!online && (
				<span
					className="text-[10px] text-content-secondary"
					title={timestamp === "Never" ? undefined : (lastSeen ?? undefined)}
				>
					Last seen
					<br />
					{timestamp}
				</span>
			)}
		</div>
	);
};
