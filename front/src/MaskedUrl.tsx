import { useState } from "react";
import { Code } from "@chakra-ui/react";

// streamers often have this page on screen — mask the host and token until clicked so a
// screenshare can't leak the server address. Click toggles reveal; the Copy buttons always
// copy the real URL regardless of what's shown here.
const MaskedUrl: React.FC<{ url: string; [prop: string]: any }> = ({ url, ...rest }) => {
	const [show, setShow] = useState(false);
	let masked = url;
	try {
		const u = new URL(url);
		masked = `${u.protocol}//${"•".repeat(10)}${u.pathname}?token=${"•".repeat(4)}`;
	} catch {}
	return (
		<Code
			cursor="pointer"
			title={show ? "Click to hide" : "Click to reveal"}
			onClick={() => setShow((s) => !s)}
			{...rest}
		>
			{show ? url : masked}
		</Code>
	);
};

export default MaskedUrl;
