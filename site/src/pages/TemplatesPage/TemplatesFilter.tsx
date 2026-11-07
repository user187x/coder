import {
	Filter,
	MenuSkeleton,
	type UseFilterResult,
	useFilter,
} from "#/components/Filter/Filter";
import {
	DEFAULT_USER_FILTER_WIDTH,
	type UserFilterMenu,
	UserMenu,
	useUserFilterMenu,
} from "#/components/Filter/UserFilter";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDashboard } from "#/modules/dashboard/useDashboard";

export const CLASSIC_PARAMETER_FLOW_FILTER = "compatibility_mode:true";

export type TemplateFilterState = {
	filter: UseFilterResult;
	menus: {
		user?: ReturnType<typeof useUserFilterMenu>;
	};
};

type UseTemplatesFilterOptions = {
	searchParams: URLSearchParams;
	onSearchParamsChange: (params: URLSearchParams) => void;
	enabled?: boolean;
};

export const useTemplatesFilter = ({
	searchParams,
	onSearchParamsChange,
	enabled = true,
}: UseTemplatesFilterOptions): TemplateFilterState => {
	const filter = useFilter({
		searchParams,
		onSearchParamsChange,
	});

	const { permissions } = useAuthenticated();
	const canFilterByUser = permissions.viewAllUsers;
	const userMenu = useUserFilterMenu({
		value: filter.values.author,
		onChange: (option) =>
			filter.update({ ...filter.values, author: option?.value }),
		enabled: enabled && canFilterByUser,
	});

	return {
		filter,
		menus: {
			user: canFilterByUser ? userMenu : undefined,
		},
	};
};

type TemplatesFilterProps = {
	filter: UseFilterResult;
	error?: unknown;

	userMenu?: UserFilterMenu;
};

export const TemplatesFilter: React.FC<TemplatesFilterProps> = ({
	filter,
	error,
	userMenu,
}) => {
	const { showOrganizations } = useDashboard();
	const width = showOrganizations ? DEFAULT_USER_FILTER_WIDTH : undefined;
	return (
		<Filter
			presets={[
				{ query: "", name: "All templates" },
				{ query: "author:me", name: "Templates you authored" },
				{ query: "deprecated:true", name: "Deprecated templates" },
				{
					query: CLASSIC_PARAMETER_FLOW_FILTER,
					name: "Templates using compatibility mode",
				},
			]}
			// TODO: Add docs for this
			isLoading={false}
			filter={filter}
			error={error}
			// No organization picker: the search field takes its width, and
			// `organization:<name>` in the query still filters by organization.
			options={userMenu && <UserMenu width={width} menu={userMenu} />}
			optionsSkeleton={userMenu && <MenuSkeleton />}
		/>
	);
};
