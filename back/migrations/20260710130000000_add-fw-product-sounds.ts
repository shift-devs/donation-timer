/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-product alert sound: { [offerId]: filename } under the site's /fwsounds/ folder,
	// played by the /fwalert browser source when that product is bought. empty = no sound.
	pgm.addColumn("Users", {
		fwProductSounds: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwProductSounds");
}
