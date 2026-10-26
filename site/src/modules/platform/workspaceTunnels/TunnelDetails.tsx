import type { WorkspaceTunnel, WorkspaceTunnelStats } from "#/api/platform";
import { formatBytes } from "../images";
import { NetworkHistogram } from "../networkLeds/NetworkHistogram";
import { TunnelPortSettings } from "./TunnelPortSettings";

/** Measurements are helper counters since its last reset, rather than lifetime totals. */
export const TunnelDetails: React.FC<{ tunnel: WorkspaceTunnel }> = ({
	tunnel,
}) => (
	<div className="flex flex-col gap-4 text-sm">
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 break-all">
			<dt>Connection</dt>
			<dd className="m-0">{tunnel.id}</dd>
			<dt>Organization</dt>
			<dd className="m-0">{tunnel.organization_id}</dd>
			<dt>Status</dt>
			<dd className="m-0">{tunnel.error ?? tunnel.status}</dd>
			<dt>Node latency</dt>
			<dd className="m-0">Not reported by tunnel helpers</dd>
			<dt>Certificates</dt>
			<dd className="m-0">Certificate details are not reported</dd>
		</dl>
		<TunnelPortSettings key={tunnel.id} tunnel={tunnel} />
		<Endpoint
			name={tunnel.source_workspace_name ?? tunnel.source_workspace_id}
			address={tunnel.source_address}
			stats={tunnel.source_stats}
		/>
		<Endpoint
			name={tunnel.target_workspace_name ?? tunnel.target_workspace_id}
			address={tunnel.target_address}
			stats={tunnel.target_stats}
		/>
	</div>
);

const Endpoint: React.FC<{
	name: string;
	address?: string;
	stats?: WorkspaceTunnelStats | null;
}> = ({ name, address, stats }) => {
	const series = (stats?.series ?? [])
		.filter(
			(s) =>
				Number.isFinite(s.timestamp) &&
				Number.isFinite(s.rx_bytes_per_second) &&
				Number.isFinite(s.tx_bytes_per_second) &&
				s.rx_bytes_per_second >= 0 &&
				s.tx_bytes_per_second >= 0,
		)
		.toSorted((a, b) => a.timestamp - b.timestamp);
	const samples = series.map((s, index) => ({
		from: (series[index - 1]?.timestamp ?? s.timestamp) * 1000,
		t: s.timestamp * 1000,
		rx: s.rx_bytes_per_second,
		tx: s.tx_bytes_per_second,
	}));
	const counter = (value?: number) =>
		value !== undefined && Number.isFinite(value) && value >= 0
			? formatBytes(value)
			: "Not reported";
	return (
		<section
			aria-label={`Endpoint ${name}`}
			className="rounded-lg border border-solid border-border p-3"
		>
			<h3 className="m-0 text-sm">{name}</h3>
			<p className="break-all font-mono">{address ?? "Address not reported"}</p>
			<p>
				Received: {counter(stats?.rx_bytes)} · Sent: {counter(stats?.tx_bytes)}
			</p>
			<p className="text-xs text-content-secondary">
				Counters since the helper's last reset.{" "}
				{stats?.stale ? "Measurements are stale." : ""}
			</p>
			{samples.length ? (
				<NetworkHistogram samples={samples} />
			) : (
				<p>Transfer history is not available yet.</p>
			)}
			<p>Observed ports</p>
			{stats?.ports_available ? (
				stats.ports.length ? (
					<ul>
						{stats.ports.map((p) => (
							<li key={`${p.protocol}:${p.local_port}:${p.remote_port}`}>
								{p.protocol.toUpperCase()} local {p.local_port} → remote{" "}
								{p.remote_port}
							</li>
						))}
					</ul>
				) : (
					<p>No active ports observed.</p>
				)
			) : (
				<p>Port information is not reported.</p>
			)}
		</section>
	);
};
