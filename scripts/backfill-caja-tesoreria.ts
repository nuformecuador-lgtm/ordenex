import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type {
  ICajaBackfillTesoreriaService,
  InformeBackfillCaja,
  ModoBackfillCaja,
  OrigenBackfillCaja,
} from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { CajaBackfillTesoreriaService } from "@/lib/services/CajaBackfillTesoreriaService";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";

// Feature 173 / T E.2 (design §6.3, R40/R43/R44) — REGISTRO RETROACTIVO de la caja en modo
// tesoreria, ejecutable a mano UNA vez por entorno.
//
// Uso:
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/backfill-caja-tesoreria.ts \
//        [--simular | --aplicar | --comprobar]
//
// **Sin flag no escribe nada**: el modo por defecto es `--simular`. Escribir en un libro de
// dinero append-only exige un flag explicito y un informe leido antes por un humano, que es el
// modo de fallo que `[P3]` = (a) acepta a cambio de no meter filas de dinero sin revisar dentro
// de una migracion (design §6.4).
//
//   --simular   (defecto) dice cuantas filas insertaria, de que categoria y por que monto. No
//               escribe. Codigo de salida 0 siempre: es una vista previa, no un veredicto.
//   --aplicar   inserta lo que falta, idempotente por el indice unico parcial de la caja.
//   --comprobar NOMBRA los cierres, pagos y anulaciones sin su movimiento de caja (R43) y sale
//               con codigo != 0 mientras quede uno (R44). Es lo que convierte «se me olvido
//               correrlo en preview» en un fallo visible en vez de un numero que miente.
//
// Este script no consulta nada ni deriva ningun importe: valida argumentos, ecoa la corrida,
// construye las dependencias reales y le pide el informe a `CajaBackfillTesoreriaService`.

/* -------------------------------------------------------------------------- */
/* Entorno inyectable                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Todo lo que el script toca del mundo, inyectado. Es lo que permite ejercer el CLI entero en
 * test —argumentos, eco, modos, salida y codigos— sin base de datos y sin proceso hijo.
 */
export interface EntornoBackfillCaja {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly salida: (linea: string) => void;
  readonly errores: (linea: string) => void;
  /** Perezoso A PROPOSITO: mientras no se llame, no se abre ninguna conexion. */
  readonly crearServicio: () => ICajaBackfillTesoreriaService;
}

/* -------------------------------------------------------------------------- */
/* Argumentos (zod en el borde)                                                */
/* -------------------------------------------------------------------------- */

/**
 * `strict()` no es cosmetico aqui: sin el, `--aplcar` (con la errata) se leeria como «ningun
 * flag» y el script diria «simulacion» — que es benigno— pero `--simular --aplicar` juntos
 * dejarian la decision a un orden de evaluacion. Los dos casos se rechazan en alto.
 */
const esquemaArgumentos = z
  .object({
    simular: z.boolean().optional(),
    aplicar: z.boolean().optional(),
    comprobar: z.boolean().optional(),
  })
  .strict();

/** Convierte `--bandera` en un objeto plano. No hay ningun argumento con valor. */
function troceaArgumentos(argv: readonly string[]): Record<string, boolean | string> {
  const crudo: Record<string, boolean | string> = {};
  for (const token of argv) {
    if (token.startsWith("--")) crudo[token.slice(2)] = true;
    else crudo[token] = token; // posicional: `strict()` lo rechaza, que es lo que se quiere
  }
  return crudo;
}

const USO =
  "Uso: scripts/backfill-caja-tesoreria.ts [--simular | --aplicar | --comprobar]. " +
  "Sin flag se SIMULA: escribir exige --aplicar.";

/* -------------------------------------------------------------------------- */
/* Eco de la corrida                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `host:puerto/base` de `DATABASE_URL`, **sin usuario y sin contrasena**. Se reconstruye con
 * `new URL(...)` en vez de recortar la cadena: cualquier recorte textual acaba imprimiendo la
 * credencial el dia que la contrasena lleva un `@` dentro.
 *
 * Es la misma idea que `scripts/backfill-analitica.ts` resuelve para si mismo. No se importa de
 * alli a proposito: aquel modulo es de la feature 125 y su guardia estructural exige que la
 * lista de quienes lo importan este censada. Un backfill de otra feature no tiene por que
 * entrar en ese censo, y quince lineas sin logica de dinero no son la duplicacion que importa.
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

/** Todo lo que aborta ANTES de invocar el servicio sale con este codigo. */
export const CODIGO_ARGUMENTOS = 1;
/** R44 — `--comprobar` con algo pendiente NO puede salir en 0: el entorno no esta al dia. */
export const CODIGO_PENDIENTES = 2;

const ETIQUETA_ORIGEN: Record<OrigenBackfillCaja, string> = {
  cierre_aprobado: "cierres aprobados",
  pago_a_tienda: "pagos a tienda",
  anulacion_de_pago_a_tienda: "anulaciones de pago a tienda",
};

/**
 * Ejecuta el CLI completo y devuelve el codigo de salida. NO llama a `process.exit`: eso es
 * cosa de `main()`, para que el test pueda comprobar el codigo sin matar al runner.
 */
