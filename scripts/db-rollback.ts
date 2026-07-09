import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");

function getLastMigrationDir(): string | null {
  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  if (dirs.length === 0) return null;
  return path.join(MIGRATIONS_DIR, dirs[dirs.length - 1].name);
}

function main() {
  const lastMigration = getLastMigrationDir();
  if (!lastMigration) {
    console.log("No hay migraciones para revertir.");
    return;
  }

  const downPath = path.join(lastMigration, "down.sql");
  if (!fs.existsSync(downPath)) {
    console.error(
      `Falta down.sql en ${path.basename(lastMigration)}. Crea el archivo antes de hacer rollback.`
    );
    process.exit(1);
  }

  const migrationName = path.basename(lastMigration);

  console.log(`Aplicando rollback: ${migrationName}`);
  execSync(
    `npx prisma db execute --file="${downPath}" --schema=db/schema.prisma`,
    { stdio: "inherit" }
  );

  execSync(
    `npx prisma migrate resolve --rolled-back "${migrationName}" --schema=db/schema.prisma`,
    { stdio: "inherit" }
  );

  console.log(`Rollback completado: ${migrationName}`);
}

main();
