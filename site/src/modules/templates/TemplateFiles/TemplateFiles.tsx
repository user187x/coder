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
import { bottomBarsHeight } from "#/utils/bottomBars";
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
	/** Fit the file browser to the remaining viewport height. */
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
	const container = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const element = container.current;
		if (!fill || !element) return;
		const measure = () => {
			const top = element.getBoundingClientRect().top + window.scrollY;
			element.style.height = `${Math.max(280, window.innerHeight - top - bottomBarsHeight() - 40)}px`;
		};
		const observer = new ResizeObserver(measure);
		if (element.parentElement) observer.observe(element.parentElement);
		const navbar = document.querySelector(".navbar-soft");
		if (navbar) observer.observe(navbar);
		measure();
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
			element.style.removeProperty("height");
		};
	}, [fill]);
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
		<div ref={container} className={cn("min-w-0", fill && "min-h-0")}>
			<div
				className={cn(
					"flex gap-3",
					fill ? "h-full min-h-0 items-stretch" : "items-start",
				)}
			>
				<div
					className={cn(
						"flex w-[clamp(9rem,22%,15rem)] shrink-0 flex-col gap-2",
						fill
							? "min-h-0 [&>section[aria-label=Versions]]:min-h-0 [&>section[aria-label=Versions]]:max-h-none [&>section[aria-label=Versions]]:flex-1"
							: "sticky top-[calc(112px+var(--coder-classification-h,0px))] max-h-[calc(100dvh-128px-var(--coder-classification-h,0px))]",
					)}
				>
					{actions}
					<div
						className={cn(
							"min-h-0 overflow-auto rounded-lg border border-solid border-surface-quaternary bg-surface-secondary/50 py-1",
							sidebar && (fill ? "max-h-[42%] shrink-0" : "max-h-[40vh]"),
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
					className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 [&>div[role=tablist]]:shrink-0"
					data-testid="template-files-content"
				>
					{tabs}
					{content ? (
						<div className="min-h-0 flex-1 overflow-auto">{content}</div>
					) : filename !== undefined && info ? (
						<Tabs
							value={filename}
							onValueChange={pickFile}
							className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-solid border-surface-quaternary bg-surface-primary"
						>
							<header className="flex w-full min-w-0 shrink-0 items-center border-0 border-b border-solid border-surface-quaternary">
								<FileCarousel names={names} selected={filename} />
							</header>
							<TabsContent
								value={filename}
								className={cn("m-0", fill && "min-h-0 flex-1 overflow-hidden")}
							>
								<SyntaxHighlighter
									key={filename}
									language={getLanguage(filename)}
									value={info.value}
									compareWith={showDiff ? info.previousValue : undefined}
									editorProps={{
										height: fill
											? "100%"
											: Math.min(numberOfLines(info.value) * 18, 560),
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
					)}
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
