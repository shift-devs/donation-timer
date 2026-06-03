/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// endTime was unix seconds (integer); move to unix milliseconds (bigint).
	// multiply existing rows by 1000 so the live timer is preserved.
	pgm.alterColumn("Users", "endTime", {
		type: "bigint",
		notNull: true,
		default: 0,
		using: '"endTime"::bigint * 1000',
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.alterColumn("Users", "endTime", {
		type: "integer",
		notNull: true,
		default: 0,
		using: '("endTime" / 1000)::integer',
	});
}
