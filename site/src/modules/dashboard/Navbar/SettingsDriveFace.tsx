import { CloudIcon, FileIcon, FolderIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import {
	cloudDriveSettings,
	quotaMeResources,
	safe,
	safeListing,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import {
	isLinked,
	useCloudDriveLinks,
} from "#/modules/platform/cloudDrive/CloudDriveSocket";
import {
	CloudDriveWindow,
	type View,
} from "#/modules/platform/cloudDrive/CloudDriveWindow";
import { formatBytes } from "#/modules/platform/cloudDrive/drivePaths";
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
	// The drive's top folder, listed in the face; each entry opens the Cloud Drive window right at it.
	const listing = useQuery(
		safeListing("", Boolean(drive.data && drive.data.enabled !== false)),
	);
	const [openAt, setOpenAt] = useState<{
		drive: string;
		path: string;
		file?: string;
	} | null>(null);
	const [view, setView] = useState<View>("files");
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
					details={
						<FilesTable
							files={drive.data.files}
							mountPath={drive.data.mountPath}
							folders={listing.data?.folders.map((f) => f.name) ?? []}
							entries={listing.data?.files ?? []}
							onOpen={(path, file) => {
								setView("files");
								setOpenAt({ drive: "", path, file });
							}}
						/>
					}
				/>
			)}
			{drive.data && (
				<CloudDriveWindow
					open={openAt !== null}
					onOpenChange={(open) => !open && setOpenAt(null)}
					view={view}
					onView={setView}
					summary={drive.data}
					openAt={openAt ?? undefined}
				/>
			)}
		</div>
	);
};

/**
 * The face's Files: the count and mount path, then the drive's top folders and files in a compact, scrollable zebra
 * table, each a link that opens the Cloud Drive window at it.
 */
const FilesTable: React.FC<{
	files: number;
	mountPath: string | null | undefined;
	folders: readonly string[];
	entries: readonly { name: string; size: number }[];
	onOpen: (path: string, file?: string) => void;
}> = ({ files, mountPath, folders, entries, onOpen }) => (
	<div className="flex min-h-0 flex-col gap-1.5 border-0 border-t border-solid border-border pt-2 text-[11px]">
		<div className="flex justify-between gap-2 text-content-secondary">
			<span>
				Files{" "}
				<span className="tabular-nums text-content-primary">
					{files.toLocaleString("en-US")}
				</span>
			</span>
			<span className="truncate font-mono" title={mountPath ?? undefined}>
				{mountPath || "Not mounted"}
			</span>
		</div>
		{folders.length + entries.length > 0 ? (
			<div className="max-h-28 overflow-y-auto overscroll-contain rounded-md border border-solid border-border scrollbar-thin [scrollbar-color:hsl(var(--surface-quaternary))_transparent]">
				<table
					aria-label="Cloud Drive files"
					className="w-full border-collapse"
				>
					<tbody>
						{[
							...folders.map((name) => ({ name, folder: true, size: 0 })),
							...entries.map((f) => ({ ...f, folder: false })),
						].map((entry) => (
							<tr
								key={`${entry.folder ? "d" : "f"}:${entry.name}`}
								className="odd:bg-surface-secondary/60"
							>
								<td className="max-w-0 px-1.5 py-0.5">
									<button
										type="button"
										className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-content-link hover:underline"
										title={`Open ${entry.name} in the Cloud Drive`}
										onClick={() =>
											entry.folder ? onOpen(entry.name) : onOpen("", entry.name)
										}
									>
										{entry.folder ? (
											<FolderIcon aria-hidden className="size-3 shrink-0" />
										) : (
											<FileIcon aria-hidden className="size-3 shrink-0" />
										)}
										<span className="truncate">{entry.name}</span>
									</button>
								</td>
								<td className="whitespace-nowrap px-1.5 py-0.5 text-right tabular-nums text-content-secondary">
									{entry.folder ? "Folder" : formatBytes(entry.size)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		) : (
			<p className="m-0 text-content-secondary">No files yet.</p>
		)}
	</div>
);
