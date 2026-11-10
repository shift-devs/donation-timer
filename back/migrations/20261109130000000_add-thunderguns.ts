/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unfired thunder gun charges: { [twitch login]: { name, count } }. the ray gun's twin — won from a box and
	// spent with "!thundergun <name>" for a 20 minute timeout. persisted for the same reason: a charge is owed.
	pgm.addColumn("Users", {
		thunderguns: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "thunderguns");
}
