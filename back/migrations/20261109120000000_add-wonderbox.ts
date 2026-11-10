/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// the wonder box: a second prize wheel earned by firesales, with its own prizes and its own wallet. the
	// settings start empty, and the first load seeds them from the mystery box's firesale rules.
	pgm.addColumn("Users", {
		wonderBoxSettings: { type: "jsonb", notNull: true, default: "{}" },
	});
	// unopened wonder boxes: { [twitch login]: { name, count } }. persisted like the mystery box ledger.
	pgm.addColumn("Users", {
		wonderBoxes: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "wonderBoxes");
	pgm.dropColumn("Users", "wonderBoxSettings");
}
