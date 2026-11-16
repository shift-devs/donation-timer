/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// unused monkey bombs: { [twitch login]: { name, count } }. won from a box and thrown with "!monkey", which
	// starts the monkey bomb game. persisted: a bomb is owed.
	pgm.addColumn("Users", {
		monkeyBombs: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "monkeyBombs");
}
