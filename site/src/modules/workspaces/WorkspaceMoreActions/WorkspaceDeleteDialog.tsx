import dayjs from "dayjs";
import { useContext, useId, useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import { cloudDriveSourceGuard } from "#/api/queries/platform";
import type {
	CreateWorkspaceBuildRequest,
	Workspace,
} from "#/api/typesGenerated";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	DeleteConfirmationField,
	useDeleteConfirmation,
} from "#/components/Dialog/DeleteDialog/DeleteConfirmationField";
import { Input } from "#/components/Input/Input";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { AuthContext } from "#/contexts/auth/AuthProvider";

const warnBoxClassName =
	"mt-6 flex gap-2 rounded-lg border border-solid border-border-warning bg-surface-orange p-3 leading-snug text-content-warning";

type WorkspaceDeleteDialogProps = {
	workspace: Workspace;
	canDeleteFailedWorkspace: boolean;
	isOpen: boolean;
	onCancel: () => void;
	onConfirm: (arg: CreateWorkspaceBuildRequest["orphan"]) => void;
};

export const WorkspaceDeleteDialog: React.FC<WorkspaceDeleteDialogProps> = ({
	workspace,
	canDeleteFailedWorkspace,
	isOpen,
	onCancel,
	onConfirm,
}) => {
	const orphanId = useId();
	// Platform: the owner's Cloud Drive source (a folder of this workspace is their Cloud Drive) is guarded: each
	// workspace connected to it confirmed, and "delete" typed (then Enter). Only the owner's own workspaces.
	const me = useContext(AuthContext)?.user?.id;
	const guard = useQuery(
		cloudDriveSourceGuard(
			workspace.id,
			isOpen && Boolean(me) && workspace.owner_id === me,
		),
	);
	const source = guard.data?.source ? guard.data : undefined;
	const [okToDisconnect, setOkToDisconnect] = useState<Record<string, boolean>>(
		{},
	);
	const [typed, setTyped] = useState("");
	const [releasing, setReleasing] = useState(false);
	const [releaseError, setReleaseError] = useState<string>();
	const allConfirmed =
		source?.connected.every((w) => okToDisconnect[w.id]) ?? false;
	const sourceConfirmed = Boolean(source) && allConfirmed && typed === "delete";

	const confirmation = useDeleteConfirmation(workspace.name, isOpen);
	const [orphanWorkspace, setOrphanWorkspace] =
		useState<CreateWorkspaceBuildRequest["orphan"]>(false);
	const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

	// The dialog stays mounted while closed, so clear the checkbox on close.
	if (isOpen !== prevIsOpen) {
		setPrevIsOpen(isOpen);
		if (!isOpen) {
			setOrphanWorkspace(false);
			setOkToDisconnect({});
			setTyped("");
			setReleaseError(undefined);
		}
	}

	const confirm = async () => {
		if (source) {
			if (!sourceConfirmed) {
				return;
			}
			// the Cloud Drive back on its S3 storage, its connected workspaces disconnected; then the delete
			setReleasing(true);
			try {
				await PlatformAPI.releaseCloudDriveSource({
					workspace: workspace.id,
					disconnect: source.connected.map((w) => w.id),
					confirm: typed,
				});
			} catch (e) {
				setReleaseError(
					getErrorMessage(e, "The Cloud Drive was not released."),
				);
				return;
			} finally {
				setReleasing(false);
			}
		}
		onConfirm(orphanWorkspace);
	};

	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (source ? sourceConfirmed : confirmation.confirmed) {
			void confirm();
		}
	};

	// Orphaning is sort of a "last resort" that should really only
	// be used under the following circumstances:
	// a) Terraform is failing to apply while deleting, which
	//    usually means that builds are failing as well.
	// b) No provisioner is available to delete the workspace, which will
	//    cause the job to remain in the "pending" state indefinitely.
	//    The assumption here is that an admin will cancel the job, in which
	//    case we want to allow them to perform an orphan-delete.
	const canOrphan =
		canDeleteFailedWorkspace &&
		(workspace.latest_build.status === "failed" ||
			workspace.latest_build.status === "canceled");

	return (
		<ConfirmDialog
			type="delete"
			hideCancel={false}
			open={isOpen}
			title="Delete Workspace"
			onConfirm={() => void confirm()}
			onClose={onCancel}
			disabled={
				guard.isLoading ||
				releasing ||
				(source ? !sourceConfirmed : !confirmation.confirmed)
			}
			description={
				<>
					<div className="flex items-center justify-between rounded-md border border-solid border-border p-4 mb-5 leading-snug">
						<div>
							<p className="m-0 text-base font-semibold text-content-primary">
								{workspace.name}
							</p>
							<p className="m-0 text-xs text-content-secondary">workspace</p>
						</div>
						<div className="text-right">
							<p className="m-0 text-xs font-medium text-content-primary">
								{dayjs(workspace.created_at).fromNow()}
							</p>
							<p className="m-0 text-xs text-content-secondary">created</p>
						</div>
					</div>

					<p>Deleting this workspace is irreversible!</p>
					{source ? (
						<div
							className="flex flex-col gap-3"
							data-testid="cloud-drive-source-guard"
						>
							<div className={warnBoxClassName.replace("mt-6 ", "")}>
								<span>
									Its folder <strong>{source.path}</strong> is your Cloud Drive.
									Deleting it takes the Cloud Drive away from{" "}
									{source.connected.length === 0
										? "it"
										: "each workspace connected to it"}
									; they have it on its S3 storage again from their next start
									(without this folder's files).
								</span>
							</div>
							{source.connected.length > 0 && (
								<ul className="m-0 flex list-none flex-col gap-2 p-0">
									{source.connected.map((w) => (
										<li
											key={w.id}
											className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-solid border-border px-3 py-2"
										>
											<span className="text-sm text-content-primary">
												{w.name}
												{w.mounted && (
													<span className="text-xs text-content-secondary">
														{" "}
														· has it now
													</span>
												)}
											</span>
											<RadioGroup
												className="flex gap-4"
												aria-label={`Disconnect ${w.name}`}
												value={
													okToDisconnect[w.id]
														? "ok"
														: okToDisconnect[w.id] === false
															? "keep"
															: ""
												}
												onValueChange={(v) =>
													setOkToDisconnect((o) => ({
														...o,
														[w.id]: v === "ok",
													}))
												}
											>
												<span className="flex items-center gap-1.5 text-xs">
													<RadioGroupItem value="keep" id={`keep-${w.id}`} />
													<label htmlFor={`keep-${w.id}`}>Not yet</label>
												</span>
												<span className="flex items-center gap-1.5 text-xs">
													<RadioGroupItem
														value="ok"
														id={`ok-${w.id}`}
														data-testid={`confirm-disconnect-${w.name}`}
													/>
													<label htmlFor={`ok-${w.id}`}>
														Confirm: OK to disconnect
													</label>
												</span>
											</RadioGroup>
										</li>
									))}
								</ul>
							)}
						</div>
					) : (
						<p>
							Type &ldquo;<strong>{workspace.name}</strong>&rdquo; below to
							confirm:
						</p>
					)}

					<form className="mt-2 flex flex-col gap-2" onSubmit={onSubmit}>
						{source ? (
							<>
								<label htmlFor="source-delete-typed" className="text-sm">
									Type &ldquo;<strong>delete</strong>&rdquo; and press Enter
								</label>
								<Input
									id="source-delete-typed"
									autoComplete="off"
									value={typed}
									disabled={!allConfirmed}
									placeholder={
										allConfirmed ? "delete" : "Confirm each workspace first"
									}
									onChange={(e) => setTyped(e.target.value)}
									data-testid="source-delete-typed"
								/>
								{releaseError && (
									<p
										role="alert"
										className="m-0 text-xs text-content-destructive"
									>
										{releaseError}
									</p>
								)}
							</>
						) : (
							<DeleteConfirmationField
								confirmation={confirmation}
								label="Workspace name"
								entity="workspace"
							/>
						)}

						{canOrphan && (
							<div className={warnBoxClassName}>
								<label
									htmlFor={orphanId}
									className="flex items-start gap-2 cursor-pointer"
								>
									<Checkbox
										id={orphanId}
										name="orphan_resources"
										checked={orphanWorkspace}
										onCheckedChange={(checked) => {
											setOrphanWorkspace(checked === true);
										}}
										data-testid="orphan-checkbox"
										className="mt-0.5 border-content-warning hover:enabled:border-content-warning data-[state=checked]:bg-content-warning data-[state=checked]:border-content-warning data-[state=checked]:text-content-invert hover:data-[state=checked]:bg-content-warning hover:data-[state=checked]:border-content-warning"
									/>
									<span>
										<span className="block text-sm font-semibold">
											Orphan Resources
										</span>
										<span className="mt-1 block text-xs text-content-secondary">
											As a Template Admin, you may skip resource cleanup to
											delete a failed workspace. Resources such as volumes and
											virtual machines will not be destroyed.
										</span>
									</span>
								</label>
							</div>
						)}
					</form>
				</>
			}
		/>
	);
};
