import { cn } from "cn";
import { LockIcon } from "lucide-react";
import { useId, useState } from "react";
import type { BrowserLockStatus } from "#/api/browserSessions";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import "../globalLockdown/globalLockdown.css";

const PIN_PATTERN = /^\d{6,12}$/;

/** Closes the shutter: locks at once when a PIN is set, or asks for the first PIN. */
export const BrowserLockButton: React.FC<{
	closed: boolean;
	busy: boolean;
	onClick: () => void;
}> = ({ closed, busy, onClick }) => (
	<Button
		size="sm"
		variant="outline"
		className="h-7"
		onClick={onClick}
		disabled={closed || busy}
		title="Lock this browser behind a PIN"
	>
		<LockIcon />
		Lock
	</Button>
);

type BrowserSessionShutterViewProps = {
	/** Undefined while loading or when the gateway cannot be read. */
	status?: BrowserLockStatus;
	/** Asking for the first PIN (the lock button, before a PIN is set). */
	setup: boolean;
	busy: boolean;
	error: unknown;
	onCancelSetup: () => void;
	onSetAndLock: (pin: string) => void;
	onUnlock: (pin: string) => void;
	children: React.ReactNode;
};

export const BrowserSessionShutterView: React.FC<
	BrowserSessionShutterViewProps
> = ({
	status,
	setup,
	busy,
	error,
	onCancelSetup,
	onSetAndLock,
	onUnlock,
	children,
}) => {
	const id = useId();
	const [pin, setPIN] = useState("");
	const [repeat, setRepeat] = useState("");
	const locked = Boolean(status?.locked);
	const closed = locked || setup;
	const waiting = locked && (status?.retryAfter ?? 0) > 0;
	const valid = PIN_PATTERN.test(pin) && (!setup || pin === repeat);
	return (
		<div className="relative flex h-full min-h-0 flex-1 overflow-hidden">
			{!closed && children}
			<div
				aria-hidden={!closed}
				inert={!closed}
				className={cn(
					"global-control-door absolute inset-0 flex items-center justify-center p-4",
					!closed && "global-control-door-open",
				)}
			>
				<div className="global-control-bottom-bar" aria-hidden />
				{closed && (
					<form
						className={cn(
							"z-10 flex w-full max-w-xs flex-col gap-3 rounded-xl border border-solid border-border bg-surface-primary p-5 text-content-primary",
							Boolean(error) && "global-control-pin-error",
						)}
						onSubmit={(event) => {
							event.preventDefault();
							if (busy || waiting || !valid) return;
							if (setup) onSetAndLock(pin);
							else onUnlock(pin);
							setPIN("");
							setRepeat("");
						}}
					>
						<h3 className="m-0 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest">
							<LockIcon className="size-4 text-content-warning" />
							{setup ? "Set browser PIN" : "Browser locked"}
						</h3>
						<Label htmlFor={`${id}-pin`} className="text-center">
							{setup ? "New PIN, 6 to 12 digits" : "Browser PIN"}
						</Label>
						<Input
							id={`${id}-pin`}
							className="global-control-pin h-14 text-center text-2xl tracking-[0.4em]"
							type="password"
							inputMode="numeric"
							autoComplete="off"
							maxLength={12}
							value={pin}
							onChange={(e) => setPIN(e.target.value.replace(/\D/g, ""))}
							disabled={busy}
							autoFocus
						/>
						{setup && (
							<>
								<Label htmlFor={`${id}-repeat`} className="text-center">
									Confirm PIN
								</Label>
								<Input
									id={`${id}-repeat`}
									type="password"
									inputMode="numeric"
									autoComplete="off"
									maxLength={12}
									value={repeat}
									onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ""))}
									disabled={busy}
								/>
							</>
						)}
						<Button
							type="submit"
							variant="outline"
							disabled={busy || waiting || !valid}
						>
							<Spinner loading={busy} />
							{setup ? "Set PIN and lock" : "Unlock browser"}
						</Button>
						{setup && (
							<Button
								type="button"
								variant="subtle"
								onClick={() => {
									setPIN("");
									setRepeat("");
									onCancelSetup();
								}}
							>
								Cancel
							</Button>
						)}
						<p
							role="status"
							className="m-0 text-center text-xs text-content-secondary"
						>
							{waiting
								? `Too many attempts. Try again in ${status?.retryAfter} seconds.`
								: "Server enforced. The session keeps running while locked."}
						</p>
						{Boolean(error) && <ErrorAlert error={error} />}
					</form>
				)}
			</div>
		</div>
	);
};
