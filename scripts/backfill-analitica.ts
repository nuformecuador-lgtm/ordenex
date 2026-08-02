import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { planificarBackfill, type PlanBackfill } from "@/lib/analytics/backfill-rango";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { IAnaliticaRollupService } from "@/lib/interfaces/services/IAnaliticaRollupService";
import type {
  EntradaPrevia,
  FallaFecha,
  LineaFecha,
  ModoBackfill,
  ResumenBackfill,
} from "@/lib/interfaces/services/IAnaliticaBackfillService";
import { AnaliticaBackfillService } from "@/lib/services/AnaliticaBackfillService";
import { buildAnaliticaRollupService } from "@/lib/services/jobs/analitica-rollup-diario-handler";

// Feature 125 (design §7, T3) — BACKFILL HISTORICO, script one-shot.
//
// Uso:
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/backfill-analitica.ts \
//        --desde YYYY-MM-DD --hasta YYYY-MM-DD [--reporte <ruta>] [--pausa-ms N] \
//        [--confirmar "<desde>..<hasta>"] [--verificar --contra <ruta>] [--verboso]
//
// Este script NO agrega nada y no tiene ni una consulta: pide cada fecha del rango al agregador
// de la feature 124 y se limita a validar argumentos, ecoar la corrida, construir las
// dependencias reales y delegar en `AnaliticaBackfillService`.
//
// A DIFERENCIA de `scripts/rollup-analitica-manual.ts`, aqui NO hay guarda de host: produccion
// es el destino LEGITIMO de esta herramienta (D8), que para eso existe. Lo que contiene el modo
// de fallo —recomputar el rango equivocado— es humano y son las dos guardas de abajo:
//   1. el ECO de la base y del rango ANTES de la primera invocacion (R27);
//   2. la REINTRODUCCION LITERAL del rango en `--confirmar` (R28).
// Sin `--confirmar` el script imprime el plan y se va sin tocar nada.
//
// `--verificar` **ESCRIBE**. No hay forma de recomputar sin escribir con el contrato de la 124 y
// no se va a anadir una: seria un segundo camino de calculo. Se dice en el eco (R26).

/* -------------------------------------------------------------------------- */
/* Entorno inyectable                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Todo lo que el script toca del mundo, inyectado. Es lo que permite ejercer el CLI entero en
 * test —argumentos, eco, confirmacion, reporte, codigos de salida— sin base de datos, sin
 * proceso hijo y sin escribir en disco de verdad.
 */
export interface EntornoCli {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ahora: () => Date;
  readonly salida: (linea: string) => void;
  readonly errores: (linea: string) => void;
  readonly leerArchivo: (ruta: string) => string;
  readonly escribirArchivo: (ruta: string, contenido: string) => void;
  /** Perezoso A PROPOSITO: mientras no se llame, no se abre ninguna conexion. */
  readonly crearRollup: () => IAnaliticaRollupService;
  readonly dormir: (ms: number) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Argumentos (zod en el borde)                                                */
/* -------------------------------------------------------------------------- */

const BANDERAS_SIN_VALOR = new Set(["verificar", "verboso"]);

/** Convierte `--clave valor` / `--bandera` en un objeto plano. No interpreta nada mas. */
function troceaArgumentos(argv: readonly string[]): Record<string, string | boolean> {
  const crudo: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      crudo[`_posicional_${i}`] = token;
      continue;
    }
    const clave = token.slice(2);
    if (BANDERAS_SIN_VALOR.has(clave)) {
      crudo[clave] = true;
      continue;
    }
    crudo[clave] = argv[i + 1] ?? "";
    i++;
  }
  return crudo;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * R6 — zod en el borde. `strict()` no es cosmetico: `--desdee 2026-07-01` sin el se leeria como
 * «falta --desde» y, peor, un `--pausams` mal escrito pasaria por defecto 0 sin avisar.
 */
