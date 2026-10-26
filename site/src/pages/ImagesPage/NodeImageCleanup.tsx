import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	nodeImageCleanup,
	onNodesKey,
	previewNodeImageCleanup,
	purgeNodeImages,
} from "#/api/queries/nodeImageCleanup";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";

/** Reviews current workload references again immediately before node-cache removal. */
export const NodeImageCleanup = ({
	images,
	label = "Purge selected",
}: {
	images: string[];
	label?: string;
}) => {
	const [open, setOpen] = useState(false);
	const [operation, setOperation] = useState("");
	const queryClient = useQueryClient();
	const preview = useMutation(previewNodeImageCleanup());
	const purge = useMutation({
		...purgeNodeImages(),
		onSuccess: (result) => {
			setOperation(result.id);
			void queryClient.invalidateQueries({ queryKey: onNodesKey });
		},
	});
	const progress = useQuery(nodeImageCleanup(operation));

	const finished =
		progress.data?.status === "complete" || progress.data?.status === "failed";
	const running = purge.isPending || (Boolean(operation) && !finished);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				disabled={(images.length === 0 && !operation) || purge.isPending}
				onClick={() => {
					setOpen(true);
					if (operation) return;
					purge.reset();
					preview.mutate(images);
				}}
			>
				{running ? "View cleanup progress" : label}
			</Button>
			<ConfirmDialog
				open={open}
				type="delete"
				title="Purge unused node images"
				confirmText={finished ? "Close" : "Purge reviewed images"}
				disabled={
					!preview.data ||
					preview.isPending ||
					(Boolean(operation) && !finished)
				}
				confirmLoading={running}
				onClose={() => {
					setOpen(false);
				}}
				onConfirm={() => {
					if (finished) {
						setOpen(false);
						setOperation("");
						void queryClient.invalidateQueries({ queryKey: onNodesKey });
					} else if (preview.data) purge.mutate(preview.data);
				}}
				description={
					<div className="flex flex-col gap-3">
						<p>
							Removes cached images from the listed nodes. This can permanently
							remove locally loaded images that have no registry copy. Shared
							layers may remain. Registry images and workspace volumes are
							preserved.
						</p>
						<p>
							Images referenced by workloads or runtime containers are
							protected. Each node rechecks references and uses the runtime's
							non-forced removal.
						</p>
						{preview.isPending && (
							<p role="status">Checking workload references...</p>
						)}
						{preview.error && <ErrorAlert error={preview.error} />}
						{purge.error && <ErrorAlert error={purge.error} />}
						{progress.error && <ErrorAlert error={progress.error} />}
						{preview.data && (
							<ul className="max-h-56 overflow-auto">
								{preview.data.nodes.map((target) => (
									<li key={target.node}>
										{target.node}
										<ul>
											{target.images.map((image) => (
												<li className="break-all font-mono text-xs" key={image}>
													{image}
												</li>
											))}
										</ul>
									</li>
								))}
							</ul>
						)}
						{progress.data && (
							<div role="status">
								Cleanup {progress.data.status}.
								{progress.data.jobs.map((job) => (
									<p key={job.name}>
										{job.node ?? job.name}:{" "}
										{job.error ??
											`${job.removed ?? 0} removed, ${job.absent ?? 0} already absent`}
									</p>
								))}
								{progress.data.status === "complete" && (
									<p>Node image lists may take a few minutes to refresh.</p>
								)}
								{progress.data.status === "failed" &&
									" A node refused cleanup. No forced removal was attempted."}
							</div>
						)}
					</div>
				}
			/>
		</>
	);
};
