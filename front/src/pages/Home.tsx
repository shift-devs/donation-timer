import React from "react";
import * as consts from "../Consts";
import { Button, ButtonGroup } from "@chakra-ui/react";

const Home: React.FC = () => {
	if (consts.CLIENT_ID == "")
		return (
			<div
			style={{
				marginTop: "10px",
				margin: "auto",
				textAlign: "center",
				color: "purple",
				fontFamily: "Roboto, sans-serif",
				fontWeight: 400,
				fontSize: "64px",
			}}
		>
			<h2>
				Note: No Twitch Application Client ID is set. Allowing unauthorized logins.
			</h2>
			<form action={`${consts.REDIRECT_URL}`}>
				<label>Username:
				<input style={{border:"2px solid purple"}} placeholder="Your username" type="text" name="access_token" />
				</label>
				<input type="submit" value="Login" />
			</form>
		</div>
		)
	return (
		<div
			style={{
				marginTop: "10px",
				margin: "auto",
				textAlign: "center",
				color: "white",
				fontFamily: "Roboto, sans-serif",
				fontWeight: 400,
				fontSize: "64px",
			}}
		>
			<Button colorScheme='purple' size='lg'>
				<a
					href={`https://id.twitch.tv/oauth2/authorize?client_id=${consts.CLIENT_ID}&redirect_uri=${consts.REDIRECT_URL}&response_type=token`}
				>
					login with twitch
				</a>
			</Button>
		</div>
	);
};

export default Home;
