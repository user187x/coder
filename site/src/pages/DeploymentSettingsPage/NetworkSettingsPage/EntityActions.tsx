import { stripAnsi } from "fancy-ansi";
import {
	FileTextIcon,
	InfoIcon,
	LogOutIcon,
	PencilIcon,
	RotateCwIcon,
	ShieldIcon,
	TagIcon,
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
	networkPodLogs,
	restartNetworkPod,
} from "#/api/clusterNetwork";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
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

import { type NodeAction, NodeActions, nodeActionTitles } from "./NodeActions";

type Mode = "logs" | "restart" | NodeAction;
const Actions = createContext<
	(target: EntityRef, mode: Mode | "details") => void
>(() => {});

/** Adds the same Kubernetes actions to buttons and SVG nodes without changing their layout. */
export const EntityContextMenu: React.FC<{
	target?: EntityRef;
	children: React.ReactElement;
}> = ({ target, children }) => {
	const action = useContext(Actions);
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
	}>();
	return (
		<Actions.Provider
			value={(target, mode) => {
				if (mode === "details") {
					setView(undefined);
					onDetails(target);
				} else if (target.type !== "link") {
					onOpen();
					setView({ target, mode });
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
						(view.mode === "logs" || view.mode === "restart" ? (
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
		</Actions.Provider>
	);
};

const selectClass =
	"h-9 w-full rounded-md border border-solid border-border bg-surface-primary px-2 text-sm text-content-primary";

const PodSelection: React.FC<{
	target: KubernetesEntityRef;
	mode: "logs" | "restart";
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
					This object has no related pods with logs.
				</p>
			) : mode === "restart" ? (
				<RestartPod key={pod.uid} pod={pod} />
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
	const logs = useQuery(networkPodLogs(pod, container, previous, paused));
	const output = useMemo(
		() => stripAnsi(logs.data?.text ?? ""),
		[logs.data?.text],
	);
	const viewport = useRef<HTMLTextAreaElement>(null);
	const id = useId();
	useEffect(() => {
		if (follow && viewport.current)
			viewport.current.scrollTop = viewport.current.scrollHeight;
	}, [follow, logs.data]);
	return (
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
};

const RestartPod: React.FC<{ pod: NetworkLogPod }> = ({ pod }) => {
	const [confirmation, setConfirmation] = useState("");
	const request = useMutation(restartNetworkPod(useQueryClient()));
	const id = useId();
	return (
		<div className="flex flex-col gap-4 text-sm">
			<p className="m-0">
				Restart {pod.namespace}/{pod.name}? Active connections to this pod may
				be interrupted. Kubernetes disruption budgets are respected, and its
				workload controller creates the replacement.
			</p>
			{!pod.restartable && (
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
				disabled={!pod.restartable || request.isPending || request.isSuccess}
			/>
			{request.error ? <ErrorAlert error={request.error} /> : null}
			{request.data && <p role="status">{request.data.message}</p>}
			<Button
				variant="destructive"
				disabled={
					!pod.restartable ||
					confirmation !== pod.name ||
					request.isPending ||
					request.isSuccess
				}
				onClick={() => request.mutate({ pod, confirmation })}
			>
				Restart Pod
			</Button>
		</div>
	);
};
