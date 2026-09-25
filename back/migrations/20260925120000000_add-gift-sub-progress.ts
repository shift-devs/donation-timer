/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// gift subs counted toward the next mystery box, per gifter: { [login]: { name, count } }. only used in
	// cumulative mode. persisted like the boxes — a half-earned box shouldn't vanish on a restart.
	pgm.addColumn("Users", {
		giftSubProgress: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "giftSubProgress");
}
