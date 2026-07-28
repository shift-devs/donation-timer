/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-product fourthwall alert toggles: { [offerId]: false } for products whose on-stream purchase
	// alert is turned off. absent = on (the default), so this starts empty and every product alerts.
	pgm.addColumn("Users", {
		fwProductAlerts: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwProductAlerts");
}
