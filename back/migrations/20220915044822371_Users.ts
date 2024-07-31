/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	pgm.createTable("Users", {
		userId: {
			type: "integer",
			notNull: true,
			primaryKey: true,
		},
		endTime: {
			type: "integer",
			notNull: true,
			default: 0,
		},
		name: { type: "varchar(32)", notNull: true },
		accessToken: { type: "varchar(100)", notNull: true },
		slToken: { type: "varchar(1000)", notNull: false },
		subTime: {
			type: "integer",
			notNull: true,
			default: 60,
		},
		dollarTime: {
			type: "integer",
			notNull: true,
			default: 15,
		},
		createdAt: {
			type: "timestamp",
			notNull: true,
			default: pgm.func("current_timestamp"),
		},
		updatedAt: {
			type: "timestamp",
			notNull: true,
			default: pgm.func("current_timestamp"),
		},
		shouldCap: {
			type: "boolean",
			notNull: true,
			default: false,
		},
		ignoreAnon: {
			type: "boolean",
			notNull: true,
			default: false,
		},
	});
}