const esquemaArgumentos = z
  .object({
    desde: z.string().regex(FECHA, "se espera YYYY-MM-DD"),
    hasta: z.string().regex(FECHA, "se espera YYYY-MM-DD"),
    reporte: z.string().min(1).optional(),
    "pausa-ms": z.coerce.number().int().min(0).optional(),
    confirmar: z.string().min(1).optional(),
    verificar: z.boolean().optional(),
    contra: z.string().min(1).optional(),
    verboso: z.boolean().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Reporte de corrida (R19) — tambien entrada externa, tambien con zod          */
/* -------------------------------------------------------------------------- */

const CLASIFICACIONES = ["procesada", "no_comparable", "fallida", "estable", "cambiada"] as const;

const esquemaEntradaReporte = z.object({
  fecha: z.string().regex(FECHA),
  filasEscritas: z.number().int(),
  filasRetiradas: z.number().int(),
  ms: z.number().int(),
  clasificacion: z.enum(CLASIFICACIONES),
});

/**
 * El reporte es JSON y NO lleva ni un identificador: fechas, conteos y clasificacion. Es a la
 * vez la evidencia de la corrida y la linea base de `--verificar`. `strict()` porque un reporte
 * con campos de mas es un reporte de otra cosa.
 */
const esquemaReporte = z
  .object({
    rango: z.object({ desde: z.string().regex(FECHA), hasta: z.string().regex(FECHA) }).strict(),
    modo: z.enum(["escritura", "verificacion"]),
    instante: z.string(),
    entradas: z.array(esquemaEntradaReporte),
  })
  .strict();

type Reporte = z.infer<typeof esquemaReporte>;

/* -------------------------------------------------------------------------- */
/* Eco de la corrida (R27/R29)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * R27/R29 — `host:puerto/base` de `DATABASE_URL`, **sin usuario y sin contrasena**. Se
 * reconstruye con `new URL(...)` (patron de `esDestinoLocalOrdenex`, feature 124) en vez de
 * recortar la cadena a mano: cualquier recorte textual acaba imprimiendo la credencial el dia
 * que la URL trae un `@` en la contrasena.
 */
export function destinoLegible(url: string | undefined): string | null {
  if (url === undefined || url === "") return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const puerto = u.port === "" ? "5432" : u.port;
    const base = u.pathname.replace(/^\//, "");
    if (host === "" || base === "") return null;
    return `${host}:${puerto}/${base}`;
  } catch {
    // Una URL ilegible no se imprime NUNCA cruda: podria llevar la credencial dentro.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* El CLI                                                                      */
/* -------------------------------------------------------------------------- */

/** R7/R24/R28 — todo lo que aborta ANTES de invocar el agregador sale con este codigo. */
const CODIGO_ARGUMENTOS = 1;

/**
 * Ejecuta el CLI completo y devuelve el codigo de salida. NO llama a `process.exit`: eso es
 * cosa de `main()`, para que el test pueda comprobar el codigo sin matar al runner.
 */
export async function ejecutarBackfillCli(entorno: EntornoCli): Promise<number> {
  const parseo = esquemaArgumentos.safeParse(troceaArgumentos(entorno.argv));
  if (!parseo.success) {
    entorno.errores(
      "ARGUMENTOS INVALIDOS: " +
        parseo.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join(" | "),
    );
    entorno.errores(
      "Uso: --desde YYYY-MM-DD --hasta YYYY-MM-DD [--reporte <ruta>] [--pausa-ms N] " +
        '[--confirmar "<desde>..<hasta>"] [--verificar --contra <ruta>] [--verboso]. ' +
        "El rango es OBLIGATORIO y explicito: no existe «toda la base».",
    );
    return CODIGO_ARGUMENTOS;
  }
  const args = parseo.data;
  const modo: ModoBackfill = args.verificar === true ? "verificacion" : "escritura";

  // R7/R10 — el rango se valida ENTERO antes de nada; es puro y no abre conexion.
  const resultadoPlan = planificarBackfill({
    desde: args.desde,
    hasta: args.hasta,
    ahora: entorno.ahora(),
  });
  if (!resultadoPlan.ok) {
    entorno.errores(`RANGO RECHAZADO: ${resultadoPlan.motivo}`);
    return CODIGO_ARGUMENTOS;
  }
  const plan = resultadoPlan.plan;

  // R24 — la linea base de la verificacion se carga y se valida ANTES de invocar al agregador.
  let previo: ReadonlyMap<string, EntradaPrevia> | undefined;
  if (modo === "verificacion") {
    const cargado = cargarReportePrevio(entorno, args.contra, plan);
    if (typeof cargado === "string") {
      entorno.errores(`VERIFICACION IMPOSIBLE: ${cargado}`);
      return CODIGO_ARGUMENTOS;
    }
    previo = cargado;
  }

  // R27 — el eco, siempre, antes de la primera invocacion.
  const destino = destinoLegible(entorno.env.DATABASE_URL);
  if (destino === null) {
    entorno.errores(
      "ABORTA: DATABASE_URL no esta definida o no es una URL legible. Este script se corre con " +
        "la variable exportada a mano (D8); no hay ninguna URL escrita en el codigo.",
    );
    return CODIGO_ARGUMENTOS;
  }
  for (const linea of ecoDeLaCorrida(destino, modo, plan, args["pausa-ms"] ?? 0)) {
    entorno.salida(linea);
  }

  // R28 — sin confirmacion se imprime el plan y NO se invoca el agregador ni una vez.
  if (args.confirmar === undefined) {
    entorno.salida(
      `PLAN: ${plan.fechas.length} fechas, de ${plan.fechas[0]} a ${plan.fechas[plan.fechas.length - 1]}.`,
    );
    entorno.salida(
      `Ensayo: no se ha invocado el agregador. Para ejecutar de verdad, repite con ` +
        `--confirmar "${plan.desde}..${plan.hasta}".`,
    );
    return 0;
  }
  const esperado = `${plan.desde}..${plan.hasta}`;
  if (args.confirmar !== esperado) {
    entorno.errores(
      `CONFIRMACION NO COINCIDE: el eco dice "${esperado}" y se reintrodujo "${args.confirmar}". ` +
        "No se ha invocado el agregador. Reintroducir el rango a mano es la guarda contra " +
        "recomputar el rango equivocado: si no coincide, es que uno de los dos esta mal.",
    );
    return CODIGO_ARGUMENTOS;
  }

  const entradas: LineaFecha[] = [];
  const servicio = new AnaliticaBackfillService(entorno.crearRollup(), {
    now: entorno.ahora,
    dormir: entorno.dormir,
    progreso: {
      linea: (linea) => {
        entradas.push(linea);
        entorno.salida(
          `${linea.fecha}  filasEscritas=${linea.filasEscritas} ` +
            `filasRetiradas=${linea.filasRetiradas} ms=${linea.ms} [${linea.clasificacion}]`,
        );
      },
      falla: (falla) => entorno.errores(textoDeLaFalla(falla, args.verboso === true)),
      aviso: (mensaje) => entorno.errores(mensaje),
    },
  });

  const resumen = await servicio.ejecutar({
    plan,
    modo,
    pausaMs: args["pausa-ms"],
    previo,
  });

  if (args.reporte !== undefined) {
    escribirReporte(entorno, args.reporte, plan, modo, entradas);
    entorno.salida(`Reporte de corrida escrito en ${args.reporte}`);
  }
  for (const linea of textoDelResumen(resumen)) entorno.salida(linea);
  return resumen.codigoSalida;
}

/** R27 — las siete cosas que el operador tiene que poder leer ANTES de confirmar. */
function ecoDeLaCorrida(
  destino: string,
  modo: ModoBackfill,
  plan: PlanBackfill,
  pausaMs: number,
): string[] {
  const lineas = [
    `Base de destino: ${destino}`,
    `Modo: ${modo}`,
    `Rango: ${plan.desde} .. ${plan.hasta}`,
    `Fechas: ${plan.fechas.length} (no comparables: ${plan.noComparables.length})`,
    `Pausa entre fechas: ${pausaMs} ms`,
  ];
  if (plan.noComparables.length > 0) {
    lineas.push(
      `AVISO: ${plan.noComparables.length} fechas son anteriores al horizonte del historial y ` +
        "van a terminar con exito y CERO filas en TODAS las medidas. No es que esos dias no " +
        "tuvieran actividad: es que no se puede saber. Se etiquetan no_comparable.",
    );
  }
  if (modo === "verificacion") {
    // R26 — se dice con todas las letras, y no se anuncia como modo de solo lectura.
    lineas.push(
      "AVISO: --verificar ESCRIBE. Recomputa cada fecha con el agregador de la 124, que es la " +
        "unica forma de saber si lo escrito sigue siendo lo que la fuente viva produce. La " +
        "escritura es idempotente, asi que sobre una base estable no cambia mas que updated_at.",
    );
  }
  return lineas;
}

/**
 * R24 — carga la linea base o devuelve el motivo por el que no se puede verificar. Que el
 * reporte sea OBLIGATORIO es la diferencia entre verificar y aparentar verificarlo: sin linea
 * base, una fecha nunca escrita daria `filasRetiradas === 0` y se leeria como estable.
 */
function cargarReportePrevio(
  entorno: EntornoCli,
  ruta: string | undefined,
  plan: PlanBackfill,
): ReadonlyMap<string, EntradaPrevia> | string {
  if (ruta === undefined) {
    return "--verificar exige --contra <reporte.json> de una corrida anterior. Sin linea base no " +
      "se puede decir «estable»: una fecha que nunca se escribio daria cero retiradas y pasaria " +
      "por buena.";
  }
  let crudo: string;
  try {
    crudo = entorno.leerArchivo(ruta);
  } catch (error) {
    return `no se pudo leer el reporte previo ${ruta}: ${error instanceof Error ? error.name : "error"}`;
  }
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    return `el reporte previo ${ruta} no es JSON valido`;
  }
  const parseado = esquemaReporte.safeParse(json);
  if (!parseado.success) {
    return `el reporte previo ${ruta} no tiene la forma esperada: ${parseado.error.issues
      .map((i) => i.path.join("."))
      .join(", ")}`;
  }
  const porFecha = new Map<string, EntradaPrevia>(
    parseado.data.entradas.map((e) => [e.fecha, { fecha: e.fecha, filasEscritas: e.filasEscritas }]),
  );
  const faltan = plan.fechas.filter((f) => !porFecha.has(f));
  if (faltan.length > 0) {
    return (
      `el reporte previo ${ruta} no cubre el rango pedido: le faltan ${faltan.length} fechas ` +
      `(la primera, ${faltan[0]}). Verifica el mismo rango que escribiste, o vuelve a escribirlo.`
    );
  }
  return porFecha;
}

/** R19 — el reporte, con su cabecera y una entrada por fecha. Sin un solo identificador. */
function escribirReporte(
  entorno: EntornoCli,
  ruta: string,
  plan: PlanBackfill,
  modo: ModoBackfill,
  entradas: readonly LineaFecha[],
): void {
  const reporte: Reporte = {
    rango: { desde: plan.desde, hasta: plan.hasta },
    modo,
    instante: entorno.ahora().toISOString(),
    entradas: entradas.map((e) => ({
      fecha: e.fecha,
      filasEscritas: e.filasEscritas,
      filasRetiradas: e.filasRetiradas,
      ms: e.ms,
      clasificacion: e.clasificacion,
    })),
  };
  entorno.escribirArchivo(ruta, `${JSON.stringify(reporte, null, 2)}\n`);
}

/**
 * R30 — por defecto, fecha + nombre del error + etapa. NO el mensaje crudo: el de
 * `PrimerIntentoIncoherenteError` lleva dentro la clave del cubo (ids de catalogo), y esa es la
 * unica via por la que un id puede llegar al log de esta feature. `--verboso` lo imprime entero,
 * y no se activa por defecto ni por omision de ningun otro argumento.
 */
function textoDeLaFalla(falla: FallaFecha, verboso: boolean): string {
  const etapa = falla.etapa === undefined ? "" : ` etapa=${falla.etapa}`;
  const cabecera = `${falla.fecha}  FALLIDA  error=${falla.nombreError}${etapa} modo=${falla.modo}`;
  if (!verboso) return `${cabecera} (usa --verboso para el error completo)`;
  const detalle = falla.error instanceof Error ? (falla.error.stack ?? falla.error.message) : String(falla.error);
  const causa = falla.error instanceof Error && falla.error.cause !== undefined ? `\n  causa: ${String(falla.error.cause)}` : "";
  return `${cabecera}\n  ${detalle}${causa}`;
}

/** R18 — el resumen final, con las fechas fallidas por su nombre (R31). */
function textoDelResumen(r: ResumenBackfill): string[] {
  const lineas = [
    "----- resumen de la corrida -----",
    `Rango: ${r.desde} .. ${r.hasta} (modo ${r.modo})`,
    `Fechas del rango: ${r.fechasDelRango} | procesadas: ${r.procesadas} | fallidas: ${r.fallidas} | ` +
      `no comparables: ${r.noComparables} | sin procesar: ${r.sinProcesar}`,
    `Filas escritas: ${r.filasEscritas} | filas retiradas: ${r.filasRetiradas} | duracion: ${r.ms} ms`,
  ];
  if (r.modo === "verificacion") {
    lineas.push(`Estables: ${r.estables} | cambiadas: ${r.cambiadas}`);
  }
  if (r.fechasFallidas.length > 0) {
    lineas.push(`Fechas FALLIDAS: ${r.fechasFallidas.join(", ")}`);
    lineas.push(
      "La operacion es idempotente: vuelve a correr SOLO ese subrango cuando sepas por que fallo.",
    );
  }
  lineas.push(`Codigo de salida: ${r.codigoSalida}`);
  return lineas;
}

/* -------------------------------------------------------------------------- */
/* Entrypoint                                                                  */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables ya presentes en process.env
  }

  const prisma = getPrismaClient();
  try {
    const codigo = await ejecutarBackfillCli({
      argv: process.argv.slice(2),
      env: process.env,
      ahora: () => new Date(),
      salida: (linea) => console.log(linea),
      errores: (linea) => console.error(linea),
      leerArchivo: (ruta) => fs.readFileSync(ruta, "utf8"),
      escribirArchivo: (ruta, contenido) => fs.writeFileSync(ruta, contenido, "utf8"),
      crearRollup: () => buildAnaliticaRollupService(() => new Date()),
      dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
    });
    process.exitCode = codigo;
  } finally {
    await prisma.$disconnect();
  }
}

// R1 — solo se auto-ejecuta como entrypoint del proceso: importarlo desde un test no ejecuta
// nada (patron de `scripts/rollup-analitica-manual.ts`).
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    // El contexto (fecha, etapa) viaja dentro del error de la 124; aqui solo se sale con != 0.
    console.error("Fallo el backfill:", error);
    process.exit(1);
  });
}
