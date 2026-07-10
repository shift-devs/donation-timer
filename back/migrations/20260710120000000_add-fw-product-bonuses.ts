/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-product fourthwall time bonuses: { [offerId]: seconds-per-item }, granted on top of the
	// per-dollar order rate. stored per-user (mirrors the rates column). starts empty for everyone.
	pgm.addColumn("Users", {
		fwProductBonuses: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwProductBonuses");
}
