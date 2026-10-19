import { Fragment } from "react";
import { Link as RouterLink } from "react-router";
import { useClipboard } from "#/hooks/useClipboard";
import { CheckGlyph, CopyGlyph } from "./settingsIcons";

/** A version ID shortened as the design shows it: its first and last 8 characters. */
const shortId = (id: string) =>
	id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;

/** The template version the settings belong to, with a copy button. */
const VersionChip: React.FC<{ id: string }> = ({ id }) => {
	const { copyToClipboard, showCopiedSuccess } = useClipboard();
	return (
		<div
			className="flex h-[38px] items-center gap-2 rounded-(--ws-r-md) border border-solid border-(--ws-line) bg-(--ws-chip) pl-3 pr-1.5"
			data-testid="version-chip"
		>
			<span className="text-xs text-(--ws-muted)">Version</span>
			<code className="ws-mono text-xs text-(--ws-text-2)" title={id}>
				{shortId(id)}
			</code>
			<button
				type="button"
				aria-label="Copy version ID"
				title={showCopiedSuccess ? "Copied" : "Copy version ID"}
				className="ws-hit flex size-7 cursor-pointer items-center justify-center rounded-(--ws-r-xs) border-0 bg-transparent text-(--ws-muted) hover:text-(--ws-text)"
				onClick={() => void copyToClipboard(id)}
			>
				{showCopiedSuccess ? <CheckGlyph /> : <CopyGlyph />}
			</button>
		</div>
	);
};

export type Crumb = { label: string; to: string };

/**
 * A settings page's header (a workspace's, a template's): its tile, the way back (crumbs; the last one the thing
 * whose settings these are), the title, and the version the settings belong to.
 */
export const SettingsPageHeader: React.FC<{
	icon: React.ReactNode;
	crumbs: readonly Crumb[];
	title: string;
	versionId?: string;
}> = ({ icon, crumbs, title, versionId }) => (
	<header className="border-0 border-b border-solid border-(--ws-header-line) bg-(--ws-header)">
		<div className="mx-auto flex max-w-(--ws-content) flex-wrap items-center justify-between gap-4 px-8 py-5">
			<div className="flex min-w-0 items-center gap-3.5">
				<div className="flex size-[46px] shrink-0 items-center justify-center rounded-(--ws-r-lg) border border-solid border-(--ws-well-line) bg-(--ws-raised) text-(--ws-soft)">
					{icon}
				</div>
				<div className="min-w-0">
					<nav
						aria-label="Breadcrumb"
						className="flex items-center gap-1.5 text-[13px] text-(--ws-muted)"
					>
						{crumbs.map((crumb, i) => (
							<Fragment key={crumb.to}>
								{i > 0 && <span aria-hidden="true">/</span>}
								<RouterLink
									to={crumb.to}
									className={
										i === crumbs.length - 1
											? "ws-quiet-link ws-hit min-w-0 text-(--ws-text-2)"
											: "ws-quiet-link ws-hit"
									}
								>
									<span className="block truncate">{crumb.label}</span>
								</RouterLink>
							</Fragment>
						))}
					</nav>
					<h1 className="m-0 mt-0.5 text-[22px] font-semibold leading-[1.5] tracking-[-0.01em]">
						{title}
					</h1>
				</div>
			</div>
			{versionId && (
				<div className="flex flex-wrap items-center gap-2.5">
					<VersionChip id={versionId} />
				</div>
			)}
		</div>
	</header>
);
