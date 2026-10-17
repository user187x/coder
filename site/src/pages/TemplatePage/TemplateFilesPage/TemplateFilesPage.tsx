import { ExternalLinkIcon } from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "react-query";
import {
	Link as RouterLink,
	useLocation,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router";
import {
	previousTemplateVersion,
	templateFiles,
	templateVersionByName,
} from "#/api/queries/templates";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { TemplateFiles } from "#/modules/templates/TemplateFiles/TemplateFiles";
import { useTemplateLayoutContext } from "#/pages/TemplatePage/TemplateLayout";
import { getTemplatePageTitle } from "../utils";
import { UploadTemplateFiles } from "./UploadTemplateFiles";
import { VersionsSidebar } from "./VersionsSidebar";

const TemplateFilesPage: React.FC = () => {
	const { organization: organizationName = "default" } = useParams() as {
		organization?: string;
	};
	const location = useLocation();
	const navigate = useNavigate();
	const locationState = location.state as { justCreated?: boolean } | null;
	const justCreated = locationState?.justCreated === true;

	useEffect(() => {
		if (justCreated) {
			navigate(location.pathname, { replace: true, state: {} });
		}
	}, [justCreated, navigate, location.pathname]);
	const { template, activeVersion, permissions } = useTemplateLayoutContext();
	const getLink = useLinks();
	// ?version=<name>: that version's code (picked in the versions list); else the active version's
	const [searchParams, setSearchParams] = useSearchParams();
	const picked = searchParams.get("version");
	const pickedQuery = useQuery({
		...templateVersionByName(organizationName, template.name, picked ?? ""),
		enabled: Boolean(picked) && picked !== activeVersion.name,
	});
	const version =
		picked && picked !== activeVersion.name ? pickedQuery.data : activeVersion;
	const { data: currentFiles } = useQuery({
		...templateFiles(version?.job.file_id ?? ""),
		enabled: Boolean(version),
	});
	const previousVersionQuery = useQuery({
		...previousTemplateVersion(
			organizationName,
			template.name,
			version?.name ?? "",
		),
		enabled: Boolean(version),
	});
	const previousVersion = previousVersionQuery.data;
	const hasPreviousVersion =
		previousVersionQuery.isSuccess && previousVersion !== null;
	const { data: previousFiles } = useQuery({
		...templateFiles(previousVersion?.job.file_id ?? ""),
		enabled: hasPreviousVersion,
	});
	const shouldDisplayFiles =
		currentFiles && (!hasPreviousVersion || previousFiles);

	return (
		<>
			<title>{getTemplatePageTitle("Source Code", template)}</title>

			{justCreated && (
				<Alert severity="info" dismissible className="mb-6">
					<AlertTitle className="font-semibold">
						Awesome, you just created a new template!
					</AlertTitle>
					<AlertDescription>
						To customize it further you can edit the Terraform or Coder Template
						directly. You can use our template agent skill to help you.
					</AlertDescription>
					<div className="flex items-center gap-2 mt-4">
						<Button asChild size="sm" variant="default">
							<a
								href="https://registry.coder.com/skills/coder-templates"
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center"
							>
								View agent skill
								<ExternalLinkIcon className="size-icon-sm ml-1" />
							</a>
						</Button>
					</div>
				</Alert>
			)}

			{version && version.id !== activeVersion.id && (
				<div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-solid border-border bg-surface-secondary px-4 py-2 text-sm">
					<span>
						The code of version{" "}
						<strong className="font-mono">{version.name}</strong>
						{version.message ? ` · ${version.message.split("\n")[0]}` : ""}
					</span>
					<span className="flex-1" />
					<RouterLink
						to={`${getLink(linkToTemplate(template.organization_name, template.name))}/versions/${version.name}`}
						className="text-content-link"
					>
						Version page
					</RouterLink>
					<button
						type="button"
						className="cursor-pointer border-0 bg-transparent p-0 text-content-link"
						onClick={() => setSearchParams({}, { replace: true })}
					>
						Back to the active version
					</button>
				</div>
			)}
			{shouldDisplayFiles && version ? (
				<TemplateFiles
					key={version.id}
					organizationName={template.organization_name}
					templateName={template.name}
					versionName={version.name}
					currentFiles={currentFiles}
					baseFiles={previousFiles}
					actions={
						permissions.canUpdateTemplate && (
							<UploadTemplateFiles
								template={template}
								version={version}
								folders={foldersOf(currentFiles)}
							/>
						)
					}
					sidebar={
						<VersionsSidebar
							template={template}
							canUpdate={permissions.canUpdateTemplate}
							shownVersionName={version.name}
							onSelect={(v) =>
								setSearchParams(
									v.id === activeVersion.id ? {} : { version: v.name },
									{ replace: true },
								)
							}
						/>
					}
				/>
			) : (
				<Loader />
			)}
		</>
	);
};

/** The folders the files are in ("a", "a/b"), sorted. */
const foldersOf = (files: Record<string, string>) => {
	const folders = new Set<string>();
	for (const name of Object.keys(files)) {
		const parts = name.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) {
			folders.add(parts.slice(0, i).join("/"));
		}
	}
	return [...folders].sort((a, b) => a.localeCompare(b));
};

export default TemplateFilesPage;
