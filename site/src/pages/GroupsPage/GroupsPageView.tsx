import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link as RouterLink, useNavigate } from "react-router";
import {
	GROUP_MEMBER_AVATAR_LIMIT,
	groupMemberAvatars,
} from "#/api/queries/groups";
import type { PaginatedGroup } from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { AvatarDataSkeleton } from "#/components/Avatar/AvatarDataSkeleton";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { EmptyState } from "#/components/EmptyState/EmptyState";
import { FeatureUnavailable } from "#/components/FeatureUnavailable/FeatureUnavailable";
import type { useFilter } from "#/components/Filter/Filter";
import { GroupsFilter } from "#/components/Filter/GroupsFilter";
import { PaginationContainer } from "#/components/PaginationWidget/PaginationContainer";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import {
	TableLoaderSkeleton,
	TableRowSkeleton,
} from "#/components/TableLoader/TableLoader";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import type { PaginationResultInfo } from "#/hooks/usePaginatedQuery";

const EM_DASH = "\u2014";

// Stable keys for the avatar loading skeletons (indexes would trip lint).
const AVATAR_SKELETON_KEYS = ["a", "b", "c", "d", "e"];

type GroupsPageViewProps = {
	groups: readonly PaginatedGroup[] | undefined;
	canCreateGroup: boolean;
	groupsEnabled: boolean;
	showOrganizations: boolean;
	filterProps: { filter: ReturnType<typeof useFilter> };
	groupsQuery: PaginationResultInfo & {
		isPlaceholderData: boolean;
	};
};

export const GroupsPageView: React.FC<GroupsPageViewProps> = ({
	groups,
	canCreateGroup,
	groupsEnabled,
	showOrganizations,
	filterProps,
	groupsQuery,
}) => {
	return (
		<>
			<SettingsHeader
				actions={
					groupsEnabled &&
					canCreateGroup && (
						<Button asChild>
							<RouterLink to="create">
								<PlusIcon />
								New group
							</RouterLink>
						</Button>
					)
				}
			>
				<SettingsHeaderTitle>Groups</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Manage groups for this{" "}
					{showOrganizations ? "organization" : "deployment"}.{" "}
				</SettingsHeaderDescription>
			</SettingsHeader>

			{!groupsEnabled ? (
				<FeatureUnavailable feature="Groups" />
			) : (
				<div className="flex flex-col gap-4">
					<GroupsFilter {...filterProps} />

					<PaginationContainer query={groupsQuery} paginationUnitLabel="groups">
						<Table aria-label="Groups">
							<TableHeader>
								<TableRow>
									<TableHead className="w-2/5">Name</TableHead>
									<TableHead className="w-3/5">Users</TableHead>
									<TableHead className="w-auto" />
								</TableRow>
							</TableHeader>
							<TableBody>
								<GroupsTableBody
									groups={groups}
									canCreateGroup={canCreateGroup}
									filterUsed={filterProps.filter.used}
								/>
							</TableBody>
						</Table>
					</PaginationContainer>
				</div>
			)}
		</>
	);
};

type GroupsTableBodyProps = {
	groups: readonly PaginatedGroup[] | undefined;
	canCreateGroup: boolean;
	filterUsed: boolean;
};

const GroupsTableBody: React.FC<GroupsTableBodyProps> = ({
	groups,
	canCreateGroup,
	filterUsed,
}) => {
	if (groups === undefined) {
		return <TableLoader />;
	}
	if (groups.length === 0) {
		// When a search returned no matches, don't nudge the user to create a
		// first group; the org may already have groups that simply don't match.
		if (filterUsed) {
			return (
				<TableRow>
					<TableCell colSpan={999}>
						<EmptyState
							message="No groups match your search"
							description="Try a different search term."
						/>
					</TableCell>
				</TableRow>
			);
		}
		return (
			<TableEmpty
				message="No groups yet"
				description={
					canCreateGroup
						? "Create your first group"
						: "You don't have permission to create a group"
				}
				cta={
					canCreateGroup && (
						<Button asChild>
							<RouterLink to="create">
								<PlusIcon />
								New group
							</RouterLink>
						</Button>
					)
				}
			/>
		);
	}
	return (
		<>
			{groups.map((group) => (
				<GroupRow key={group.id} group={group} />
			))}
		</>
	);
};

type GroupRowProps = {
	group: PaginatedGroup;
};

const GroupRow: React.FC<GroupRowProps> = ({ group }) => {
	const navigate = useNavigate();
	const rowProps = useClickableTableRow({
		onClick: () => navigate(group.name),
	});

	// The list endpoint returns only total_member_count, so fetch a small
	// avatar preview per visible row instead of a full roster.
	const membersQuery = useQuery({
		...groupMemberAvatars(
			group.organization_name,
			group.name,
			GROUP_MEMBER_AVATAR_LIMIT,
		),
		enabled: group.total_member_count > 0,
	});
	const memberAvatars = membersQuery.data?.users ?? [];
	const remainingAvatars = group.total_member_count - memberAvatars.length;
	const skeletonCount = Math.min(
		group.total_member_count,
		GROUP_MEMBER_AVATAR_LIMIT,
	);

	return (
		<TableRow data-testid={`group-${group.id}`} {...rowProps}>
			<TableCell>
				<AvatarData
					avatar={
						<Avatar
							size="lg"
							variant="icon"
							fallback={group.display_name || group.name}
							src={group.avatar_url}
						/>
					}
					title={group.display_name || group.name}
					subtitle={`${group.total_member_count} members`}
				/>
			</TableCell>

			<TableCell>
				{group.total_member_count === 0 || membersQuery.isError ? (
					EM_DASH
				) : membersQuery.isLoading ? (
					<div className="flex items-center gap-2">
						{AVATAR_SKELETON_KEYS.slice(0, skeletonCount).map((key) => (
							<Skeleton key={key} className="size-(--avatar-default)" />
						))}
					</div>
				) : (
					<div className="flex items-center gap-2">
						{memberAvatars.map((member) => (
							<Avatar
								key={member.username}
								fallback={member.username}
								src={member.avatar_url}
							/>
						))}
						{remainingAvatars > 0 && (
							<Badge className="h-(--avatar-default)">
								+{remainingAvatars}
							</Badge>
						)}
					</div>
				)}
			</TableCell>

			<TableCell>
				<div className="flex">
					<ChevronRightIcon className="size-icon-sm" />
				</div>
			</TableCell>
		</TableRow>
	);
};

const TableLoader: React.FC = () => {
	return (
		<TableLoaderSkeleton>
			<TableRowSkeleton>
				<TableCell>
					<div className="flex items-center gap-2">
						<AvatarDataSkeleton />
					</div>
				</TableCell>
				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>
				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>
			</TableRowSkeleton>
		</TableLoaderSkeleton>
	);
};
