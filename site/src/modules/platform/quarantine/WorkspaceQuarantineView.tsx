import { ShieldBanIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";

type Props = {
	name: string;
	enabled?: boolean;
	reason?: string;
	canManage?: boolean;
	loading?: boolean;
	busy?: boolean;
	error?: unknown;
	onRetry: () => void;
	onChange: (enabled: boolean, reason: string, onSuccess: () => void) => void;
	children?: React.ReactNode;
};

/** Separates requested quarantine policy from independently reported enforcement. */
export const WorkspaceQuarantineView: React.FC<Props> = ({
	name,
	enabled,
	reason,
	canManage,
	loading,
	busy,
	error,
	onRetry,
	onChange,
	children,
}) => {
	const [confirm, setConfirm] = useState(false);
	const [activate, setActivate] = useState(true);
	const [draftReason, setDraftReason] = useState("");
	const reasonId = useId();
	const reasonTooLong =
		new TextEncoder().encode(draftReason.trim()).length > 1000;
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<section
			aria-label={`Quarantine ${name}`}
			className="rounded-lg border border-solid border-border p-4 flex flex-col gap-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base">
					<ShieldBanIcon aria-hidden className="size-4" />
					Quarantine
				</h3>
				{canManage && (
					<Button
						ref={trigger}
						size="sm"
						variant="outline"
						disabled={loading || busy || enabled === undefined}
						onClick={() => {
							setActivate(!enabled);
							setDraftReason("");
							setConfirm(true);
						}}
					>
						{busy ? <Spinner loading /> : null}
						{enabled ? "Release quarantine" : "Quarantine workspace"}
					</Button>
				)}
			</div>
			{loading && <Spinner loading />}
			{error ? (
				<>
					<ErrorAlert error={error} />
					<Button size="sm" variant="outline" onClick={onRetry}>
						Retry quarantine status
					</Button>
				</>
			) : null}
			{enabled !== undefined && (
				<p className="m-0 text-sm text-content-secondary">
					{enabled
						? "Quarantine requested. Workspace access is blocked for all users, including administrators. Network isolation is confirmed only by the enforcement results below."
						: "Quarantine is off. Releasing quarantine keeps the workspace stopped and does not reconnect sessions or shares. Start it manually after review."}
				</p>
			)}
			{enabled && reason && (
				<p className="m-0 text-sm break-words">Reason: {reason}</p>
			)}
			{children}
			<ConfirmDialog
				open={confirm}
				title={
					activate ? `Quarantine ${name}?` : `Release quarantine for ${name}?`
				}
				hideCancel={false}
				confirmText={activate ? "Quarantine workspace" : "Release quarantine"}
				confirmLoading={busy}
				disabled={reasonTooLong || (activate && !draftReason.trim())}
				onClose={() => {
					if (!busy) setConfirm(false);
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					trigger.current?.focus();
				}}
				onConfirm={() =>
					onChange(activate, draftReason.trim(), () => setConfirm(false))
				}
				description={
					<div className="flex flex-col gap-4">
						<p className="m-0">
							{!activate
								? "The workspace stays stopped. Release does not start it, reconnect sessions, or restore disconnected shares. Announcements and chat remain available."
								: "This blocks workspace access for everyone, including administrators, requests a host-enforced stop, and disconnects workspace tunnels and Cloud Drive links. HOME data is retained. Announcements, chat, and workspace metadata remain accessible. Enforcement may remain pending or unverified until the host confirms isolation."}
						</p>
						<div className="flex flex-col gap-2">
							<Label htmlFor={reasonId}>
								{activate ? "Reason" : "Release note (optional)"}
							</Label>
							<Input
								id={reasonId}
								aria-invalid={reasonTooLong}
								value={draftReason}
								maxLength={1000}
								onChange={(event) => setDraftReason(event.target.value)}
							/>
							{reasonTooLong && (
								<p
									role="alert"
									className="m-0 text-sm text-content-destructive"
								>
									Reason must be at most 1,000 UTF-8 bytes.
								</p>
							)}
						</div>
						{error ? <ErrorAlert error={error} /> : null}
					</div>
				}
			/>
		</section>
	);
};
