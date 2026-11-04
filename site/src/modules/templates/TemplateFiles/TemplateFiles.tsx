import { cn } from "cn";
import set from "lodash/set";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { SyntaxHighlighter } from "#/components/SyntaxHighlighter/SyntaxHighlighter";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/Tabs/Tabs";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { CarouselArrow } from "#/modules/platform/workspaceApps/AppsCarousel";
import type { FileTree } from "#/utils/filetree";
import type { TemplateVersionFiles } from "#/utils/templateVersion";
import { getTemplateFileIcon } from "./TemplateFileIcon";
import { TemplateFileTree } from "./TemplateFileTree";

type TemplateFilesProps = {
	organizationName: string;
	templateName: string;
	versionName: string;
	currentFiles: TemplateVersionFiles;
	/**
	 * Files used to compare with current files
	 */
	baseFiles?: TemplateVersionFiles;
	canEdit?: boolean;
	/** Shown under the file tree, in the same sticky column (Source Code: the versions). */
	sidebar?: React.ReactNode;
	/** Shown above the file tree (Source Code: Upload). */
	actions?: React.ReactNode;
	/** Shown above the files (Source Code: Code | Materialized). */
	tabs?: React.ReactNode;
	/** Shown in place of the files (Source Code: the materialized main.tf). */
	content?: React.ReactNode;
	onSelectFile?: () => void;
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
	canEdit = true,
	sidebar,
	actions,
	tabs,
	content,
	onSelectFile,
	fill = false,
}) => {
	const getLink = useLinks();
	const [showDiff, setShowDiff] = useState(true);
	const location = useLocation();
	const navigate = useNavigate();
	const names = useMemo(
		() => Object.keys(currentFiles).sort((a, b) => a.localeCompare(b)),
		[currentFiles],
	);
	const hash = location.hash.slice(1);
	const filename =
		names.find(
			(name) =>
				encodeURIComponent(name) === hash ||
				encodeURI(name) === hash ||
				name === hash,
		) ?? (names.includes("main.tf") ? "main.tf" : names[0]);
	const pickFile = (path: string) => {
		if (!Object.hasOwn(currentFiles, path)) return;
		onSelectFile?.();
		void navigate(
			{
				pathname: location.pathname,
				search: location.search,
				hash: encodeURIComponent(path),
			},
			{ replace: true, preventScrollReset: true },
		);
	};

	const fileInfo = useCallback(
		(filename: string) => {
			const value = currentFiles[filename].trim();
			const previousValue = baseFiles ? baseFiles[filename]?.trim() : undefined;
			const hasDiff = previousValue !== undefined && value !== previousValue;

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

	const info = filename === undefined ? undefined : fileInfo(filename);
	return (
		<div>
			<div className="flex items-start gap-8">
				{/* top-28 (112px) is a sum of nav height (72px) and TemplateLayout's LinkTabs' mb-10 (40px); without
				    the tabs (fill), the nav and a 16px gap */}
				<div
					className={cn(
						"sticky flex w-[240px] shrink-0 flex-col gap-3",
						fill
							? "top-[calc(88px+var(--coder-classification-h,0px))] max-h-[calc(100dvh-104px-var(--coder-classification-h,0px))]"
							: "top-[calc(112px+var(--coder-classification-h,0px))] max-h-[calc(100dvh-128px-var(--coder-classification-h,0px))]",
					)}
				>
					{actions}
					<div
						className={cn(
							"min-h-0 overflow-auto rounded-lg border border-solid border-surface-quaternary py-1",
							sidebar && "max-h-[40vh]",
						)}
					>
						<TemplateFileTree
							fileTree={fileTree}
							activePath={filename}
							onSelect={pickFile}
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
						(filename !== undefined && info ? (
							<Tabs
								value={filename}
								onValueChange={pickFile}
								className="min-w-0 overflow-hidden rounded-lg border border-solid border-surface-quaternary"
							>
								<header className="flex w-full min-w-0 items-center border-0 border-b border-solid border-surface-quaternary">
									<FileCarousel names={names} selected={filename} />
								</header>
								<TabsContent value={filename} className="m-0">
									<SyntaxHighlighter
										key={filename}
										language={getLanguage(filename)}
										value={info.value}
										compareWith={showDiff ? info.previousValue : undefined}
										editorProps={{
											// 18 is the editor line height; filling the page, up to most of the window
											height: Math.min(
												numberOfLines(info.value) * 18,
												fill
													? Math.max(560, Math.round(window.innerHeight * 0.72))
													: 560,
											),
											onMount: (editor) => {
												editor.updateOptions({
													scrollBeyondLastLine: false,
												});
												const editors =
													"getModifiedEditor" in editor
														? [
																editor.getOriginalEditor(),
																editor.getModifiedEditor(),
															]
														: [editor];
												for (const pane of editors) {
													if (canEdit)
														pane.addAction({
															id: "coder.editTemplateFile",
															label: "Edit file",
															contextMenuGroupId: "navigation",
															run: () =>
																navigate(
																	`${versionLink}/edit?path=${encodeURIComponent(filename)}`,
																),
														});
													if (info.hasDiff)
														pane.addAction({
															id: "coder.toggleTemplateDiff",
															label: showDiff
																? "Hide diff view"
																: "Show diff view",
															contextMenuGroupId: "navigation",
															run: () => setShowDiff(!showDiff),
														});
												}
											},
										}}
									/>
								</TabsContent>
							</Tabs>
						) : (
							<p>No files in this template version.</p>
						))}
				</div>
			</div>
		</div>
	);
};

const FileCarousel: React.FC<{ names: string[]; selected: string }> = ({
	names,
	selected,
}) => {
	const list = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ before: false, after: false });
	const measure = useCallback(() => {
		const el = list.current;
		if (el)
			setEdges({
				before: el.scrollLeft > 1,
				after: el.scrollWidth - el.clientWidth - el.scrollLeft > 1,
			});
	}, []);
	useLayoutEffect(() => {
		const el = list.current;
		if (!el) return;
		const reveal = () => {
			const active = el.querySelector<HTMLElement>('[aria-selected="true"]');
			if (active) {
				const left = active.offsetLeft;
				if (left < el.scrollLeft) el.scrollLeft = left;
				else if (left + active.offsetWidth > el.scrollLeft + el.clientWidth)
					el.scrollLeft = left + active.offsetWidth - el.clientWidth;
			}
			measure();
		};
		reveal();
		const observer = new ResizeObserver(reveal);
		observer.observe(el);
		return () => observer.disconnect();
	}, [selected, names, measure]);
	const slide = (direction: number) => {
		const el = list.current;
		if (el)
			el.scrollBy({
				left: direction * el.clientWidth * 0.75,
				behavior: "auto",
			});
	};
	return (
		<div
			className="apps-carousel my-1 min-w-0 flex-1"
			data-framed
			aria-label="Template file carousel"
			role="group"
			aria-roledescription="carousel"
		>
			<CarouselArrow
				orientation="horizontal"
				side="previous"
				itemLabel="files"
				disabled={!edges.before}
				onClick={() => slide(-1)}
			/>
			<TabsList
				ref={list}
				aria-label="Template files"
				className="relative min-w-0 flex-1 flex-nowrap justify-start gap-1 overflow-x-auto border-0 [scrollbar-width:none]"
				onScroll={measure}
			>
				{names.map((name) => {
					const Icon = getTemplateFileIcon(name);
					return (
						<TabsTrigger
							key={name}
							value={name}
							title={name}
							className="flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-linear-to-r from-surface-secondary to-surface-tertiary px-3! py-1.5! data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-content-link"
						>
							<Icon aria-hidden className="size-icon-xs shrink-0" />
							<span className="truncate">{name}</span>
						</TabsTrigger>
					);
				})}
			</TabsList>
			<CarouselArrow
				orientation="horizontal"
				side="next"
				itemLabel="files"
				disabled={!edges.after}
				onClick={() => slide(1)}
			/>
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
