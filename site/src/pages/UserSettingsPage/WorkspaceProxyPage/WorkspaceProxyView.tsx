import type { Region } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { FeatureUnavailable } from "#/components/FeatureUnavailable/FeatureUnavailable";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderDocsLink,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import { TableLoader } from "#/components/TableLoader/TableLoader";
import type { ProxyLatencyReport } from "#/contexts/useProxyLatency";
import { docs } from "#/utils/docs";
import { ProxyRow } from "./WorkspaceProxyRow";

type WorkspaceProxyViewProps = {
	proxies?: readonly Region[];
	proxyLatencies?: Record<string, ProxyLatencyReport>;
	getWorkspaceProxiesError?: unknown;
	isLoading: boolean;
	hasLoaded: boolean;
	preferredProxy?: Region;
	selectProxyError?: unknown;
	isFeatureUnavailable: boolean;
};

export const WorkspaceProxyView: React.FC<WorkspaceProxyViewProps> = ({
	proxies,
	proxyLatencies,
	getWorkspaceProxiesError,
	isLoading,
	hasLoaded,
	selectProxyError,
	isFeatureUnavailable,
}) => {
	return (
		<div>
			<SettingsHeader>
				<SettingsHeaderTitle>Workspace Proxies</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Workspace proxies improve terminal and web app connections to
					workspaces.{" "}
					<SettingsHeaderDocsLink
						href={docs("/admin/networking/workspace-proxies")}
					/>
				</SettingsHeaderDescription>
			</SettingsHeader>

			{isFeatureUnavailable ? (
				<FeatureUnavailable feature="Workspace Proxies" />
			) : (
				<div className="flex flex-col gap-4">
					{Boolean(getWorkspaceProxiesError) && (
						<ErrorAlert error={getWorkspaceProxiesError} />
					)}
					{Boolean(selectProxyError) && <ErrorAlert error={selectProxyError} />}

					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[60%]">Proxy</TableHead>
								<TableHead className="w-[20%]">Status</TableHead>
								<TableHead className="w-[20%]">Latency</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<ProxiesTableBody
								proxies={proxies}
								proxyLatencies={proxyLatencies}
								isLoading={isLoading}
								hasLoaded={hasLoaded}
							/>
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
};

type ProxiesTableBodyProps = {
	proxies?: readonly Region[];
	proxyLatencies?: Record<string, ProxyLatencyReport>;
	isLoading: boolean;
	hasLoaded: boolean;
};

const ProxiesTableBody: React.FC<ProxiesTableBodyProps> = ({
	proxies,
	proxyLatencies,
	isLoading,
	hasLoaded,
}) => {
	if (isLoading) {
		return <TableLoader />;
	}
	if (hasLoaded && proxies?.length === 0) {
		return <TableEmpty message="No workspace proxies found" />;
	}
	return proxies?.map((proxy) => (
		<ProxyRow
			latency={proxyLatencies?.[proxy.id]}
			key={proxy.id}
			proxy={proxy}
		/>
	));
};
