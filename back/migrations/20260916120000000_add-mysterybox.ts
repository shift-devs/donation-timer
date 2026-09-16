/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// how the /mysterybox browser source looks and behaves, and the prize list itself: each prize's art,
	// sound, rarity weight and effect. the spin happening right now is live state and is not stored.
	pgm.addColumn("Users", {
		mysteryBoxSettings: { type: "jsonb", notNull: true, default: "{}" },
	});
	// the ledger of unopened boxes: { [twitch login]: { name, count } }. a box is earned by putting an item
	// up for firesale and spent with "!mb open", so unlike a giveaway run it has to survive a restart —
	// otherwise a viewer who earned one before the process died is simply robbed of it.
	pgm.addColumn("Users", {
		mysteryBoxes: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "mysteryBoxes");
	pgm.dropColumn("Users", "mysteryBoxSettings");
}
