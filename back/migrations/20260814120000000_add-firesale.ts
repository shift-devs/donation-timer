/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// how the /firesale browser source looks and behaves: which account's giveaway announcements start a run,
	// what chatters type to enter, the looping music, and the colours. the run itself (entrants, winner) is
	// live state and is deliberately not stored.
	pgm.addColumn("Users", {
		firesaleSettings: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "firesaleSettings");
}
