import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent } from "storybook/test";
import { dependencyImagesKey } from "#/api/queries/images";
import { DockerImageLibrary } from "./DockerImageLibrary";

const meta: Meta<typeof DockerImageLibrary> = {
	title: "pages/ImagesPage/DockerImageLibrary",
	component: DockerImageLibrary,
	args: { canUpload: true },
};

export default meta;
type Story = StoryObj<typeof DockerImageLibrary>;

export const Populated: Story = {
	parameters: {
		queries: [
			{
				key: dependencyImagesKey,
				data: {
					images: [
						"localhost:5000/coder-dependencies/cloudnative-pg/pgbouncer:1.25.1",
					],
					upload: null,
				},
			},
		],
	},
};

export const UploadArchive: Story = {
	parameters: {
		queries: [{ key: dependencyImagesKey, data: { images: [], upload: null } }],
	},
	play: async ({ canvas }) => {
		await userEvent.click(canvas.getByRole("button", { name: "Upload image" }));
	},
};
