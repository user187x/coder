import { stripAnsi } from "fancy-ansi";
import {
	FileTextIcon,
	InfoIcon,
	LogOutIcon,
	Maximize2Icon,
	MoveRightIcon,
	PencilIcon,
	RotateCwIcon,
	ShieldIcon,
	TagIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	type EntityRef,
	type KubernetesEntityRef,
	type NetworkLogPod,
	networkLogTargets,
	networkPodControllers,
	networkPodLogs,
	type PodController,
	restartNetworkPod,
} from "#/api/clusterNetwork";
import { getErrorMessage } from "#/api/errors";
import { workspaceMigrationPlan } from "#/api/queries/workspaceMigrations";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "#/components/Dialog/Dialog";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "#/components/Drawer/Drawer";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { MigrateWorkspaceDialog } from "#/modules/workspaces/WorkspaceMoreActions/MigrateWorkspaceDialog";

import { type NodeAction, NodeActions, nodeActionTitles } from "./NodeActions";

type Mode = "logs" | "restart" | "delete" | "controller" | NodeAction;
const Actions = createContext<
	(
		target: EntityRef,
		mode: Mode | "details",
		controller?: PodController,
	) => void
>(() => {});
type MigrationTarget = { id: string; name: string };
const MigrateAction = createContext<(workspace: MigrationTarget) => void>(
	() => {},
);

/**
 * Offers migration for pods that carry the workspace labels. System pods have
 * none, so they never get the item. Eligibility comes from the migration plan.
 */
const MigratePodItem: React.FC<{ target: KubernetesEntityRef }> = ({
	target,
}) => {
	const migrate = useContext(MigrateAction);
	const pods = useQuery(networkLogTargets(target));
	const pod = pods.data?.pods.find((p) => p.workspaceId);
	const plan = useQuery({
		...workspaceMigrationPlan(pod?.workspaceId ?? ""),
		enabled: Boolean(pod?.workspaceId),
		retry: false,
	});
	if (!pod?.workspaceId) return null;
	const workspace = {
		id: pod.workspaceId,
		name: pod.workspaceName || pod.name,
	};
	const reason = plan.error
		? getErrorMessage(plan.error, "This workspace cannot be migrated.")
		: plan.isLoading
			? "Checking eligibility"
			: null;
	return (
		<ContextMenuItem
			disabled={Boolean(reason)}
			onSelect={() => migrate(workspace)}
		>
			<MoveRightIcon />
			<span className="flex flex-col">
				Migrate to node...
				{reason && (
					<span className="max-w-64 text-xs text-content-secondary">
						{reason}
					</span>
				)}
			</span>
		</ContextMenuItem>
	);
};

const PodControllerItems: React.FC<{ target: KubernetesEntityRef }> = ({
	target,
}) => {
	const action = useContext(Actions);
	const query = useQuery(networkPodControllers(target));
	return (
		<>
			<ContextMenuSeparator />
			<div className="px-2 py-1 text-xs font-medium text-content-secondary">
				Controlled By
			</div>
			{query.data?.controllers.length ? (
				query.data.controllers.map((controller) => (
					<ContextMenuItem
						key={`${controller.kind}/${controller.name}`}
						onSelect={() => action(target, "controller", controller)}
					>
						<FileTextIcon /> {controller.kind} · {controller.name}
					</ContextMenuItem>
				))
			) : (
				<ContextMenuItem disabled>
					{query.isLoading
						? "Loading controllers…"
						: query.error
							? "Controller lookup unavailable"
							: "No controlling resource"}
				</ContextMenuItem>
			)}
		</>
	);
};

