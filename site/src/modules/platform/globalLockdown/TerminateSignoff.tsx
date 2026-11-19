import { cn } from "cn";
import { PauseIcon, PlayIcon, XIcon, ZapIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminateSignoff, TerminateSignoffs } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import "./terminateSignoff.css";

/**
 * One end of the Terminate button: a dimple until an administrator signs off, then a turning red emergency light
 * whose tooltip says who signed, when, and their certificate's thumbprint.
 */
export const SignoffLight: React.FC<{ signoff?: TerminateSignoff }> = ({
	signoff,
}) => {
	if (!signoff) {
		return <span aria-hidden className="terminate-dimple" />;
	}
	const at = new Date(signoff.signed_at);
	const when = Number.isFinite(at.getTime())
		? at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" })
		: "Unknown time";
	const who = signoff.name || signoff.username || "Unknown administrator";
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="terminate-beacon"
					aria-label={`Signed off by ${who}`}
				>
					<span aria-hidden className="terminate-beacon-beam" />
				</button>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<p className="m-0 font-semibold">Signed off by {who}</p>
				{signoff.name && signoff.username && (
					<p className="m-0 text-content-secondary">@{signoff.username}</p>
				)}
				<p className="m-0">{when}</p>
				<p className="m-0 mt-1 break-all font-mono text-2xs">
					SHA-256 {signoff.fingerprint}
				</p>
			</TooltipContent>
		</Tooltip>
	);
};

/**
 * Global Command & Control's Terminate: two administrators must sign off on it. Each sign-off lights one of the
 * button's two ends; the first end is the first sign-off's.
 */
export const TerminateSignoffButton: React.FC<{
	signoffs: readonly TerminateSignoff[];
	disabled?: boolean;
	/** The signed-in administrator already signed this round: the next sign-off is another's. */
	signed?: boolean;
	onClick: (button: HTMLButtonElement) => void;
}> = ({ signoffs, disabled = false, signed = false, onClick }) => (
	<div className="terminate-signoff flex items-center gap-2">
		<SignoffLight signoff={signoffs[0]} />
		<Button
			variant="outline"
			className="min-w-0 flex-1 border-gray-500 bg-gray-700 font-semibold text-white hover:bg-gray-800 disabled:text-white disabled:opacity-50"
			disabled={disabled || signed}
			title={
				signed
					? "You signed off. Another administrator must sign off too."
					: undefined
			}
			onClick={(e) => onClick(e.currentTarget)}
		>
			<ZapIcon aria-hidden />
			Terminate
			{signoffs.length > 0 && (
				<span className="text-xs font-normal opacity-80">
					({signoffs.length}/2 signed)
				</span>
			)}
		</Button>
		<SignoffLight signoff={signoffs[1]} />
	</div>
);

/** One digit of the split-flap display, flipping down to the next value. */
const Flap: React.FC<{ value: number }> = ({ value }) => (
	<span className="terminate-flap" data-value={value}>
		<span key={value} className="terminate-flap-card">
			{value}
		</span>
	</span>
);

/**
 * After the last sign-off the Terminate button folds down into a split-flap countdown: any administrator here can
 * pause it or cancel it until it reaches zero, then onDone runs the terminate.
 */
export const TerminateCountdown: React.FC<{
	deadline: number;
	pausedMs?: number | null;
	onDone?: () => void;
	onPause?: (paused: boolean) => void;
	onCancel?: () => void;
	busy?: boolean;
}> = ({ deadline, pausedMs, onDone, onPause, onCancel, busy }) => {
	const [now, setNow] = useState(Date.now);
	const paused = pausedMs != null;
	const left = Math.max(0, Math.ceil((pausedMs ?? deadline - now) / 1000));
	useEffect(() => {
		if (paused) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 50);
		return () => window.clearInterval(timer);
	}, [paused]);
	useEffect(() => {
		if (!busy && !paused && left === 0) {
			onDone?.();
		}
	}, [busy, left, onDone, paused]);
	return (
		<section
			aria-label={`Terminate countdown: ${left} seconds remaining`}
			className="terminate-countdown flex flex-col items-center gap-2 rounded-lg border border-solid border-red-500 bg-gray-900 p-3 text-white"
		>
			<p className="m-0 text-xs uppercase tracking-widest">
				{paused ? "Paused" : "Terminating reviewed workspaces in"}
			</p>
			<Flap value={left} />
			<div className="flex gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={left === 0 || busy || !onPause}
					onClick={() => onPause?.(!paused)}
				>
					{paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
					{paused ? "Resume" : "Pause"}
				</Button>
				<Button
					size="sm"
					variant="destructive"
					disabled={left === 0 || busy || !onCancel}
					onClick={onCancel}
				>
					<XIcon aria-hidden />
					Cancel
				</Button>
			</div>
		</section>
	);
};

export const terminateFlashFinished = "coder:terminate-flash-finished";

/** The whole screen flashes white once, and the flash outlives the page that started it (it leaves the DOM itself). */
const flashScreen = () => {
	const flash = document.createElement("div");
	flash.className = "terminate-flash";
	flash.setAttribute("aria-hidden", "true");
	const finish = () => {
		window.clearTimeout(fallback);
		flash.removeEventListener("animationend", finish);
		flash.remove();
		window.dispatchEvent(new Event(terminateFlashFinished));
	};
	flash.addEventListener("animationend", finish, { once: true });
	const fallback = window.setTimeout(finish, 2000);
	document.body.append(flash);
};

/** Flash once per deadline observed in this dashboard. */
export const useTerminateFlash = (round: TerminateSignoffs | undefined) => {
	const flashed = useRef<string | null>(null);
	const deadline = round?.deadline_ms;
	const roundId = round?.round_id;
	const paused = round?.paused_ms != null;
	const signedAt = round?.signoffs.at(-1)?.signed_at;
	useEffect(() => {
		if (!roundId || !signedAt || deadline == null || paused) return;
		const signature = `${roundId}:${signedAt}`;
		const remaining = deadline - Date.now();
		if (signature === flashed.current || remaining < -1000) return;
		const timer = window.setTimeout(
			() => {
				flashed.current = signature;
				flashScreen();
			},
			Math.max(0, remaining),
		);
		return () => window.clearTimeout(timer);
	}, [deadline, paused, roundId, signedAt]);
};

/** Whether the sign-off list is complete, and the last one is this administrator's (who runs the countdown). */
export const lastSigner = (
	signoffs: readonly TerminateSignoff[],
	required: number,
	userId: string | undefined,
) =>
	signoffs.length >= required &&
	Boolean(userId) &&
	signoffs[signoffs.length - 1]?.user_id === userId;

export const signoffClass = (folded: boolean) =>
	cn("terminate-fold", folded && "terminate-fold-down");
