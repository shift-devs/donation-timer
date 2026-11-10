/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unfired fuck you gun charges: { [twitch login]: { name, count } }. the thunder gun's big brother — won from
	// a box and spent with "!fuckyougun <name>" for a 24 hour timeout. persisted: a charge is owed.
	pgm.addColumn("Users", {
		fuckYouGuns: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fuckYouGuns");
}
