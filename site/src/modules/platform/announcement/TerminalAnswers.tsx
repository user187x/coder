import { useEffect, useState } from "react";
import { useQuery } from "react-query";
import { dashboardAddress } from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";

/** What the announcement terminal answers a command with (BannerScrollView). */
export type Answer =
	| "none"
	| "nono"
	| "notfound"
	| "time"
	| "date"
	| "whoami"
	| "ls"
	| "ip";

/** "rm" and anything after it (rm, rm file, rmdir...): the wagging finger. */
export const isRm = (command: string) => /^rm/.test(command);

/** The no-no picture's answer: shown, typed out, then faded away after this long (ms). */
export const NO_NO_SHOWN_MS = 1500;
const NO_NO_FADE_MS = 400;
const NO_NO_SRC = "/no-no.gif";
const NO_NO_TEXT = "ahh ahh ahh...";
/** The typing starts once the picture is up, a letter at a time - done before it fades. */
const NO_NO_LEAD_MS = 200;
const NO_NO_PER_MS = 70;

/**
 * The terminal's answer to an rm: a picture printed inline, as image-capable terminals show one (imgcat), then "ahh
 * ahh ahh..." typed out a letter at a time (the banner's typewriter effect, announce-appear) - faded out after 1.5 s,
 * then gone.
 */
export const NoNoResponse: React.FC = () => {
	const [gone, setGone] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(
			() => setGone(true),
			NO_NO_SHOWN_MS + NO_NO_FADE_MS,
		);
		return () => window.clearTimeout(timer);
	}, []);
	if (gone) {
		return null;
	}
	return (
		<div
			className="banner-scroll-nono"
			data-testid="announcement-scroll-nono"
			style={{
				animation: `banner-scroll-fade-out ${NO_NO_FADE_MS}ms ease-in ${NO_NO_SHOWN_MS}ms 1 both`,
			}}
		>
			<img src={NO_NO_SRC} alt="" width={120} height={120} draggable={false} />
			<div className="banner-scroll-ahh">
				{Array.from(NO_NO_TEXT).map((ch, i) => (
					<span
						key={i}
						style={{
							animation: `announce-appear 1ms linear ${NO_NO_LEAD_MS + i * NO_NO_PER_MS}ms 1 both`,
						}}
					>
						{ch}
					</span>
				))}
			</div>
		</div>
	);
};

/** "Wed Oct 22 08:30:12 EDT 2026", as date(1) says it (this browser's time zone). */
export const dateText = (at: Date) => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			weekday: "short",
			month: "short",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
			timeZoneName: "short",
			year: "numeric",
		})
			.formatToParts(at)
			.map((p) => [p.type, p.value]),
	);
	const hour = parts.hour === "24" ? "00" : parts.hour;
	return `${parts.weekday} ${parts.month} ${parts.day} ${hour}:${parts.minute}:${parts.second} ${parts.timeZoneName} ${parts.year}`;
};

/** How long a running workspace has been up (its last build's end), as "2d 3h", "1h 40m", "12m"; "-" otherwise. */
export const uptimeText = (w: Workspace, now: number) => {
	const since = w.latest_build.job.completed_at;
	if (w.latest_build.status !== "running" || !since) {
		return "-";
	}
	const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
	const d = Math.floor(minutes / 1440);
	const h = Math.floor((minutes % 1440) / 60);
	const m = minutes % 60;
	return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** "ls": the user's workspaces, a line each - its name, state and uptime, in columns. */
const LsResponse: React.FC = () => {
	const query = useQuery({
		...workspaces({ q: "owner:me" }),
		staleTime: 5_000,
	});
	if (query.isLoading) {
		return <div className="banner-scroll-out">…</div>;
	}
	const list = query.data?.workspaces ?? [];
	if (list.length === 0) {
		return <div className="banner-scroll-out">no workspaces</div>;
	}
	const now = Date.now();
	const width = Math.max(4, ...list.map((w) => w.name.length)) + 2;
	const rows = [
		["NAME", "STATE", "UPTIME"],
		...list.map((w) => [w.name, w.latest_build.status, uptimeText(w, now)]),
	];
	return (
		<div className="banner-scroll-out" data-testid="announcement-scroll-ls">
			{rows.map(([name, state, up], i) => (
				<div key={i} className={i === 0 ? "opacity-60" : undefined}>
					{name.padEnd(width)}
					{state.padEnd(10)}
					{up}
				</div>
			))}
		</div>
	);
};

/** "ip": where the dashboard is reached - the Gateway's addresses, and its host name. */
const IpResponse: React.FC = () => {
	const query = useQuery({
		...dashboardAddress(),
	});
	if (query.isLoading) {
		return <div className="banner-scroll-out">…</div>;
	}
	const data = query.data;
	const lines = data
		? [
				...data.addresses.map((a) => `inet ${a}`),
				...(data.host ? [`host ${data.host}`] : []),
			]
		: [];
	return (
		<div className="banner-scroll-out" data-testid="announcement-scroll-ip">
			{lines.length === 0 ? (
				<div>ip: the dashboard's address is not known</div>
			) : (
				lines.map((line) => <div key={line}>{line}</div>)
			)}
		</div>
	);
};

/** The terminal's answers that print something (the effects run from BannerScrollView itself). */
export const TerminalAnswer: React.FC<{
	answer: Answer;
	command: string;
	time: React.ReactNode;
}> = ({ answer, command, time }) => {
	switch (answer) {
		case "nono":
			return <NoNoResponse />;
		case "notfound":
			return (
				<div
					className="banner-scroll-out"
					data-testid="announcement-scroll-notfound"
				>
					bash: {command.split(" ")[0]}: command not found
				</div>
			);
		case "time":
			return <>{time}</>;
		case "date":
			return (
				<div
					className="banner-scroll-out"
					data-testid="announcement-scroll-date"
				>
					{dateText(new Date())}
				</div>
			);
		case "whoami":
			return (
				<div
					className="banner-scroll-out"
					data-testid="announcement-scroll-whoami"
				>
					Skynet
				</div>
			);
		case "ls":
			return <LsResponse />;
		case "ip":
			return <IpResponse />;
		default:
			return null;
	}
};
