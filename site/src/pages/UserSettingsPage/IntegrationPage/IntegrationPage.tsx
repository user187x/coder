import { DownloadIcon, TerminalIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link as RouterLink } from "react-router";
import { buildInfo } from "#/api/queries/buildInfo";
import type { BuildInfoResponse } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { UserSettingsHeader } from "../UserSettingsHeader";

/** The CLI this deployment serves: it bundles the Linux x86-64 build. */
const CLI_DOWNLOAD = {
	path: "/bin/coder-linux-amd64",
	platform: "Linux x86-64",
};

const releaseDate = (time: string | undefined) => {
	if (!time) {
		return "Not recorded in this build";
	}
	const date = new Date(time);
	return Number.isNaN(date.getTime())
		? "Not recorded in this build"
		: date.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
	label,
	children,
}) => (
	<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-0 border-b border-solid border-border py-3 last:border-b-0">
		<dt className="text-sm text-content-secondary">{label}</dt>
		<dd className="m-0 text-sm font-medium tabular-nums text-content-primary">
			{children}
		</dd>
	</div>
);

export const IntegrationPageView: React.FC<{ build: BuildInfoResponse }> = ({
	build,
}) => (
	<div className="flex flex-col gap-6">
		<dl className="m-0 rounded-lg border border-solid border-border px-4 bg-surface-primary">
			<Row label="CLI version">{build.version}</Row>
			<Row label="Dashboard">
				<span className="break-all">{build.dashboard_url}</span>
				<span className="ml-2 text-content-secondary">{build.version}</span>
			</Row>
			<Row label="Agent version">
				{build.version}
				<span className="ml-2 text-content-secondary">
					API {build.agent_api_version}
				</span>
			</Row>
			<Row label="Coder version">{build.version}</Row>
			<Row label="Release date">{releaseDate(build.build_time)}</Row>
		</dl>
		<div className="flex flex-wrap items-center gap-3">
			<Button asChild>
				<a href={CLI_DOWNLOAD.path} download>
					<DownloadIcon aria-hidden />
					Download the CLI ({CLI_DOWNLOAD.platform})
				</a>
			</Button>
			<Button asChild variant="outline">
				<RouterLink to="/install">
					<TerminalIcon aria-hidden />
					Install with a script
				</RouterLink>
			</Button>
		</div>
		<p className="m-0 text-xs text-content-secondary">
			The CLI, the dashboard and the workspace agent are built with this
			deployment, so they share its version. It bundles the CLI for{" "}
			{CLI_DOWNLOAD.platform}.
		</p>
	</div>
);

/** User Settings > Integration: the versions of what this deployment runs, and the CLI to download. */
const IntegrationPage: React.FC = () => {
	const { metadata } = useEmbeddedMetadata();
	const build = useQuery(buildInfo(metadata["build-info"]));
	return (
		<>
			<UserSettingsHeader section="integration">
				<SettingsHeaderTitle>Integration</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					The versions this deployment runs, and its command-line interface.
				</SettingsHeaderDescription>
			</UserSettingsHeader>
			{build.error ? (
				<ErrorAlert error={build.error} />
			) : build.data ? (
				<IntegrationPageView build={build.data} />
			) : (
				<Loader />
			)}
		</>
	);
};

export default IntegrationPage;
