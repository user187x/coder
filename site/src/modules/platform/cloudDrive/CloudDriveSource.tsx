import { FolderInputIcon, UndoIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import {
	cloudDriveConnections,
	invalidateCloudDrive,
	safe,
} from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";

/**
 * The Cloud Drive window's Source: a folder of one of the owner's workspaces as their Cloud Drive instead of its S3
 * storage. That workspace serves the folder; their other workspaces mount it (from their next start) while it runs.
 * The S3 storage keeps its files, unused, until the owner goes back to it. Deleting the source workspace is guarded
 * (its connected workspaces confirmed one by one, and "delete" typed).
 */
export const CloudDriveSource: React.FC = () => {
	const queryClient = useQueryClient();
	const summary = useQuery(safe());
	const connections = useQuery(cloudDriveConnections());
	const list = useQuery(workspaces({ q: "owner:me" }));
	const source = connections.data?.source ?? summary.data?.source ?? null;
	const shared = new Set(connections.data?.shared ?? []);
	const mine = (list.data?.workspaces ?? []).filter((w) => !shared.has(w.id));
	const [workspace, setWorkspace] = useState("");
	const [path, setPath] = useState("");
	const [confirmClear, setConfirmClear] = useState(false);
	const set = useMutation({
		mutationFn: () => PlatformAPI.setCloudDriveSource(workspace, path),
		onSuccess: () => {
			toast.success(
				"Your Cloud Drive is that folder now: your other workspaces have it from their next start.",
			);
			setPath("");
			void invalidateCloudDrive(queryClient);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not changed.")),
	});
	const clear = useMutation({
		mutationFn: PlatformAPI.clearCloudDriveSource,
		onSuccess: () => {
			setConfirmClear(false);
			toast.success(
				"Back on its S3 storage: your workspaces have it from their next start.",
			);
			void invalidateCloudDrive(queryClient);
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not changed.")),
	});
	const encrypted = Boolean(
		connections.data?.encrypted ?? summary.data?.encrypted,
	);

	return (
		<div
			className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-6 py-5"
			data-testid="cloud-drive-source"
		>
			{source ? (
				<div className="flex flex-col gap-3">
					<p className="m-0 text-sm">
						Your Cloud Drive is the folder{" "}
						<span className="font-mono text-xs">{source.path}</span> of your
						workspace <span className="font-medium">{source.name}</span>,{" "}
						{source.running ? (
							<span className="text-content-success">served now</span>
						) : (
							<span className="text-content-warning">
								which is not running: start it to reach your files
							</span>
						)}
						.
					</p>
					{source.error && (
						<Alert severity="warning">
							<AlertTitle>Its server</AlertTitle>
							<AlertDescription>{source.error}</AlertDescription>
						</Alert>
					)}
					<p className="m-0 text-xs text-content-secondary">
						Your other workspaces mount it from their next start, while it runs;
						it has the folder itself at ~/cloud-drive. Your files on the S3
						storage stay as they were until you go back to it.
					</p>
					<div>
						<Button variant="outline" onClick={() => setConfirmClear(true)}>
							<UndoIcon />
							Back to the S3 storage
						</Button>
					</div>
				</div>
			) : (
				<p className="m-0 text-sm text-content-secondary">
					Your Cloud Drive is on the deployment's S3 storage. Instead, a folder
					of one of your workspaces can be it: that workspace serves the folder
					to your other workspaces while it runs, and deleting it asks you to
					confirm each workspace connected to it.
				</p>
			)}

			{encrypted ? (
				<Alert severity="info">
					<AlertDescription>
						Your Cloud Drive is encrypted: a workspace's folder can be its
						source once encryption is off.
					</AlertDescription>
				</Alert>
			) : (
				<form
					className="flex flex-col gap-3 border-0 border-t border-solid border-border pt-4"
					onSubmit={(e) => {
						e.preventDefault();
						set.mutate();
					}}
				>
					<span className="text-sm font-medium">
						{source
							? "Another folder"
							: "A workspace's folder as my Cloud Drive"}
					</span>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1">
							<Label htmlFor="cd-src-ws">Workspace</Label>
							<Select value={workspace} onValueChange={setWorkspace}>
								<SelectTrigger id="cd-src-ws">
									<SelectValue placeholder="Choose one of yours" />
								</SelectTrigger>
								<SelectContent>
									{mine.map((w) => (
										<SelectItem key={w.id} value={w.id}>
											{w.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1">
							<Label htmlFor="cd-src-path">Folder</Label>
							<Input
								id="cd-src-path"
								placeholder="/home/coder/data or data"
								value={path}
								onChange={(e) => setPath(e.target.value)}
							/>
						</div>
					</div>
					<span className="text-xs text-content-secondary">
						A folder in its home (absolute, or relative to /home/coder), not the
						home itself or a hidden folder. A shared workspace cannot be the
						source.
					</span>
					<div>
						<Button
							type="submit"
							disabled={!workspace || !path || set.isPending}
						>
							<Spinner loading={set.isPending}>
								<FolderInputIcon />
							</Spinner>
							Make it my Cloud Drive
						</Button>
					</div>
				</form>
			)}

			<ConfirmDialog
				type="info"
				open={confirmClear}
				title="Back to the S3 storage?"
				description="Your workspaces have the Cloud Drive on its S3 storage again from their next start, with the files it had there. The workspace's folder stays as it is."
				confirmText="Go back"
				confirmLoading={clear.isPending}
				onClose={() => setConfirmClear(false)}
				onConfirm={() => clear.mutate()}
			/>
		</div>
	);
};
