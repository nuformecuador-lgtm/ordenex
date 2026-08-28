import { pathToFileURL } from "node:url";
import type { JobTipo } from "@prisma/client";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { seedJobLiberarReprogramadas } from "./seed-jobs-liberar-reprogramadas";
import { seedJobAnaliticaRollupDiario } from "./seed-jobs-analitica-rollup-diario";

// Ficha 313 — REGISTRO UNICO DE LAS SIEMBRAS DE LOS JOBS RECURRENTES, y lo que las corre.
//
// EL INCIDENTE QUE LO MOTIVA, medido contra la base de PRODUCCION el 2026-08-28. Un job
// recurrente se re-agenda SOLO DESPUES de cada corrida, asi que la serie necesita una PRIMERA
// fila. Los dos scripts que la siembran existian desde las features 90 y 124
// (`scripts/seed-jobs-*.ts`), pero NO estaban en ningun paso del despliegue y nunca se
// corrieron contra produccion. Sin primera fila no hay segunda. Lo que se midio ese dia:
//
//   - tabla `jobs`: 0 filas de `liberar_reprogramadas` y 0 de `analitica_rollup_diario`;
//   - 0 transiciones `liberacion_reprogramada` en TODA la historia de la base;
//   - 40 ordenes atrapadas en `reprogramada` con el mensajero del dia anterior puesto,
//     invisibles al filtro de reasignables: un operador que no podia trabajar;
//   - el rollup diario no se escribio NUNCA, y eso no lo reporto nadie.
//
// Ningun test se puso rojo y el build salio verde durante dos dias. La unica senal fue humana.
// Los dos se sembraron a mano y la serie ya se auto-perpetua; esto es la red para que no vuelva
// a pasar cuando alguien recree la base (como el 2026-08-25).
//
// QUE APORTA ESTE ARCHIVO, siendo los seeds ya codigo:
//   1. un REGISTRO declarado tipo -> sembrador, sobre el que se puede censar la cobertura sin
//      base de datos delante (lo hace
//      `tests/unit/guards/jobs-recurrentes-con-siembra.guardia.test.ts`);
//   2. un unico punto que `scripts/migrate-deploy.ts` —el unico paso del despliegue que corre
//      contra la base— invoca, para que anadir un tipo recurrente no exija acordarse de nada.
//
// IDEMPOTENCIA (comprobada, no supuesta): cada sembrador encola con la MISMA `dedupe_key` que
// usaria la recurrencia para esa corrida, y `JobRepository.enqueue` hace
// `ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL DO NOTHING`. Sembrar en cada
// despliegue no duplica ni adelanta la corrida. Lo demuestran, contando filas contra Postgres
// real, `tests/integration/db/job-tipo-analitica-rollup-migration.test.ts` y
// `tests/integration/db/siembra-liberar-reprogramadas-idempotente.test.ts`.

/** Encola la PRIMERA ocurrencia de un tipo recurrente. Devuelve null si ya estaba encolada. */
export type Sembrador = (repo: IJobRepository, now: Date) => Promise<JobDTO | null>;

export interface SiembraRecurrente {
  /** Tipo de job, tal como se registra en `buildRecurrencias()`. */
  tipo: JobTipo;
  /** Script que define la siembra (se nombra en los mensajes de la guardia). */
  script: string;
  /** Que se rompe si esta siembra no corre. */
  siNoCorre: string;
  sembrar: Sembrador;
}

/**
 * INVENTARIO CERRADO de siembras. Toda entrada de `buildRecurrencias()` tiene que estar aqui, y
 * viceversa; la guardia lo exige en las dos direcciones (una siembra huerfana encolaria un
 * trabajo que ya nadie re-agenda: correria una sola vez sin que nada lo diga).
 */
export const SIEMBRAS_RECURRENTES: readonly SiembraRecurrente[] = [
  {
    tipo: "liberar_reprogramadas",
    script: "scripts/seed-jobs-liberar-reprogramadas.ts",
    siNoCorre:
      "las ordenes reprogramadas se quedan con el mensajero del dia anterior y fuera del " +
      "filtro de reasignables (40 ordenes atrapadas el 2026-08-28)",
    sembrar: seedJobLiberarReprogramadas,
  },
  {
    tipo: "analitica_rollup_diario",
    script: "scripts/seed-jobs-analitica-rollup-diario.ts",
    siNoCorre:
      "el rollup diario no se escribe: la tabla no se rompe, simplemente deja de crecer y el " +
      "tablero sirve cifras viejas sin que nada falle",
    sembrar: seedJobAnaliticaRollupDiario,
  },
];

/** Un hueco de la cadena "tipo recurrente -> siembra registrada". */
export type HuecoDeSiembra =
  /** No hay nada que comprobar: el censo se quedo vacio (guardia vacua). */
  | { clase: "censo_vacio"; detalle: string }
  /** Tipo con recurrencia registrada y sin siembra: la serie nunca arranca. */
  | { clase: "sin_siembra"; tipo: string; detalle: string }
  /** Siembra de un tipo que ya no es recurrente: encolaria un trabajo sin serie detras. */
  | { clase: "siembra_huerfana"; tipo: string; detalle: string };

