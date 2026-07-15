// navigator.clipboard only exists on secure origins (https / localhost), and this app is
// routinely served over plain http on a LAN or tailscale IP — fall back to the legacy
// execCommand path there so the copy buttons work everywhere. Resolves true on success.
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {}
	}
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.style.position = "fixed";
	ta.style.opacity = "0";
	document.body.appendChild(ta);
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {}
	document.body.removeChild(ta);
	return ok;
}
