import React, { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { TRANSPARENT_BODY_CSS } from "./textEffect";

// every page is loaded on demand rather than imported up front. eagerly importing them meant a browser
// source rendering one progress bar also pulled in the dashboard, the timer and all seven other pages —
// unbundled, since production serves these through the vite dev server — and a scene with five sources
// paid for that five times over.
const Settings = lazy(() => import("./pages/Settings"));
const Login = lazy(() => import("./pages/Login"));
const Widget = lazy(() => import("./pages/Widget"));
const EventSource = lazy(() => import("./pages/EventSource"));
const FwAlert = lazy(() => import("./pages/FwAlert"));
const FwActivity = lazy(() => import("./pages/FwActivity"));
const SubCount = lazy(() => import("./pages/SubCount"));
const SubProgress = lazy(() => import("./pages/SubProgress"));
const FwProgress = lazy(() => import("./pages/FwProgress"));
const TextBox = lazy(() => import("./pages/TextBox"));

const App: React.FC = () => (
	<Router>
		<ChakraProvider>
			{/* no content while a page loads — each browser source draws its own chroma fill (or a transparent
			    one), so anything drawn here would flash the wrong colour over the scene. the style is the
			    other half of index.html's transparent body: chakra has mounted by now and painted the body
			    white, and this holds that off until the page itself is on screen. */}
			<Suspense fallback={<style>{TRANSPARENT_BODY_CSS}</style>}>
				<Routes>
					<Route path='/' element={<Settings />} />
					<Route path='/login' element={<Login />} />
					<Route path='/widget' element={<Widget />} />
					<Route path='/events' element={<EventSource />} />
					<Route path='/fwalert' element={<FwAlert />} />
					<Route path='/fwactivity' element={<FwActivity />} />
					<Route path='/subcount' element={<SubCount />} />
					<Route path='/subprogress' element={<SubProgress />} />
					<Route path='/fwprogress' element={<FwProgress />} />
					<Route path='/text' element={<TextBox />} />
					<Route path='*' element={<Navigate to='/' replace />} />
				</Routes>
			</Suspense>
		</ChakraProvider>
	</Router>
);

export default App;
