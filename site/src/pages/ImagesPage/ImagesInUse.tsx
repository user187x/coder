import { ScanSearchIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "react-query";
import { Link as RouterLink, useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { ImagesAPI } from "#/api/images";
import { nodeImages } from "#/api/queries/nodeImageCleanup";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import { formatSize } from "./badges";
import { CoderForkBadge, ourImage, useImageContents } from "./CoderForkImages";
import { nameFrom } from "./ImportImageDialog";
import { NodeImageCleanup } from "./NodeImageCleanup";

export const inUseKey = ["platform", "images", "in-use"] as const;

/**
 * Scan, for an image that has no entry here: scanned as it is (from the
 * cluster's registry, else from a node that holds it: no registry needed),
 * listed as a read-only entry with its report; opens its scan.
 */
const ScanButton: React.FC<{ image: string }> = ({ image }) => {
	const navigate = useNavigate();
	const scan = useMutation({
		mutationFn: () => ImagesAPI.scan(image),
		onSuccess: ({ id, build }) => navigate(`/images/${id}/builds/${build}`),
		onError: (e) =>
			toast.error(getErrorMessage(e, `${image} could not be scanned.`)),
	});
	return (
		<Button
			variant="outline"
			size="sm"
			onClick={() => scan.mutate()}
			disabled={scan.isPending}
			title="Scan it as it is: from the cluster's registry, else from a node that holds it"
		>
			<Spinner loading={scan.isPending}>
				<ScanSearchIcon />
			</Spinner>
			Scan
		</Button>
	);
};

/**
 * In use: every image workspaces run now, and the ones the templates run,
 * with which workspaces and templates. One that is here (built, imported,
 * scanned, or the template's own) links to its page; editors can scan the
 * others as they are, or import them to build on them.
 */
export const ImagesInUse: React.FC<{
	canEdit: boolean;
	onImport: (initial: { name: string; ref: string }) => void;
}> = ({ canEdit, onImport }) => {
	const query = useQuery({
		queryKey: inUseKey,
		queryFn: ImagesAPI.inUse,
		refetchInterval: 30_000,
	});
	const catalog = useImageContents().data;
	const images = query.data?.images ?? [];
	if (!images.length) {
		return null;
	}
	return (
		<section className="mt-10" aria-labelledby="images-in-use">
			<h2 id="images-in-use" className="m-0 text-lg font-semibold">
				In use
			</h2>
			<p className="mt-1 mb-3 text-sm text-content-secondary">
				The images workspaces run now, and the ones the templates run. Any of
				them can be scanned, wherever it comes from.
			</p>
			<TableCard
				summary={`${images.length} ${images.length === 1 ? "image" : "images"} in use`}
				hint="Point at anything in the table to read what it does"
			>
				<Table data-testid="images-in-use">
					<TableHeader>
						<TableRow>
							<TableHead className="w-[42%]">Image</TableHead>
							<TableHead className="w-[20%]">Workspaces</TableHead>
							<TableHead className="w-[18%]">Templates</TableHead>
							<TableHead className="w-[20%]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{images.map((i) => (
							<TableRow key={i.image}>
								<TableCell className="break-all font-mono text-xs">
									{i.image}
									<OursTag catalog={catalog} image={i.image} />
								</TableCell>
								<TableCell className="text-sm text-content-secondary">
									{i.workspaces.length ? (
										<span title={i.workspaces.join(", ")}>
											{i.workspaces.length}{" "}
											{i.workspaces.length === 1 ? "workspace" : "workspaces"}
										</span>
									) : (
										"none running"
									)}
								</TableCell>
								<TableCell className="text-sm text-content-secondary">
									{i.templates.join(", ") || "–"}
								</TableCell>
								<TableCell>
									<div className="flex justify-end gap-2">
										{i.entry ? (
											<Button asChild variant="outline" size="sm">
												<RouterLink to={`/images/${i.entry}`}>Open</RouterLink>
											</Button>
										) : (
											canEdit && (
												<>
													<ScanButton image={i.image} />
													<Button
														variant="outline"
														size="sm"
														onClick={() =>
															onImport({
																name: nameFrom(i.image),
																ref: i.image,
															})
														}
													>
														Import
													</Button>
												</>
											)
										)}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableCard>
		</section>
	);
};

/** One of the Coder fork's images: its tag, which opens what it holds (Coder fork images). */
const OursTag: React.FC<{
	catalog: ReturnType<typeof useImageContents>["data"];
	image: string;
}> = ({ catalog, image }) => {
	const ours = ourImage(catalog, image);
	return ours ? (
		<span className="ml-2 inline-flex align-middle font-sans">
			<CoderForkBadge ours={ours} link />
		</span>
	) : null;
};

const NODE_IMAGES_SHOWN = 8;

/**
 * On the nodes: every image the cluster's nodes hold, preloaded (an
 * air-gapped bundle's images) or pulled, with their size and nodes. Each can
 * be scanned from the node that holds it, with no registry: in an air-gapped
 * cluster the images in use are reported on too.
 */
export const ImagesOnNodes: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
	const [all, setAll] = useState(false);
	const query = useQuery(nodeImages());
	const [selected, setSelected] = useState<string[]>([]);
	const catalog = useImageContents().data;
	const images = query.data?.images ?? [];
	if (!images.length) {
		return null;
	}
	const shown = all ? images : images.slice(0, NODE_IMAGES_SHOWN);
	const eligible = images.filter((image) => image.purgeBlocked === "");
	const chosen = selected.filter((ref) =>
		eligible.some((image) => image.image === ref),
	);
	return (
		<section className="mt-10" aria-labelledby="images-on-nodes">
			<h2 id="images-on-nodes" className="m-0 text-lg font-semibold">
				On the nodes
			</h2>
			<p className="mt-1 mb-3 text-sm text-content-secondary">
				Every image the cluster's nodes hold, preloaded or pulled (
				{images.length}). A scan reads it from a node that holds it: no registry
				needed.
			</p>
			{canEdit && (
				<div className="mb-3 flex flex-wrap items-center gap-2">
					<Button
						variant="subtle"
						size="sm"
						onClick={() =>
							setSelected(eligible.slice(0, 100).map((image) => image.image))
						}
					>
						Select unused (up to 100)
					</Button>
					<Button variant="subtle" size="sm" onClick={() => setSelected([])}>
						Clear selection
					</Button>
					<NodeImageCleanup
						images={chosen}
						label={`Review cleanup (${chosen.length})`}
					/>
				</div>
			)}
			<TableCard
				summary={`Showing ${shown.length} of ${images.length} ${images.length === 1 ? "image" : "images"} on the nodes`}
				hint="Point at anything in the table to read what it does"
			>
				<Table
					data-testid="images-on-nodes"
					aria-label="Images cached on nodes"
				>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[52%]">Image</TableHead>
							<TableHead className="w-[12%]">Size</TableHead>
							<TableHead className="w-[18%]">Nodes</TableHead>
							<TableHead className="w-[18%]" />
						</TableRow>
					</TableHeader>
					<TableBody>
						{shown.map((i) => (
							<TableRow key={i.image} data-testid="image-on-node">
								<TableCell className="break-all font-mono text-xs">
									{canEdit && (
										<Checkbox
											aria-label={`Select ${i.image} for cleanup`}
											checked={chosen.includes(i.image)}
											disabled={i.purgeBlocked !== ""}
											title={i.purgeBlocked || undefined}
											className="mr-2"
											onCheckedChange={(checked) =>
												setSelected((previous) =>
													checked
														? [...previous, i.image]
														: previous.filter((ref) => ref !== i.image),
												)
											}
										/>
									)}
									<span title={i.names.join("\n") || undefined}>{i.image}</span>
									<OursTag catalog={catalog} image={i.image} />
									{i.running && (
										<Badge size="xs" className="ml-2 align-middle">
											running
										</Badge>
									)}
								</TableCell>
								<TableCell className="text-sm tabular-nums text-content-secondary">
									{formatSize(i.sizeBytes)}
								</TableCell>
								<TableCell className="text-sm text-content-secondary">
									<span title={i.nodes.join(", ")}>
										{i.nodes.length === 1
											? i.nodes[0]
											: `${i.nodes.length} nodes`}
									</span>
								</TableCell>
								<TableCell>
									<div className="flex justify-end gap-2">
										{i.entry ? (
											<Button asChild variant="outline" size="sm">
												<RouterLink to={`/images/${i.entry}`}>Open</RouterLink>
											</Button>
										) : (
											canEdit && <ScanButton image={i.image} />
										)}
										{canEdit && i.purgeBlocked === "" && (
											<NodeImageCleanup images={[i.image]} label="Purge" />
										)}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableCard>
			{images.length > NODE_IMAGES_SHOWN && (
				<Button
					variant="subtle"
					size="sm"
					className="mt-2"
					onClick={() => setAll(!all)}
				>
					{all ? "Show fewer" : `Show all ${images.length}`}
				</Button>
			)}
		</section>
	);
};
