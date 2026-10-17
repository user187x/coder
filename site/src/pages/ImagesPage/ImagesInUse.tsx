import { useQuery } from "react-query";
import { Link as RouterLink } from "react-router";
import { ImagesAPI } from "#/api/images";
import { Button } from "#/components/Button/Button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { nameFrom } from "./ImportImageDialog";

export const inUseKey = ["platform", "images", "in-use"] as const;

/**
 * In use: every image workspaces run now, and the ones the templates run,
 * with which workspaces and templates. One that is here (built, imported, or
 * the template's own) links to its page; editors can import the others, so
 * they are scanned and listed too.
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
				The images workspaces run now, and the ones the templates run.
			</p>
			<Table data-testid="images-in-use">
				<TableHeader>
					<TableRow>
						<TableHead className="w-[46%]">Image</TableHead>
						<TableHead className="w-[22%]">Workspaces</TableHead>
						<TableHead className="w-[20%]">Templates</TableHead>
						<TableHead className="w-[12%]" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{images.map((i) => (
						<TableRow key={i.image}>
							<TableCell className="break-all font-mono text-xs">
								{i.image}
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
							<TableCell className="text-right">
								{i.entry ? (
									<Button asChild variant="outline" size="sm">
										<RouterLink to={`/images/${i.entry}`}>Open</RouterLink>
									</Button>
								) : (
									canEdit && (
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												onImport({ name: nameFrom(i.image), ref: i.image })
											}
										>
											Import
										</Button>
									)
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
};
