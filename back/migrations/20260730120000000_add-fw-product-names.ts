/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-product display names: { [offerId]: label } shown on stream instead of the shop's own product
	// name. absent = use fourthwall's name, so this starts empty.
	pgm.addColumn("Users", {
		fwProductNames: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwProductNames");
}