export async function ejecutarBackfillCajaCli(entorno: EntornoBackfillCaja): Promise<number> {
  const parseo = esquemaArgumentos.safeParse(troceaArgumentos(entorno.argv));
  if (!parseo.success) {
    entorno.errores(
      "ARGUMENTOS INVALIDOS: " +
        parseo.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join(" | "),
    );
    entorno.errores(USO);
    return CODIGO_ARGUMENTOS;
  }

  const pedidos = (["simular", "aplicar", "comprobar"] as const).filter(
    (m) => parseo.data[m] === true,
  );
  if (pedidos.length > 1) {
    entorno.errores(
      `MODOS INCOMPATIBLES: se pidieron ${pedidos.map((m) => `--${m}`).join(" y ")}. ` +
        "Elige uno; no se ha tocado la base.",
    );
    entorno.errores(USO);
    return CODIGO_ARGUMENTOS;
  }
  // Sin flag, `simular`. El defecto es el modo que NO escribe.
  const modo: ModoBackfillCaja = pedidos[0] ?? "simular";

  const destino = destinoLegible(entorno.env.DATABASE_URL);
  if (destino === null) {
    entorno.errores(
      "ABORTA: DATABASE_URL no esta definida o no es una URL legible. Este script se corre con " +
        "la variable exportada a mano, una vez por entorno; no hay ninguna URL escrita en el codigo.",
    );
    return CODIGO_ARGUMENTOS;
  }

  entorno.salida(`Base de destino: ${destino}`);
  entorno.salida(`Modo: ${modo}${modo === "simular" ? " (por defecto: NO escribe)" : ""}`);

  const informe = await entorno.crearServicio().ejecutar(modo);
  for (const linea of textoDelInforme(informe)) entorno.salida(linea);

  // R44: mientras quede uno, `--comprobar` no puede salir en 0. El codigo distinto de 0 es lo
  // que hace que un olvido se vea en el entorno, y no solo en la pantalla de quien lo corrio.
  if (modo === "comprobar" && !informe.alDia) return CODIGO_PENDIENTES;
  return 0;
}

/**
 * El informe entero. **La frase «al dia» se emite en UNA sola rama** —la de `alDia === true`—
 * para que R44 sea comprobable barriendo la salida: mientras quede un documento pendiente, esas
 * palabras no aparecen en ningun sitio, ni siquiera negadas.
 */
function textoDelInforme(informe: InformeBackfillCaja): string[] {
  const lineas = [
    `Instante de la corrida: ${informe.instante} (metadato: NINGUNA fila se fecha con el)`,
    "----- documentos examinados -----",
  ];
  for (const [origen, etiqueta] of Object.entries(ETIQUETA_ORIGEN) as [
    OrigenBackfillCaja,
    string,
  ][]) {
    lineas.push(`${etiqueta}: ${informe.examinados[origen]}`);
  }

  lineas.push("----- filas de caja que faltan -----");
  if (informe.porCategoria.length === 0) {
    lineas.push("ninguna");
  }
  for (const r of informe.porCategoria) {
    lineas.push(`${r.tipo} / ${r.categoria}: filas=${r.filas} monto total=${r.montoTotal}`);
  }

  // R43 — se NOMBRAN, uno a uno. Un conteo no sirve para ir a mirar que paso con cada uno.
  if (informe.pendientes.length > 0) {
    lineas.push(`----- sin movimiento de caja (${informe.pendientes.length}) -----`);
    for (const p of informe.pendientes) {
      lineas.push(
        `${p.origen} ${p.documentoId} -> ${p.movimiento.tipo}/${p.movimiento.categoria} ` +
          `${p.movimiento.monto} fecha=${p.movimiento.fechaMovimiento?.toISOString() ?? "(sin fecha)"}`,
      );
    }
  }

  lineas.push("----- resultado -----");
  if (informe.modo === "aplicar") {
    lineas.push(`Filas insertadas: ${informe.insertadas}`);
    lineas.push(
      "La operacion es idempotente: volver a correrla inserta 0. Corre ahora --comprobar.",
    );
  } else {
    lineas.push(`Filas insertadas: ${informe.insertadas} (este modo NO escribe)`);
  }

  if (informe.alDia) {
    lineas.push("AL DIA: los tres origenes tienen su movimiento de caja. No falta ninguno.");
  } else if (informe.modo === "comprobar") {
    lineas.push(
      `PENDIENTE: quedan ${informe.pendientes.length} documentos sin su movimiento de caja. ` +
        "Corre este mismo script con --aplicar.",
    );
  } else if (informe.modo === "simular") {
    lineas.push(
      `SIMULACION: se insertarian ${informe.pendientes.length} filas y no se ha escrito nada. ` +
        "Revisa el detalle de arriba y, si cuadra, repite con --aplicar.",
    );
  } else {
    lineas.push(
      `Quedan ${informe.pendientes.length} documentos por registrar respecto a la lectura previa.`,
    );
  }
  return lineas;
}

/* -------------------------------------------------------------------------- */
/* Entrypoint                                                                  */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  // Sin `try/catch`: un `.env` que existe y no se puede leer tiene que ser RUIDOSO. Si no hay
  // `.env`, se usan las variables ya presentes en `process.env`, que es como se corre esto
  // contra los entornos desplegados.
  if (fs.existsSync(".env")) process.loadEnvFile();

  const prisma = getPrismaClient();
  try {
    const codigo = await ejecutarBackfillCajaCli({
      argv: process.argv.slice(2),
      env: process.env,
      salida: (linea) => console.log(linea),
      errores: (linea) => console.error(linea),
      crearServicio: () =>
        new CajaBackfillTesoreriaService({
          cliente: prisma,
          codFeed: new CajaCodFeedService(),
          crearPuertoDePago: (repo) => new CajaPagoTiendaFeedService(repo),
          cajaRepo: new WalletMovimientoRepository(prisma),
          ahora: () => new Date(),
        }),
    });
    process.exitCode = codigo;
  } finally {
    await prisma.$disconnect();
  }
}

// Solo se auto-ejecuta como entrypoint del proceso: importarlo desde un test no ejecuta nada
// (patron de `scripts/backfill-analitica.ts` y `scripts/rollup-analitica-manual.ts`).
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error("Fallo el registro retroactivo de la caja:", error);
    process.exit(1);
  });
}