/** Adds the same Kubernetes actions to buttons and SVG nodes without changing their layout. */
export const EntityContextMenu: React.FC<{
	target?: EntityRef;
	children: React.ReactElement;
}> = ({ target, children }) => {
	const action = useContext(Actions);
	const { permissions } = useAuthenticated();
	if (!target || target.type === "link") return children;
	return (
		<ContextMenu modal={false}>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent
				aria-label="Kubernetes object actions"
				onCloseAutoFocus={(event) => event.preventDefault()}
			>
				<ContextMenuItem onSelect={() => action(target, "logs")}>
					<FileTextIcon />
					View Logs
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => action(target, "restart")}>
					<RotateCwIcon />
					Restart Pod
				</ContextMenuItem>
				{target.type === "pod" && permissions.editDeploymentConfig && (
					<>
						<ContextMenuItem onSelect={() => action(target, "delete")}>
							<Trash2Icon /> Delete Pod
						</ContextMenuItem>
						<MigratePodItem target={target} />
					</>
				)}
				{target.type === "node" && (
					<>
						<ContextMenuItem onSelect={() => action(target, "edit-node")}>
							<PencilIcon />
							Edit node
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => action(target, "restart-node")}>
							<RotateCwIcon />
							Restart node
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => action(target, "drain-node")}>
							<LogOutIcon />
							Drain node
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => action(target, "cordon-node")}>
							<ShieldIcon />
							Cordon or uncordon node
						</ContextMenuItem>
						<ContextMenuItem onSelect={() => action(target, "taint-node")}>
							<TagIcon />
							Taint node
						</ContextMenuItem>
					</>
				)}
				<ContextMenuItem onSelect={() => action(target, "details")}>
					<InfoIcon />
					{target.type === "node" ? "Describe" : "Details"}
				</ContextMenuItem>
				{target.type === "pod" && <PodControllerItems target={target} />}
			</ContextMenuContent>
		</ContextMenu>
	);
};

export const EntityActionsProvider: React.FC<{
	children: React.ReactNode;
	onDetails: (target: EntityRef) => void;
	onOpen: () => void;
}> = ({ children, onDetails, onOpen }) => {
	const [view, setView] = useState<{
		target: KubernetesEntityRef;
		mode: Mode;
		controller?: PodController;
	}>();
	const [migrating, setMigrating] = useState<MigrationTarget>();
	return (
		<MigrateAction.Provider value={setMigrating}>
			<Actions.Provider
				value={(target, mode, controller) => {
					if (mode === "details") {
						setView(undefined);
						onDetails(target);
					} else if (target.type !== "link") {
						onOpen();
						setView({ target, mode, controller });
					}
				}}
			>
				{children}
				<Drawer
					open={Boolean(view)}
					onOpenChange={(open) => {
						if (!open) setView(undefined);
					}}
				>
					<DrawerContent className="w-full gap-4 bg-surface-primary p-5 sm:max-w-2xl">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<DrawerTitle>
									{!view || view.mode === "logs"
										? "Pod logs"
										: view.mode === "restart"
											? "Restart Pod"
											: view.mode === "delete"
												? "Delete Pod"
												: view.mode === "controller"
													? `${view.controller?.kind} manifest`
													: nodeActionTitles[view.mode]}
								</DrawerTitle>
								<DrawerDescription className="break-all">
									{view?.target.type === "node"
										? view.target.name
										: view && `${view.target.namespace}/${view.target.name}`}
								</DrawerDescription>
							</div>
							<DrawerClose asChild>
								<Button
									size="icon"
									variant="subtle"
									aria-label="Close object panel"
								>
									<XIcon />
								</Button>
							</DrawerClose>
						</div>
						{view &&
							(view.mode === "controller" ? (
								view.controller?.manifest ? (
									<>
										<p className="m-0 text-xs text-content-secondary">
											Operational fields from the controller manifest.
										</p>
										<pre className="overflow-auto rounded-md border border-border p-3 text-xs">
											{JSON.stringify(view.controller.manifest, null, 2)}
										</pre>
									</>
								) : (
									<p className="text-sm text-content-secondary">
										The controller manifest is unavailable.
									</p>
								)
							) : view.mode === "logs" ||
								view.mode === "restart" ||
								view.mode === "delete" ? (
								<PodSelection
									key={JSON.stringify(view)}
									target={view.target}
									mode={view.mode}
								/>
							) : (
								<NodeActions
									key={JSON.stringify(view)}
									name={view.target.name}
									action={view.mode}
								/>
							))}
					</DrawerContent>
				</Drawer>
				{migrating && (
					<MigrateWorkspaceDialog
						key={migrating.id}
						workspace={migrating}
						open
						onClose={() => setMigrating(undefined)}
					/>
				)}
			</Actions.Provider>
		</MigrateAction.Provider>
	);
};