/**
 * Compara los dos censos y devuelve los huecos. PURA (recibe las dos listas) para que la
 * guardia pueda demostrar sobre censos sinteticos que sabe ponerse roja.
 *
 * Un censo vacio en CUALQUIERA de los dos lados es un hueco, no un aprobado: el modo de fallo
 * de esta familia de guardias es quedarse sin nada que mirar (un rename de `buildRecurrencias`,
 * un registro vaciado) y seguir verde.
 */
export function auditarCoberturaDeSiembra(
  tiposRecurrentes: readonly string[],
  tiposSembrados: readonly string[],
): HuecoDeSiembra[] {
  const huecos: HuecoDeSiembra[] = [];

  if (tiposRecurrentes.length === 0) {
    huecos.push({
      clase: "censo_vacio",
      detalle:
        "el censo de tipos recurrentes salio VACIO: o se dejaron de registrar recurrencias " +
        "(cada serie moriria tras su primera corrida) o la guardia dejo de leer donde se " +
        "registran.",
    });
  }
  if (tiposSembrados.length === 0) {
    huecos.push({
      clase: "censo_vacio",
      detalle:
        "el registro SIEMBRAS_RECURRENTES salio VACIO: no queda una sola siembra declarada.",
    });
  }

  const sembrados = new Set(tiposSembrados);
  const recurrentes = new Set(tiposRecurrentes);

  for (const tipo of tiposRecurrentes) {
    if (!sembrados.has(tipo)) {
      huecos.push({
        clase: "sin_siembra",
        tipo,
        detalle:
          `el tipo '${tipo}' tiene recurrencia registrada y NINGUNA siembra en ` +
          "SIEMBRAS_RECURRENTES. Un recurrente se re-agenda despues de cada corrida: sin la " +
          "primera fila la serie NUNCA arranca, y no falla nada — es exactamente lo que paso " +
          "el 2026-08-28.",
      });
    }
  }

  for (const tipo of tiposSembrados) {
    if (!recurrentes.has(tipo)) {
      huecos.push({
        clase: "siembra_huerfana",
        tipo,
        detalle:
          `hay siembra registrada para '${tipo}' pero ese tipo ya no esta en ` +
          "buildRecurrencias(): la fila sembrada correria UNA vez y la serie moriria ahi. Si " +
          "el tipo dejo de ser recurrente, retira tambien su siembra.",
      });
    }
  }

  return huecos;
}

/** Desenlace de sembrar un tipo. `creada = false` = ya estaba encolada (idempotente). */
export interface ResultadoSiembra {
  tipo: JobTipo;
  creada: boolean;
  runAfter: Date | null;
  dedupeKey: string | null;
}

/**
 * Siembra TODOS los tipos del registro con el mismo `now`. Recibe el repositorio por parametro
 * (patron de los seeds del repo): se puede ejercitar con un doble, sin conexion.
 */
export async function sembrarJobsRecurrentes(
  repo: IJobRepository,
  now: Date = new Date(),
): Promise<ResultadoSiembra[]> {
  const resultados: ResultadoSiembra[] = [];
  for (const siembra of SIEMBRAS_RECURRENTES) {
    const fila = await siembra.sembrar(repo, now);
    resultados.push({
      tipo: siembra.tipo,
      creada: fila !== null,
      runAfter: fila?.runAfter ?? null,
      dedupeKey: fila?.dedupeKey ?? null,
    });
  }
  return resultados;
}

/**
 * La misma siembra contra la base real. Es lo que invoca `scripts/migrate-deploy.ts` tras
 * aplicar las migraciones; se exporta con nombre propio para que ese enganche sea censable.
 */
export async function sembrarJobsRecurrentesEnBase(
  now: Date = new Date(),
): Promise<ResultadoSiembra[]> {
  const prisma = getPrismaClient();
  try {
    return await sembrarJobsRecurrentes(new JobRepository(prisma), now);
  } finally {
    await prisma.$disconnect();
  }
}

/** Linea de log de un resultado. Sin PII: solo tipo, instante y clave de deduplicacion. */
export function describirResultado(resultado: ResultadoSiembra): string {
  if (!resultado.creada) return `${resultado.tipo}: ya estaba encolada (idempotente, sin cambios).`;
  const runAfter = resultado.runAfter?.toISOString() ?? "-";
  return `${resultado.tipo}: fila sembrada (run_after=${runAfter}, dedupe_key=${resultado.dedupeKey ?? "-"}).`;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const resultados = await sembrarJobsRecurrentesEnBase();
  for (const resultado of resultados) {
    console.log(`Siembra ${describirResultado(resultado)}`);
  }
}

// Solo auto-ejecuta cuando este archivo es el entrypoint (no cuando un test lo importa).
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo la siembra de los jobs recurrentes:", error);
    process.exit(1);
  });
}
