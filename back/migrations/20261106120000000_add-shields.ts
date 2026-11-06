/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unspent timeout shields (the "PHD Flopper" prize): { [twitch login]: { name, count } }. each one blocks
	// one timeout the bot would have given the holder. persisted like the boxes and ray guns — it's owed.
	pgm.addColumn("Users", {
		shields: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "shields");
}