const selectClass =
	"h-9 w-full rounded-md border border-solid border-border bg-surface-primary px-2 text-sm text-content-primary";

const PodSelection: React.FC<{
	target: KubernetesEntityRef;
	mode: "logs" | "restart" | "delete";
}> = ({ target, mode }) => {
	const targets = useQuery(networkLogTargets(target));
	const [uid, setUid] = useState("");
	const pod =
		targets.data?.pods.find((p) => p.uid === uid) ?? targets.data?.pods[0];
	const id = useId();
	return (
		<>
			<div className="flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Label htmlFor={id}>Pod</Label>
					<select
						id={id}
						className={selectClass}
						value={pod?.uid ?? ""}
						onChange={(e) => setUid(e.target.value)}
						disabled={!targets.data?.pods.length}
					>
						{!pod && <option value="">No pods available</option>}
						{targets.data?.pods.map((p) => (
							<option key={p.uid} value={p.uid}>
								{p.namespace}/{p.name}
							</option>
						))}
					</select>
				</div>
				<Button
					variant="outline"
					onClick={() => void targets.refetch()}
					disabled={targets.isFetching}
				>
					Refresh pods
				</Button>
			</div>
			{targets.error ? <ErrorAlert error={targets.error} /> : null}
			{targets.isLoading ? (
				<Loader />
			) : !pod ? (
				<p className="text-sm text-content-secondary">
					This object has no related pods.
				</p>
			) : mode !== "logs" ? (
				<PodOperation key={pod.uid} pod={pod} operation={mode} />
			) : (
				<PodLogs key={pod.uid} pod={pod} />
			)}
		</>
	);
};

