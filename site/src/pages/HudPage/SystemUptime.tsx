import { cn } from "cn";
import { TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** "45s", "12m", "4h 12m", "2d 4h 12m": how long, to the minute (seconds only in the first minute). */
export const formatUptime = (ms: number): string => {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) {
		return `${s}s`;
	}
	const m = Math.floor(s / 60) % 60;
	const h = Math.floor(s / 3600) % 24;
	const d = Math.floor(s / 86400);
	if (d > 0) {
		return `${d}d ${h}h ${m}m`;
	}
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * The HUD's System Uptime, a small pill under the Live indicator: how long the
 * Coder server has been up and online - since its oldest ready replica started
 * (the platform service reads it from Kubernetes). It counts on between the
 * HUD's updates.
 */
export const SystemUptime: React.FC<{
	uptime: { since: string | null; replicas: number };
}> = ({ uptime }) => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	const since = uptime.since ? Date.parse(uptime.since) : Number.NaN;
	const up = !Number.isNaN(since);
	return (
		<span
			data-testid="hud-uptime"
			title={
				up
					? `Coder has been up since ${new Date(since).toLocaleString("en-US")} (${uptime.replicas} replica${uptime.replicas === 1 ? "" : "s"} serving)`
					: "No Coder replica is ready"
			}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-0.5 text-xs",
				up
					? "border-border bg-surface-secondary/60 text-content-secondary"
					: "border-border-warning text-content-warning",
			)}
		>
			<TimerIcon aria-hidden className="size-3" />
			System Uptime
			<span className="font-mono font-semibold tabular-nums text-content-primary">
				{up ? formatUptime(now - since) : "down"}
			</span>
		</span>
	);
};
