import { CloudIcon } from "lucide-react";
import { useQuery } from "react-query";
import {
	cloudDriveSettings,
	quotaMeResources,
	safe,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import {
	isLinked,
	useCloudDriveLinks,
} from "#/modules/platform/cloudDrive/CloudDriveSocket";
import { CloudDriveCardBody } from "#/pages/DashboardPage/StorageCards";

/**
 * The Settings panel's Cloud Drive face, as detailed as its Metrics face: the drive (its bucket, connection and
 * encryption), what it holds against its quota and what is shared in, its files and mount path, and which of the
 * account's workspaces have it connected (the Dashboard's Cloud Drive card).
 */
export const SettingsDriveFace: React.FC = () => {
	const drive = useQuery(safe());
	const settings = useQuery(cloudDriveSettings());
	const mine = useQuery(quotaMeResources(false));
	const links = useCloudDriveLinks();
	const workspaces = links.ready
		? (mine.data?.workspaces ?? []).map((w) => ({
				id: w.id,
				label: w.name,
				value: !isLinked(links, w.id)
					? "Disconnected"
					: links.attaching.has(w.id)
						? "Connecting"
						: "Connected",
			}))
		: [];
	const connected = workspaces.filter((w) => w.value !== "Disconnected").length;
	return (
		<div className="flex h-full flex-col gap-3 rounded-lg border border-solid border-border bg-surface-primary p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-primary">
					<CloudIcon aria-hidden className="size-3.5" />
					Cloud Drive
				</span>
				{workspaces.length > 0 && (
					<span className="rounded-full border border-solid border-border bg-surface-secondary px-1.5 text-[10px] leading-4 tabular-nums text-content-secondary">
						{connected} of {workspaces.length} connected
					</span>
				)}
			</div>
			{drive.isLoading && <Loader size="sm" />}
			{drive.error && !drive.data && <ErrorAlert error={drive.error} />}
			{drive.data?.enabled === false && (
				<p className="m-0 text-xs text-content-secondary">
					Cloud Drive is not available on this deployment.
				</p>
			)}
			{drive.data && drive.data.enabled !== false && (
				<CloudDriveCardBody
					drive={drive.data}
					settings={settings.data}
					workspaces={workspaces}
				/>
			)}
		</div>
	);
};
