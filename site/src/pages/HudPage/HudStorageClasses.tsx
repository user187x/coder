import type { HudStorage } from "#/api/platform";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";

const gib = (value: number | null) =>
	value === null
		? "Unavailable"
		: `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB`;

export const HudStorageClasses = ({ storage }: { storage: HudStorage }) => (
	<section className="rounded-lg border border-solid border-border p-4">
		<h2 className="m-0 text-base font-medium">Storage classes</h2>
		<p className="text-xs text-content-secondary">
			Physical totals cover ready nodes' root filesystems. PVC requests and
			persistent volume capacity can use remote or thin-provisioned storage.
			Usage covers measured claims only; unmounted claims may have no reading.
		</p>
		{!storage.inventoryAvailable ? (
			<p role="status">Storage inventory is unavailable.</p>
		) : storage.classes.length === 0 ? (
			<p>No persistent volumes or claims.</p>
		) : (
			<Table aria-label="Storage class totals">
				<TableHeader>
					<TableRow>
						{[
							"Storage class",
							"Volumes",
							"Claims",
							"Capacity",
							"Claimed",
							"Measured usage",
						].map((label) => (
							<TableHead key={label}>{label}</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{storage.classes.map((group) => (
						<TableRow key={group.name}>
							<TableCell>{group.name}</TableCell>
							<TableCell>{group.volumes}</TableCell>
							<TableCell>{group.claims}</TableCell>
							<TableCell>{gib(group.capacity)}</TableCell>
							<TableCell>{gib(group.claimed)}</TableCell>
							<TableCell>
								{gib(group.used)} ({group.measuredClaims}/{group.claims} claims)
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		)}
	</section>
);
