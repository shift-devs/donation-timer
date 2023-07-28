import React from "react";
import Widget from "./pages/Widget";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Settings from "./pages/Settings";
import HypeTimer from "./pages/HypeTimer";
import CurrentTimeBonus from "./pages/CurrentTimeBonus";
import CurrentDollarBonus from "./pages/DollarBonuses";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";

const App: React.FC = () => {
	return (
		<Router>
			<ChakraProvider>
				<Routes>
					<Route path='/' element={<Home />} />
					<Route path='/widget' element={<Widget />} />
					<Route path='/login' element={<Login />} />
					<Route path='/settings' element={<Settings />} />
					<Route path='/hypetimer' element={<HypeTimer />} />
					<Route path='/timetiers' element={<CurrentTimeBonus />} />
					<Route path='/dollartime' element={<CurrentDollarBonus />} />
				</Routes>
			</ChakraProvider>
		</Router>
	);
};

export default App;
