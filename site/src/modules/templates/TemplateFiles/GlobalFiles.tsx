import { FileLockIcon, GlobeIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { templateDecorator } from "#/api/queries/templateBuilder";
import type { TemplateDecoratorFile } from "#/api/typesGenerated";
import { Badge } from "#/components/Badge/Badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { SyntaxHighlighter } from "#/components/SyntaxHighlighter/SyntaxHighlighter";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { formatBytes } from "#/modules/platform/cloudDrive/drivePaths";

const languageOf = (name: string) =>
	name.endsWith(".py") ? "python" : name.endsWith(".sh") ? "shell" : undefined;

/**
 * Global files (Source Code, under Upload): the files the platform provides to every template - the scripts of the
 * template decorator's sections (the owner's certificate, Lock Down, the Cloud Drive, the metrics), in a template
 * as .platform/<name> when it is built. Read-only. Hovered, a file says it is provided and how a template of your own
 * reads it; clicked, it opens with its whole code.
 */
export const GlobalFiles: React.FC = () => {
	const { data } = useQuery(templateDecorator());
	const [open, setOpen] = useState<TemplateDecoratorFile | null>(null);
	if (!data?.enabled || data.global_files.length === 0) {
		return null;
	}
	return (
		<section
			className="flex shrink-0 flex-col gap-1.5 rounded-lg border border-solid border-surface-quaternary p-2"
			aria-labelledby="global-files"
			data-testid="global-files"
		>
			<h3
				id="global-files"
				className="m-0 flex items-center gap-1.5 px-1 text-xs font-semibold text-content-secondary"
			>
				<GlobeIcon className="size-3.5" />
				Global files
			</h3>
			<ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0">
				{data.global_files.map((f) => (
					<li key={f.name}>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => setOpen(f)}
									className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-solid border-border bg-surface-secondary px-2 py-1.5 text-left text-xs hover:border-content-secondary"
									data-testid={`global-file-${f.name}`}
								>
									<FileLockIcon className="size-3.5 shrink-0 text-content-secondary" />
									<span className="min-w-0 flex-1 truncate font-mono">
										{f.name}
									</span>
									<span className="shrink-0 text-content-secondary tabular-nums">
										{formatBytes(f.size)}
									</span>
								</button>
							</TooltipTrigger>
							<TooltipContent
								side="right"
								className="max-w-md"
								data-testid={`global-file-hover-${f.name}`}
							>
								<div className="flex flex-col gap-1.5">
									<span className="flex items-center gap-2">
										<Badge size="sm" variant="info">
											Provided
										</Badge>
										<span className="font-mono text-xs">{f.path}</span>
									</span>
									<span className="text-xs text-content-secondary">
										In every template ({f.features.join(", ")}). Read it in
										yours:
									</span>
									<pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-primary p-2 font-mono text-[11px]">
										{f.reference || `file("\${path.module}/${f.path}")`}
									</pre>
								</div>
							</TooltipContent>
						</Tooltip>
					</li>
				))}
			</ul>
			{open && (
				<Dialog open onOpenChange={(o) => !o && setOpen(null)}>
					<DialogContent className="max-w-4xl" data-testid="global-file-view">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2 font-mono">
								{open.path}
								<Badge size="sm" variant="info">
									Provided · read-only
								</Badge>
							</DialogTitle>
							<DialogDescription>
								The platform provides it to every template (
								{open.features.join(", ")}). Read it in a template of yours
								with:{" "}
								<code className="whitespace-pre-wrap">{open.reference}</code>
							</DialogDescription>
						</DialogHeader>
						<div className="overflow-hidden rounded-lg border border-solid border-surface-quaternary">
							<SyntaxHighlighter
								language={languageOf(open.name)}
								value={open.content}
								editorProps={{
									height: "60vh",
									options: { readOnly: true, scrollBeyondLastLine: false },
								}}
							/>
						</div>
					</DialogContent>
				</Dialog>
			)}
		</section>
	);
};
