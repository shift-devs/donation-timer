/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// all-time per-service sub tallies backing the /subcount browser sources. each is a running count of
	// observed subs/memberships (incl. each gifted recipient); the dashboard can also set them to reconcile
	// drift against the real number on the platform. start at zero for everyone.
	pgm.addColumn("Users", {
		subCountTwitch: { type: "integer", notNull: true, default: 0 },
		subCountYoutube: { type: "integer", notNull: true, default: 0 },
		subCountKick: { type: "integer", notNull: true, default: 0 },
	});
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", ["subCountTwitch", "subCountYoutube", "subCountKick"]);
}
