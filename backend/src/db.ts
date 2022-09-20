import { Sequelize, DataTypes } from "sequelize";
import { user } from "./types.js";

const sequelize = new Sequelize(
	process.env.DB_SCHEMA || "postgres",
	process.env.DB_USER || "postgres",
	process.env.DB_PASSWORD || "",
	{
		host: process.env.DB_HOST || "postgres",
		port: parseInt(process.env.DB_PORT || "5432"),
		dialect: "postgres",
		dialectOptions: {
			ssl: process.env.DB_SSL == "true",
			rejectUnauthorized: false,
		},
		logging: false,
	}
);

export const Users = sequelize.define("User", {
	userId: {
		type: DataTypes.INTEGER,
		allowNull: false,
		primaryKey: true,
	},
	name: {
		type: DataTypes.STRING,
		allowNull: false,
	},
	accessToken: {
		type: DataTypes.STRING,
		allowNull: false,
	},
	subTime: {
		type: DataTypes.INTEGER,
		allowNull: false,
	},
	dollarTime: {
		type: DataTypes.INTEGER,
		allowNull: false,
	},
	slToken: {
		type: DataTypes.STRING,
		allowNull: true,
	},
	endTime: {
		type: DataTypes.INTEGER,
		allowNull: false,
	},
	hypeEndTime: {
		type: DataTypes.INTEGER,
	},
	bonusTime: {
		type: DataTypes.INTEGER,
	},
	hypeLevel: {
		type: DataTypes.INTEGER,
	},
	currentHype: {
		type: DataTypes.INTEGER,
	},
});

export async function createUser(user: user) {
	console.log;
	Users.create({
		userId: user.userId,
		name: user.name,
		accessToken: user.accessToken,
		subTime: user.subTime,
		dollarTime: user.dollarTime,
		slToken: user.slToken,
		endTime: user.endTime,
		hypeEndTime: user.hypeEndTime,
		bonusTime: user.bonusTime,
		hypeLevel: user.hypeLevel,
		currentHype: user.currentHype,
	});
}

async function main() {
	try {
		await sequelize.authenticate();
		await Users.sync();
		console.log("Connection has been established successfully.");
	} catch (error) {
		console.error("Unable to connect to the database:", error);
	}
}

main();
