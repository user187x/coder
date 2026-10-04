import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import type { MonitoredWorkspace, MonitoringOverview } from "#/api/platform";
import { monitoring } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { SearchField } from "#/components/SearchField/SearchField";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Switch } from "#/components/Switch/Switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { pageTitle } from "#/utils/page";
import { MAX_SHOWN_LINES, useWorkspaceLogs } from "./useWorkspaceLogs";

const formatSize = (b: number) =>
	b > 1_048_576
		? `${(b / 1_048_576).toFixed(1)} MB`
		: `${Math.round(b / 1024)} KB`;

const startedAgo = (iso: string | null) => {
	if (!iso) {
		return "N/A";
	}
	const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
	if (!Number.isFinite(s)) {
		return "N/A";
	}
	return s < 90
		? "just now"
		: s < 5400
			? `${Math.round(s / 60)} min ago`
			: s < 129_600
				? `${Math.round(s / 3600)} h ago`
				: `${Math.round(s / 86_400)} d ago`;
};

/**
 * General > Monitoring: every user, their running workspaces, and a live log
 * for any of them (the workspace pod's log, kept by the platform service, the
 * newest 5 MB per workspace).
 */
const MonitoringSettingsPage: React.FC = () => {
	const overviewQuery = useQuery(monitoring());
	const [filter, setFilter] = useState("");
	const [onlyRunning, setOnlyRunning] = useState(false);

	return (
		<>
			<title>{pageTitle("Monitoring")}</title>
			<SettingsHeader>
				<SettingsHeaderTitle>Monitoring</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Every user and their running workspaces. Open one to follow its logs
					live.
				</SettingsHeaderDescription>
			</SettingsHeader>

			<div className="mb-4 flex flex-wrap items-center gap-4">
				<SearchField
					value={filter}
					onChange={setFilter}
					placeholder="Filter users or workspaces"
					aria-label="Filter users or workspaces"
				/>
				<div className="flex items-center gap-2">
					<Switch
						id="monitoring-only-running"
						checked={onlyRunning}
						onCheckedChange={setOnlyRunning}
					/>
					<Label htmlFor="monitoring-only-running">
						Only users with running workspaces
					</Label>
				</div>
			</div>

			{overviewQuery.isLoading ? (
				<Loader />
			) : !overviewQuery.data ? (
				<ErrorAlert error={overviewQuery.error} />
			) : (
				<UserList
					overview={overviewQuery.data}
					filter={filter.trim().toLowerCase()}
					onlyRunning={onlyRunning}
				/>
			)}
		</>
	);
};

type UserListProps = {
	overview: MonitoringOverview;
	filter: string;
	onlyRunning: boolean;
};

const UserList: React.FC<UserListProps> = ({
	overview,
	filter,
	onlyRunning,
}) => {
	const running = overview.users.reduce((n, u) => n + u.instances.length, 0);
	const rows = overview.users.filter(
		({ user, instances }) =>
			(!onlyRunning || instances.length) &&
			(!filter ||
				[user.username, user.name, user.email, ...instances.map((i) => i.name)]
					.join(" ")
					.toLowerCase()
					.includes(filter)),
	);

	return (
		<div className="flex flex-col gap-2">
			<p className="m-0 mb-2 text-sm text-content-secondary">
				{overview.users.length} users · {running} running{" "}
				{running === 1 ? "workspace" : "workspaces"} (namespace{" "}
				{overview.namespace})
			</p>
			{rows.length ? (
				rows.map(({ user, instances }) => (
					<UserBlock
						key={user.id}
						name={user.name || user.username}
						subtitle={`${user.username}${user.email ? ` · ${user.email}` : ""}`}
						instances={instances}
						capBytes={overview.capBytes}
					/>
				))
			) : (
				<p className="m-0 text-sm text-content-secondary">
					{onlyRunning
						? "Nobody has a running workspace right now."
						: "No users match."}
				</p>
			)}
		</div>
	);
};

type UserBlockProps = {
	name: string;
	subtitle: string;
	instances: MonitoredWorkspace[];
	capBytes: number;
};

