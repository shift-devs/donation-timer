import React from "react";
import Widget from "./pages/Widget";
import EventSource from "./pages/EventSource";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";

const App: React.FC = () => (
	<Router>
		<ChakraProvider>
			<Routes>
				<Route path='/' element={<Settings />} />
				<Route path='/login' element={<Login />} />
				<Route path='/widget' element={<Widget />} />
				<Route path='/events' element={<EventSource />} />
				<Route path='*' element={<Navigate to='/' replace />} />
			</Routes>
		</ChakraProvider>
	</Router>
);

export default App;
