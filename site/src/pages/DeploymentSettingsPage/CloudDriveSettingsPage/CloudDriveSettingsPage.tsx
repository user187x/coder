import { CloudIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformAPI } from "#/api/platform";
import { cloudDriveSettings, safeKey } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { Switch } from "#/components/Switch/Switch";
import { CloudDriveSettings } from "#/modules/platform/cloudDrive/CloudDriveSettings";
import { pageTitle } from "#/utils/page";

/**
 * Platform: Admin Settings > Cloud Drive. At the top, the Cloud Drive on or off for everyone - off, every workspace's
 * drive is unlinked at once and no one is shown one (the platform service: safe.py's save_enabled); then where it
 * keeps files and every account's capacity (CloudDriveSettings, as in the Cloud Drive window's Settings).
 */
const CloudDriveSettingsPage: React.FC = () => {
	const queryClient = useQueryClient();
	const settings = useQuery(cloudDriveSettings());
	const toggle = useMutation({
		mutationFn: (enabled: boolean) => PlatformAPI.setCloudDriveEnabled(enabled),
		onSuccess: (data) => {
			toast.success(
				data.enabled
					? "The Cloud Drive is on for everyone."
					: "The Cloud Drive is off for everyone.",
			);
			void queryClient.invalidateQueries({ queryKey: safeKey });
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "The Cloud Drive was not switched.")),
	});
	const on = settings.data?.enabled ?? true;

	return (
		<>
			<title>{pageTitle("Cloud Drive")}</title>
			<h1 className="sr-only">Cloud Drive</h1>

			{settings.isLoading && <Loader />}
			{settings.error ? (
				<ErrorAlert error={settings.error} />
			) : (
				settings.data && (
					<div className="flex flex-col gap-6">
						<section
							data-testid="cloud-drive-enabled"
							className="flex items-center gap-4 rounded-lg border border-solid border-border px-6 py-5 bg-surface-primary"
						>
							<CloudIcon
								aria-hidden
								className={
									on
										? "size-6 shrink-0 text-content-success"
										: "size-6 shrink-0 text-content-disabled"
								}
							/>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<label
									htmlFor="cloud-drive-enabled"
									className="text-base font-semibold text-content-primary"
								>
									Cloud Drive for everyone
								</label>
								<span className="text-sm text-content-secondary">
									{on
										? "On: every user has their Cloud Drive, linked into their workspaces."
										: `Off${
												settings.data.turnedOff?.by
													? ` (by ${settings.data.turnedOff.by}${
															settings.data.turnedOff.at
																? `, ${new Date(settings.data.turnedOff.at * 1000).toLocaleString()}`
																: ""
														})`
													: ""
											}: no one is shown a Cloud Drive, and it is unlinked from every workspace. Its files stay where they are.`}
								</span>
							</div>
							<Switch
								id="cloud-drive-enabled"
								data-testid="cloud-drive-enabled-switch"
								checked={on}
								disabled={!settings.data.canEdit || toggle.isPending}
								onCheckedChange={(next) => toggle.mutate(next)}
							/>
						</section>
						<div className="rounded-lg border border-solid border-border bg-surface-primary">
							<CloudDriveSettings settings={settings.data} />
						</div>
					</div>
				)
			)}
		</>
	);
};

export default CloudDriveSettingsPage;
