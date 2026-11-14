/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unused ice staff charges: { [twitch login]: { name, count } }. won from a box and spent with "!icestaff",
	// which freezes the timer the way the timebomb prize does. persisted: a charge is owed.
	pgm.addColumn("Users", {
		iceStaffs: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "iceStaffs");
}
