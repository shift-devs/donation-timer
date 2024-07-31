import React, { useState, useEffect } from "react";
import { Button, Grid, GridItem, Center, Spinner } from "@chakra-ui/react";
import { addTime, setEndTime } from "../../Api";
/*
const merchValues = {
	"SHiFT-A-Thon 2023 Cap": 22.90,
	"Matte Poster": 14.95,
	"S.S. Movie Crew Cap": 22.90,
	"S.S. Movie Unixsex Tee": 20.95,
	"S.S. Movie Tank": 19.90,
	"S.S. Movie Crop": 21.95,
	"S.S. Movie Mug": 15.00,
	"S.S. Movie Snapback": 23.90,
	"S.S. Movie Knit Cap": 22.95,
	"SHiFT Trucker Cap": 23.95,
	"Shiny Knit Cap": 22.95,
	"Spatula Cap": 22.9,
	"Shiny Cap": 22.9,
	"SHiFT Cap": 23.9,
	"Spatula Crewneck": 24.95,
	"Spatula Windbreaker": 39.96,
	"Shiny Windbreaker": 39.96,
	"Love Cap": 22.9,
	"Spatula Apron": 22.95,
	"Spatula Tank": 19.95,
	"Shiny Crop Tee": 21.95,
	"Shiny Crewneck": 24.95,
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
*/

let merchValues: Object = {"Please Connect Streamlabs / Please Wait":0};

const Merch: React.FC<{ ws: any; endTime: number; settings: any }> = ({
	ws,
	endTime,
	settings,
}) => {
	const [fetched, setFetched] = useState(false);

	useEffect(() => {
		if (typeof settings.subTime == "number") setFetched(true);
	}, [settings]);

	if (Object.keys(settings.merchValues).length != 0){
		merchValues = {};
		Object.entries(settings.merchValues).map((pair)=>{
			merchValues[pair[0] as keyof typeof merchValues] = pair[1] as any;
		});	
	}

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
							<GridItem key={k} colSpan={1}>
								<Button
									onClick={() => {
										addTime(ws, endTime, key[1] as number * settings.dollarTime);
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
