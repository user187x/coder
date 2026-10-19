import { useRef, useState } from "react";
import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "react-query";
import { toast } from "sonner";
import {
	createAndBuildTemplateVersion,
	enableTemplateParameterCompatibilityMode,
	templateVersion,
	templateVersionsQueryKey,
	updateActiveTemplateVersion,
} from "#/api/queries/templates";
import type { Template } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	ResetGlyph,
	SlidersGlyph,
} from "#/modules/platform/settingsPage/settingsIcons";
import {
	CardLoader,
	SettingsCard,
	ToggleRow,
} from "#/modules/platform/settingsPage/settingsParts";
import { formatDate } from "#/utils/time";

/**
 * Parameters: how the template's parameters are resolved (dynamic, or the deprecated compatibility mode), and its
 * cached data refreshed with a new version. Both act at once, as on the former Parameters page.
 */
export const TemplateParametersCard: React.FC<{
	template: Template;
	canUpdate: boolean;
}> = ({ template, canUpdate }) => {
	const queryClient = useQueryClient();
	const versionQuery = useQuery({
		...templateVersion(template.active_version_id),
		placeholderData: keepPreviousData,
	});
	const activeVersion = versionQuery.data;
	const compatibility = useMutation(
		enableTemplateParameterCompatibilityMode(template, queryClient),
	);
	const build = useMutation(
		createAndBuildTemplateVersion(template.organization_name),
	);
	const promote = useMutation(
		updateActiveTemplateVersion(template, queryClient),
	);
	const [confirming, setConfirming] = useState(false);
	const refreshButton = useRef<HTMLButtonElement>(null);
	const refreshing = build.isPending || promote.isPending;
	const error =
		versionQuery.error ?? compatibility.error ?? build.error ?? promote.error;
	const importedAt = activeVersion?.job.completed_at;

	const refresh = async () => {
		if (!activeVersion) {
			return;
		}
		build.reset();
		promote.reset();
		try {
			const newVersion = await build.mutateAsync({
				template_id: template.id,
				provisioner: "terraform",
				storage_method: "file",
				file_id: activeVersion.job.file_id,
				tags: activeVersion.job.tags,
				message: "Refreshed template data",
			});
			await queryClient.invalidateQueries({
				queryKey: templateVersionsQueryKey(template.id),
			});
			await promote.mutateAsync(newVersion.id);
			toast.success(`Template "${template.name}" data refreshed successfully.`);
		} catch {}
	};

	return (
		<SettingsCard
			id="parameters"
			title="Parameters"
			description="How its parameters are resolved when a workspace is created"
			icon={<SlidersGlyph size={18} />}
		>
			<div className="flex flex-col gap-2 px-6 py-2">
				{error ? <ErrorAlert error={error} className="mt-4" /> : null}
				{!canUpdate && (
					<p className="ws-help">
						You need permission to update this template to change these
						settings.
					</p>
				)}
				<ToggleRow
					id="use_classic_parameter_flow"
					label="Use parameter compatibility mode for workspace builds"
					badge={
						<>
							<Badge size="sm" variant="warning">
								Deprecated
							</Badge>
							{compatibility.isPending && (
								<Spinner loading size="sm" label="Saving" />
							)}
						</>
					}
					description='Only if this template does not work with dynamic parameters: workspace builds fall back to the older "Rich parameters" strategy, which is deprecated and will be removed. Dynamic parameters (the default since Coder 2.25) bring more form types, identity-aware values, conditional parameters and data sources; some templates need their data refreshed for them to work.'
					pressed={template.use_classic_parameter_flow}
					disabled={!canUpdate || compatibility.isPending}
					onChange={(pressed) => {
						compatibility.reset();
						compatibility.mutate(pressed, {
							onSuccess: () =>
								toast.success(
									pressed
										? `${template.display_name} will use parameter compatibility mode.`
										: `${template.display_name} will use dynamic parameters.`,
								),
						});
					}}
				/>
				<div className="py-[18px]">
					<div className="font-medium">Template data</div>
					<p className="ws-desc">
						Coder caches some values (Terraform <code>data</code> sources) when
						a version is created, and every workspace built from it reuses them.
						Refreshing creates a new version, with them fetched again.
					</p>
					{!activeVersion ? (
						<CardLoader />
					) : (
						<div className="mt-3 flex flex-wrap items-center justify-between gap-4">
							<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[13px]">
								<dt className="text-(--ws-muted)">Active version</dt>
								<dd className="ws-mono m-0">{activeVersion.name}</dd>
								<dt className="text-(--ws-muted)">Last imported</dt>
								<dd className="m-0">
									{importedAt ? formatDate(new Date(importedAt)) : "Unknown"}
								</dd>
							</dl>
							<button
								ref={refreshButton}
								type="button"
								className="ws-btn ws-btn-sm ws-hit"
								disabled={!canUpdate || refreshing}
								onClick={() => setConfirming(true)}
							>
								{refreshing ? <Spinner loading size="sm" /> : <ResetGlyph />}
								Refresh template data
							</button>
						</div>
					)}
				</div>
			</div>
			<ConfirmDialog
				open={confirming}
				type="info"
				hideCancel={false}
				title="Refresh template data"
				description={
					<>
						This creates a new template version from the same source as{" "}
						<strong>{activeVersion?.name}</strong> and makes it the active
						version. New workspaces will use it immediately. Existing workspaces
						keep running until they are updated.
					</>
				}
				confirmText="Refresh"
				onClose={() => setConfirming(false)}
				onConfirm={() => {
					setConfirming(false);
					void refresh();
				}}
				// Radix returns focus to its trigger on close, and this dialog has
				// none, so focus would land on <body>.
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					refreshButton.current?.focus();
				}}
			/>
		</SettingsCard>
	);
};
