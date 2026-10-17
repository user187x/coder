/**
 * Pictures baked into the dashboard (site/static/pictures/), so they are there
 * offline from the first install, however Coder was installed (install.sh,
 * Argo CD, plain Helm): offered as backgrounds (Appearance > Background image;
 * saved as their path, drawn from Coder), as the announcement's preset
 * pictures, and in the logo and avatar editors (PREBAKED_GALLERY).
 */
export type PrebakedPicture = {
	name: string;
	url: string;
	type: string;
};

export const PREBAKED_BACKGROUNDS: readonly PrebakedPicture[] = [
	{ name: "creeper.gif", url: "/pictures/creeper.gif", type: "image/gif" },
	{
		name: "background.gif",
		url: "/pictures/background.gif",
		type: "image/gif",
	},
];

/** The pictures every picture chooser offers (GalleryPicker): once only the platform service's, which an Argo CD install did not have. */
export const PREBAKED_GALLERY: readonly PrebakedPicture[] = [
	{
		name: "pulser-cube.gif",
		url: "/pictures/pulser-cube.gif",
		type: "image/gif",
	},
	{
		name: "loading-cube.gif",
		url: "/pictures/loading-cube.gif",
		type: "image/gif",
	},
	{
		name: "destructed-cube.png",
		url: "/pictures/destructed-cube.png",
		type: "image/png",
	},
];

export const BANNER_PRESET_PICTURES: readonly PrebakedPicture[] = [
	{ name: "usa.gif", url: "/pictures/usa.gif", type: "image/gif" },
	{
		name: "background.gif",
		url: "/pictures/background.gif",
		type: "image/gif",
	},
];
