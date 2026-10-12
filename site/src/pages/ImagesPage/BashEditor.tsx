import Editor, { loader, type OnMount } from "@monaco-editor/react";
import { cn } from "cn";
import {
	AlignLeftIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	InfoIcon,
	TriangleAlertIcon,
} from "lucide-react";
import * as monaco from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "#/api/errors";
import { ImagesAPI, type LintIssue } from "#/api/images";
import { Button } from "#/components/Button/Button";
import { Spinner } from "#/components/Spinner/Spinner";
import { MONOSPACE_FONT_FAMILY } from "#/theme/constants";
import { useTheme } from "#/theme/context";

// Monaco from the dashboard's own bundle (nothing loads from a CDN: air-gapped).
loader.config({ monaco });

const SEVERITY: Record<LintIssue["level"], monaco.MarkerSeverity> = {
	error: monaco.MarkerSeverity.Error,
	warning: monaco.MarkerSeverity.Warning,
	info: monaco.MarkerSeverity.Info,
	style: monaco.MarkerSeverity.Hint,
};

type BashEditorProps = {
	value: string;
	onChange: (value: string) => void;
	height?: number;
	/** Reported after each lint: the issues, so the step can tell whether the script is fit to build. */
	onIssues?: (issues: LintIssue[]) => void;
	readOnly?: boolean;
	label: string;
};

/**
 * A bash script, highlighted, linted by shellcheck as you type (squiggles and
 * a list of what it found) and formatted with `shfmt -i 1` (one space per
 * level). Both tools run in the platform service.
 */
export const BashEditor: React.FC<BashEditorProps> = ({
	value,
	onChange,
	height = 260,
	onIssues,
	readOnly,
	label,
}) => {
	const theme = useTheme();
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const [issues, setIssues] = useState<LintIssue[]>([]);
	const [linting, setLinting] = useState(false);
	const [lintError, setLintError] = useState<string>();
	const [formatting, setFormatting] = useState(false);
	const [formatError, setFormatError] = useState<string>();
	// the latest callback, so a new one each render doesn't lint again
	const onIssuesRef = useRef(onIssues);
	onIssuesRef.current = onIssues;

	// shellcheck, a moment after typing stops
	useEffect(() => {
		if (!value.trim()) {
			setIssues([]);
			onIssuesRef.current?.([]);
			return;
		}
		const timer = window.setTimeout(async () => {
			setLinting(true);
			try {
				const out = await ImagesAPI.lint(value);
				setIssues(out.issues);
				setLintError(out.available ? out.error : "shellcheck is not available");
				onIssuesRef.current?.(out.issues);
			} catch (e) {
				setLintError(getErrorMessage(e, "Could not lint the script."));
			} finally {
				setLinting(false);
			}
		}, 600);
		return () => window.clearTimeout(timer);
	}, [value]);

	// the issues as markers in the editor
	useEffect(() => {
		const model = editorRef.current?.getModel();
		if (!model) {
			return;
		}
		monaco.editor.setModelMarkers(
			model,
			"shellcheck",
			issues.map((i) => ({
				startLineNumber: i.line,
				startColumn: i.column,
				endLineNumber: i.endLine,
				endColumn: Math.max(i.endColumn, i.column + 1),
				message: `${i.code}: ${i.message}`,
				severity: SEVERITY[i.level] ?? monaco.MarkerSeverity.Info,
				source: "shellcheck",
			})),
		);
	}, [issues]);

	const onMount: OnMount = (editor) => {
		editorRef.current = editor;
		monaco.editor.defineTheme("min", theme.monaco);
		monaco.editor.setTheme("min");
	};

	const format = async () => {
		setFormatting(true);
		setFormatError(undefined);
		try {
			const out = await ImagesAPI.format(value);
			if (out.script !== undefined) {
				onChange(out.script);
			} else {
				setFormatError(out.error ?? "shfmt is not available");
			}
		} catch (e) {
			setFormatError(getErrorMessage(e, "Could not format the script."));
		} finally {
			setFormatting(false);
		}
	};

	const counts = {
		error: issues.filter((i) => i.level === "error").length,
		warning: issues.filter((i) => i.level === "warning").length,
		other: issues.filter((i) => i.level === "info" || i.level === "style")
			.length,
	};

	return (
		<div
			className="flex flex-col overflow-hidden rounded-md border border-solid border-border"
			data-testid="bash-editor"
		>
			<div className="flex items-center gap-2 border-0 border-b border-solid border-border bg-surface-secondary px-2 py-1">
				<span className="text-xs font-medium text-content-secondary">
					{label}
				</span>
				<span className="flex-1" />
				<span
					className="flex items-center gap-2 text-xs"
					aria-live="polite"
					data-testid="lint-summary"
				>
					{linting ? (
						<Spinner loading size="sm" />
					) : lintError ? (
						<span className="text-content-secondary">{lintError}</span>
					) : issues.length === 0 ? (
						value.trim() && (
							<span className="flex items-center gap-1 text-content-success">
								<CircleCheckIcon className="size-3.5" /> shellcheck: clean
							</span>
						)
					) : (
						<>
							{counts.error > 0 && (
								<span className="flex items-center gap-1 text-content-destructive">
									<CircleAlertIcon className="size-3.5" />
									{counts.error}
								</span>
							)}
							{counts.warning > 0 && (
								<span className="flex items-center gap-1 text-content-warning">
									<TriangleAlertIcon className="size-3.5" />
									{counts.warning}
								</span>
							)}
							{counts.other > 0 && (
								<span className="flex items-center gap-1 text-content-secondary">
									<InfoIcon className="size-3.5" />
									{counts.other}
								</span>
							)}
						</>
					)}
				</span>
				{!readOnly && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => void format()}
						disabled={formatting || !value.trim()}
						title="shfmt -i 1"
					>
						<Spinner loading={formatting} />
						<AlignLeftIcon />
						Format
					</Button>
				)}
			</div>
			<Editor
				height={height}
				language="shell"
				value={value}
				theme="min"
				onMount={onMount}
				onChange={(v) => onChange(v ?? "")}
				options={{
					automaticLayout: true,
					fontFamily: MONOSPACE_FONT_FAMILY,
					fontSize: 13,
					tabSize: 1,
					insertSpaces: true,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					readOnly,
					renderWhitespace: "boundary",
					padding: { top: 8, bottom: 8 },
				}}
			/>
			{(issues.length > 0 || formatError) && (
				<ul
					className="m-0 max-h-36 list-none overflow-y-auto border-0 border-t border-solid border-border p-0 text-xs"
					data-testid="lint-issues"
				>
					{formatError && (
						<li className="px-3 py-1 text-content-destructive">
							Format: {formatError}
						</li>
					)}
					{issues.map((i) => (
						<li key={`${i.line}:${i.column}:${i.code}`}>
							<button
								type="button"
								onClick={() => {
									editorRef.current?.revealLineInCenter(i.line);
									editorRef.current?.setPosition({
										lineNumber: i.line,
										column: i.column,
									});
									editorRef.current?.focus();
								}}
								className={cn(
									"flex w-full cursor-pointer items-start gap-2 border-0 bg-transparent px-3 py-1 text-left text-inherit hover:bg-surface-secondary",
									i.level === "error" && "text-content-destructive",
								)}
							>
								<span className="shrink-0 tabular-nums text-content-secondary">
									{i.line}:{i.column}
								</span>
								<span className="shrink-0 font-mono">{i.code}</span>
								<span>{i.message}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
