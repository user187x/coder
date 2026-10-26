import { useId, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import type { WorkspaceTunnel, WorkspaceTunnelPort } from "#/api/platform";
import { updateWorkspaceTunnelPorts } from "#/api/queries/workspaceTunnels";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";

const formatPorts = (tunnel: WorkspaceTunnel, protocol: "tcp" | "udp") =>
	(tunnel.ports ?? [])
		.filter((rule) => rule.protocol === protocol)
		.map((rule) => rule.port)
		.join(", ");

export const TunnelPortSettings = ({ tunnel }: { tunnel: WorkspaceTunnel }) => {
	const id = useId();
	const client = useQueryClient();
	const [all, setAll] = useState(!tunnel.ports);
	const [tcp, setTcp] = useState(() => formatPorts(tunnel, "tcp"));
	const [udp, setUdp] = useState(() => formatPorts(tunnel, "udp"));
	const [revision, setRevision] = useState(tunnel.revision);
	const [error, setError] = useState("");
	const update = useMutation({
		...updateWorkspaceTunnelPorts(client),
		onSuccess: (result) => setRevision(result.tunnel.revision),
	});
	const changed = tunnel.revision !== revision;
	return (
		<form
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-3"
			aria-label="Tunnel port settings"
			onSubmit={(event) => {
				event.preventDefault();
				setError("");
				if (revision === undefined || changed) {
					setError("The connection changed. Reload settings before saving.");
					return;
				}
				const ports: WorkspaceTunnelPort[] = [];
				for (const [protocol, text] of [
					["tcp", tcp],
					["udp", udp],
				] as const) {
					if (all || !text.trim()) continue;
					for (const value of text.split(",")) {
						if (
							!/^\d+$/.test(value.trim()) ||
							Number(value) < 1 ||
							Number(value) > 65535
						) {
							setError(
								"Enter comma-separated port numbers from 1 through 65535.",
							);
							return;
						}
						ports.push({ protocol, port: Number(value) });
					}
				}
				if (
					!all &&
					(ports.length === 0 ||
						ports.length > 32 ||
						new Set(ports.map((rule) => `${rule.protocol}:${rule.port}`))
							.size !== ports.length)
				) {
					setError("Choose between one and 32 unique service ports.");
					return;
				}
				update.mutate({
					organizationId: tunnel.organization_id,
					id: tunnel.id,
					revision,
					ports: all ? null : ports,
				});
			}}
		>
			<h3 className="m-0 text-sm font-medium">Allowed service ports</h3>
			<p className="m-0 text-xs text-content-secondary">
				The same service ports are allowed in either direction. Replies are
				allowed; other tunneled traffic is blocked.
			</p>
			<Label className="flex items-center gap-2">
				<Checkbox
					checked={all}
					onCheckedChange={(checked) => setAll(checked === true)}
				/>
				Allow all ports
			</Label>
			<Label htmlFor={`${id}-tcp`}>TCP service ports</Label>
			<Input
				id={`${id}-tcp`}
				value={tcp}
				disabled={all || update.isPending}
				onChange={(event) => setTcp(event.target.value)}
				placeholder="27182, 8080"
			/>
			<Label htmlFor={`${id}-udp`}>UDP service ports</Label>
			<Input
				id={`${id}-udp`}
				value={udp}
				disabled={all || update.isPending}
				onChange={(event) => setUdp(event.target.value)}
				placeholder="5353"
			/>
			{!tunnel.port_settings_supported && (
				<p role="status">
					Update both workspaces to a helper with port-policy support before
					changing these settings.
				</p>
			)}
			{changed && (
				<div>
					<p role="status">The connection changed while you were editing.</p>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => {
							setAll(!tunnel.ports);
							setTcp(formatPorts(tunnel, "tcp"));
							setUdp(formatPorts(tunnel, "udp"));
							setRevision(tunnel.revision);
						}}
					>
						Reload settings
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="text-content-destructive">
					{error}
				</p>
			)}
			{update.error && <ErrorAlert error={update.error} />}
			{update.isSuccess && (
				<p role="status">
					{tunnel.status === "ready"
						? "Port settings are active."
						: "Port policy saved. Waiting for both helpers to acknowledge it."}
				</p>
			)}
			<Button
				type="submit"
				variant="outline"
				size="sm"
				disabled={
					!tunnel.port_settings_supported ||
					changed ||
					update.isPending ||
					tunnel.status === "disconnecting"
				}
			>
				Save port settings
			</Button>
		</form>
	);
};
