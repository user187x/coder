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
 * Parameters: how the template's parameters are resolved (dynamic parameters on, or off: the deprecated compatibility
 * mode, the only case that shows a warning), and its cached data refreshed with a new version. Both act at once, as on
 * the former Parameters page.
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
				{/* On is the default and what the templates here use; off is the deprecated compatibility mode, which
				    only then shows its warning */}
				<ToggleRow
					id="use_classic_parameter_flow"
					label="Dynamic parameters"
					badge={
						<>
							{template.use_classic_parameter_flow && (
								<Badge size="sm" variant="warning">
									Compatibility mode (deprecated)
								</Badge>
							)}
							{compatibility.isPending && (
								<Spinner loading size="sm" label="Saving" />
							)}
						</>
					}
					description="Workspace builds resolve this template's parameters with dynamic parameters, the default since Coder 2.25: more form types, identity-aware values, conditional parameters and data sources. Some templates need their data refreshed for them to work."
					note={
						template.use_classic_parameter_flow
							? 'This template uses parameter compatibility mode: the older "Rich parameters" strategy, which is deprecated and will be removed. Turn dynamic parameters on unless the template does not work with them.'
							: undefined
					}
					pressed={!template.use_classic_parameter_flow}
					disabled={!canUpdate || compatibility.isPending}
					onChange={(dynamic) => {
						compatibility.reset();
						compatibility.mutate(!dynamic, {
							onSuccess: () =>
								toast.success(
									dynamic
										? `${template.display_name} will use dynamic parameters.`
										: `${template.display_name} will use parameter compatibility mode.`,
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