const UserBlock: React.FC<UserBlockProps> = ({
	name,
	subtitle,
	instances,
	capBytes,
}) => {
	const [open, setOpen] = useState(false);
	const initials = name
		.split(/\s+/)
		.map((word) => word[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className={cn(
				"rounded-lg border border-solid border-border",
				!instances.length && "opacity-75",
			)}
		>
			<CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left text-inherit">
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-icon-sm shrink-0 text-content-secondary transition-transform",
						open && "rotate-90",
					)}
				/>
				<span
					aria-hidden
					className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-xs font-semibold"
				>
					{initials}
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<b className="truncate">{name}</b>
					<small className="truncate text-content-secondary">{subtitle}</small>
				</span>
				<Badge size="xs" variant={instances.length ? "green" : "default"}>
					{instances.length ? `${instances.length} running` : "none running"}
				</Badge>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="border-0 border-t border-solid border-border p-3">
					{instances.length ? (
						<Table aria-label={`Running workspaces of ${name}`}>
							<TableHeader>
								<TableRow>
									<TableHead>Workspace</TableHead>
									<TableHead>Template</TableHead>
									<TableHead>Agent</TableHead>
									<TableHead>Started</TableHead>
									<TableHead>
										<span className="sr-only">Logs</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{instances.map((instance) => (
									<InstanceRows
										key={instance.workspaceId}
										instance={instance}
										capBytes={capBytes}
									/>
								))}
							</TableBody>
						</Table>
					) : (
						<p className="m-0 text-sm text-content-secondary">
							No running workspaces.
						</p>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};

type InstanceRowsProps = {
	instance: MonitoredWorkspace;
	capBytes: number;
};

const InstanceRows: React.FC<InstanceRowsProps> = ({ instance, capBytes }) => {
	const [showLogs, setShowLogs] = useState(false);
	const agent = instance.agents[0];
	const troubled = !instance.healthy || (agent && agent.status !== "connected");

	return (
		<>
			<TableRow>
				<TableCell>
					<span className="flex items-center gap-2">
						<span
							aria-hidden
							className={cn(
								"size-2 rounded-full",
								troubled ? "bg-content-warning" : "bg-content-success",
							)}
						/>
						<b>{instance.name}</b>
					</span>
				</TableCell>
				<TableCell>{instance.template ?? "N/A"}</TableCell>
				<TableCell>
					{instance.agents
						.map(
							(a) =>
								`${a.name}: ${a.status}${a.lifecycle && a.lifecycle !== "ready" ? ` (${a.lifecycle})` : ""}`,
						)
						.join(", ") || "N/A"}
				</TableCell>
				<TableCell title={instance.startedAt ?? undefined} data-pixel="ignore">
					{startedAgo(instance.startedAt)}
				</TableCell>
				<TableCell className="text-right">
					{instance.pod ? (
						<Button
							size="sm"
							variant="outline"
							aria-expanded={showLogs}
							onClick={() => setShowLogs(!showLogs)}
						>
							{showLogs ? "Hide logs" : "Show logs"}
						</Button>
					) : (
						<span className="text-xs text-content-secondary">no pod found</span>
					)}
				</TableCell>
			</TableRow>
			{showLogs && (
				<TableRow>
					<TableCell colSpan={5}>
						<LogViewer instance={instance} capBytes={capBytes} />
					</TableCell>
				</TableRow>
			)}
		</>
	);
};

const LINE_CLASS = (text: string) =>
	/\b(error|fatal|panic|fail(ed)?)\b/i.test(text)
		? "text-content-destructive"
		: /\bwarn(ing)?\b/i.test(text)
			? "text-content-warning"
			: undefined;

type LogViewerProps = {
	instance: MonitoredWorkspace;
	capBytes: number;
};

/**
 * Follow keeps the newest line in view. Scrolling up to read pauses it;
 * scrolling back to the bottom, or ticking the box, resumes it.
 */
const LogViewer: React.FC<LogViewerProps> = ({ instance, capBytes }) => {
	const [paused, setPaused] = useState(false);
	const [follow, setFollow] = useState(true);
	const followId = useId();
	const logs = useWorkspaceLogs(instance.workspaceId, paused);
	const box = useRef<HTMLPreElement>(null);
	const lastTop = useRef(0);

	useLayoutEffect(() => {
		const el = box.current;
		if (el && follow && logs.lines.length >= 0) {
			el.scrollTop = el.scrollHeight;
			lastTop.current = el.scrollTop;
		}
	}, [logs.lines, follow]);

	const state = logs.error
		? logs.error
		: !logs.info
			? "connecting…"
			: logs.info.state === "streaming"
				? "live"
				: `${logs.info.state}${logs.info.error ? `: ${logs.info.error}` : ""}`;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-3 text-xs">
				<span
					className={cn(
						"font-semibold",
						state === "live"
							? "text-content-success"
							: "text-content-secondary",
					)}
				>
					{state}
				</span>
				<code>
					{logs.info
						? `${logs.info.pod} / ${logs.info.container}`
						: (instance.pod ?? "pod")}
				</code>
				{logs.info && (
					<span className="text-content-secondary">
						{logs.info.stored.lines.toLocaleString("en-US")} lines ·{" "}
						{formatSize(logs.info.stored.bytes)} of{" "}
						{formatSize(logs.info.stored.capBytes)} stored
					</span>
				)}
				<span className="flex-1" />
				<div className="flex items-center gap-1.5">
					<Checkbox
						id={followId}
						checked={follow}
						onCheckedChange={(checked) => setFollow(checked === true)}
					/>
					<Label htmlFor={followId} className="font-normal">
						Follow
					</Label>
				</div>
				<Button size="sm" variant="outline" onClick={() => setPaused(!paused)}>
					{paused ? "Resume" : "Pause"}
				</Button>
				<Button size="sm" variant="outline" onClick={logs.clear}>
					Clear view
				</Button>
			</div>
			<pre
				ref={box}
				role="log"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region needs keyboard access
				tabIndex={0}
				aria-label={`Log of ${instance.owner}/${instance.name}`}
				className="m-0 h-80 overflow-auto rounded-md border border-solid border-border bg-surface-secondary p-3 font-mono text-xs leading-relaxed"
				onScroll={(event) => {
					const el = event.currentTarget;
					if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) {
						setFollow(true);
					} else if (el.scrollTop < lastTop.current - 2) {
						setFollow(false);
					}
					lastTop.current = el.scrollTop;
				}}
			>
				{logs.lines.map(([seq, ts, text]) => (
					<div key={seq} className={LINE_CLASS(text)}>
						<span className="text-content-secondary">
							{(ts || "").slice(11, 19)}{" "}
						</span>
						{text}
					</div>
				))}
			</pre>
			<p className="m-0 text-xs text-content-secondary">
				Streamed from the pod into the temporary log database; the newest{" "}
				{formatSize(capBytes)} are kept there. This page shows up to{" "}
				{MAX_SHOWN_LINES.toLocaleString("en-US")} lines.
			</p>
		</div>
	);
};

export default MonitoringSettingsPage;
