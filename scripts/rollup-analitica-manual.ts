import { pathToFileURL } from "node:url";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { buildAnaliticaRollupService } from "@/lib/services/jobs/analitica-rollup-diario-handler";
import { fechaObjetivo, validarFechaInvocacionManual } from "@/lib/analytics/rollup-dia";

// Feature 124 (R39, design §8) — INVOCACION MANUAL del rollup de UNA fecha.
//
// Uso:  node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/rollup-analitica-manual.ts [YYYY-MM-DD]
// Sin argumento agrega la fecha objetivo por defecto: el dia CR que acaba de cerrar (D-1).
//
// DOS guardas, y las dos son deliberadas:
//
// 1. **Tope de antiguedad (R39).** Solo se admiten HOY y AYER en calendario CR. Cualquier
//    fecha mas vieja se rechaza remitiendo al backfill de la feature 125. Esto es la
//    contrapartida operativa de R35 estricto (D3/D8): sin esta guarda, la 124 se convierte en
//    la 125 por la puerta de atras —un recomputo de fechas pasadas, invisible y no auditado—,
//    que es exactamente lo que R35 prohibe. El rechazo NO escribe absolutamente nada: se sale
//    ANTES de construir el cliente Prisma.
// 2. **Guarda de host (patron de la 123).** Aborta si `DATABASE_URL` no apunta a
//    `localhost:5432/ordenex`. Este script escribe; correrlo por descuido contra produccion
//    no es un incidente recuperable.
//
// Este script NO nombra la tabla del rollup ni la consulta de ninguna forma: delega en el
// servicio, cuya unica puerta a esa tabla es `AnaliticaRollupRepository` (R42).

const HOST_LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const PUERTO_LOCAL = "5432";
const BASE_LOCAL = "ordenex";

/** `true` solo si la URL apunta a `localhost:5432/ordenex`. Cualquier duda -> `false`. */
export function esDestinoLocalOrdenex(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const puerto = u.port === "" ? PUERTO_LOCAL : u.port;
    const base = u.pathname.replace(/^\//, "");
    return HOST_LOCAL.has(host) && puerto === PUERTO_LOCAL && base === BASE_LOCAL;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const now = new Date();
  const fecha = process.argv[2] ?? fechaObjetivo(now);

  // Guarda 1 (R39) ANTES de cualquier conexion: un rechazo no debe ni abrir la base.
  const admitida = validarFechaInvocacionManual(fecha, now);
  if (!admitida.ok) {
    console.error(`RECHAZADO: ${admitida.motivo}`);
    console.error(
      "El job diario solo agrega hoy o el dia que acaba de cerrar. Para recomputar un rango " +
        "historico, usa el backfill de la feature 125 (deliberado, sobre un rango explicito).",
    );
    process.exit(1);
    return;
  }

  // Guarda 2 (host): este script ESCRIBE. Produccion no se toca ni por error.
  const url = process.env.DATABASE_URL;
  if (url === undefined || !esDestinoLocalOrdenex(url)) {
    console.error(
      "ABORTA: DATABASE_URL no apunta a localhost:5432/ordenex. Este script ESCRIBE el rollup " +
        "de una fecha; no se corre contra ninguna otra base.",
    );
    process.exit(1);
    return;
  }

  const prisma = getPrismaClient();
  try {
    const service = buildAnaliticaRollupService(() => new Date());
    // R37: conteos agregados y nada mas. Sin ids, sin PII. Sin `BigInt` (R32).
    const resumen = await service.agregarFecha(admitida.fecha);
    console.log(
      `Rollup ${resumen.fecha}: filasEscritas=${resumen.filasEscritas} ` +
        `filasRetiradas=${resumen.filasRetiradas} ms=${resumen.ms}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    // R38: el error se propaga con su contexto (fecha + etapa vienen dentro del
    // `AnaliticaRollupError`); aqui solo se imprime y se sale con codigo != 0.
    console.error("Fallo el rollup manual:", error);
    process.exit(1);
  });
}
