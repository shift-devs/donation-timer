import React from "react";
import Widget from "./pages/Widget";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import Timer from "./Timer";

const App: React.FC = () => (
	<Router>
		<ChakraProvider>
			<Routes>
				<Route path='/' element={<Home />} />
				<Route path='/widget' element={<Widget />} />
				<Route path='/login' element={<Login />} />
				<Route path='/settings' element={<Settings />} />
			</Routes>
		</ChakraProvider>
	</Router>
);

export default App;
