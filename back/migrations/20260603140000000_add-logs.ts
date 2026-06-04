/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
	// audit trail: one row per timer-affecting action. oldMs/newMs = remaining time at event, addedMs = delta.
	pgm.createTable("Logs", {
		id: "id",
		userId: { type: "integer", notNull: true },
		createdAt: { type: "timestamptz", notNull: true, default: pgm.func("current_timestamp") },
		action: { type: "text", notNull: true },
		oldMs: { type: "bigint", notNull: true },
		newMs: { type: "bigint", notNull: true },
		addedMs: { type: "bigint", notNull: true },
	});
	pgm.createIndex("Logs", ["userId", "createdAt"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
	pgm.dropTable("Logs");
}
