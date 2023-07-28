import React, { useState } from "react";
import {
	NumberInput,
	NumberInputField,
	NumberInputStepper,
	NumberIncrementStepper,
	NumberDecrementStepper,
	InputGroup,
	InputLeftAddon,
	Button,
	Input,
	Grid,
	GridItem,
	Center,
	Text,
} from "@chakra-ui/react";
import { addTime, setEndTime } from "../../Api";

const ChangeTime: React.FC<{ ws: any; endTime: number }> = ({
	ws,
	endTime,
}) => {
	const [Seconds, setSeconds] = useState(30);
	const [Minutes, setMinutes] = useState(10);
	const [Hours, setHours] = useState(1);
	const [formattedSeconds, setFormattedSeconds] = useState("");
	const [formattedMinutes, setFormattedMinutes] = useState("");
	const [formattedHours, setFormattedHours] = useState("");

	return (
		<div
			id='ChangeTimer'
			style={{
				margin: "auto",
				textAlign: "center",
				width: "80%",
			}}
		>
			<Center>
				<Grid h='150px' templateColumns='repeat(4, 1fr)' gap={8}>
					<GridItem colSpan={4}>
						<InputGroup width='100%'>
							<InputLeftAddon children='Time' />
							<Input
								onChange={(e) => {
									setFormattedHours(e.currentTarget.value.replace(/\D/g, ""));
								}}
								value={formattedHours}
								placeholder='Hours'
							/>
							<Input
								onChange={(e) => {
									setFormattedMinutes(e.currentTarget.value.replace(/\D/g, ""));
								}}
								value={formattedMinutes}
								placeholder='Minutes'
							/>
							<Input
								onChange={(e) => {
									setFormattedSeconds(e.currentTarget.value.replace(/\D/g, ""));
								}}
								value={formattedSeconds}
								placeholder='Seconds'
							/>

							<Button
								onClick={() => {
									setEndTime(
										ws,
										(parseInt(formattedHours) * 3600 || 0) +
											(parseInt(formattedMinutes) * 60 || 0) +
											(parseInt(formattedSeconds) || 0) +
											Math.trunc(Date.now() / 1000)
									);
								}}
								colorScheme='purple'
								width='20%'
							>
								Set
							</Button>
						</InputGroup>
					</GridItem>
					<GridItem colSpan={2}>
						<InputGroup>
							<InputLeftAddon children='Seconds' />
							<NumberInput
								defaultValue={Seconds}
								onChange={(value) => setSeconds(parseInt(value))}
								width='50%'
							>
								<NumberInputField />
								<NumberInputStepper>
									<NumberIncrementStepper />
									<NumberDecrementStepper />
								</NumberInputStepper>
							</NumberInput>
							<Button
								onClick={() => {
									addTime(ws, endTime, Seconds);
								}}
								colorScheme='purple'
								width='60%'
							>
								Add/Remove
							</Button>
						</InputGroup>
					</GridItem>
					<GridItem colSpan={2}>
						<InputGroup>
							<InputLeftAddon children='Minutes' />
							<NumberInput
								defaultValue={Minutes}
								onChange={(value) => setMinutes(parseInt(value))}
								width='50%'
							>
								<NumberInputField />
								<NumberInputStepper>
									<NumberIncrementStepper />
									<NumberDecrementStepper />
								</NumberInputStepper>
							</NumberInput>
							<Button
								onClick={() => {
									addTime(ws, endTime, Minutes * 60);
								}}
								colorScheme='purple'
								width='60%'
							>
								Add/Remove
							</Button>
						</InputGroup>
					</GridItem>
					<GridItem w='100%' colStart={2} colSpan={2}>
						<InputGroup>
							<InputLeftAddon children='Hours' />
							<NumberInput
								defaultValue={Hours}
								onChange={(value) => setHours(parseInt(value))}
								width='50%'
							>
								<NumberInputField />
								<NumberInputStepper>
									<NumberIncrementStepper />
									<NumberDecrementStepper />
								</NumberInputStepper>
							</NumberInput>
							<Button
								onClick={() => {
									addTime(ws, endTime, Hours * 60 * 60);
								}}
								colorScheme='purple'
								width='
                                60%'
							>
								Add/Remove
							</Button>
						</InputGroup>
					</GridItem>
				</Grid>
			</Center>
			<br />
			<br />
			<br />
		</div>
	);
};

export default ChangeTime;
