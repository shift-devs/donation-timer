/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-platform/per-unit rates (seconds per unit). replaces the global subTime/dollarTime.
	pgm.addColumn("Users", {
		rates: { type: "jsonb", notNull: true, default: "{}" },
	});
	// backfill from existing subTime/dollarTime, preserving current behavior (incl. the old tier3->5x).
	pgm.sql(`
		UPDATE "Users" SET rates = jsonb_build_object(
			'twitch', jsonb_build_object(
				'sub_t1', "subTime",
				'sub_t2', "subTime" * 2,
				'sub_t3', "subTime" * 5,
				'bits', "dollarTime"::float / 100
			),
			'streamlabs', jsonb_build_object(
				'donation', "dollarTime",
				'merch', "dollarTime"
			)
		);
	`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "rates");
}
