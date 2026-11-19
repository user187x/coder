import { useId, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import {
	type CloudDriveCleanupScan,
	reviewCloudDriveCleanup,
	startCloudDriveCleanup,
} from "#/api/clusterNetwork";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Label } from "#/components/Label/Label";
import type { useSearchParamsKey } from "#/hooks/useSearchParamsKey";

export const CloudDriveCleanupControls: React.FC<{
	scan?: CloudDriveCleanupScan | null;
	review: ReturnType<typeof useSearchParamsKey>;
}> = ({ scan, review }) => {
	const client = useQueryClient();
	const start = useMutation(startCloudDriveCleanup(client));
	const busy = scan?.status === "scanning" || scan?.status === "deleting";

	return (
		<div className="flex flex-wrap items-center gap-2">
			{scan?.status === "ready" ? (
				<>
					<Button variant="outline" onClick={() => review.setValue(scan.id)}>
						Review cleanup
					</Button>
					{review.value === scan.id && (
						<CleanupReview
							key={scan.id}
							scan={scan}
							onClose={review.deleteValue}
						/>
					)}
				</>
			) : (
				<Button
					variant="outline"
					disabled={busy || start.isPending}
					onClick={() => start.mutate()}
				>
					{scan?.status === "scanning"
						? "Scanning volumes…"
						: scan?.status === "deleting"
							? "Deleting volumes…"
							: "Clean Up"}
				</Button>
			)}
			{start.error && <ErrorAlert error={start.error} />}
			{scan?.error && (
				<p role="alert" className="m-0 text-xs text-content-destructive">
					{scan.error}
				</p>
			)}
			{scan?.status === "complete" && !scan.deleted && (
				<p role="status" className="m-0 text-xs">
					{scan.kept
						? "All flagged volumes were kept."
						: "No eligible volumes found."}
				</p>
			)}
			{scan?.deleted && (
				<p role="status" className="m-0 text-xs">
					Deletion requested for {scan.deleted.length} of{" "}
					{scan.deleted.length + (scan.skipped?.length ?? 0)} selected volumes.
				</p>
			)}
			{scan?.skipped?.map(({ name, reason }) => (
				<p key={name} className="m-0 text-xs text-content-secondary">
					{name}: {reason}
				</p>
			))}
		</div>
	);
};

const CleanupReview: React.FC<{
	scan: CloudDriveCleanupScan;
	onClose: () => void;
}> = ({ scan, onClose }) => {
	const client = useQueryClient();
	const review = useMutation(reviewCloudDriveCleanup(client));
	const checkboxId = useId();
	const [selected, setSelected] = useState<ReadonlySet<string>>(
		() => new Set(scan.candidates?.map(({ name }) => name)),
	);
	const submit = (names: readonly string[]) =>
		review.mutate({ id: scan.id, names }, { onSuccess: onClose });
	return (
		<ConfirmDialog
			open
			title="Review Cloud Drive cleanup"
			type="delete"
			confirmText={`Delete selected (${selected.size})`}
			disabled={review.isPending || selected.size === 0}
			onConfirm={() => submit([...selected])}
			onClose={onClose}
			description={
				<div className="flex flex-col gap-3">
					<p className="m-0">
						Review volumes for deleted accounts. Cleanup removes the Kubernetes
						volumes and claims. Cloud Drive files stay in storage.
					</p>
					<div className="max-h-56 space-y-2 overflow-y-auto">
						{scan.candidates?.map(({ name, account }) => (
							<div key={name} className="flex items-center gap-2">
								<Checkbox
									id={`${checkboxId}-${name}`}
									checked={selected.has(name)}
									disabled={review.isPending}
									onCheckedChange={(check) =>
										setSelected((current) => {
											const next = new Set(current);
											if (check === true) next.add(name);
											else next.delete(name);
											return next;
										})
									}
								/>
								<Label htmlFor={`${checkboxId}-${name}`}>
									{account} · {name}
								</Label>
							</div>
						))}
					</div>
					<Button
						variant="outline"
						disabled={review.isPending}
						onClick={() => submit([])}
					>
						Keep all and dismiss
					</Button>
					{review.error && <ErrorAlert error={review.error} />}
				</div>
			}
		/>
	);
};
