import { Suspense } from "react";
import { Outlet } from "react-router";
import { Loader } from "#/components/Loader/Loader";
import { OrganizationSidebar } from "./OrganizationSidebar";

const OrganizationSidebarLayout: React.FC = () => {
	return (
		<section className="px-4 sm:px-6 lg:px-10 max-w-[1920px] mx-auto">
			<div className="flex flex-col gap-4 py-3 lg:flex-row lg:gap-8 lg:py-5">
				<OrganizationSidebar />
				<div className="grow min-w-0">
					<Suspense fallback={<Loader />}>
						<Outlet />
					</Suspense>
				</div>
			</div>
		</section>
	);
};

export default OrganizationSidebarLayout;
