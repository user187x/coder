import axios from "axios";

/** End only the browser process group owned by this panel. */
export const closeBrowserSession = async (baseUrl: string, id: string) => {
	const control = new URL("control", new URL(baseUrl, window.location.origin))
		.href;
	const { data } = await axios.get<{ csrf: string }>(control);
	await axios.post(
		control,
		{ id },
		{ headers: { "X-Browser-CSRF": data.csrf } },
	);
};
