import React, { useEffect, useState } from "react";
import {
	NumberInput,
	NumberInputField,
	NumberInputStepper,
	NumberIncrementStepper,
	NumberDecrementStepper,
	InputGroup,
	InputLeftAddon,
	Spinner,
	Button,
	SimpleGrid,
} from "@chakra-ui/react";
import { setSetting } from "../../Api";

const TimingSettings: React.FC<{ ws: any; input_settings: any }> = ({
	ws,
	input_settings,
}) => {
	const [fetched, setFetched] = useState(false);
	const [SubTime, setSubTime] = useState(0);
	const [DollarTime, setDollarTime] = useState(0);

	const pushUpdates = () => {
		setSetting(ws, "subTime", SubTime);
		setSetting(ws, "dollarTime", DollarTime);
	};

	useEffect(() => {
		if (typeof input_settings.subTime == "number") setFetched(true);
	}, [input_settings]);

	if (fetched)
		return (
			<div
				id='TimingSettings'
				style={{
					margin: "auto",
					textAlign: "center",
					width: "80%",
				}}
			>
				<SimpleGrid columns={2} spacing={10}>
					<InputGroup>
						<InputLeftAddon children='Seconds per sub' />
						<NumberInput
							defaultValue={input_settings.subTime}
							onChange={(value) => setSubTime(parseInt(value))}
						>
							<NumberInputField />
							<NumberInputStepper>
								<NumberIncrementStepper />
								<NumberDecrementStepper />
							</NumberInputStepper>
						</NumberInput>
					</InputGroup>
					<InputGroup>
						<InputLeftAddon children='Seconds per $1' />
						<NumberInput
							defaultValue={input_settings.dollarTime}
							onChange={(value) => setDollarTime(parseInt(value))}
						>
							<NumberInputField />
							<NumberInputStepper>
								<NumberIncrementStepper />
								<NumberDecrementStepper />
							</NumberInputStepper>
						</NumberInput>
					</InputGroup>
				</SimpleGrid>
				<br />
				<br />
				<br />
				<Button onClick={pushUpdates} colorScheme='purple'>
					Save
				</Button>
			</div>
		);
	else
		return (
			<div
				style={{
					margin: "auto",
					textAlign: "center",
					width: "30%",
				}}
			>
				<Spinner
					thickness='4px'
					speed='0.65s'
					emptyColor='gray.200'
					color='blue.500'
					size='xl'
				></Spinner>
				<br />
				Loading
			</div>
		);
};

export default TimingSettings;
