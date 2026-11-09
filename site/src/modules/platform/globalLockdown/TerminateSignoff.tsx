import { cn } from "cn";
import { PauseIcon, PlayIcon, XIcon, ZapIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { TerminateSignoff } from "#/api/platform";
import { Button } from "#/components/Button/Button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import "./terminateSignoff.css";

/** Seconds the folded-down Terminate counts down before it runs. */
const TERMINATE_COUNTDOWN = 5;

/**
 * One end of the Terminate button: a dimple until an administrator signs off, then a turning red emergency light
 * whose tooltip says who signed, when, and their certificate's thumbprint.
 */
const SignoffLight: React.FC<{ signoff?: TerminateSignoff }> = ({
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
	onDone: () => void;
	onCancel: () => void;
	cancelling?: boolean;
}> = ({ onDone, onCancel, cancelling = false }) => {
	const [left, setLeft] = useState(TERMINATE_COUNTDOWN);
	const [paused, setPaused] = useState(false);
	useEffect(() => {
		if (paused || left <= 0) {
			return;
		}
		const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
		return () => window.clearTimeout(timer);
	}, [left, paused]);
	useEffect(() => {
		if (left === 0) {
			onDone();
		}
	}, [left, onDone]);
	return (
		<section
			aria-label="Terminate countdown"
			className="terminate-countdown flex flex-col items-center gap-2 rounded-lg border border-solid border-red-500 bg-gray-900 p-3 text-white"
		>
			<p role="status" className="m-0 text-xs uppercase tracking-widest">
				{paused ? "Paused" : "Terminating all workspaces in"}
			</p>
			<Flap value={left} />
			<div className="flex gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={left === 0}
					onClick={() => setPaused((p) => !p)}
				>
					{paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
					{paused ? "Resume" : "Pause"}
				</Button>
				<Button
					size="sm"
					variant="destructive"
					disabled={left === 0 || cancelling}
					onClick={onCancel}
				>
					<XIcon aria-hidden />
					Cancel
				</Button>
			</div>
		</section>
	);
};

/** The whole screen flashes white once, and the flash outlives the page that started it (it leaves the DOM itself). */
export const flashScreen = () => {
	const flash = document.createElement("div");
	flash.className = "terminate-flash";
	flash.setAttribute("aria-hidden", "true");
	const remove = () => flash.remove();
	flash.addEventListener("animationend", remove);
	window.setTimeout(remove, 2000);
	document.body.append(flash);
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
