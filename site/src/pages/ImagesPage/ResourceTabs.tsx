import { LinkTabs, LinkTabsList, TabLink } from "#/components/Tabs/Tabs";

/**
 * Workspaces | Templates | Images, above all three pages (as the Resources
 * menu lists them): workspaces are made from templates; images are what their
 * containers run (built in Templates > Images).
 */
export const ResourceTabs: React.FC<{
	active: "workspaces" | "templates" | "images";
}> = ({ active }) => (
	<LinkTabs active={active} className="mb-2 mt-6">
		<LinkTabsList>
			<TabLink value="workspaces" to="/workspaces">
				Workspaces
			</TabLink>
			<TabLink value="templates" to="/templates">
				Templates
			</TabLink>
			<TabLink value="images" to="/images">
				Images
			</TabLink>
		</LinkTabsList>
	</LinkTabs>
);
