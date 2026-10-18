import { CircleCheckIcon, CircleMinusIcon, Layers3Icon } from "lucide-react";
import { useQuery } from "react-query";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { Loader } from "#/components/Loader/Loader";
import { SyntaxHighlighter } from "#/components/SyntaxHighlighter/SyntaxHighlighter";

const FEATURE_TITLES: Record<string, string> = {
	certificates: "the owner's certificate",
	lockdown: "Lock Down",
	"cloud-drive": "the Cloud Drive",
	metrics: "the metrics",
	requires: "what they use",
};

type MaterializedTemplateProps =
	| { versionId: string; files?: undefined; height?: number }
	| { files: Record<string, string>; versionId?: undefined; height?: number };

/**
 * A template's main.tf as Coder provisions it: the template's own code with the platform's sections the template
 * decorator injects (the owner's certificate, Lock Down, the Cloud Drive, the metrics) - a version's, or the
 * editor's files as they are now. Read-only: the template's code stays its own logic only.
 */
export const MaterializedTemplate: React.FC<MaterializedTemplateProps> = ({
	versionId,
	files,
	height,
}) => {
	const query = useQuery({
		queryKey: ["templateBuilder", "materialized", versionId ?? files],
		queryFn: () =>
			API.materializeTemplate(
				versionId ? { template_version_id: versionId } : { files },
			),
	});
	if (query.error) {
		return (
			<p role="alert" className="m-0 p-4 text-sm text-content-destructive">
				{getErrorMessage(
					query.error,
					"The materialized template could not be made.",
				)}
			</p>
		);
	}
	const m = query.data;
	if (!m) {
		return <Loader />;
	}
	const lines = m.main_tf.split("\n").length;
	return (
		<div className="flex flex-col gap-3" data-testid="materialized-template">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
				<span className="flex items-center gap-1.5 font-medium">
					<Layers3Icon className="size-4" />
					{m.main_tf_name} as it is provisioned
				</span>
				{!m.enabled ? (
					<span className="text-content-secondary">
						No template decorator on this deployment: the code as it is.
					</span>
				) : (
					<>
						{m.injected.map((f) => (
							<span
								key={f}
								className="flex items-center gap-1 text-content-success"
								data-testid={`injected-${f}`}
							>
								<CircleCheckIcon className="size-3.5" />
								{FEATURE_TITLES[f] ?? f} injected
							</span>
						))}
						{m.skipped.map((s) => (
							<span
								key={s.feature}
								className="flex items-center gap-1 text-content-secondary"
								title={s.reason}
							>
								<CircleMinusIcon className="size-3.5" />
								{FEATURE_TITLES[s.feature] ?? s.feature}: {s.reason}
							</span>
						))}
					</>
				)}
			</div>
			{m.added.length > 0 && (
				<p className="m-0 text-xs text-content-secondary">
					With the platform's files: {m.added.join(", ")} (see Global files).
				</p>
			)}
			<div className="overflow-hidden rounded-lg border border-solid border-surface-quaternary">
				<SyntaxHighlighter
					language="hcl"
					value={m.main_tf}
					editorProps={{
						height: height ?? Math.min(lines * 18, 900),
						options: { readOnly: true, scrollBeyondLastLine: false },
					}}
				/>
			</div>
			{Object.entries(m.changed)
				.filter(([name]) => name !== m.main_tf_name)
				.map(([name, content]) => (
					<div
						key={name}
						className="overflow-hidden rounded-lg border border-solid border-surface-quaternary"
					>
						<header className="border-0 border-b border-solid border-surface-quaternary px-4 py-2 text-sm font-medium">
							{name}
						</header>
						<SyntaxHighlighter
							language="hcl"
							value={content}
							editorProps={{
								height: Math.min(content.split("\n").length * 18, 560),
								options: { readOnly: true, scrollBeyondLastLine: false },
							}}
						/>
					</div>
				))}
		</div>
	);
};
