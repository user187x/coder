import { cn } from "cn";
import set from "lodash/set";
import { EditIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { SyntaxHighlighter } from "#/components/SyntaxHighlighter/SyntaxHighlighter";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import type { FileTree } from "#/utils/filetree";
import type { TemplateVersionFiles } from "#/utils/templateVersion";
import { getTemplateFileIcon } from "./TemplateFileIcon";
import { TemplateFileTree } from "./TemplateFileTree";

/** What sticks to the top of the page (the navbar, and the classification banner when there is one), plus a gap. */
const stickyTop = () => {
	const banner =
		Number.parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue(
				"--coder-classification-h",
			),
		) || 0;
	return 72 + banner + 16;
};

/**
 * Platform: a file picked in the tree brought into view - centred when it fits below the sticky navbar, else its
 * header just below it - in one smooth scroll. The address keeps the file (#path) without a navigation: setting
 * location.hash made the browser jump and the router react while the smooth scroll ran, so the page jittered.
 */
export const scrollToFile = (path: string) => {
	const el = document.getElementById(path);
	if (!el) {
		return false;
	}
	window.history.replaceState(window.history.state, "", `#${encodeURI(path)}`);
	const rect = el.getBoundingClientRect();
	const top = stickyTop();
	const room = window.innerHeight - top;
	const offset = rect.height < room ? top + (room - rect.height) / 2 : top;
	window.scrollTo({
		top: Math.max(0, window.scrollY + rect.top - offset),
		behavior: "smooth",
	});
	return true;
};

type TemplateFilesProps = {
	organizationName: string;
	templateName: string;
	versionName: string;
	currentFiles: TemplateVersionFiles;
	/**
	 * Files used to compare with current files
	 */
	baseFiles?: TemplateVersionFiles;
	/** Shown under the file tree, in the same sticky column (Source Code: the versions). */
	sidebar?: React.ReactNode;
	/** Shown above the file tree (Source Code: Upload). */
	actions?: React.ReactNode;
	/** Shown above the files (Source Code: Code | Materialized). */
	tabs?: React.ReactNode;
	/** Shown in place of the files (Source Code: the materialized main.tf). */
	content?: React.ReactNode;
	/**
	 * Platform: the page has no tabs above it (Source Code, the template page's one view): the file tree sticks just
	 * under the navigation and both columns take the height the tabs had, the files a taller view each.
	 */
	fill?: boolean;
};

export const TemplateFiles: React.FC<TemplateFilesProps> = ({
	organizationName,
	templateName,
	versionName,
	currentFiles,
	baseFiles,
	sidebar,
	actions,
	tabs,
	content,
	fill = false,
}) => {
	const getLink = useLinks();
	// The file just picked in the tree: outlined for a moment, so the eye finds it.
	const [picked, setPicked] = useState<string>();
	const pickedTimer = useRef<number>(undefined);

	const fileInfo = useCallback(
		(filename: string) => {
			const value = currentFiles[filename].trim();
			const previousValue = baseFiles ? baseFiles[filename]?.trim() : undefined;
			const hasDiff = previousValue && value !== previousValue;

			return {
				value,
				previousValue,
				hasDiff,
			};
		},
		[baseFiles, currentFiles],
	);

	const fileTree: FileTree = useMemo(() => {
		const tree: FileTree = {};
		for (const filename of Object.keys(currentFiles)) {
			const info = fileInfo(filename);
			set(tree, filename.split("/"), info.value);
		}
		return tree;
	}, [fileInfo, currentFiles]);

	const versionLink = `${getLink(
		linkToTemplate(organizationName, templateName),
	)}/versions/${versionName}`;

	return (
		<div>
			<div className="flex items-start gap-8">
				{/* top-28 (112px) is a sum of nav height (72px) and TemplateLayout's LinkTabs' mb-10 (40px); without
				    the tabs (fill), the nav and a 16px gap */}
				<div
					className={cn(
						"sticky flex w-[240px] shrink-0 flex-col gap-3",
						fill
							? "top-[88px] max-h-[calc(100vh-6rem)]"
							: "top-28 max-h-[calc(100vh-8rem)]",
					)}
				>
					{actions}
					<div
						className={cn(
							"min-h-0 overflow-auto rounded-lg border border-solid border-surface-quaternary py-1",
							sidebar && "max-h-[40vh] shrink-0",
						)}
					>
						<TemplateFileTree
							fileTree={fileTree}
							onSelect={(path: string) => {
								if (!scrollToFile(path)) {
									return;
								}
								setPicked(path);
								window.clearTimeout(pickedTimer.current);
								pickedTimer.current = window.setTimeout(
									() => setPicked(undefined),
									1600,
								);
							}}
							Label={({ path, filename, isFolder }) => {
								if (isFolder) {
									return filename;
								}

								const hasDiff = fileInfo(path).hasDiff;
								return (
									<span className={cn(hasDiff && "text-content-warning")}>
										{filename}
									</span>
								);
							}}
						/>
					</div>
					{sidebar}
				</div>

				<div
					className="flex min-w-0 flex-1 flex-col gap-4"
					data-testid="template-files-content"
				>
					{tabs}
					{content ??
						Object.keys(currentFiles)
							.sort((a, b) => a.localeCompare(b))
							.map((filename) => {
								const TemplateFileIcon = getTemplateFileIcon(filename);
								const info = fileInfo(filename);

								return (
									<div
										key={filename}
										id={filename}
										data-picked={picked === filename || undefined}
										className={cn(
											"overflow-hidden rounded-lg border border-solid border-surface-quaternary transition-shadow duration-500",
											picked === filename &&
												"border-content-link shadow-[0_0_0_2px_hsl(var(--content-link)/0.35)]",
										)}
									>
										<header className="flex items-center gap-2 border-0 border-b border-solid border-surface-quaternary px-4 py-2 text-sm font-medium">
											<div className="flex items-center gap-2">
												<TemplateFileIcon className="text-content-secondary size-icon-xs" />
												<span
													className={cn({
														"text-content-warning": info.hasDiff,
													})}
												>
													{filename}
												</span>
											</div>

											<div className="ml-auto">
												<RouterLink
													to={`${versionLink}/edit?path=${filename}`}
													className="flex items-center gap-1 text-sm no-underline text-content-secondary hover:text-content-primary"
												>
													<EditIcon className="text-inherit size-icon-xs" />
													Edit
												</RouterLink>
											</div>
										</header>
										<SyntaxHighlighter
											language={getLanguage(filename)}
											value={info.value}
											compareWith={info.previousValue}
											editorProps={{
												// 18 is the editor line height; filling the page, up to most of the window
												height: Math.min(
													numberOfLines(info.value) * 18,
													fill
														? Math.max(
																560,
																Math.round(window.innerHeight * 0.72),
															)
														: 560,
												),
												onMount: (editor) => {
													editor.updateOptions({
														scrollBeyondLastLine: false,
													});
												},
											}}
										/>
									</div>
								);
							})}
				</div>
			</div>
		</div>
	);
};

const languageByExtension: Record<string, string> = {
	tf: "hcl",
	hcl: "hcl",
	md: "markdown",
	mkd: "markdown",
	sh: "shell",
	tpl: "tpl",
	protobuf: "protobuf",
	nix: "dockerfile",
	json: "json",
};

const getLanguage = (filename: string) => {
	// Dockerfile can be like images/Dockerfile or Dockerfile.java
	if (filename.includes("Dockerfile")) {
		return "dockerfile";
	}
	const extension = filename.split(".").pop();
	return languageByExtension[extension ?? ""];
};

const numberOfLines = (content: string) => {
	return content.split("\n").length;
};
