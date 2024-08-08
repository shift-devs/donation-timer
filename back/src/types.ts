export type user = {
	userId: number;
	name: string;
	accessToken: string;
	subTime: number;
	dollarTime: number;
	slToken?: string;
	endTime: number;
	shouldCap: boolean;
	ignoreAnon: boolean;
};

export interface wsType extends WebSocket {
	endTime: number;
	name: string;
	isAlive: boolean;
	subTime: number;
	socket: SocketIOClient.Socket;
	slToken: string;
	dollarTime: number;
	slStatus: boolean;
	userId: number;
	initialized: boolean;
	accessToken: string;
	on: (event: string, listener: (data: any) => void) => void;
	type: string;
	shouldLogin: boolean;
	shouldCap: boolean;
	ignoreAnon: boolean;
	merchValues: Object;
}
