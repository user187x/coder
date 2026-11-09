import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { toast } from "sonner";
import type { WorkspaceTunnel, WorkspaceTunnelPort } from "#/api/platform";
import { updateWorkspaceTunnelPorts } from "#/api/queries/workspaceTunnels";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";

type Row = {
	key: number;
	protocol: "tcp" | "udp";
	input: string;
	output: string;
};

let nextKey = 0;
const row = (port?: WorkspaceTunnelPort): Row => ({
	key: nextKey++,
	protocol: port?.protocol ?? "tcp",
	input: port ? String(port.port) : "",
	output: port ? String(port.target_port ?? port.port) : "",
});

const valid = (value: string) => {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= 65535;
};

/**
 * A tunnel's port mappings, built as a list: each row an input port (what the source workspace connects to) mapped
 * to an output port (the service's port on the target). No rows: every port, unmapped. Saved as the tunnel's ports.
 */
export const TunnelPortsDialog: React.FC<{
	tunnel: WorkspaceTunnel;
	onClose: () => void;
}> = ({ tunnel, onClose }) => {
	const client = useQueryClient();
	const [rows, setRows] = useState<Row[]>(() => (tunnel.ports ?? []).map(row));
	const save = useMutation({
		...updateWorkspaceTunnelPorts(client),
		onSuccess: () => {
			toast.success(
				"Tunnel ports saved: both workspaces apply them in a few seconds.",
			);
			onClose();
		},
	});
	const source = tunnel.source_workspace_name || "Source";
	const target = tunnel.target_workspace_name || "Target";
	const update = (key: number, change: Partial<Row>) =>
		setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
	const incomplete = rows.some((r) => !valid(r.input) || !valid(r.output));
	const duplicate =
		new Set(rows.map((r) => `${r.protocol}:${r.input}`)).size !== rows.length;
	const maps = rows.some((r) => r.input !== r.output);
	const unsupported = maps && tunnel.port_mapping_supported === false;
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				overlayClassName="backdrop-blur-md"
				className="max-w-2xl"
				aria-describedby="tunnel-ports-description"
			>
				<DialogTitle>
					Tunnel ports: {source} → {target}
				</DialogTitle>
				<DialogDescription id="tunnel-ports-description">
					Map each input port, the one {source} connects to, to an output port,
					where the service listens on {target}. With no mappings the tunnel
					carries every port.
				</DialogDescription>
				{save.error ? <ErrorAlert error={save.error} /> : null}
				<ul
					aria-label="Port mappings"
					className="m-0 flex list-none flex-col gap-2 p-0"
				>
					{rows.length > 0 && (
						<li
							aria-hidden
							className="grid grid-cols-[6rem_1fr_auto_1fr_2.5rem] items-center gap-2 px-1 text-xs text-content-secondary"
						>
							<span>Protocol</span>
							<span>Input port</span>
							<span />
							<span>Output port</span>
							<span />
						</li>
					)}
					{rows.map((r, i) => (
						<li
							key={r.key}
							className="grid grid-cols-[6rem_1fr_auto_1fr_2.5rem] items-center gap-2"
						>
							<Select
								value={r.protocol}
								onValueChange={(protocol) =>
									(protocol === "tcp" || protocol === "udp") &&
									update(r.key, { protocol })
								}
							>
								<SelectTrigger aria-label={`Mapping ${i + 1} protocol`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="tcp">TCP</SelectItem>
									<SelectItem value="udp">UDP</SelectItem>
								</SelectContent>
							</Select>
							<Input
								type="number"
								min={1}
								max={65535}
								inputMode="numeric"
								aria-label={`Mapping ${i + 1} input port`}
								value={r.input}
								onChange={(e) => {
									const input = e.target.value;
									// A new row's output follows its input until set apart.
									update(
										r.key,
										r.output === r.input ? { input, output: input } : { input },
									);
								}}
							/>
							<span aria-hidden className="text-content-secondary">
								→
							</span>
							<Input
								type="number"
								min={1}
								max={65535}
								inputMode="numeric"
								aria-label={`Mapping ${i + 1} output port`}
								value={r.output}
								onChange={(e) => update(r.key, { output: e.target.value })}
							/>
							<Button
								variant="subtle"
								size="icon"
								aria-label={`Remove mapping ${i + 1}`}
								onClick={() =>
									setRows((all) => all.filter((other) => other.key !== r.key))
								}
							>
								<Trash2Icon />
							</Button>
						</li>
					))}
				</ul>
				<Button
					variant="outline"
					className="justify-self-start"
					onClick={() => setRows((all) => [...all, row()])}
				>
					<PlusIcon />
					Add mapping
				</Button>
				{duplicate && (
					<p className="m-0 text-sm text-content-destructive">
						An input port can be mapped only once per protocol.
					</p>
				)}
				{unsupported && (
					<p className="m-0 text-sm text-content-warning">
						Restart both workspaces first: their tunnel helper cannot map one
						port to another yet.
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={
							incomplete ||
							duplicate ||
							unsupported ||
							save.isPending ||
							tunnel.revision === undefined
						}
						onClick={() =>
							save.mutate({
								organizationId: tunnel.organization_id,
								id: tunnel.id,
								revision: tunnel.revision ?? 0,
								ports:
									rows.length === 0
										? null
										: rows.map((r) => ({
												protocol: r.protocol,
												port: Number(r.input),
												...(r.output !== r.input
													? { target_port: Number(r.output) }
													: {}),
											})),
							})
						}
					>
						{save.isPending ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
