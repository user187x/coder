import { EyeOffIcon, MessageSquareIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import type { OnlineUser } from "#/api/platform";
import { onlineUsers } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { PresenceAvatar } from "#/modules/platform/chat/ChatPeople";
import {
	displayName,
	openChatWith,
	useChatSnapshot,
} from "#/modules/platform/chat/chatStore";
import { pageTitle } from "#/utils/page";

const card =
	"flex flex-col gap-3 rounded-lg border border-solid border-border p-6";

/** "now", "40 s", "3 min", "2 h 5 min": how long ago (or for how long) from the report's own clock. */
export const sinceText = (iso: string | null, now: number) => {
	if (!iso) {
		return "—";
	}
	const seconds = Math.max(
		0,
		Math.round((now - new Date(iso).getTime()) / 1000),
	);
	if (seconds < 5) {
		return "now";
	}
	if (seconds < 60) {
		return `${seconds} s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours < 24) {
		return rest ? `${hours} h ${rest} min` : `${hours} h`;
	}
	return `${Math.floor(hours / 24)} d ${hours % 24} h`;
};

/**
 * Admin Controls > Online Users: everyone with a Coder tab open now (active,
 * or idle: grey after 30 seconds without input), how many tabs, since when,
 * their last input and their running workspaces; then who Coder saw in the
 * last 15 minutes without a tab open (the CLI, SSH, an app). Asked again every
 * 3 seconds.
 */
const OnlineUsersPage: React.FC = () => {
	const query = useQuery(onlineUsers());
	const report = query.data;
	const now = report ? new Date(report.generatedAt).getTime() : Date.now();
	const active = report?.online.filter((u) => u.status === "active").length;
	return (
		<>
			<title>{pageTitle("Online Users")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Online Users</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Who is using Coder right now, live: active, or idle after{" "}
					{report?.idleSeconds ?? 30} seconds without input.
				</SettingsHeaderDescription>
			</SettingsHeader>
			{query.isLoading ? (
				<Loader />
			) : !report ? (
				<ErrorAlert error={query.error} />
			) : (
				<div className="flex flex-col gap-6">
					{query.isError && <ErrorAlert error={query.error} />}
					<section aria-labelledby="online-now" className={card}>
						<h2
							id="online-now"
							className="m-0 flex items-baseline gap-2 text-base font-semibold"
						>
							Online now
							<span
								className="text-sm font-normal text-content-secondary"
								data-testid="online-count"
							>
								{report.online.length} online · {active} active ·{" "}
								{report.online.length - (active ?? 0)} idle
							</span>
						</h2>
						{report.online.length === 0 ? (
							<p className="m-0 text-sm text-content-secondary">
								No one has Coder open right now.
							</p>
						) : (
							<UsersTable users={report.online} now={now} live />
						)}
					</section>
					<section aria-labelledby="online-recent" className={card}>
						<h2 id="online-recent" className="m-0 text-base font-semibold">
							Seen in the last 15 minutes
						</h2>
						<p className="m-0 text-sm text-content-secondary">
							Without a Coder tab open: through the CLI, SSH, an IDE or a
							workspace app.
						</p>
						{report.recent.length === 0 ? (
							<p className="m-0 text-sm text-content-secondary">No one else.</p>
						) : (
							<UsersTable users={report.recent} now={now} live={false} />
						)}
					</section>
				</div>
			)}
		</>
	);
};

type UsersTableProps = {
	users: OnlineUser[];
	now: number;
	/** Online now: status, tabs, since and last input; otherwise when Coder last saw them. */
	live: boolean;
};

const UsersTable: React.FC<UsersTableProps> = ({ users, now, live }) => {
	const me = useChatSnapshot().me;
	return (
		<Table aria-label={live ? "Online now" : "Seen lately"}>
			<TableHeader>
				<TableRow>
					<TableHead>User</TableHead>
					{live ? (
						<>
							<TableHead>Status</TableHead>
							<TableHead>Tabs</TableHead>
							<TableHead>Online for</TableHead>
							<TableHead>Last input</TableHead>
						</>
					) : (
						<TableHead>Last seen</TableHead>
					)}
					<TableHead>Running workspaces</TableHead>
					<TableHead />
				</TableRow>
			</TableHeader>
			<TableBody>
				{users.map((u) => {
					const idle = u.status === "idle";
					return (
						<TableRow
							key={u.id}
							data-testid="online-user"
							data-status={u.status}
							className={idle ? "text-content-secondary" : undefined}
						>
							<TableCell>
								<span className="flex items-center gap-2">
									<PresenceAvatar
										person={{ ...u, online: u.status !== "offline", idle }}
									/>
									<span className="flex min-w-0 flex-col">
										<span className="flex items-center gap-1.5 truncate font-medium">
											{displayName(u)}
											{u.id === me?.id && (
												<span className="text-xs font-normal text-content-secondary">
													(you)
												</span>
											)}
											{u.invisible && (
												<span
													title="Invisible in the People list (only admins see them)"
													className="inline-flex"
												>
													<EyeOffIcon className="size-3.5 text-content-secondary" />
												</span>
											)}
										</span>
										<span className="truncate text-xs text-content-secondary">
											@{u.username}
											{u.admin ? " · admin" : ""}
										</span>
									</span>
								</span>
							</TableCell>
							{live ? (
								<>
									<TableCell>
										<span className="inline-flex items-center gap-1.5">
											<span
												aria-hidden
												className={
													idle
														? "size-2 rounded-full bg-content-disabled"
														: "size-2 rounded-full bg-content-success"
												}
											/>
											{idle ? "Idle" : "Active"}
										</span>
									</TableCell>
									<TableCell className="tabular-nums">{u.tabs}</TableCell>
									<TableCell className="tabular-nums">
										{sinceText(u.since, now)}
									</TableCell>
									<TableCell className="tabular-nums">
										{sinceText(u.activeAt, now)}
										{u.activeAt && sinceText(u.activeAt, now) !== "now"
											? " ago"
											: ""}
									</TableCell>
								</>
							) : (
								<TableCell className="tabular-nums">
									{sinceText(u.lastSeen, now)}
									{u.lastSeen ? " ago" : ""}
								</TableCell>
							)}
							<TableCell>
								{u.workspaces.length === 0 ? (
									<span className="text-content-secondary">—</span>
								) : (
									<span className="flex flex-wrap gap-x-2 gap-y-0.5">
										{u.workspaces.map((w) => (
											<Link
												key={w.id}
												to={`/@${w.owner}/${w.name}`}
												className="text-content-link no-underline hover:underline"
											>
												{w.name}
											</Link>
										))}
									</span>
								)}
							</TableCell>
							<TableCell>
								{u.id !== me?.id && (
									<span className="flex justify-end">
										<Button
											size="sm"
											variant="outline"
											title={`Message ${displayName(u)}`}
											onClick={() => void openChatWith(u)}
										>
											<MessageSquareIcon />
											Message
										</Button>
									</span>
								)}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
};

export default OnlineUsersPage;
