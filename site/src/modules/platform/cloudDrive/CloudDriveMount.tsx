import { FolderSymlinkIcon, TriangleAlertIcon, UnplugIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type CloudDriveCollision,
	type CloudDriveMountMode,
	type CloudDriveMountPlan,
	PlatformAPI,
} from "#/api/platform";
import { cloudDriveConnections } from "#/api/queries/platform";
import { workspaces } from "#/api/queries/workspaces";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Spinner } from "#/components/Spinner/Spinner";
import { formatBytes } from "./drivePaths";

type Decisions = Record<string, "overwrite" | "keep">;

/**
 * The Cloud Drive window's Mount: the Cloud Drive in a folder of one of the owner's running workspaces (absolute, or
 * relative to its home; one with files of its own, or a new one), beside the files already there - its folders of
 * the same name merged. Files of the same name halt it until the owner chooses: keep both (the Cloud Drive's as
 * data-(cloud_drive).csv) or overwrite - all of them, or each occurrence asked in turn. The same as
 * `cloud-drive mount` in the workspace's terminal; the workspace keeps the mount up to date as the Cloud Drive
 * changes.
 */
export const CloudDriveMount: React.FC = () => {
	const connections = useQuery(cloudDriveConnections());
	const list = useQuery(workspaces({ q: "owner:me" }));
	const shared = new Set(connections.data?.shared ?? []);
	const running = (list.data?.workspaces ?? []).filter(
		(w) => !shared.has(w.id) && w.latest_build.status === "running",
	);
	const [workspace, setWorkspace] = useState("");
	const [path, setPath] = useState("");
	const [plan, setPlan] = useState<CloudDriveMountPlan | null>(null);
	useEffect(() => {
		if (!workspace && running.length === 1) {
			setWorkspace(running[0].id);
		}
	}, [workspace, running]);
	const mounts = useQuery({
		queryKey: ["platform", "cloud-drive-mounts", workspace],
		queryFn: () => PlatformAPI.getCloudDriveMounts(workspace),
		enabled: Boolean(workspace),
		retry: false,
	});
	const apply = useMutation({
		mutationFn: (v: { mode: CloudDriveMountMode; decisions: Decisions }) =>
			PlatformAPI.applyCloudDriveMount(workspace, path, v.mode, v.decisions),
		onSuccess: (r) => {
			if (r.halted) {
				toast.error(
					`Not mounted: ${r.unresolved.length} file${r.unresolved.length === 1 ? "" : "s"} of the same name appeared meanwhile. Check again.`,
				);
				return;
			}
			const parts = [`${r.linked} linked`];
			if (r.keptBoth.length) {
				parts.push(`${r.keptBoth.length} kept both`);
			}
			if (r.overwritten.length) {
				parts.push(`${r.overwritten.length} overwritten`);
			}
			toast.success(`Mounted at ${r.target}: ${parts.join(", ")}.`);
			setPlan(null);
			setPath("");
			void mounts.refetch();
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not mounted.")),
	});
	const check = useMutation({
		mutationFn: () => PlatformAPI.planCloudDriveMount(workspace, path),
		onSuccess: (p) => {
			if (!p.cloud) {
				toast.error("The Cloud Drive is not in that workspace now.");
			} else if (p.collisions.length === 0) {
				apply.mutate({ mode: "keep-both", decisions: {} });
			} else {
				setPlan(p); // halted: the owner chooses
			}
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not checked.")),
	});
	const unmount = useMutation({
		mutationFn: (target: string) =>
			PlatformAPI.unmountCloudDrive(workspace, target),
		onSuccess: (r) => {
			toast.success(
				`Out of ${r.target}: ${r.removed} links removed${r.restored ? `, ${r.restored} overwritten files put back` : ""}.`,
			);
			void mounts.refetch();
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not unmounted.")),
	});
	const busy = check.isPending || apply.isPending;

	return (
		<div
			className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-6 py-5"
			data-testid="cloud-drive-mount"
		>
			<p className="m-0 text-sm text-content-secondary">
				Your Cloud Drive is at ~/cloud-drive in your workspaces. Mounted into
				another folder, its files and folders appear there beside the ones it
				has; files of the same name are yours to decide. In a workspace's
				terminal: <code>cloud-drive mount PATH</code>.
			</p>
			<form
				className="flex flex-col gap-3"
				onSubmit={(e) => {
					e.preventDefault();
					check.mutate();
				}}
			>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="flex flex-col gap-1">
						<Label htmlFor="cd-mount-ws">Workspace</Label>
						<Select value={workspace} onValueChange={setWorkspace}>
							<SelectTrigger id="cd-mount-ws">
								<SelectValue
									placeholder={
										running.length ? "One of yours, running" : "None running"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{running.map((w) => (
									<SelectItem key={w.id} value={w.id}>
										{w.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-1">
						<Label htmlFor="cd-mount-path">Folder</Label>
						<Input
							id="cd-mount-path"
							placeholder="project/data or /home/coder/project/data"
							value={path}
							onChange={(e) => setPath(e.target.value)}
						/>
					</div>
				</div>
				<div>
					<Button type="submit" disabled={!workspace || !path.trim() || busy}>
						<Spinner loading={busy}>
							<FolderSymlinkIcon />
						</Spinner>
						Mount here
					</Button>
				</div>
			</form>

			{workspace && (
				<section
					className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4"
					data-testid="cloud-drive-mounts"
				>
					<span className="text-sm font-medium">
						Mounted in {mounts.data?.name ?? "this workspace"}
					</span>
					{mounts.error ? (
						<span className="text-xs text-content-destructive">
							{getErrorMessage(mounts.error, "Not read.")}
						</span>
					) : !mounts.data ? (
						<Spinner loading size="sm" />
					) : mounts.data.mounts.length === 0 ? (
						<span className="text-xs text-content-secondary">
							Nowhere but ~/cloud-drive.
						</span>
					) : (
						<ul className="m-0 flex list-none flex-col gap-1 p-0">
							{mounts.data.mounts.map((m) => (
								<li key={m.target} className="flex items-center gap-2 text-xs">
									<span className="font-mono">{m.target}</span>
									<span className="text-content-secondary">
										{m.links} links ·{" "}
										{m.mode === "overwrite-all"
											? "overwrites"
											: m.mode === "ask"
												? "asked for each"
												: "keeps both"}
									</span>
									<Button
										size="xs"
										variant="outline"
										className="ml-auto"
										disabled={unmount.isPending}
										onClick={() => unmount.mutate(m.target)}
									>
										<UnplugIcon />
										Unmount
									</Button>
								</li>
							))}
						</ul>
					)}
				</section>
			)}

			{plan && (
				<CollisionDialog
					plan={plan}
					pending={apply.isPending}
					onCancel={() => setPlan(null)}
					onResolve={(mode, decisions) => apply.mutate({ mode, decisions })}
				/>
			)}
		</div>
	);
};

const describe = (c: CloudDriveCollision) =>
	`yours: ${c.local}${c.localSize !== null ? `, ${formatBytes(c.localSize)}` : ""} · the Cloud Drive's: ${c.cloud}${c.cloudSize !== null ? `, ${formatBytes(c.cloudSize)}` : ""}`;

/**
 * The mount halted on files of the same name: keep both, or overwrite - and then overwrite all, or each occurrence
 * asked in turn (the terminal's [Y/n]: Y overwrites, n keeps both).
 */
export const CollisionDialog: React.FC<{
	plan: CloudDriveMountPlan;
	pending: boolean;
	onCancel: () => void;
	onResolve: (mode: CloudDriveMountMode, decisions: Decisions) => void;
}> = ({ plan, pending, onCancel, onResolve }) => {
	const [choice, setChoice] = useState<"keep" | "overwrite">("keep");
	const [overwrite, setOverwrite] = useState<"all" | "each">("all");
	const [step, setStep] = useState<number | null>(null);
	const [decisions, setDecisions] = useState<Decisions>({});
	const collisions = plan.collisions;
	const current = step !== null ? collisions[step] : null;

	const decide = (d: "overwrite" | "keep") => {
		if (step === null || !current) {
			return;
		}
		const next = { ...decisions, [current.path]: d };
		setDecisions(next);
		if (step + 1 < collisions.length) {
			setStep(step + 1);
		} else {
			onResolve("ask", next);
		}
	};

	useEffect(() => {
		if (current === null) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "y" || e.key === "Y" || e.key === "Enter") {
				e.preventDefault();
				decide("overwrite");
			} else if (e.key === "n" || e.key === "N") {
				e.preventDefault();
				decide("keep");
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<Dialog open onOpenChange={(o) => !o && !pending && onCancel()}>
			<DialogContent className="max-w-xl" data-testid="mount-collisions">
				{current === null ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<TriangleAlertIcon className="size-5 text-content-warning" />
								{collisions.length} file{collisions.length === 1 ? "" : "s"} of
								the same name
							</DialogTitle>
							<DialogDescription>
								<span className="font-mono">{plan.target}</span> has{" "}
								{collisions.length === 1 ? "a file" : "files"} named like the
								Cloud Drive's. Nothing is changed until you choose.
							</DialogDescription>
						</DialogHeader>
						<ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto rounded-md border border-solid border-border p-2">
							{collisions.map((c) => (
								<li key={c.path} className="flex flex-col text-xs">
									<span className="font-mono">{c.path}</span>
									<span className="text-content-secondary">{describe(c)}</span>
								</li>
							))}
						</ul>
						<RadioGroup
							value={choice}
							onValueChange={(v) => setChoice(v as "keep" | "overwrite")}
							aria-label="What to do with files of the same name"
							className="flex flex-col gap-3"
						>
							<div className="flex items-start gap-2">
								<RadioGroupItem value="keep" id="cd-keep" className="mt-0.5" />
								<Label htmlFor="cd-keep" className="flex flex-col gap-0.5">
									<span>Keep both</span>
									<span className="text-xs font-normal text-content-secondary">
										Yours stay; the Cloud Drive's are linked beside them as{" "}
										<span className="font-mono">
											{collisions[0]?.keepBothAs}
										</span>
										{collisions.length > 1 && " and so on"}.
									</span>
								</Label>
							</div>
							<div className="flex items-start gap-2">
								<RadioGroupItem
									value="overwrite"
									id="cd-overwrite"
									className="mt-0.5"
								/>
								<Label htmlFor="cd-overwrite" className="flex flex-col gap-0.5">
									<span>Overwrite</span>
									<span className="text-xs font-normal text-content-secondary">
										The Cloud Drive's take the names; yours move to
										~/.local/share/cloud-drive/overwritten/ and come back when
										you unmount.
									</span>
								</Label>
							</div>
						</RadioGroup>
						{choice === "overwrite" && (
							<RadioGroup
								value={overwrite}
								onValueChange={(v) => setOverwrite(v as "all" | "each")}
								aria-label="Overwrite all, or ask for each"
								className="ml-6 flex flex-col gap-2 border-0 border-l-2 border-solid border-border pl-4"
								data-testid="overwrite-how"
							>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="all" id="cd-ow-all" />
									<Label htmlFor="cd-ow-all">Overwrite all</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="each" id="cd-ow-each" />
									<Label htmlFor="cd-ow-each">Prompt for each occurrence</Label>
								</div>
							</RadioGroup>
						)}
						<DialogFooter>
							<Button variant="outline" disabled={pending} onClick={onCancel}>
								Cancel
							</Button>
							<Button
								disabled={pending}
								onClick={() => {
									if (choice === "keep") {
										onResolve("keep-both", {});
									} else if (overwrite === "all") {
										onResolve("overwrite-all", {});
									} else {
										setDecisions({});
										setStep(0);
									}
								}}
							>
								<Spinner loading={pending} />
								{choice === "overwrite" && overwrite === "each"
									? "Ask for each"
									: "Mount"}
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>
								Overwrite <span className="font-mono">{current.path}</span>?
							</DialogTitle>
							<DialogDescription>
								{step !== null && `${step + 1} of ${collisions.length}`} ·{" "}
								{describe(current)}
							</DialogDescription>
						</DialogHeader>
						<p className="m-0 text-sm text-content-secondary">
							Yes: the Cloud Drive's takes its name (yours moves aside). No:
							both are kept, the Cloud Drive's as{" "}
							<span className="font-mono">{current.keepBothAs}</span>.
						</p>
						<DialogFooter>
							<Button variant="outline" disabled={pending} onClick={onCancel}>
								Cancel
							</Button>
							<Button
								variant="outline"
								disabled={pending}
								onClick={() => decide("keep")}
								data-testid="collision-no"
							>
								No, keep both (n)
							</Button>
							<Button
								disabled={pending}
								onClick={() => decide("overwrite")}
								data-testid="collision-yes"
							>
								<Spinner loading={pending} />
								Yes, overwrite (Y)
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
};
