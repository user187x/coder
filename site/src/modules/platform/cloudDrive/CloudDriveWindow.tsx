import { cn } from "cn";
import {
	ChevronRightIcon,
	CloudIcon,
	FolderInputIcon,
	FolderSymlinkIcon,
	LockIcon,
	PlugIcon,
	SettingsIcon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import type { SafeSummary } from "#/api/platform";
import { cloudDriveSettings } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { CloudDriveBrowser } from "./CloudDriveBrowser";
import { CloudDriveConnections } from "./CloudDriveConnections";
import { CloudDriveEncryption } from "./CloudDriveEncryption";
import { CloudDriveMount } from "./CloudDriveMount";
import { CloudDrivePeersView } from "./CloudDrivePeers";
import { CloudDriveSettings, StatusIndicator } from "./CloudDriveSettings";
import { CloudDriveSource } from "./CloudDriveSource";

/**
 * The user's Cloud Drive window, centred over the page blurred behind it: its files (CloudDriveBrowser), and in its
 * header the workspaces it is connected to, its encryption, its source, mounts, sharing and settings. Opened from
 * the Cloud Drive above the Workspaces table (CloudDrive) and from a workspace's Cloud Drive glyph (CloudDriveGlyph).
 */
export const CloudDriveWindow: React.FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	view: View;
	onView: React.Dispatch<React.SetStateAction<View>>;
	summary: SafeSummary;
	/** Where the files open: the user's own drive (""), or one shared with them (its owner), at a folder. */
	openAt?: { drive: string; path: string };
	/** An admin's look at another account's drive (read only). */
	inspect?: { owner: string; ownerName: string };
}> = ({
	open,
	onOpenChange,
	view,
	onView,
	summary,
	openAt = { drive: "", path: "" },
	inspect,
}) => {
	const settings = useQuery({
		...cloudDriveSettings(),
		enabled: Boolean(summary.enabled),
	});
	const status = settings.data?.status;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-3xl gap-0 overflow-hidden p-0"
				// the page behind it blurred (a Gaussian blur), as the quick access wheel's
				overlayClassName="backdrop-blur-md"
				aria-describedby={undefined}
				data-testid="cloud-drive-dialog"
			>
				<header className="flex items-center gap-3 border-0 border-b border-solid border-border px-4 py-3">
					<CloudIcon aria-hidden className="size-5 text-content-secondary" />
					<DialogTitle className="flex items-center gap-1.5 text-base">
						{view !== "files" ? (
							<>
								<button
									type="button"
									className="cursor-pointer border-0 bg-transparent p-0 text-base font-semibold text-content-secondary hover:text-content-primary"
									onClick={() => onView("files")}
								>
									Cloud Drive
								</button>
								<ChevronRightIcon
									aria-hidden
									className="size-4 text-content-secondary"
								/>
								{VIEW_TITLES[view]}
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
							aria-label="Workspaces: which are connected"
							title="Workspaces: which are connected"
							aria-pressed={view === "workspaces"}
							className={cn(
								view === "workspaces" &&
									"bg-surface-secondary text-content-primary",
							)}
							onClick={() =>
								onView((v) => (v === "workspaces" ? "files" : "workspaces"))
							}
						>
							<PlugIcon />
						</Button>
						<ViewButton
							view="encryption"
							current={view}
							label="Encryption: your own key"
							onToggle={onView}
						>
							<LockIcon />
						</ViewButton>
						<ViewButton
							view="source"
							current={view}
							label="Source: a workspace's folder as the Cloud Drive"
							onToggle={onView}
						>
							<FolderInputIcon />
						</ViewButton>
						<ViewButton
							view="mount"
							current={view}
							label="Mount: the Cloud Drive in a folder of a workspace"
							onToggle={onView}
						>
							<FolderSymlinkIcon />
						</ViewButton>
						<ViewButton
							view="sharing"
							current={view}
							label="Sharing: Cloud Drives between users"
							onToggle={onView}
						>
							<UsersIcon />
						</ViewButton>
						<Button
							size="icon"
							variant="subtle"
							aria-label="Settings"
							aria-pressed={view === "settings"}
							className={cn(
								view === "settings" &&
									"bg-surface-secondary text-content-primary",
							)}
							onClick={() => {
								// Opened: what the service has now.
								if (view !== "settings") {
									void settings.refetch();
								}
								onView((v) => (v === "settings" ? "files" : "settings"));
							}}
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
					<CloudDriveBrowser
						summary={summary}
						initialDrive={openAt.drive}
						initialPath={openAt.path}
						inspect={inspect}
					/>
				) : view === "workspaces" ? (
					<CloudDriveConnections />
				) : view === "encryption" ? (
					<CloudDriveEncryption />
				) : view === "source" ? (
					<CloudDriveSource />
				) : view === "mount" ? (
					<CloudDriveMount />
				) : view === "sharing" ? (
					<CloudDrivePeersView />
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
	);
};

export type View =
	| "files"
	| "workspaces"
	| "encryption"
	| "source"
	| "mount"
	| "sharing"
	| "settings";

const VIEW_TITLES: Record<View, string> = {
	files: "Files",
	workspaces: "Workspaces",
	encryption: "Encryption",
	source: "Source",
	mount: "Mount",
	sharing: "Sharing",
	settings: "Settings",
};

const ViewButton: React.FC<{
	view: View;
	current: View;
	label: string;
	onToggle: (next: View) => void;
	children: React.ReactNode;
}> = ({ view, current, label, onToggle, children }) => (
	<Button
		size="icon"
		variant="subtle"
		aria-label={label}
		title={label}
		aria-pressed={current === view}
		className={cn(
			current === view && "bg-surface-secondary text-content-primary",
		)}
		onClick={() => onToggle(current === view ? "files" : view)}
	>
		{children}
	</Button>
);
