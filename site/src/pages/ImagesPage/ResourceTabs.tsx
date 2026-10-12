import { LinkTabs, LinkTabsList, TabLink } from "#/components/Tabs/Tabs";

/**
 * Templates | Images, above both pages: templates are what workspaces are
 * made from; images are what their containers run (built in Templates >
 * Images).
 */
export const ResourceTabs: React.FC<{ active: "templates" | "images" }> = ({
	active,
}) => (
	<LinkTabs active={active} className="mb-2 mt-6">
		<LinkTabsList>
			<TabLink value="templates" to="/templates">
				Templates
			</TabLink>
			<TabLink value="images" to="/images">
				Images
			</TabLink>
		</LinkTabsList>
	</LinkTabs>
);
