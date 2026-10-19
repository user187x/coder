import { ChevronRightIcon, GitForkIcon } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import {
	type ImageContents,
	type ImageContentsCatalog,
	ImagesAPI,
} from "#/api/images";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import { SearchField } from "#/components/SearchField/SearchField";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import { createDayString } from "#/utils/createDayString";
import { formatSize } from "./badges";

export const contentsKey = ["platform", "images", "contents"] as const;

/** The Coder fork's images: we build them, so what they hold is known precisely. */
const OURS = "ghcr.io/user187x/";

/** What each image of ours holds (recorded when they were built: it does not change while the page is open). */
export const useImageContents = () =>
	useQuery({
		queryKey: contentsKey,
		queryFn: ImagesAPI.contents,
		staleTime: Number.POSITIVE_INFINITY,
	});

export type OurImage = {
	contents: ImageContents;
	/** The very image described; else another version of it (the one the platform pins is described). */
	exact: boolean;
};

/** The image of ours a reference names, if it is one. */
export const ourImage = (
	catalog: ImageContentsCatalog | undefined,
	ref: string | null | undefined,
): OurImage | undefined => {
	if (!catalog || !ref) {
		return undefined;
	}
	const name = ref.replace(/^docker\.io\//, "");
	const exact = catalog.images[name];
	if (exact) {
		return { contents: exact, exact: true };
	}
	if (!name.startsWith(OURS)) {
		return undefined;
	}
	const repository = name.slice(OURS.length).split(/[:@]/)[0];
	const other = Object.values(catalog.images).find(
		(i) => i.repository === repository,
	);
	return other ? { contents: other, exact: false } : undefined;
};

/** Where an image's contents open in Coder fork images (from the other tables' badges). */
export const contentsAnchor = (repository: string) => `contents-${repository}`;

/** An image the Coder fork builds. */
export const CoderForkBadge: React.FC<{ ours: OurImage; link?: boolean }> = ({
	ours,
	link,
}) => {
	const title = `Built by the Coder fork (${ours.contents.source.build || ours.contents.repository}): what it holds is known precisely${
		ours.exact
			? ""
			: ` - described as ${tag(ours.contents.ref)}, the version the platform pins`
	}`;
	const badge = (
		<Badge variant="purple" size="sm" title={title} data-testid="coder-fork">
			<GitForkIcon />
			Coder fork
		</Badge>
	);
	return link ? (
		<a
			href={`#${contentsAnchor(ours.contents.repository)}`}
			onClick={(e) => e.stopPropagation()}
			className="no-underline"
			aria-label={`${ours.contents.repository}: what it holds`}
		>
			{badge}
		</a>
	) : (
		badge
	);
};

const tag = (ref: string) => ref.split("/").pop() ?? ref;

type Leaf = {
	key: string;
	name: string;
	value?: string;
	/** A longer text under it (a build step's command). */
	detail?: string;
};

type Node = {
	id: string;
	label: string;
	/** How many it holds in all (shown "matches of all" while filtering). */
	count?: number;
	children?: Node[];
	leaves?: Leaf[];
	/** Many short leaves (packages): in columns. */
	columns?: boolean;
	open?: boolean;
};

const shown = (s: string[] | null | undefined) =>
	s?.length ? s.join(" ") : "–";

const pairs = (items: [string, string][], prefix: string): Leaf[] =>
	items.map(([name, version]) => ({
		key: `${prefix}-${name}`,
		name,
		value: version,
	}));

/** Its add-ons and packages with every part there (an image's addons.json may have no Python part, an image no package manager). */
const parts = (c: ImageContents) => ({
	addons: c.addons
		? {
				software: c.addons.software ?? [],
				added: c.addons.packages?.added ?? [],
				dependencies: c.addons.packages?.dependencies ?? 0,
				pythonEnvironment: c.addons.python?.environment ?? null,
				python: c.addons.python?.packages ?? [],
			}
		: null,
	os: c.packages?.os ?? null,
	python: c.packages?.python ?? [],
});

/** An image's contents as a tree: overview, configuration, programs, add-ons, packages, environments, steps. */
export const contentsTree = (c: ImageContents): Node[] => {
	const { addons: a, os, python } = parts(c);
	const nodes: Node[] = [
		{
			id: "overview",
			label: "Overview",
			open: true,
			leaves: [
				{ key: "ref", name: "Reference", value: c.ref },
				{ key: "digest", name: "Pinned (images.txt)", value: c.digest },
				...(c.imageId !== c.digest
					? [{ key: "id", name: "Image ID", value: c.imageId }]
					: []),
				{ key: "platform", name: "Platform", value: c.platform },
				{ key: "size", name: "Size", value: formatSize(c.size) },
				{ key: "layers", name: "Layers", value: String(c.layers) },
				...(c.created
					? [
							{
								key: "created",
								name: "Built",
								value: `${new Date(c.created).toLocaleString()} (${createDayString(c.created)})`,
							},
						]
					: []),
				{ key: "section", name: "Bundle section", value: c.section },
				{ key: "folder", name: "Made in", value: c.source.folder || "–" },
				{ key: "build", name: "Built with", value: c.source.build || "–" },
			],
		},
		{
			id: "config",
			label: "Configuration",
			children: [
				{
					id: "config-run",
					label: "How it runs",
					open: true,
					leaves: [
						{ key: "user", name: "User", value: c.config.user },
						{
							key: "entrypoint",
							name: "Entrypoint",
							value: shown(c.config.entrypoint),
						},
						{ key: "cmd", name: "Command", value: shown(c.config.cmd) },
						{
							key: "workdir",
							name: "Working directory",
							value: c.config.workdir,
						},
						{
							key: "ports",
							name: "Ports",
							value: c.config.ports.join(", ") || "none",
						},
					],
				},
				{
					id: "config-env",
					label: "Environment",
					count: c.config.env.length,
					leaves: c.config.env.map((e) => {
						const at = e.indexOf("=");
						return {
							key: `env-${e}`,
							name: at < 0 ? e : e.slice(0, at),
							value: at < 0 ? "" : e.slice(at + 1),
						};
					}),
				},
				{
					id: "config-labels",
					label: "Labels",
					count: Object.keys(c.config.labels).length,
					leaves: Object.entries(c.config.labels)
						.sort()
						.map(([name, value]) => ({ key: `label-${name}`, name, value })),
				},
			],
		},
	];
	if (c.programs.length) {
		nodes.push({
			id: "programs",
			label: "Programs",
			count: c.programs.length,
			open: true,
			leaves: c.programs.map((p) => ({
				key: `program-${p.name}`,
				name: p.name,
				value: p.version ?? "–",
				detail: p.what,
			})),
		});
	}
	if (a) {
		const groups = [...new Set(a.software.map((s) => s.group ?? "Other"))];
		nodes.push({
			id: "addons",
			label: "Add-ons",
			count: a.software.length,
			open: true,
			children: [
				...groups.map((group) => ({
					id: `addons-${group}`,
					label: group,
					count: a.software.filter((s) => (s.group ?? "Other") === group)
						.length,
					leaves: a.software
						.filter((s) => (s.group ?? "Other") === group)
						.map((s) => ({
							key: `addon-${s.name}`,
							name: s.name,
							value: s.version ?? "–",
							detail: s.what ?? undefined,
						})),
				})),
				{
					id: "addons-apt",
					label: `apt packages asked for (and ${a.dependencies} they depend on)`,
					count: a.added.length,
					columns: true,
					leaves: a.added.map((p) => ({
						key: `apt-${p.name}`,
						name: p.name,
						value: p.version,
					})),
				},
				...(a.python.length
					? [
							{
								id: "addons-python",
								label: `Python packages${a.pythonEnvironment ? ` (${a.pythonEnvironment})` : ""}`,
								count: a.python.length,
								columns: true,
								leaves: a.python.map((p) => ({
									key: `addon-py-${p.name}`,
									name: p.name,
									value: p.version,
								})),
							},
						]
					: []),
			],
		});
	}
	if (os) {
		nodes.push({
			id: "os",
			label: `OS packages (${os.manager})`,
			count: os.count,
			columns: true,
			leaves: pairs(os.items, "os"),
		});
	}
	if (python.length) {
		nodes.push({
			id: "python",
			label: "Python environments",
			count: python.reduce((n, e) => n + e.count, 0),
			children: python.map((e) => ({
				id: `python-${e.env}`,
				label: e.env,
				count: e.count,
				columns: true,
				leaves: pairs(e.items, `py-${e.env}`),
			})),
		});
	}
	nodes.push({
		id: "steps",
		label: "Build steps",
		count: c.steps.length,
		leaves: c.steps.map((s, i) => ({
			key: `step-${i}`,
			name: `${i + 1}`,
			value: s.size,
			detail: s.step || s.comment || "–",
		})),
	});
	return nodes;
};

const matches = (leaf: Leaf, q: string) =>
	leaf.name.toLowerCase().includes(q) ||
	Boolean(leaf.value?.toLowerCase().includes(q)) ||
	Boolean(leaf.detail?.toLowerCase().includes(q));

/** Only what matches (and the branches it is in, open); null when nothing does. */
const filtered = (node: Node, q: string): (Node & { found: number }) | null => {
	if (node.label.toLowerCase().includes(q)) {
		return { ...node, found: node.count ?? node.leaves?.length ?? 0 };
	}
	const leaves = node.leaves?.filter((l) => matches(l, q));
	const children = node.children
		?.map((c) => filtered(c, q))
		.filter((c): c is Node & { found: number } => c !== null);
	const found =
		(leaves?.length ?? 0) + (children?.reduce((n, c) => n + c.found, 0) ?? 0);
	return found ? { ...node, leaves, children, open: true, found } : null;
};

const TreeNode: React.FC<{
	node: Node & { found?: number };
	filtering: boolean;
}> = ({ node, filtering }) => {
	// opened or closed by hand; else as it comes (a filter's matches open)
	const [open, setOpen] = useState<boolean | null>(null);
	const expanded = open ?? Boolean(node.open);
	const count =
		node.count === undefined
			? ""
			: filtering && node.found !== undefined && node.found !== node.count
				? `${node.found} of ${node.count}`
				: String(node.count);
	return (
		<li className="list-none" data-testid={`contents-${node.id}`}>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setOpen(!expanded)}
				className="flex w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1 py-1 text-left text-sm font-medium text-content-primary hover:bg-surface-secondary"
			>
				<ChevronRightIcon
					aria-hidden
					className={`size-4 shrink-0 text-content-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
				/>
				{node.label}
				{count && (
					<span className="text-xs font-normal tabular-nums text-content-secondary">
						{count}
					</span>
				)}
			</button>
			{expanded && (
				<ul className="m-0 ml-3 border-0 border-l border-solid border-border p-0 pl-3">
					{node.children?.map((c) => (
						<TreeNode key={c.id} node={c} filtering={filtering} />
					))}
					{node.leaves && node.leaves.length > 0 && (
						<li className="list-none py-1">
							{node.columns ? (
								<ul className="m-0 grid max-h-80 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-4 overflow-auto p-0 font-mono text-xs">
									{node.leaves.map((l) => (
										<li
											key={l.key}
											className="list-none truncate"
											title={`${l.name} ${l.value ?? ""}`}
										>
											{l.name}{" "}
											<span className="text-content-secondary">{l.value}</span>
										</li>
									))}
								</ul>
							) : (
								<dl className="m-0 grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-4 gap-y-1 text-sm">
									{node.leaves.map((l) => (
										<Fragment key={l.key}>
											<dt className="font-medium text-content-secondary">
												{l.name}
											</dt>
											<dd className="m-0 min-w-0">
												<span className="break-all font-mono text-xs">
													{l.value}
												</span>
												{l.detail && (
													<span
														className={`block text-xs text-content-secondary ${node.id === "steps" ? "whitespace-pre-wrap break-all font-mono" : ""}`}
													>
														{l.detail}
													</span>
												)}
											</dd>
										</Fragment>
									))}
								</dl>
							)}
						</li>
					)}
				</ul>
			)}
		</li>
	);
};

/** What an image of ours holds, as a tree, with a filter over everything in it (a package, a variable, a step). */
export const ImageContentsTree: React.FC<{
	ours: OurImage;
	asked?: string;
}> = ({ ours, asked }) => {
	const [find, setFind] = useState("");
	const tree = useMemo(() => contentsTree(ours.contents), [ours.contents]);
	const q = find.trim().toLowerCase();
	const nodes: Node[] = q
		? tree
				.map((n) => filtered(n, q))
				.filter((n): n is Node & { found: number } => n !== null)
		: tree;
	return (
		<div className="flex flex-col gap-3" data-testid="image-contents">
			{!ours.exact && asked && (
				<p className="m-0 text-xs text-content-secondary">
					Described as <code>{tag(ours.contents.ref)}</code>, the version the
					platform pins: this one is <code>{tag(asked)}</code>.
				</p>
			)}
			<SearchField
				value={find}
				onChange={setFind}
				placeholder="Find a program, package, variable or step…"
				aria-label="Find in what it holds"
				className="max-w-md"
			/>
			{nodes.length ? (
				<ul
					// a node opened or closed by hand is as it comes again when the filter starts or ends
					key={q ? "filtering" : "all"}
					aria-label={`What ${tag(ours.contents.ref)} holds`}
					className="m-0 p-0"
				>
					{nodes.map((n) => (
						<TreeNode key={n.id} node={n} filtering={Boolean(q)} />
					))}
				</ul>
			) : (
				<p className="m-0 text-sm text-content-secondary">Nothing matches.</p>
			)}
		</div>
	);
};

/** The toggle that opens an image's contents under its row. */
export const ContentsToggle: React.FC<{
	open: boolean;
	onToggle: () => void;
	name: string;
}> = ({ open, onToggle, name }) => (
	<Button
		variant="subtle"
		size="icon"
		className="size-6"
		aria-expanded={open}
		aria-label={`${open ? "Hide" : "Show"} what ${name} holds`}
		title={open ? "Hide what it holds" : "What it holds, in detail"}
		onClick={(e) => {
			e.stopPropagation();
			onToggle();
		}}
		data-testid="contents-toggle"
	>
		<ChevronRightIcon
			className={`transition-transform ${open ? "rotate-90" : ""}`}
		/>
	</Button>
);

const summary = (c: ImageContents) => {
	const { addons, os, python } = parts(c);
	return [
		c.programs.length &&
			`${c.programs.length} program${c.programs.length === 1 ? "" : "s"}`,
		addons?.software.length && `${addons.software.length} add-ons`,
		os && `${os.count} OS packages`,
		python.length &&
			`${python.reduce((n, e) => n + e.count, 0)} Python packages`,
	]
		.filter(Boolean)
		.join(" · ");
};

/**
 * Coder fork images: every image the fork builds (images.txt's ghcr.io/user187x/), each with what it holds, read
 * from the image as built - every program with its own version, every OS and Python package, its configuration and
 * every build step. A "Coder fork" tag elsewhere in the view opens its entry here.
 */
export const CoderForkImages: React.FC = () => {
	const query = useImageContents();
	const location = useLocation();
	const [open, setOpen] = useState<string | null>(null);
	const images = Object.values(query.data?.images ?? {}).sort((a, b) =>
		a.section === b.section
			? a.repository.localeCompare(b.repository)
			: a.section.localeCompare(b.section),
	);
	// #contents-<repository> (a Coder fork tag in In use or On the nodes): that image, open and in view
	const asked = location.hash.startsWith("#contents-")
		? location.hash.slice("#contents-".length)
		: null;
	const known = images.some((i) => i.repository === asked);
	useEffect(() => {
		if (asked && known) {
			setOpen(asked);
			document.getElementById(contentsAnchor(asked))?.scrollIntoView();
		}
	}, [asked, known]);
	if (!images.length) {
		return null;
	}
	return (
		<section className="mt-10" aria-labelledby="coder-fork-images">
			<h2
				id="coder-fork-images"
				className="m-0 flex items-center gap-2 text-lg font-semibold"
			>
				Coder fork images
			</h2>
			<p className="mt-1 mb-3 text-sm text-content-secondary">
				The images the Coder fork builds ({images.length}), with what each holds
				as built: every program and the version it reports, every OS and Python
				package, its configuration and every build step.
			</p>
			<Table data-testid="coder-fork-images">
				<TableHeader>
					<TableRow>
						<TableHead className="w-[40%]">Image</TableHead>
						<TableHead className="w-[30%]">Contents</TableHead>
						<TableHead className="w-[10%]">Size</TableHead>
						<TableHead className="w-[20%]">Built</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{images.map((c) => (
						<ForkImageRow
							key={c.ref}
							contents={c}
							open={open === c.repository}
							onToggle={() =>
								setOpen(open === c.repository ? null : c.repository)
							}
						/>
					))}
				</TableBody>
			</Table>
		</section>
	);
};

const ForkImageRow: React.FC<{
	contents: ImageContents;
	open: boolean;
	onToggle: () => void;
}> = ({ contents: c, open, onToggle }) => {
	const clickable = useClickableTableRow({ onClick: onToggle });
	const ours = { contents: c, exact: true };
	return (
		<>
			<TableRow
				{...clickable}
				id={contentsAnchor(c.repository)}
				aria-expanded={open}
				data-testid={`coder-fork-${c.repository}`}
			>
				<TableCell>
					<div className="flex items-start gap-2">
						<ContentsToggle open={open} onToggle={onToggle} name={tag(c.ref)} />
						<div className="flex min-w-0 flex-col gap-0.5">
							<span className="flex flex-wrap items-center gap-2 font-semibold">
								{c.repository}
								<CoderForkBadge ours={ours} />
							</span>
							<span className="line-clamp-2 text-sm text-content-secondary">
								{c.description}
							</span>
							<span className="flex items-center gap-1 break-all font-mono text-xs text-content-secondary">
								{c.ref}
								<CopyButton
									text={c.ref}
									label="Copy the image reference"
									variant="subtle"
									size="icon"
									className="size-6"
									onClick={(e) => e.stopPropagation()}
								/>
							</span>
						</div>
					</div>
				</TableCell>
				<TableCell className="text-sm text-content-secondary">
					{summary(c) || "–"}
				</TableCell>
				<TableCell className="text-sm tabular-nums">
					{formatSize(c.size)}
				</TableCell>
				<TableCell className="text-sm text-content-secondary">
					{c.created ? createDayString(c.created) : "–"}
					<div className="text-xs">{c.section}</div>
				</TableCell>
			</TableRow>
			{open && (
				<TableRow className="hover:bg-transparent">
					<TableCell colSpan={4} className="bg-surface-secondary/40">
						<ImageContentsTree ours={ours} />
					</TableCell>
				</TableRow>
			)}
		</>
	);
};
