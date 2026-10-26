import { cn } from "cn";
import { LockIcon, SettingsIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	closeGlobalControls,
	configureGlobalControls,
	globalControls,
	unlockGlobalControls,
} from "#/api/queries/globalLockdown";
import type { GlobalControlStatus } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";

/** A local panel close also revokes its server grant; no credential enters browser storage. */
export const GlobalControlDoor: React.FC<{
	onUnlock: (grant: GlobalControlStatus | null) => void;
	children: React.ReactNode;
	disabled?: boolean;
}> = ({ onUnlock, children, disabled = false }) => {
	const client = useQueryClient();
	const status = useQuery({ ...globalControls(), enabled: !disabled });
	const unlock = useMutation(unlockGlobalControls());
	const configure = useMutation(configureGlobalControls(client));
	const close = useMutation(closeGlobalControls());
	const [grant, setGrant] = useState<GlobalControlStatus | null>(null);
	const [pin, setPIN] = useState("");
	const [repeat, setRepeat] = useState("");
	const [current, setCurrent] = useState("");
	const [settings, setSettings] = useState(false);
	const id = useId();
	const firstAction = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const opened = Boolean(grant?.token) && !disabled;
	const setup = !status.data?.configured || settings;
	const busy = unlock.isPending || configure.isPending || close.isPending;
	const lock = () => {
		setGrant(null);
		onUnlock(null);
		setPIN("");
		setRepeat("");
		setCurrent("");
		setSettings(false);
		unlock.reset();
		configure.reset();
		close.mutate();
		window.requestAnimationFrame(() => input.current?.focus());
	};
	useEffect(() => {
		if (!grant?.expires_at) return;
		const timer = window.setTimeout(
			() => {
				setGrant(null);
				onUnlock(null);
				setPIN("");
			},
			Math.min(
				5 * 60_000,
				Math.max(0, Date.parse(grant.expires_at) - Date.now()),
			),
		);
		return () => window.clearTimeout(timer);
	}, [grant, onUnlock]);
	const accepted = (result: GlobalControlStatus) => {
		setGrant(result);
		onUnlock(result);
		setPIN("");
		setRepeat("");
		setCurrent("");
		setSettings(false);
		window.requestAnimationFrame(() =>
			firstAction.current
				?.querySelector<HTMLButtonElement>("button:not(:disabled)")
				?.focus(),
		);
	};
	return (
		<div
			style={{
				minHeight: setup
					? settings
						? 540
						: 460
					: unlock.error || configure.error || close.error
						? 440
						: 340,
			}}
			className="global-control-box relative min-h-[340px] w-full shrink-0 overflow-hidden rounded-2xl border border-solid border-border bg-surface-primary lg:w-[340px]"
		>
			<div
				ref={firstAction}
				className="flex min-h-[340px] flex-col justify-center gap-3 p-6"
				inert={!opened}
				aria-hidden={!opened}
			>
				{opened && children}
				{opened && (
					<>
						<Button variant="outline" onClick={lock} disabled={busy}>
							Close Panel
						</Button>
						<Button
							variant="subtle"
							size="sm"
							onClick={() => {
								setSettings(true);
								setGrant(null);
								onUnlock(null);
							}}
						>
							{" "}
							<SettingsIcon />
							Change admin PIN
						</Button>
						<p className="m-0 text-center text-xs text-content-secondary">
							Unlock expires after five minutes.
						</p>
					</>
				)}
			</div>
			<div
				aria-hidden={opened}
				inert={opened}
				className={cn(
					"global-control-door absolute inset-0 flex items-center justify-center p-4",
					opened && "global-control-door-open",
				)}
			>
				<div className="global-control-bottom-bar" aria-hidden />
				<form
					className={cn(
						"global-control-pin-panel z-10 flex w-full flex-col gap-3 rounded-xl border border-solid border-border p-5",
						unlock.isError && "global-control-pin-error",
					)}
					onSubmit={(event) => {
						event.preventDefault();
						if (busy || disabled || !status.data || !/^\d{6}$/.test(pin))
							return;
						if (setup) {
							if (pin !== repeat) return;
							configure.mutate(
								{ pin, current_pin: current },
								{ onSuccess: accepted },
							);
						} else unlock.mutate({ pin }, { onSuccess: accepted });
					}}
				>
					<h3 className="m-0 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest">
						<LockIcon className="size-4 text-content-warning" />
						{setup ? "Set up admin PIN" : "Admin PIN"}
					</h3>
					{status.isLoading ? (
						<p role="status">
							<Spinner loading />
							Loading control security
						</p>
					) : status.error ? (
						<>
							<ErrorAlert error={status.error} />
							<Button
								type="button"
								variant="outline"
								onClick={() => void status.refetch()}
							>
								Retry
							</Button>
						</>
					) : (
						<>
							{settings && (
								<>
									<Label htmlFor={`${id}-current`}>Current PIN</Label>
									<Input
										id={`${id}-current`}
										type="password"
										inputMode="numeric"
										maxLength={6}
										value={current}
										onChange={(e) =>
											setCurrent(e.target.value.replace(/\D/g, ""))
										}
										autoComplete="off"
										disabled={busy}
									/>
								</>
							)}
							<Label htmlFor={`${id}-pin`}>
								{setup ? "New six-digit PIN" : "Six-digit admin PIN"}
							</Label>
							<Input
								ref={input}
								id={`${id}-pin`}
								className="global-control-pin h-14 text-center text-2xl tracking-[0.4em]"
								type="password"
								inputMode="numeric"
								autoComplete="off"
								maxLength={6}
								value={pin}
								onChange={(e) => setPIN(e.target.value.replace(/\D/g, ""))}
								disabled={busy || disabled}
							/>
							{setup && (
								<>
									<Label htmlFor={`${id}-repeat`}>Confirm PIN</Label>
									<Input
										id={`${id}-repeat`}
										type="password"
										inputMode="numeric"
										autoComplete="off"
										maxLength={6}
										value={repeat}
										onChange={(e) =>
											setRepeat(e.target.value.replace(/\D/g, ""))
										}
										disabled={busy || disabled}
									/>
								</>
							)}
							<Button
								type="submit"
								variant="outline"
								disabled={
									busy ||
									disabled ||
									pin.length !== 6 ||
									(setup && pin !== repeat)
								}
							>
								<Spinner loading={busy} />
								{setup ? "Save PIN and open" : "Unlock controls"}
							</Button>
							<p className="m-0 text-center text-xs text-content-secondary">
								Server verified. Five attempts per five minutes.
							</p>
						</>
					)}
					{settings && (
						<Button
							type="button"
							variant="subtle"
							onClick={() => {
								setSettings(false);
								setPIN("");
								setRepeat("");
								setCurrent("");
							}}
						>
							Cancel PIN change
						</Button>
					)}
					{unlock.error || configure.error || close.error ? (
						<ErrorAlert
							error={unlock.error || configure.error || close.error}
						/>
					) : null}
				</form>
			</div>
		</div>
	);
};
