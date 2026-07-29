/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-product alert name drop shadow: { [offerId]: true } for the products that need one to stay
	// readable over a busy banner. absent = off (the default), so this starts empty.
	pgm.addColumn("Users", {
		fwProductShadows: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwProductShadows");
}
