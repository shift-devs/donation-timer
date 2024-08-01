import React, { useEffect } from "react";

const Login: React.FC = () => {
	let token = new URLSearchParams(window.location.hash.substring(1)).get(
		"access_token"
	);
	
	if (!token)
		token = new URLSearchParams(window.location.search).get(
		"access_token"
	);

	if (token)
		useEffect(() => {
			window.location.href = `/settings?token=${token}`;
		});
	if (!token)
		return <div>Missing access token!</div>;
	return <div>Logging in...</div>;
};

export default Login;
