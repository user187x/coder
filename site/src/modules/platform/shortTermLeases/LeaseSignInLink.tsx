import { cn } from "cn";
import { LinkIcon } from "lucide-react";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import { Link } from "#/components/Link/Link";

export const LeaseSignInLink = ({
	className,
	iconOnly = false,
}: {
	className?: string;
	iconOnly?: boolean;
}) => {
	const url = new URL("/lease", window.location.origin).href;
	return (
		<div
			className={cn(
				"flex min-w-0 items-center gap-2 rounded-lg border border-solid border-border bg-surface-secondary px-3 py-2 text-xs",
				className,
			)}
		>
			{!iconOnly && (
				<>
					<LinkIcon aria-hidden className="size-4 shrink-0" />
					<span className="shrink-0">Lease sign-in</span>
				</>
			)}
			<Link
				href={url}
				aria-label={iconOnly ? "Open lease sign-in" : undefined}
				showExternalIcon={!iconOnly}
				target="_blank"
				rel="noreferrer"
				className="min-w-0 truncate"
			>
				{iconOnly ? <LinkIcon aria-hidden /> : url}
			</Link>
			<CopyButton text={url} label="Copy lease sign-in URL" />
		</div>
	);
};
