/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	pgm.addColumns("Users", {
		hypeEndTime: {
			type: "integer",
			notNull: true,
			default: 0,
		},
		bonusTime: {
			type: "integer",
			notNull: true,
			default: 0,
		},
		hypeLevel: {
			type: "integer",
			notNull: true,
			default: 0,
		},
		currentHype: {
			type: "integer",
			notNull: true,
			default: 0,
		},
	});
}
