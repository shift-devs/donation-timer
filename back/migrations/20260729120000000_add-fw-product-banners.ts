/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-product fourthwall alert banners: { [offerId]: filename under public/banners }, drawn over the
	// alert's purple name panel. absent = the default purple, so this starts empty.
	pgm.addColumn("Users", {
		fwProductBanners: { type: "jsonb", notNull: true, default: "{}" },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "fwProductBanners");
}
