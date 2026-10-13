import type { ImageAddons as Addons } from "#/api/images";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { createDayString } from "#/utils/createDayString";

const GROUP_ORDER = ["Apps", "Kubernetes", "Tools", "Fonts"];

/**
 * What an image adds over its base, as the image itself records it
 * (addons.json, written when the workspace image is built): every program with
 * the version it reports, grouped; the apt packages someone asked for (their
 * dependencies counted); marimo's Python packages. So people know what they
 * take into their enclave before using it.
 */
export const ImageAddons: React.FC<{ addons: Addons }> = ({ addons }) => {
	const groups = [
		...new Set(addons.software.map((s) => s.group ?? "Other")),
	].sort(
		(a, b) =>
			(GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
	);
	const p = addons.packages;
	return (
		<div className="flex flex-col gap-4" data-testid="image-addons">
			<p className="m-0 text-sm text-content-secondary">
				{addons.software.length} programs over{" "}
				<code>{addons.base || "its base"}</code>
				{addons.builtAt && (
					<>, recorded when it was built ({createDayString(addons.builtAt)})</>
				)}
				. Every version is the installed program's own.
			</p>
			<div className="overflow-auto rounded-md border border-solid border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[24%]">Program</TableHead>
							<TableHead className="w-[18%]">Version</TableHead>
							<TableHead>What it is for</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{groups.flatMap((group) => [
							<TableRow key={`g-${group}`} className="bg-surface-secondary">
								<TableCell
									colSpan={3}
									className="py-1.5 text-xs font-semibold uppercase tracking-wide text-content-secondary"
								>
									{group}
								</TableCell>
							</TableRow>,
							...addons.software
								.filter((s) => (s.group ?? "Other") === group)
								.map((s) => (
									<TableRow key={`${group}-${s.name}`} data-testid="addon">
										<TableCell className="font-medium">{s.name}</TableCell>
										<TableCell className="font-mono text-xs">
											{s.version ?? "–"}
										</TableCell>
										<TableCell className="text-sm text-content-secondary">
											{s.what}
										</TableCell>
									</TableRow>
								)),
						])}
					</TableBody>
				</Table>
			</div>
			<details className="rounded-md border border-solid border-border px-3 py-2">
				<summary className="cursor-pointer text-sm font-medium">
					{p.added.length} apt packages added
					<span className="font-normal text-content-secondary">
						{" "}
						(and {p.dependencies} they depend on; {p.upgraded} of the base's
						upgraded; {p.installed} installed in all)
					</span>
				</summary>
				<ul className="m-0 mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-4 overflow-auto p-0 font-mono text-xs text-content-secondary">
					{p.added.map((pkg) => (
						<li
							key={pkg.name}
							className="list-none truncate"
							title={pkg.version}
						>
							{pkg.name} <span className="opacity-70">{pkg.version}</span>
						</li>
					))}
				</ul>
			</details>
			{addons.python.packages.length > 0 && (
				<details className="rounded-md border border-solid border-border px-3 py-2">
					<summary className="cursor-pointer text-sm font-medium">
						{addons.python.packages.length} Python packages
						<span className="font-normal text-content-secondary">
							{" "}
							(marimo's environment
							{addons.python.environment && (
								<>
									, <code>{addons.python.environment}</code>
								</>
							)}
							)
						</span>
					</summary>
					<ul className="m-0 mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-4 overflow-auto p-0 font-mono text-xs text-content-secondary">
						{addons.python.packages.map((pkg) => (
							<li key={pkg.name} className="list-none truncate">
								{pkg.name} <span className="opacity-70">{pkg.version}</span>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
};
