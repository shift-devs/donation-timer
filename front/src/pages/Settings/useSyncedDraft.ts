import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// a settings blob the dashboard edits and the server owns: the screen keeps a draft, every edit is pushed (now,
// or coalesced for the controls that fire per pixel), and the server's copy is followed again once it agrees.
// between an edit and its sync the server's copy is OLDER than the screen, so following it would undo
// keystrokes. shared by the Mystery Box and Wonder Box tabs.
//
// `patch` is STABLE (same function every render) and takes either the fields to change or a function of the
// current draft that returns them — the prize cards are memoised, and a patch that changed identity on every
// render would make every card re-render on every keystroke, which is the lag this exists to avoid.
export function useSyncedDraft(raw: any, canon: (raw: any) => any, send: (next: any) => void, debounceMs = 300) {
	const server = useMemo(() => canon(raw || {}), [raw, canon]);
	const serverStr = useMemo(() => JSON.stringify(server), [server]);
	const [draft, setDraftState] = useState<any>(server);
	const draftRef = useRef<any>(server);
	const sentRef = useRef(serverStr);
	const pendingRef = useRef(0);
	const timers = useRef<{ [key: string]: any }>({});
	const sendRef = useRef(send);
	sendRef.current = send;

	useEffect(() => {
		if (serverStr === sentRef.current) {
			pendingRef.current = 0;
			return;
		}
		if (pendingRef.current && Date.now() - pendingRef.current < 10000)
			return;
		draftRef.current = server;
		setDraftState(server);
		sentRef.current = serverStr;
		pendingRef.current = 0;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [serverStr]);

	useEffect(() => () => {
		for (const key of Object.keys(timers.current))
			clearTimeout(timers.current[key]);
	}, []);

	const patch = useCallback((p: any, key?: string) => {
		const cur = draftRef.current;
		const fields = typeof p === "function" ? p(cur) : p;
		const next = { ...cur, ...fields };
		draftRef.current = next;
		setDraftState(next);
		sentRef.current = JSON.stringify(canon(next));
		pendingRef.current = Date.now();
		if (key) {
			clearTimeout(timers.current[key]);
			timers.current[key] = setTimeout(() => sendRef.current(draftRef.current), debounceMs);
		} else {
			sendRef.current(next);
		}
	}, [canon, debounceMs]);

	return { draft, patch };
}
