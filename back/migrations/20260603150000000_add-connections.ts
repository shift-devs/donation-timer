/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// per-user, per-platform connection config (what to watch). decouples watch-target from identity.
	pgm.addColumn("Users", {
		connections: { type: "jsonb", notNull: true, default: "{}" },
	});
	// backfill: twitch channel from the legacy identity name, streamlabs token from the legacy slToken.
	pgm.sql(`
		UPDATE "Users" SET connections = jsonb_build_object(
			'twitch', jsonb_build_object('channel', "name"),
			'streamlabs', jsonb_build_object('token', coalesce("slToken", ''))
		);
	`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropColumn("Users", "connections");
}
