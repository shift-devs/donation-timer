import React, { useState, useEffect } from "react";
import { Button, Grid, GridItem, Center, Spinner } from "@chakra-ui/react";
import { addTime, setEndTime } from "../../Api";

const merchValues = {
	"INCREDI-CAP": 22.9,
	"INCREDI-SHIRT": 19.9,
	"INCREDI-HOOD": 34.9,
	"INCREDI-CREW": 24.95,
	"INCREDI-CROP": 33.9,
	"Movie Cap": 22.9,
	"Movie T-Shirt": 19.9,
	"Movie Hoodie": 34.9,
	"Movie Crewneck": 24.95,
	"Movie Crop Sweatshirt": 34.96,
	"Spatula Cap": 22.9,
	"Shiny Cap": 22.9,
	"SHiFT Cap": 23.9,
	"Spatula Windbreaker": 39.96,
	"Shiny Windbreaker": 39.96,
	"Love Cap": 22.9,
	"Spatula Apron": 22.95,
	"Spatula Tank": 19.95,
	"Shiny Crop Tee": 21.95,
	"30! Knit Cap": 22.95,
	"30! Cap": 23.9,
	"30! Cap 2": 22.9,
	"SHiFT T-Shirt": 19.9,
	"SHiFT Tank": 19.95,
	"SHiFT Crop Tee": 21.85,
	"SHiFT Crop Sweatshirt": 33.9,
	"SHiFT Hoodie": 34.96,
	"SHiFT Windbreaker": 39.96,
	"SHiFT Dad Hat": 22.9,
	"SHiFT Knit Cap": 22.95,
	"SHiFT Grustler Apron": 22.9,
};

const Merch: React.FC<{ ws: any; endTime: number; settings: any }> = ({
	ws,
	endTime,
	settings,
}) => {
	const [fetched, setFetched] = useState(false);

	console.log("shit", ws.dollarTime);

	useEffect(() => {
		if (typeof settings.subTime == "number") setFetched(true);
	}, [settings]);

	if (fetched)
		return (
			<div
				id='Merch'
				style={{
					margin: "auto",
					textAlign: "center",
					width: "100%",
				}}
			>
				<Center>
					<Grid templateColumns='repeat(4, 1fr)' gap={8}>
						{Object.entries(merchValues).map((key, k) => (
							<GridItem colSpan={1}>
								<Button
									onClick={() => {
										addTime(ws, endTime, key[1] * settings.dollarTime);
									}}
									colorScheme='purple'
									width='100%'
								>
									{key[0]}
								</Button>
							</GridItem>
						))}
					</Grid>
				</Center>
				<br />
				<br />
				<br />
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

export default Merch;
