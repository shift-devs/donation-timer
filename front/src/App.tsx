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
import Timer from "./Timer";

const App: React.FC = () => (
	<Router>
		<ChakraProvider>
			<Routes>
				<Route path='/' element={<Home />} />
				<Route path='/test' element={<Timer input_seconds={12342}/>} />
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

export default App;
