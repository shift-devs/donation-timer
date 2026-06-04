import React, { useState } from "react";
import { Button, Heading, Input, VStack } from "@chakra-ui/react";

const Login: React.FC = () => {
	const [name, setName] = useState("");
	const submit = () => {
		const n = name.trim();
		if (!n) return;
		localStorage.setItem("identity", n);
		window.location.href = "/";
	};
	return (
		<VStack minH="100vh" justify="center" spacing={5} px={4}>
			<Heading size="lg">Who are you?</Heading>
			<Input
				value={name}
				onChange={(e) => setName(e.currentTarget.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") submit();
				}}
				placeholder="your channel name"
				width="320px"
				textAlign="center"
				autoFocus
			/>
			<Button colorScheme="purple" onClick={submit} isDisabled={!name.trim()}>
				Continue
			</Button>
		</VStack>
	);
};

export default Login;