const PodLogs: React.FC<{ pod: NetworkLogPod }> = ({ pod }) => {
	const [container, setContainer] = useState(pod.containers[0] ?? "");
	const [previous, setPrevious] = useState(false);
	const [paused, setPaused] = useState(false);
	const [follow, setFollow] = useState(true);
	const [wrap, setWrap] = useState(true);
	const [expanded, setExpanded] = useState(false);
	const logs = useQuery(networkPodLogs(pod, container, previous, paused));
	const output = useMemo(
		() => stripAnsi(logs.data?.text ?? ""),
		[logs.data?.text],
	);
	const viewport = useRef<HTMLTextAreaElement>(null);
	const offset = useRef({ top: 0, left: 0 });
	const id = useId();
	const changeExpanded = (open: boolean) => {
		if (viewport.current) {
			offset.current = {
				top: viewport.current.scrollTop,
				left: viewport.current.scrollLeft,
			};
		}
		setExpanded(open);
	};
	useEffect(() => {
		viewport.current?.scrollTo?.(offset.current.left, offset.current.top);
	}, [expanded]);
	useEffect(() => {
		if (follow && viewport.current)
			viewport.current.scrollTop = viewport.current.scrollHeight;
	}, [expanded, follow, output, logs.isLoading]);
	const logView = (
		<>
			<div>
				<Label htmlFor={id}>Container</Label>
				<select
					id={id}
					className={selectClass}
					value={container}
					onChange={(e) => setContainer(e.target.value)}
				>
					{pod.containers.map((name) => (
						<option key={name}>{name}</option>
					))}
				</select>
			</div>
			<div className="flex flex-wrap items-center gap-4 text-sm">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={follow}
						onChange={(e) => setFollow(e.target.checked)}
					/>
					Auto-scroll
				</label>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={wrap}
						onChange={(e) => setWrap(e.target.checked)}
					/>
					Wrap lines
				</label>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={previous}
						onChange={(e) => setPrevious(e.target.checked)}
					/>
					Previous container
				</label>
				<Button
					variant="outline"
					size="sm"
					onClick={() => setPaused((p) => !p)}
				>
					{paused ? "Resume logs" : "Pause logs"}
				</Button>
			</div>
			<p className="m-0 text-xs text-content-secondary">
				Latest 500 lines, up to 128 KiB.{" "}
				{previous
					? "Previous container instance."
					: paused
						? "Updates paused."
						: "Refreshes every 2 seconds."}
			</p>
			{logs.error ? <ErrorAlert error={logs.error} /> : null}
			{logs.isLoading ? (
				<Loader />
			) : (
				<textarea
					ref={viewport}
					readOnly
					aria-label="Pod log output"
					aria-live="off"
					wrap={wrap ? "soft" : "off"}
					onClick={(event) => {
						const { selectionStart, selectionEnd } = event.currentTarget;
						if (!expanded && selectionStart === selectionEnd)
							changeExpanded(true);
					}}
					onScroll={(e) => {
						const el = e.currentTarget;
						if (el.scrollHeight - el.scrollTop - el.clientHeight > 40)
							setFollow(false);
					}}
					className="m-0 min-h-0 w-full flex-1 resize-none overflow-auto rounded-md border border-solid border-border bg-surface-secondary p-3 font-mono text-xs leading-5 text-content-primary"
					value={output || "No log lines available."}
				/>
			)}
		</>
	);
	return (
		<Dialog open={expanded} onOpenChange={changeExpanded}>
			<div className="flex justify-end">
				<DialogTrigger asChild>
					<Button size="sm" variant="outline">
						<Maximize2Icon aria-hidden /> Expand logs
					</Button>
				</DialogTrigger>
			</div>
			{!expanded && logView}
			<DialogContent
				className="flex h-[85dvh] w-[calc(100%_-_2rem)] max-w-6xl flex-col gap-4 p-4 sm:p-6"
				overlayClassName="backdrop-blur-md"
				onOpenAutoFocus={(event) => {
					if (viewport.current) {
						event.preventDefault();
						viewport.current.focus({ preventScroll: true });
					}
				}}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<DialogTitle>Expanded pod logs</DialogTitle>
						<DialogDescription className="wrap-anywhere">
							{pod.namespace}/{pod.name}
						</DialogDescription>
					</div>
					<DialogClose asChild>
						<Button
							size="icon"
							variant="subtle"
							aria-label="Close expanded logs"
						>
							<XIcon />
						</Button>
					</DialogClose>
				</div>
				{expanded && logView}
			</DialogContent>
		</Dialog>
	);
};

const PodOperation: React.FC<{
	pod: NetworkLogPod;
	operation: "restart" | "delete";
}> = ({ pod, operation }) => {
	const deleting = operation === "delete";
	const allowed = deleting || pod.restartable;
	const [confirmation, setConfirmation] = useState("");
	const request = useMutation(restartNetworkPod(useQueryClient(), operation));
	const id = useId();
	return (
		<div className="flex flex-col gap-4 text-sm">
			<p className="m-0">
				{deleting ? "Delete" : "Restart"} {pod.namespace}/{pod.name}?{" "}
				{deleting
					? "Direct deletion interrupts active connections and bypasses pod disruption budgets. An unmanaged pod may have no replacement."
					: "Active connections to this pod may be interrupted. Kubernetes disruption budgets are respected, and its workload controller creates the replacement."}
			</p>
			{!allowed && (
				<p role="status" className="text-content-warning">
					{pod.restartReason || "This pod is already terminating."}
				</p>
			)}
			<Label htmlFor={id}>Type the pod name to confirm</Label>
			<Input
				id={id}
				value={confirmation}
				onChange={(e) => setConfirmation(e.target.value)}
				autoComplete="off"
				disabled={!allowed || request.isPending || request.isSuccess}
			/>
			{request.error ? <ErrorAlert error={request.error} /> : null}
			{request.data && <p role="status">{request.data.message}</p>}
			<Button
				variant="destructive"
				disabled={
					!allowed ||
					confirmation !== pod.name ||
					request.isPending ||
					request.isSuccess
				}
				onClick={() => request.mutate({ pod, confirmation })}
			>
				{deleting ? "Delete Pod" : "Restart Pod"}
			</Button>
		</div>
	);
};
