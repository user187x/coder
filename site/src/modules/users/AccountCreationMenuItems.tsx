import { HourglassIcon, UserPlusIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";

export const accountsPath = "/deployment/users";
export const createLeaseParam = "create_lease";

export function AccountCreationMenuItems({
	canCreateLease,
}: {
	canCreateLease: boolean;
}) {
	const { pathname, search } = useLocation();
	const params = new URLSearchParams(pathname === accountsPath ? search : "");
	params.set(createLeaseParam, "1");

	return (
		<>
			<DropdownMenuItem asChild>
				<Link to={`${accountsPath}/create`}>
					<UserPlusIcon aria-hidden />
					New account
				</Link>
			</DropdownMenuItem>
			{canCreateLease && (
				<DropdownMenuItem asChild>
					<Link to={{ pathname: accountsPath, search: params.toString() }}>
						<HourglassIcon aria-hidden />
						New Lease
					</Link>
				</DropdownMenuItem>
			)}
		</>
	);
}
