import { cn } from "cn";
import { LockIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type { BrowserLockStatus } from "#/api/browserSessions";
import {
	browserLock,
	changeWorkspaceBrowserLock,
} from "#/api/queries/browserSessions";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import "../globalLockdown/globalLockdown.css";

const PIN_PATTERN = /^\d{6,12}$/;

/** The browser panel behind a PIN shutter that its gateway enforces for every page, socket and stream. */
export const BrowserSessionShutter: React.FC<{
	baseUrl: string;
	children: React.ReactNode;
}> = ({ baseUrl, children }) => {
	const client = useQueryClient();
	const status = useQuery(browserLock(baseUrl));
	const change = useMutation(changeWorkspaceBrowserLock(client, baseUrl));
	return (
		<BrowserSessionShutterView
			status={status.data}
			busy={change.isPending}
			error={change.error}
			onReset={change.reset}
			onSetAndLock={(pin, onLocked) =>
				change.mutate(
					{ action: "pin-set", pin },
					{
						onSuccess: () =>
							change.mutate({ action: "pin-lock" }, { onSuccess: onLocked }),
					},
				)
			}
			onLock={() => change.mutate({ action: "pin-lock" })}
			onUnlock={(pin) => change.mutate({ action: "pin-unlock", pin })}
		>
			{children}
		</BrowserSessionShutterView>
	);
};

type BrowserSessionShutterViewProps = {
	/** Undefined while loading, or for a gateway without the lock: the panel then shows no lock control. */
	status?: BrowserLockStatus;
	busy: boolean;
	error: unknown;
	onReset: () => void;
	/** Sets the first PIN, then locks; onLocked runs once the lock is in place. */
	onSetAndLock: (pin: string, onLocked: () => void) => void;
	onLock: () => void;
	onUnlock: (pin: string) => void;
	children: React.ReactNode;
};

export const BrowserSessionShutterView: React.FC<
	BrowserSessionShutterViewProps
> = ({
	status,
	busy,
	error,
	onReset,
	onSetAndLock,
	onLock,
	onUnlock,
	children,
}) => {
	const id = useId();
	const [setup, setSetup] = useState(false);
	const [pin, setPIN] = useState("");
	const [repeat, setRepeat] = useState("");
	const locked = Boolean(status?.locked);
	const closed = locked || setup;
	const waiting = locked && (status?.retryAfter ?? 0) > 0;
	const valid = PIN_PATTERN.test(pin) && (!setup || pin === repeat);
	const close = () => {
		setPIN("");
		setRepeat("");
		onReset();
		if (status?.configured) onLock();
		else setSetup(true);
	};
	return (
		<div className="relative flex h-full min-h-0 flex-1 overflow-hidden">
			{!closed && children}
			{status && !closed && (
				<Button
					variant="outline"
					size="icon"
					className="absolute right-2 top-2 z-20"
					aria-label="Lock browser"
					title="Lock browser"
					onClick={close}
					disabled={busy}
				>
					<LockIcon />
				</Button>
			)}
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
							if (setup) onSetAndLock(pin, () => setSetup(false));
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
									setSetup(false);
									setPIN("");
									setRepeat("");
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
