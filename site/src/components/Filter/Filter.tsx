import { cn } from "cn";
import { SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	getValidationErrorMessage,
	hasError,
	isApiValidationError,
} from "#/api/errors";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { SearchField } from "#/components/SearchField/SearchField";
import { Skeleton, type SkeletonProps } from "#/components/Skeleton/Skeleton";
import { useDebouncedFunction } from "#/hooks/debounce";
import {
	type FilterValues,
	parseFilterQuery,
	stringifyFilter,
} from "./filterQuery";

type PresetFilter = {
	name: string;
	query: string;
};

type UseFilterConfig = {
	/**
	 * The fallback value to use in the event that no filter params can be
	 * parsed from the search params object.
	 */
	fallbackFilter?: string;
	searchParams: URLSearchParams;
	onSearchParamsChange: (newParams: URLSearchParams) => void;
	onUpdate?: (newValue: string) => void;
};

export type UseFilterResult = Readonly<{
	query: string;
	values: FilterValues;
	used: boolean;
	update: (newValues: string | FilterValues) => void;
	debounceUpdate: (newValues: string | FilterValues) => void;
	cancelDebounce: () => void;
}>;

export const useFilterParamsKey = "filter";

export const useFilter = ({
	fallbackFilter = "",
	searchParams,
	onSearchParamsChange,
	onUpdate,
}: UseFilterConfig): UseFilterResult => {
	const query = searchParams.get(useFilterParamsKey) ?? fallbackFilter;

	const update = (newValues: string | FilterValues) => {
		const serialized =
			typeof newValues === "string" ? newValues : stringifyFilter(newValues);
		const noUpdateNeeded = query === serialized;
		if (noUpdateNeeded) {
			return;
		}

		/**
		 * @todo 2025-07-15 - We have a slightly nasty bug here, where trying to
		 * update state via immutable state updates causes our code to break.
		 *
		 * In theory, it would be better to make a copy of the search params. We
		 * can then mutate and dispatch the copy instead of the original. Doing
		 * that causes other parts of our existing logic to break, though.
		 * That's a sign that our other code is slightly broken, and only just
		 * happens to work by chance right now.
		 */
		searchParams.set(useFilterParamsKey, serialized);
		onSearchParamsChange(searchParams);
		onUpdate?.(serialized);
	};

	const { debounced: debounceUpdate, cancelDebounce } = useDebouncedFunction(
		update,
		500,
	);

	return {
		query,
		update,
		debounceUpdate,
		cancelDebounce,
		values: parseFilterQuery(query),
		used: query !== "" && query !== fallbackFilter,
	};
};

const BaseSkeleton: React.FC<SkeletonProps> = ({
	children,
	...skeletonProps
}) => {
	return (
		<Skeleton
			height={36}
			{...skeletonProps}
			className="bg-surface-tertiary rounded-md w-52"
		>
			{children}
		</Skeleton>
	);
};

export const MenuSkeleton: React.FC = () => {
	return <BaseSkeleton className="min-w-[200px] shrink-0" />;
};

type FilterProps = React.ComponentProps<"div"> & {
	filter: ReturnType<typeof useFilter>;
	optionsSkeleton: React.ReactNode;
	isLoading: boolean;
	error?: unknown;
	options?: React.ReactNode;
	presets: PresetFilter[];
};

export const Filter: React.FC<FilterProps> = ({
	filter,
	isLoading,
	error,
	optionsSkeleton,
	options,
	presets,
	className,
	...props
}) => {
	// Storing local copy of the filter query so that it can be updated more
	// aggressively without re-renders rippling out to the rest of the app every
	// single time. Exists for performance reasons - not really a good way to
	// remove this; render keys would cause the component to remount too often
	const [queryCopy, setQueryCopy] = useState(filter.query);
	const textboxInputRef = useRef<HTMLInputElement>(null);

	// Conditionally re-syncs the parent and local filter queries
	useEffect(() => {
		const hasSelfOrInnerFocus =
			textboxInputRef.current?.contains(document.activeElement) ?? false;

		// This doesn't address all state sync issues - namely, what happens if the
		// user removes focus just after this synchronizing effect fires. Also need
		// to rely on onBlur behavior as an extra safety measure
		if (!hasSelfOrInnerFocus) {
			setQueryCopy(filter.query);
		}
	}, [filter.query]);

	const shouldDisplayError = hasError(error) && isApiValidationError(error);

	return (
		<div
			className={cn("flex gap-2 flex-wrap lg:flex-nowrap mb-4", className)}
			{...props}
		>
			{isLoading ? (
				<>
					<BaseSkeleton width="100%" />
					{optionsSkeleton}
				</>
			) : (
				<>
					{presets.length > 0 && (
						<PresetMenu
							value={filter.query}
							onSelect={(query) => filter.update(query)}
							presets={presets}
						/>
					)}
					<div className="flex flex-col gap-2 w-full">
						<SearchField
							ref={textboxInputRef}
							className="w-full"
							value={queryCopy}
							aria-label="Filter"
							aria-invalid={shouldDisplayError}
							onChange={(query) => {
								setQueryCopy(query);
								filter.debounceUpdate(query);
							}}
							onClear={() => {
								setQueryCopy("");
								filter.cancelDebounce();
								filter.update("");
							}}
							onBlur={() => {
								if (queryCopy === filter.query) return;
								setQueryCopy(filter.query);
							}}
							placeholder="Search..."
						/>
						{hasError(error) && (
							<span className="text-content-destructive text-sm">
								{getValidationErrorMessage(error)}
							</span>
						)}
					</div>
					{options}
				</>
			)}
		</div>
	);
};

type PresetMenuProps = {
	value: string;
	presets: PresetFilter[];
	onSelect: (query: string) => void;
};

const PresetMenu: React.FC<PresetMenuProps> = ({
	value,
	presets,
	onSelect,
}) => {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline">
					<SlidersHorizontalIcon />
					Filters
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="bottom" align="start">
				<DropdownMenuRadioGroup value={value}>
					{presets.map((presetFilter) => (
						<DropdownMenuRadioItem
							value={presetFilter.query}
							onSelect={() => onSelect(presetFilter.query)}
							key={presetFilter.name}
						>
							{presetFilter.name}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
