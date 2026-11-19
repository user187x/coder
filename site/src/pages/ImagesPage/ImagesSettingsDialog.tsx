import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	ImagesAPI,
	type ImagesSettings,
	type TrivyScannerSources,
	type TrivyScannerStatus,
} from "#/api/images";
import { securityDataKey, trivyScannerKey } from "#/api/queries/images";
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
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import { Switch } from "#/components/Switch/Switch";
import { Textarea } from "#/components/Textarea/Textarea";
import { createDayString } from "#/utils/createDayString";
import { SecurityDataSection } from "./SecurityData";

/**
 * Images > Settings: where apt packages come from (in an air gap: your
 * mirror), and where backups go (S3 or an S3-compatible store). Admins
 * change them; everyone sees them.
 */
export const ImagesSettingsDialog: React.FC<{ onClose: () => void }> = ({
	onClose,
}) => {
	const query = useQuery({
		queryKey: ["platform", "images", "settings"],
		queryFn: ImagesAPI.settings,
	});
	const [sources, setSources] = useState("");
	const [s3, setS3] = useState<ImagesSettings["s3"]>({});
	useEffect(() => {
		if (query.data) {
			setSources(query.data.aptSources);
			setS3({ ...query.data.s3, secretKey: "" });
		}
	}, [query.data]);
	const save = useMutation({
		mutationFn: () => ImagesAPI.saveSettings({ aptSources: sources, s3 }),
		onSuccess: () => {
			toast.success(
				"Saved. The package lists are fetched again from the new sources.",
			);
			void query.refetch();
		},
		onError: (e) => toast.error(getErrorMessage(e, "Not saved.")),
	});
	const can = query.data?.canChange ?? false;
	const index = query.data?.index;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Image builder settings</DialogTitle>
					<DialogDescription>
						{can
							? "The security data that grades images, apt sources for every build, and S3 for backups."
							: "Only admins change these."}
					</DialogDescription>
				</DialogHeader>
				{!query.data ? (
					<Loader />
				) : (
					<div className="flex max-h-[calc(65vh/var(--app-zoom,1))] flex-col gap-5 overflow-y-auto pr-1">
						<TrivyScannerSettings canChange={can} />
						<SecurityDataSection />
						<section className="flex flex-col gap-2">
							<Label htmlFor="apt-sources">
								Apt sources (deb822 or one-line "deb" entries)
							</Label>
							<Textarea
								id="apt-sources"
								value={sources}
								disabled={!can}
								rows={9}
								className="font-mono text-xs"
								onChange={(e) => setSources(e.target.value)}
							/>
							<span className="text-xs text-content-secondary">
								Used to check packages in the builder and, when they differ from
								the workspace image's own, as the image's only sources (an
								air-gapped mirror: Nexus, Artifactory, aptly…).{" "}
								{index && (
									<>
										Now: {index.packages.toLocaleString()} packages from{" "}
										{index.sources} source
										{index.sources === 1 ? "" : "s"}
										{index.loadedAt
											? `, read ${createDayString(index.loadedAt)}`
											: ""}
										.
									</>
								)}
							</span>
							{index?.errors.length ? (
								<ul className="m-0 pl-4 text-xs text-content-destructive">
									{index.errors.map((e) => (
										<li key={e}>{e}</li>
									))}
								</ul>
							) : null}
							{can && (
								<div>
									<Button
										size="sm"
										variant="outline"
										onClick={() => setSources(query.data.defaultAptSources)}
									>
										The workspace image's own sources
									</Button>
								</div>
							)}
						</section>
						<section className="flex flex-col gap-3">
							<h3 className="m-0 text-sm font-semibold">S3 backups</h3>
							<p className="m-0 text-xs text-content-secondary">
								An image with S3 backup on is uploaded after each build as{" "}
								<code>&lt;prefix&gt;&lt;name&gt;-&lt;version&gt;.tar</code> (a{" "}
								<code>docker load</code> tarball). AWS S3, or a compatible store
								such as MinIO inside the air gap.
							</p>
							<div className="grid gap-3 sm:grid-cols-2">
								{(
									[
										[
											"endpoint",
											"Endpoint (empty: AWS)",
											"https://minio.example.internal",
										],
										["region", "Region", "us-east-1"],
										["bucket", "Bucket", "coder-images"],
										["prefix", "Key prefix", "backups/"],
										["accessKey", "Access key", ""],
									] as const
								).map(([key, label, placeholder]) => (
									<div key={key} className="flex flex-col gap-1">
										<Label htmlFor={`s3-${key}`}>{label}</Label>
										<Input
											id={`s3-${key}`}
											value={(s3[key] as string | undefined) ?? ""}
											placeholder={placeholder}
											disabled={!can}
											onChange={(e) => setS3({ ...s3, [key]: e.target.value })}
										/>
									</div>
								))}
								<div className="flex flex-col gap-1">
									<Label htmlFor="s3-secret">Secret key</Label>
									<Input
										id="s3-secret"
										type="password"
										value={s3.secretKey ?? ""}
										placeholder={
											query.data.s3.secretSet ? "(kept; type to replace)" : ""
										}
										disabled={!can}
										autoComplete="off"
										onChange={(e) =>
											setS3({ ...s3, secretKey: e.target.value })
										}
									/>
								</div>
							</div>
							<label
								htmlFor="s3-path-style"
								className="flex items-center gap-2 text-sm"
							>
								<Switch
									id="s3-path-style"
									checked={s3.pathStyle ?? true}
									disabled={!can}
									onCheckedChange={(v) => setS3({ ...s3, pathStyle: v })}
								/>
								Path-style addresses (MinIO and most S3-compatible stores)
							</label>
						</section>
					</div>
				)}
				<DialogFooter className="gap-2">
					<Button variant="outline" onClick={onClose}>
						Close
					</Button>
					{can && (
						<Button onClick={() => save.mutate()} disabled={save.isPending}>
							<Spinner loading={save.isPending} />
							Save
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

function TrivyScannerSettings({ canChange }: { canChange: boolean }) {
	const id = useId();
	const queryClient = useQueryClient();
	const [version, setVersion] = useState<string | null>(null);
	const [sources, setSources] = useState<TrivyScannerSources | null>(null);
	const query = useQuery({
		queryKey: trivyScannerKey,
		queryFn: async () => {
			const status = await ImagesAPI.trivyScanner();
			if (
				!status.updatingDefinitions &&
				queryClient.getQueryData<TrivyScannerStatus>(trivyScannerKey)
					?.updatingDefinitions
			) {
				void queryClient.invalidateQueries({ queryKey: securityDataKey });
			}
			return status;
		},
		refetchInterval: ({ state: { data } }) =>
			data?.installing || data?.updatingDefinitions ? 2_000 : false,
	});
	const configure = useMutation({
		mutationFn: ({
			enabled,
			version,
			sources,
		}: {
			enabled: boolean;
			version: string;
			sources?: TrivyScannerSources;
		}) =>
			sources
				? ImagesAPI.configureTrivyScanner(enabled, version, sources)
				: ImagesAPI.configureTrivyScanner(enabled, version),
		onSuccess: (status) => {
			queryClient.setQueryData(trivyScannerKey, status);
			setVersion(null);
			setSources(null);
		},
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not configure Trivy.")),
	});
	const refresh = useMutation({
		mutationFn: ImagesAPI.refreshTrivyDefinitions,
		onSuccess: (status) => queryClient.setQueryData(trivyScannerKey, status),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not update scan definitions.")),
	});

	if (query.isError && !query.data) {
		return <p role="alert">Could not load Trivy Scanner settings.</p>;
	}
	if (!query.data) {
		return <Loader />;
	}
	const status = query.data;
	const requestedVersion = version ?? status.requestedVersion;
	const busy =
		status.installing ||
		status.updatingDefinitions ||
		configure.isPending ||
		refresh.isPending;
	const configuredSources = sources ?? status.sources;
	const sourceFields = [
		["releaseUrl", "Scanner release base URL"],
		["dbRepository", "Vulnerability database repository"],
		["javaDbRepository", "Java database repository"],
	] as const;
	const validVersion = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(
		requestedVersion,
	);

	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor={id}>Enable Trivy Scanner</Label>
				<Switch
					id={id}
					checked={status.enabled}
					disabled={!canChange || busy || (!status.enabled && !validVersion)}
					onCheckedChange={(enabled) =>
						configure.mutate({
							enabled,
							version: enabled ? requestedVersion : status.requestedVersion,
							sources: enabled ? (sources ?? undefined) : undefined,
						})
					}
				/>
			</div>
			<p className="m-0 text-xs text-content-secondary" role="status">
				{status.installing
					? `Installing Trivy ${status.requestedVersion}.`
					: status.enabled && status.activeVersion
						? `Trivy ${status.activeVersion} is ready.`
						: status.enabled
							? "Trivy is not installed."
							: "Trivy scanning is off."}
			</p>
			{status.error && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{status.error}
				</p>
			)}
			<div className="flex flex-wrap items-end gap-2">
				<div className="flex flex-col gap-1">
					<Label htmlFor={`${id}-version`}>Trivy release version</Label>
					<Input
						id={`${id}-version`}
						value={requestedVersion}
						onChange={(event) => setVersion(event.target.value)}
						disabled={!canChange || busy}
					/>
				</div>
				{status.enabled && canChange && (
					<Button
						variant="outline"
						disabled={
							busy || !validVersion || requestedVersion === status.activeVersion
						}
						onClick={() =>
							configure.mutate({
								enabled: true,
								version: requestedVersion,
								sources: sources ?? undefined,
							})
						}
					>
						{status.error && requestedVersion === status.requestedVersion
							? "Retry install"
							: "Install version"}
					</Button>
				)}
			</div>
			{canChange && (
				<>
					<div>
						<Button
							variant="outline"
							disabled={busy || !status.enabled || !status.activeVersion}
							onClick={() => refresh.mutate()}
						>
							<Spinner
								loading={refresh.isPending || status.updatingDefinitions}
							/>
							{status.updatingDefinitions
								? "Updating scan definitions…"
								: "Update scan definitions"}
						</Button>
					</div>
					{status.definitionError && (
						<p role="alert" className="m-0 text-sm text-content-destructive">
							{status.definitionError}
						</p>
					)}
					<details className="text-sm">
						<summary className="cursor-pointer">Download sources</summary>
						<div className="mt-2 flex flex-col gap-2">
							{sourceFields.map(([key, label]) => (
								<div key={key} className="flex flex-col gap-1">
									<Label htmlFor={`${id}-${key}`}>{label}</Label>
									<Input
										id={`${id}-${key}`}
										value={configuredSources[key]}
										disabled={busy}
										onChange={(event) =>
											setSources({
												...configuredSources,
												[key]: event.target.value,
											})
										}
									/>
								</div>
							))}
							<p className="m-0 text-xs text-content-secondary">
								For offline deployments, point these sources at internal
								mirrors. The release mirror must serve the checksum file and
								archive at the same versioned paths as the upstream release
								source.
							</p>
							<div>
								<Button
									variant="outline"
									disabled={busy || !sources}
									onClick={() =>
										configure.mutate({
											enabled: status.enabled,
											version: status.requestedVersion,
											sources: sources ?? undefined,
										})
									}
								>
									Save download sources
								</Button>
							</div>
						</div>
					</details>
				</>
			)}
		</section>
	);
}
