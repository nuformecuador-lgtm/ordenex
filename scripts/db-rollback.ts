import { execSync } from "child_process";
import fs from "fs";
import os from "os";
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

  // Prisma 7: `prisma db execute` ya no acepta --schema (la datasource se lee
  // de prisma.config.ts). Solo migrate status/deploy siguen aceptandolo.
  console.log(`Aplicando rollback: ${migrationName}`);
  execSync(`npx prisma db execute --file="${downPath}"`, { stdio: "inherit" });

  // El nombre proviene del nombre de carpeta (sin comillas simples), pero
  // validamos para blindar la sentencia SQL contra caracteres inesperados.
  if (!/^[A-Za-z0-9_]+$/.test(migrationName)) {
    console.error(
      `Nombre de migracion invalido para SQL: ${migrationName}. Abortando.`
    );
    process.exit(1);
  }

  // Prisma 7: `migrate resolve --rolled-back` solo aplica a migraciones en
  // estado FALLIDO (da P3012 sobre una aplicada con exito). En su lugar
  // eliminamos el registro de _prisma_migrations para que la migracion vuelva
  // a figurar como PENDIENTE y `migrate deploy` la reaplique.
  const tmpSqlPath = path.join(os.tmpdir(), `db-rollback-${Date.now()}.sql`);
  try {
    fs.writeFileSync(
      tmpSqlPath,
      `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${migrationName}';\n`
    );
    execSync(`npx prisma db execute --file="${tmpSqlPath}"`, {
      stdio: "inherit",
    });
  } finally {
    if (fs.existsSync(tmpSqlPath)) {
      fs.unlinkSync(tmpSqlPath);
    }
  }

  console.log(`Rollback completado: ${migrationName}`);
}

main();
