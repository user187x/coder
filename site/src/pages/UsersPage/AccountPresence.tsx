import { useQuery } from "react-query";
import { onlineUsers } from "#/api/queries/platform";
import type { User } from "#/api/typesGenerated";

export const AccountPresence: React.FC<{
	user: Pick<User, "id" | "status" | "last_seen_at">;
	enabled: boolean;
}> = ({ user, enabled }) => {
	const presence = useQuery({ ...onlineUsers(), enabled });
	const peer = presence.data?.online.find((person) => person.id === user.id);
	const recent = presence.data?.recent.find((person) => person.id === user.id);
	const online = peer !== undefined && peer.status !== "offline";
	const lastSeen = recent?.lastSeen ?? peer?.lastSeen ?? user.last_seen_at;
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
	return (
		<div className="flex flex-col gap-0.5 text-xs normal-case">
			<span>
				{accountDisabled
					? user.status
					: !enabled || !presence.data || presence.isError
						? "Presence unavailable"
						: online
							? peer.status === "idle"
								? "Idle"
								: "Online"
							: "Offline"}
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
