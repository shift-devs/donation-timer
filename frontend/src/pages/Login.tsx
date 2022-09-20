import React, { useEffect } from "react";

const Login: React.FC = () => {
	const token = new URLSearchParams(window.location.hash.substring(1)).get(
		"access_token"
	);

	if (token)
		useEffect(() => {
			window.location.href = `/settings?token=${token}`;
		});

	return <div>Login</div>;
};

export default Login;
