import React, { useEffect, useState } from "react";

// a bit of text that has to count down on its own (a spin landing, a pause running out). it re-renders ITSELF
// twice a second rather than the whole tab: a page-level tick re-rendered every prize, every wallet list and
// every sound picker on the Mystery Box tab, for as long as anything was running — a pause can last minutes.
const Tick: React.FC<{ children: () => React.ReactNode; ms?: number }> = ({ children, ms = 500 }) => {
	const [, setN] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setN((n) => n + 1), ms);
		return () => clearInterval(id);
	}, [ms]);
	return <>{children()}</>;
};

export default Tick;
