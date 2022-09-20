import React, { useState, useEffect } from "react";
import { connectSl } from "../../Api";
import { Input, Button, Grid, GridItem, Badge, Center } from "@chakra-ui/react";

const ConnectivitySettings: React.FC<{ ws: any; status?: boolean }> = ({
	ws,
	status = false,
}) => {
	const [slToken, setSlToken] = useState("");
	const [slStatus, setslStatus] = useState("Not Connected");
	const [ColorScheme, setColorScheme] = useState("red");

	useEffect(() => {
		if (status) {
			setslStatus("Connected");
			setColorScheme("green");
		}
	}, [status]);

	return (
		<div
			id='settings'
			style={{
				margin: "auto",
				textAlign: "center",
				width: "80%",
			}}
		>
			<Grid templateColumns='repeat(7, 1fr)' gap={8}>
				<GridItem colSpan={6}>
					<Input
						onChange={(e) => setSlToken(e.currentTarget.value)}
						placeholder='Update Streamlabs Socket API'
					/>
				</GridItem>
				<GridItem colSpan={1}>
					<Button
						colorScheme='purple'
						onClick={() =>
							window.open(
								"https://streamlabs.com/dashboard#/settings/api-settings",
								"_blank"
							)
						}
					>
						Get Token
					</Button>
				</GridItem>
			</Grid>

			<br />
			<Center>
				<Badge colorScheme={ColorScheme}>{slStatus}</Badge>
			</Center>
			<br />
			<br />

			<Button onClick={() => connectSl(ws, slToken)} colorScheme='purple'>
				Save
			</Button>
		</div>
	);
};

export default ConnectivitySettings;
