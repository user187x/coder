import { cn } from "cn";
import { ChevronRightIcon, CloudIcon, SettingsIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { PlatformError } from "#/api/platform";
import { cloudDriveSettings, safe } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { CloudDriveBrowser } from "./CloudDriveBrowser";
import { CloudDriveRopes } from "./CloudDriveRopes";
import { CloudDriveSettings, StatusIndicator } from "./CloudDriveSettings";
import { formatBytes } from "./drivePaths";
import "./cloudDrive.css";

/**
 * The account's Cloud Drive, once above the Workspaces table on its right: its
 * own files on S3, the same ones each of its workspaces has at ~/cloud-drive,
 * with ropes to each of those workspaces' rows (CloudDriveRopes). Opened, a
 * window in the middle of the screen with the files (CloudDriveBrowser) and
 * its Settings: where the files are kept, and whether that answers. Only ever
 * the signed-in user's own drive; nothing where the deployment has none.
 */
export const CloudDrive: React.FC<{
	/** The signed-in user's workspaces on the page: a rope to each. */
	workspaceIds: readonly string[];
	className?: string;
}> = ({ workspaceIds, className }) => {
	const { data: summary, error } = useQuery(safe());
	const enabled = Boolean(summary?.enabled);
	const settings = useQuery({ ...cloudDriveSettings(), enabled });
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<"files" | "settings">("files");
	const button = useRef<HTMLButtonElement>(null);

	if (
		!summary ||
		!enabled ||
		(error instanceof PlatformError && error.status === 404)
	) {
		return null;
	}
	const status = settings.data?.status;
	const usage = `${formatBytes(summary.usedBytes)} of ${formatBytes(summary.quotaBytes)}`;

	return (
		<>
			<Button
				ref={button}
				variant="outline"
				size="sm"
				className={cn("gap-2 font-normal", className)}
				data-testid="cloud-drive"
				aria-haspopup="dialog"
				aria-label={`Cloud Drive: ${usage} used${status?.connected === true ? ", connected" : status?.connected === false ? ", not connected" : ""}`}
				onClick={() => {
					setView("files");
					setOpen(true);
				}}
			>
				<CloudIcon aria-hidden />
				<span className="font-semibold">Cloud Drive</span>
				<span className="tabular-nums text-content-secondary">{usage}</span>
				<StatusIndicator status={status} compact />
			</Button>
			<CloudDriveRopes
				anchor={button}
				workspaceIds={workspaceIds}
				connected={status?.connected}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					className="max-w-3xl gap-0 overflow-hidden p-0"
					aria-describedby={undefined}
					data-testid="cloud-drive-dialog"
				>
					<header className="flex items-center gap-3 border-0 border-b border-solid border-border px-4 py-3">
						<CloudIcon aria-hidden className="size-5 text-content-secondary" />
						<DialogTitle className="flex items-center gap-1.5 text-base">
							{view === "settings" ? (
								<>
									<button
										type="button"
										className="cursor-pointer border-0 bg-transparent p-0 text-base font-semibold text-content-secondary hover:text-content-primary"
										onClick={() => setView("files")}
									>
										Cloud Drive
									</button>
									<ChevronRightIcon
										aria-hidden
										className="size-4 text-content-secondary"
									/>
									Settings
								</>
							) : (
								"Cloud Drive"
							)}
						</DialogTitle>
						<StatusIndicator status={status} />
						<div className="ml-auto flex items-center gap-1">
							<Button
								size="icon"
								variant="subtle"
								aria-label="Settings"
								aria-pressed={view === "settings"}
								className={cn(
									view === "settings" &&
										"bg-surface-secondary text-content-primary",
								)}
								onClick={() =>
									setView((v) => (v === "settings" ? "files" : "settings"))
								}
							>
								<SettingsIcon />
							</Button>
							<DialogClose asChild>
								<Button size="icon" variant="subtle" aria-label="Close">
									<XIcon />
								</Button>
							</DialogClose>
						</div>
					</header>
					{view === "files" ? (
						<CloudDriveBrowser summary={summary} />
					) : settings.data ? (
						<CloudDriveSettings settings={settings.data} />
					) : (
						<p
							role={settings.error ? "alert" : undefined}
							className={cn(
								"m-0 px-6 py-8 text-center text-sm",
								settings.error
									? "text-content-destructive"
									: "text-content-secondary",
							)}
						>
							{settings.error
								? getErrorMessage(
										settings.error,
										"The Cloud Drive's settings could not be read.",
									)
								: "Opening…"}
						</p>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
};
