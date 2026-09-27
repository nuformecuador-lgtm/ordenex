// ⭑ FICHA 429 (paso 2 de 3 de la siembra) — RELLENA EL SINPE DE LAS BODEGAS QUE ESTAN EN NULL.
//
// ═════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE ESTE SCRIPT EXISTE, EN UNA FRASE
// ═════════════════════════════════════════════════════════════════════════════════════════════
// Porque ESTE REPOSITORIO ES PUBLICO. El `design.md` de la ficha proponia sembrar el numero y el
// titular como LITERALES dentro de `migration.sql`; el leader lo veto el 2026-09-15: eso publica
// en internet, de forma PERMANENTE, un movil real de Costa Rica y el nombre de una persona —
// quitarlo despues no sirve, `git` conserva la historia. Asi que el valor se queda donde ya vive,
// en el ENTORNO del despliegue, y este script lo mueve a la base UNA vez.
//
// ⚠️ ESTE ES EL UNICO ARCHIVO DEL ARBOL AL QUE SE LE PERMITE NOMBRAR ESAS DOS VARIABLES, y esta
// declarado como tal —con su motivo— en la allowlist de
// `tests/unit/guards/sinpe-sin-variables-de-entorno.guardia.test.ts` (R17). La aplicacion NO las
// lee en ningun punto: las lee el TRASVASE, una vez, y despues dejan de significar nada. La
// excepcion se escribe a la vista en vez de disfrazar el literal para esquivar la guardia: una
// guardia que se puede burlar concatenando cadenas no vigila nada.
//
// ORDEN DE DESPLIEGUE (no es opcional):
//   1. `20260918120100_zona_sinpe`             — columnas NULLABLES;
//   2. ESTE SCRIPT;
//   3. `20260918120200_zona_sinpe_no_nulo`     — `NOT NULL` + los dos `CHECK`.
// El paso 3 aborta con un mensaje que nombra este archivo si el 2 no ha corrido.
//
// ES IDEMPOTENTE, Y EN UN SENTIDO ESTRECHO: solo escribe en las zonas cuyo `sinpe_numero` o
// `sinpe_nombre` este en NULL. NUNCA pisa un valor ya puesto — ni el sembrado, ni (sobre todo) el
// que una persona haya corregido desde la aplicacion. Correrlo dos veces no cambia nada la segunda.
//
// NO TOCA `sinpe_revisado_at`. Se queda en NULL A PROPOSITO (R10): esto es una semilla, nadie la
// ha mirado, y ese NULL es lo que dispara la revision obligatoria del primer inicio de sesion
// (R26). Marcarla aqui convertiria la tercera capa de D3 en un adorno.
//
// FALLA RUIDOSAMENTE, y en las tres formas en que puede fallar:
//   · falta alguna de las dos variables      → `exit 1` diciendo cual;
//   · el numero no cumple el formato de R7   → `exit 1` diciendo que se espera (y NO escribe nada);
//   · el titular esta vacio o pasa del ancho → `exit 1`.
// Un seed de dinero que se salta en silencio lo que no entiende es la familia de fallo que esta
// ficha entera persigue.
//
// ⚠️ NUNCA IMPRIME EL VALOR, ni siquiera al fallar: imprime CONTEOS y el nombre de la variable. El
// log de un build de Vercel se conserva.
//
// USO:  pnpm exec tsx scripts/seed-sinpe-inicial.ts
import { pathToFileURL } from "node:url";

import type { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  MSG_SINPE_NUMERO_INVALIDO,
  SINPE_NOMBRE_MAX_CHARS,
  esSinpeNumeroValido,
  normalizarSinpeNumero,
} from "@/lib/utils/sinpe-cr";

const PREFIJO = "[sinpe]";

/** Las dos variables de entorno de las que sale la semilla. Ver la allowlist de R17 arriba. */
export const ENV_NUMERO = "NEXT_PUBLIC_SINPE_NUMERO";
export const ENV_NOMBRE = "NEXT_PUBLIC_SINPE_NOMBRE";

export type SemillaSinpe =
  | { ok: true; numero: string; nombre: string }
  | { ok: false; motivo: string };

/**
 * Lee y VALIDA la semilla del entorno. Funcion pura (recibe el entorno) para poder probarla sin
 * tocar `process.env` ni la base.
 *
 * ⚠️ La validacion es la MISMA de `lib/utils/sinpe-cr.ts`, no una copia relajada: un seed es
 * exactamente uno de los escritores que entran por debajo de zod, y por eso el `CHECK` de la base
 * existe. Que aqui tambien se valide no es redundancia inutil — es lo que convierte un fallo de
 * Postgres sin contexto en un mensaje que dice QUE variable arreglar.
 */
export function leerSemilla(env: NodeJS.ProcessEnv): SemillaSinpe {
  const numeroCrudo = env[ENV_NUMERO]?.trim() ?? "";
  const nombreCrudo = env[ENV_NOMBRE]?.trim() ?? "";
  if (numeroCrudo === "") return { ok: false, motivo: `falta ${ENV_NUMERO} en el entorno` };
  if (nombreCrudo === "") return { ok: false, motivo: `falta ${ENV_NOMBRE} en el entorno` };

  const numero = normalizarSinpeNumero(numeroCrudo);
  if (!esSinpeNumeroValido(numero)) {
    return { ok: false, motivo: `${ENV_NUMERO} no vale. ${MSG_SINPE_NUMERO_INVALIDO}` };
  }
  if (nombreCrudo.length > SINPE_NOMBRE_MAX_CHARS) {
    return {
      ok: false,
      motivo: `${ENV_NOMBRE} pasa de ${SINPE_NOMBRE_MAX_CHARS} caracteres, el ancho de la columna`,
    };
  }
  return { ok: true, numero, nombre: nombreCrudo };
}

export interface ResultadoSiembraSinpe {
  /** Cuantas bodegas estaban en NULL y se han rellenado. `0` en la segunda corrida. */
  rellenadas: number;
  /** Cuantas ya tenian valor y NO se han tocado. */
  intactas: number;
}

/**
 * LA ESCRITURA. El `WHERE … IS NULL` es lo que hace la idempotencia ESTRUCTURAL en vez de un `if`
 * que alguien pueda quitar: una bodega con valor no entra en el `where`, asi que no hay camino por
 * el que este script pise una correccion humana.
 *
 * ⚠️ POR QUE SQL CRUDO Y NO `zona.updateMany`. `db/schema.prisma` declara las dos columnas
 * `NOT NULL` —que es el estado FINAL, el del paso 3—, asi que el cliente de Prisma no admite
 * `sinpeNumero: null` ni en un `where`: «Argument `sinpeNumero`: Invalid value provided». Este
 * script corre EN LA VENTANA en la que la base todavia las tiene nullables, y esa ventana no es
 * representable en el modelo. Medido, no supuesto: con `updateMany` el script muere con un error
 * de validacion del cliente antes de tocar la base.
 *
 * Los dos valores viajan PARAMETRIZADOS (`$executeRaw`, no `Unsafe`): no entran en el texto del
 * SQL, asi que no aparecen en ningun log de consultas.
 */
export async function sembrarSinpeInicial(
  prisma: Pick<PrismaClient, "zona" | "$executeRaw">,
  semilla: { numero: string; nombre: string },
): Promise<ResultadoSiembraSinpe> {
  const total = await prisma.zona.count();
  const rellenadas = await prisma.$executeRaw`
    UPDATE "zona" SET "sinpe_numero" = ${semilla.numero}, "sinpe_nombre" = ${semilla.nombre}
     WHERE "sinpe_numero" IS NULL OR "sinpe_nombre" IS NULL`;
  return { rellenadas, intactas: total - rellenadas };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin `.env`: se usan las variables ya presentes en `process.env` (el caso del despliegue)
  }

  const semilla = leerSemilla(process.env);
  if (!semilla.ok) {
    console.error(`${PREFIJO} NO SE SIEMBRA NADA: ${semilla.motivo}`);
    console.error(
      `${PREFIJO} sin esto, \`20260918120200_zona_sinpe_no_nulo\` no se puede aplicar y las ` +
        `bodegas se quedan sin numero al que transferir.`,
    );
    process.exit(1);
  }

  const prisma = getPrismaClient();
  const r = await sembrarSinpeInicial(prisma, semilla);
  console.log(
    `${PREFIJO} ${r.rellenadas} bodega(s) sembradas, ${r.intactas} intactas ` +
      `(ya tenian valor: no se pisa lo que alguien corrigio).`,
  );
  console.log(
    `${PREFIJO} \`sinpe_revisado_at\` se queda en NULL a proposito: nadie lo ha mirado todavia.`,
  );
  await prisma.$disconnect();
}

// Solo auto-ejecuta cuando este archivo es el entrypoint; nunca cuando un test lo importa.
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((causa: unknown) => {
    console.error(`${PREFIJO} la siembra aborto:`, causa);
    process.exit(1);
  });
}
