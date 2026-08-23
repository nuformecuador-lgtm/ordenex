/**
 * Feature 169 · T4.1 — BANCO DE PRUEBAS del buscador de ordenes (design §6).
 *
 * Por que existe: el humano pidio esta feature con un aviso expreso —"que no sea lenta por
 * una mala implementacion de consultas"—. Todo lo entregado hasta T3 ASUME que el indice
 * trigram funciona. Este script es lo unico que lo DEMUESTRA, y por eso su salida no es
 * "parece rapido" sino numeros y planes de ejecucion reales.
 *
 * Que hace, en orden:
 *   1) Siembra N ordenes (50 000 por defecto) con nombres CON y SIN tildes, telefonos CON y
 *      SIN separadores y remisiones variadas. Todas llevan el prefijo `BENCH169-` en
 *      `num_remision`: es la marca por la que se borran despues.
 *   2) `ANALYZE orden` (sin estadisticas frescas el planificador decide a ciegas y la
 *      medicion no vale nada).
 *   3) Corre los cinco escenarios del design §6 por el CAMINO REAL —`OrdenService.listar`
 *      con el repositorio de produccion—, no sobre una consulta suelta. De cada repeticion
 *      se toma: el reloj de pared del service, y la duracion que Postgres reporta para el
 *      `findMany` y para el `count` (capturadas del evento `query` de Prisma: son las
 *      consultas REALES que emite el repositorio, no una reescritura a mano).
 *   4) `EXPLAIN (ANALYZE, BUFFERS)` del SQL EXACTO que Prisma emitio, con sus parametros, y
 *      las dos aserciones de PLAN que cierran R31:
 *        · E2/E3 -> `Bitmap Index Scan on orden_busqueda_texto_trgm_idx` y NUNCA
 *          `Seq Scan on orden`.
 *        · E1    -> `Index Scan using orden_num_guia_key`.
 *   5) E5: coste de ESCRITURA del indice. Inserta 200 ordenes en tres estados del esquema
 *      (con columna+indice / solo columna / sin nada) y reporta el sobrecoste en %.
 *   6) Limpia: restaura el esquema y BORRA todas las filas sembradas. Siempre, incluso si
 *      algo revienta a mitad (bloque `finally`).
 *
 * COMO SE REPITE LA MEDICION:
 *   pnpm exec tsx scripts/bench-busqueda-ordenes.ts
 *   pnpm exec tsx scripts/bench-busqueda-ordenes.ts --filas=50000 --reps=10
 *   pnpm exec tsx scripts/bench-busqueda-ordenes.ts --solo-limpiar   # si quedo basura
 *
 * SEGURIDAD: se niega a correr contra una base que no sea local (siembra 50 000 filas y
 * dropea/recrea un indice). `--forzar` lo salta, y hay que escribirlo a mano.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import { OrdenRepository } from "../lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "../lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "../lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialService } from "../lib/services/OrdenHistorialService";
import { OrdenService } from "../lib/services/OrdenService";
import type { Actor } from "../lib/interfaces/services/IOrdenService";
import type { ListarOrdenesInput } from "../lib/types/orden";
import { PRISMA_OMIT } from "../lib/db/prisma-client";

// --- Constantes del banco ---------------------------------------------------------------

/** Marca de las filas sembradas. Es el criterio EXACTO de borrado: si cambia, cambia el DELETE. */
const MARCA = "BENCH169-";
/** Base de `num_guia` de la siembra: 8 digitos (E1 pide "8 digitos que existen") y muy lejos
 *  de las guias reales, que las genera `siguiente_num_guia()` en el rango de 6 digitos. */
const GUIA_BASE = 20_000_000;
/** 1 de cada 5 filas lleva "María" -> ~20 % del corpus. E3 necesita > 5 000 coincidencias. */
const CADA_MARIA = 5;
/** 1 de cada 833 lleva "Zúñiga" -> ~60 filas. E2 necesita < 100 coincidencias. */
const CADA_ZUNIGA = 833;
/** ESCALERA DE SELECTIVIDAD. El design solo pide E2 (<100) y E3 (>5000), pero entre esos dos
 *  extremos esta el punto donde el planificador deja de usar el indice y pasa a recorrer la
 *  tabla. Sin peldaños intermedios, el informe diria "el indice se usa / no se usa" sin decir
 *  DONDE esta la frontera, que es el unico dato accionable.
 *  Los modulos son PRIMOS entre si para que los solapes sean despreciables y cada peldaño
 *  tenga la cardinalidad que dice tener. */
/** 1 de cada N filas lleva una remision NUMERICA CON GUIONES (`BENCH169-2026-000021`) en vez
 *  del prefijo alfabetico. Existe por M1 del review: la remision se indexa TAL CUAL (a
 *  diferencia del telefono, que va tambien en su forma solo-digitos), asi que sin filas de
 *  esta forma el banco no puede medir el escenario que M1 arregla —ni el sobrecoste de
 *  buscar las dos formas—. Con 7 son ~14 % de la tabla, que da a la vez un termino MUY
 *  selectivo (una remision concreta) y uno amplio (`2026-0`). */
const CADA_REMISION_NUMERICA = 7;
const CADA_KOPPER = 251; // ~199 filas -> 0,4 % de la tabla
const CADA_LIZANO = 101; // ~495 filas -> 1,0 %
const CADA_BARQUERO = 47; // ~1 063 filas -> 2,1 %
const CADA_TREJOS = 17; // ~2 941 filas -> 5,9 %
/** `random_page_cost` de contraste: el default de Postgres es 4.0 (disco giratorio). Sobre SSD
 *  —y Supabase corre sobre SSD— lo habitual es 1.1, y ese parametro es EXACTAMENTE el que
 *  decide si un bitmap heap scan sale mas caro que recorrer la tabla. Medir los dos evita
 *  extrapolar de un portatil a produccion. */
const RPC_SSD = 1.1;
/** Repeticiones descartadas antes de medir (cargan paginas en shared_buffers). */
const CALENTAMIENTO = 3;
/** Filas por INSERT de la siembra. */
const LOTE_SIEMBRA = 10_000;
/** Ordenes por carga masiva simulada en E5. */
const FILAS_E5 = 200;
/** Repeticiones de cada brazo de E5. */
const REPS_E5 = 20;

const MIGRACION = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "20260731160000_orden_busqueda_trgm",
  "migration.sql",
);

// Nombres SIN tilde y CON tilde mezclados a proposito: el corpus tiene que ejercitar el
// plegado de acentos, no solo el LIKE. Ninguno contiene "maria" ni "zuniga": esas dos
// cadenas se inyectan aparte para que las cardinalidades de E2/E3 sean EXACTAS y conocidas.
const NOMBRES = [
  "Jose", "José", "Carlos", "Andrés", "Ana", "Luis", "Sofia", "Sofía", "Diego", "Karla",
  "Roberto", "Gabriel", "Valeria", "Esteban", "Natalia", "Fabián", "Ivannia", "Rodrigo",
  "Silvia", "Marco", "Wendy", "Alonso", "Priscilla",
];
const APELLIDOS = [
  "Rodriguez", "Rodríguez", "Hernandez", "Hernández", "Solis", "Solís", "Vargas", "Chaves",
  "Mora", "Jimenez", "Jiménez", "Araya", "Cordero", "Brenes", "Alfaro", "Quesada", "Rojas",
  "Sanchez", "Sánchez", "Camacho", "Villalobos", "Ulloa", "Fallas", "Segura", "Bogantes",
  "Céspedes", "Montero", "Picado", "Barrantes",
];
const PREFIJOS_REMISION = ["REM", "ORD", "GD", "TN", "PKG"];

// --- Utilidades -------------------------------------------------------------------------

interface Opciones {
  filas: number;
  reps: number;
  soloLimpiar: boolean;
  conservar: boolean;
  forzar: boolean;
}

function leerOpciones(): Opciones {
  const args = process.argv.slice(2);
  const num = (nombre: string, porDefecto: number): number => {
    const arg = args.find((a) => a.startsWith(`--${nombre}=`));
    if (!arg) return porDefecto;
    const v = Number.parseInt(arg.split("=")[1] ?? "", 10);
    return Number.isInteger(v) && v > 0 ? v : porDefecto;
  };
  return {
    filas: num("filas", 50_000),
    reps: num("reps", 10),
    soloLimpiar: args.includes("--solo-limpiar"),
    conservar: args.includes("--conservar"),
    forzar: args.includes("--forzar"),
  };
}

/** Percentil por RANGO MAS CERCANO (sin interpolar): p_k = ordenado[ceil(k/100 * n) - 1].
 *  Con n = 10, p95 es literalmente el PEOR de los diez. Es el criterio pesimista a proposito. */
function percentil(muestras: number[], k: number): number {
  if (muestras.length === 0) return Number.NaN;
  const orden = [...muestras].sort((a, b) => a - b);
  const i = Math.max(0, Math.ceil((k / 100) * orden.length) - 1);
  return orden[i];
}

const ms = (n: number): string => (Number.isNaN(n) ? "—" : n.toFixed(1));

function esLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Trocea un `.sql` en sentencias: quita comentarios de linea y parte por `;`. */
function sentenciasDe(sql: string): string[] {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// --- Captura del SQL real que emite Prisma ----------------------------------------------

interface EventoSql {
  query: string;
  params: string;
  duration: number;
}

class EspiaSql {
  private eventos: EventoSql[] = [];
  private grabando = false;

  registrar(e: EventoSql): void {
    if (this.grabando) this.eventos.push(e);
  }

  async medir<T>(fn: () => Promise<T>): Promise<{ valor: T; wall: number; sql: EventoSql[] }> {
    this.eventos = [];
    this.grabando = true;
    const t0 = performance.now();
    const valor = await fn();
    const wall = performance.now() - t0;
    // El evento `query` llega por callback: se cede el turno al event loop para no perder
    // el ultimo. Sin esto, la duracion del `count` se pierde en una de cada N corridas.
    await new Promise((r) => setTimeout(r, 5));
    this.grabando = false;
    return { valor, wall, sql: [...this.eventos] };
  }
}

const esFindManyDeOrden = (e: EventoSql): boolean =>
  e.query.includes('FROM "public"."orden"') && e.query.includes("LIMIT");
const esCountDeOrden = (e: EventoSql): boolean =>
  e.query.includes('COUNT(*)') && e.query.includes('FROM "public"."orden"');

// --- Escenarios -------------------------------------------------------------------------

interface Escenario {
  id: string;
  titulo: string;
  input: ListarOrdenesInput;
  /** Que se espera del plan. `null` = sin asercion (E4 comparte forma con E3). */
  planEsperado: "trigram" | "guia" | null;
  /** Peldaño de la escalera de selectividad: se informa, pero NO cuenta como fallo del
   *  contrato del design §6, que solo manda sobre E1, E2 y E3. */
  exploratorio?: boolean;
}

interface Medicion {
  escenario: Escenario;
  total: number;
  wall: number[];
  findMany: number[];
  count: number[];
  consultas: number;
  sqlFindMany?: EventoSql;
  sqlCount?: EventoSql;
  planFindMany: string;
  planCount: string;
  /** Solo si el plan por defecto recorrio la tabla: el plan con `enable_seqscan = off`.
   *  Sirve para distinguir "el indice NO SIRVE" (fallo real) de "el planificador prefirio
   *  recorrer porque le sale mas barato" (decision de coste, que hay que contrastar). */
  planForzado: string;
  /** Idem, con `random_page_cost = 1.1` (SSD) en vez del 4.0 por defecto: dice si el Seq Scan
   *  es una propiedad de la consulta o del hardware que el planificador cree tener debajo. */
  planSsd: string;
}

// --- Programa ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.loadEnvFile?.();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Falta DATABASE_URL. Este banco necesita un Postgres real.");
    process.exit(1);
  }
  const opciones = leerOpciones();
  if (!esLocal(url) && !opciones.forzar) {
    console.error(
      "ABORTA: DATABASE_URL no apunta a localhost.\n" +
        "Este script siembra decenas de miles de filas y DROPEA/RECREA el indice del buscador.\n" +
        "Si de verdad quieres correrlo contra esa base, pasa --forzar.",
    );
    process.exit(1);
  }

  const espia = new EspiaSql();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 4 }),
    // MISMO `omit` que produccion: sin el, el `findMany` traeria `busqueda_texto` y el SQL
    // medido no seria el que corre de verdad.
    omit: PRISMA_OMIT,
    log: [{ emit: "event", level: "query" }],
  });
  (prisma as unknown as { $on: (e: "query", cb: (v: EventoSql) => void) => void }).$on(
    "query",
    (e) => espia.registrar(e),
  );
  const cliente = prisma as unknown as PrismaClient;

  const crudo = (sql: string, ...p: unknown[]) => cliente.$executeRawUnsafe(sql, ...p);
  const consulta = <T>(sql: string, ...p: unknown[]) =>
    cliente.$queryRawUnsafe(sql, ...p) as Promise<T>;

  try {
    if (opciones.soloLimpiar) {
      await limpiar(cliente);
      return;
    }

    console.log(`\n=== Feature 169 · T4.1 — banco de busqueda de ordenes ===`);
    const [{ version }] = await consulta<{ version: string }[]>("SELECT version()");
    console.log(version);
    const ajustes = await consulta<Record<string, string>[]>(
      "SELECT current_setting('shared_buffers') sb, current_setting('work_mem') wm," +
        " current_setting('max_parallel_workers_per_gather') mp",
    );
    console.log(
      `shared_buffers=${ajustes[0].sb} work_mem=${ajustes[0].wm} parallel_workers=${ajustes[0].mp}`,
    );

    // 0) Estado de partida.
    await limpiar(cliente);
    const previas = await contarOrdenes(cliente);
    console.log(`Filas de \`orden\` antes de sembrar: ${previas}`);

    // 1) Siembra.
    await sembrar(cliente, opciones.filas);
    const tras = await contarOrdenes(cliente);
    console.log(`Filas de \`orden\` tras sembrar: ${tras} (+${tras - previas})`);
    console.log("ANALYZE orden ...");
    await crudo("ANALYZE orden");
    const tam = await consulta<{ tabla: string; indice: string }[]>(
      "SELECT pg_size_pretty(pg_relation_size('orden')) tabla," +
        " pg_size_pretty(pg_relation_size('orden_busqueda_texto_trgm_idx')) indice",
    );
    console.log(`Tamaño: tabla=${tam[0].tabla} indice_trgm=${tam[0].indice}`);

    // 2) Escenarios de LECTURA.
    const repo = new OrdenRepository(cliente);
    const service = new OrdenService(
      repo,
      new OrdenHistorialService(
        repo,
        new OrdenHistorialRepository(cliente),
        new OrdenDiaRepartoCambioRepository(cliente),
      ),
    );
    const actor: Actor = { usuarioId: "bench", rol: "maestro" };

    const hoy = new Date();
    const hace90 = new Date(hoy.getTime() - 90 * 24 * 3600 * 1000);
    const iso = (d: Date): string => d.toISOString().slice(0, 10);
    const estatusE4 = await consulta<{ estatus_id: string; n: bigint }[]>(
      `SELECT estatus_id, count(*) n FROM orden WHERE num_remision LIKE '${MARCA}%'` +
        " GROUP BY estatus_id ORDER BY n DESC LIMIT 1",
    );

    // --- Terminos de los escenarios de M1 (dos formas del mismo termino) ---
    // Se LEEN de la tabla en vez de calcularse: si la siembra cambiara, el banco mediria
    // igualmente terminos que existen de verdad, en vez de buscar cadenas inventadas.
    const remisiones = await consulta<{ num_remision: string }[]>(
      `SELECT num_remision FROM orden WHERE num_remision LIKE '${MARCA}2026-%'` +
        " ORDER BY num_remision DESC LIMIT 1",
    );
    const telefonos = await consulta<{ telefono_dest: string }[]>(
      `SELECT telefono_dest FROM orden WHERE num_remision LIKE '${MARCA}%'` +
        " AND telefono_dest LIKE '%-%' LIMIT 1",
    );
    // `2026-049994` (sin la marca): una remision concreta, tecleada tal como se lee.
    const terminoRemision = remisiones[0].num_remision.slice(MARCA.length);
    const terminoTelefono = telefonos[0].telefono_dest;
    /** Prefijo comun de TODAS las remisiones numericas: el caso poco selectivo de M1. */
    const TERMINO_M1_AMPLIO = "2026-0";

    // La evidencia de M1, en numeros y sobre 50 000 filas: cuantas filas encuentra el
    // termino TAL COMO SE ESCRIBE y cuantas su forma solo-digitos (que es lo unico que se
    // buscaba antes). La diferencia es exactamente el falso negativo que M1 describe.
    const soloDigitosRemision = terminoRemision.replace(/\D/g, "");
    const m1 = await consulta<{ tal_cual: number; solo_digitos: number }[]>(
      "SELECT (SELECT count(*)::int FROM orden WHERE busqueda_texto LIKE $1) tal_cual," +
        " (SELECT count(*)::int FROM orden WHERE busqueda_texto LIKE $2) solo_digitos",
      `%${terminoRemision}%`,
      `%${soloDigitosRemision}%`,
    );
    console.log(
      `\nM1 (falso negativo): '${terminoRemision}' tal cual = ${m1[0].tal_cual} fila(s);` +
        ` reducido a digitos ('${soloDigitosRemision}') = ${m1[0].solo_digitos} fila(s).`,
    );

    const base = { page: 1, pageSize: 25, sortBy: "created_at", sortDir: "desc" } as const;
    const escenarios: Escenario[] = [
      {
        id: "E1",
        titulo: "guia exacta (8 digitos que existen)",
        input: { ...base, filter: { q: String(GUIA_BASE + Math.floor(opciones.filas / 2)) } },
        planEsperado: "guia",
      },
      {
        id: "E2",
        titulo: "termino selectivo ('zuniga', < 100 coincidencias)",
        input: { ...base, filter: { q: "zuniga" } },
        planEsperado: "trigram",
      },
      {
        id: "E2a",
        titulo: "escalera: 'kopper' (~0,4 % de la tabla)",
        input: { ...base, filter: { q: "kopper" } },
        planEsperado: "trigram",
        exploratorio: true,
      },
      {
        id: "E2b",
        titulo: "escalera: 'lizano' (~1 % de la tabla)",
        input: { ...base, filter: { q: "lizano" } },
        planEsperado: "trigram",
        exploratorio: true,
      },
      {
        id: "E2c",
        titulo: "escalera: 'barquero' (~2 % de la tabla)",
        input: { ...base, filter: { q: "barquero" } },
        planEsperado: "trigram",
        exploratorio: true,
      },
      {
        id: "E2d",
        titulo: "escalera: 'trejos' (~6 % de la tabla)",
        input: { ...base, filter: { q: "trejos" } },
        planEsperado: "trigram",
        exploratorio: true,
      },
      {
        id: "E3",
        titulo: "termino amplio ('maria', > 5 000 coincidencias)",
        input: { ...base, filter: { q: "maria" } },
        planEsperado: "trigram",
      },
      {
        id: "E4",
        titulo: "termino amplio + estado + rango de fechas",
        input: {
          ...base,
          filter: {
            q: "maria",
            status_id: [estatusE4[0].estatus_id],
            created_desde: iso(hace90),
            created_hasta: iso(hoy),
          },
        },
        planEsperado: null,
      },
      // --- M1 del review: los escenarios de DOS formas -------------------------------
      // El termino con separadores viaja tal cual Y reducido a digitos, unidos por un `OR`
      // sobre la MISMA columna. Eso mete un segundo recorrido del trigram en el plan, y la
      // pregunta que hay que contestar con numeros —no con fe— es si el planificador sigue
      // eligiendo el indice y cuanto cuesta el segundo recorrido.
      {
        id: "E6",
        titulo: `M1: telefono con guion ('${terminoTelefono}', dos formas)`,
        input: { ...base, filter: { q: terminoTelefono } },
        planEsperado: "trigram",
      },
      {
        id: "E7",
        titulo: `M1: remision numerica con guiones ('${terminoRemision}', dos formas)`,
        input: { ...base, filter: { q: terminoRemision } },
        planEsperado: "trigram",
      },
      {
        id: "E8",
        titulo: `M1 poco selectivo: '${TERMINO_M1_AMPLIO}' (~14 % por la forma tal cual)`,
        input: { ...base, filter: { q: TERMINO_M1_AMPLIO } },
        planEsperado: "trigram",
        // Informativo, como los peldaños de la escalera: un termino que casa una de cada
        // siete filas puede legitimamente salirle mas barato a Postgres recorriendo la
        // tabla. Lo que importa es SABERLO y compararlo con E3 (mismo orden de magnitud de
        // coincidencias, una sola forma).
        exploratorio: true,
      },
    ];

    const correr = async (): Promise<Medicion[]> => {
      const salida: Medicion[] = [];
      for (const escenario of escenarios) {
        salida.push(await medirEscenario(espia, cliente, service, actor, escenario, opciones.reps));
      }
      return salida;
    };

    // 2a) Estado "RECIEN CARGADO": las entradas de indice de las 50 000 filas siguen en la
    //     PENDING LIST del GIN (`fastupdate`, el default). Es el estado REAL de produccion
    //     justo despues de una carga masiva, y no es un detalle: mientras la lista esta
    //     llena, cada busqueda la recorre entera Y el planificador infla el coste estimado
    //     del indice hasta abandonarlo. Se mide ANTES de vaciarla, no despues.
    console.log("\n########## ESTADO A: recien cargado (pending list del GIN sin vaciar)");
    const trasCarga = await correr();

    // 2b) Estado ESTACIONARIO: la pending list vaciada, que es donde autovacuum deja el
    //     indice al rato. Es el estado en el que vive el sistema el 99 % del tiempo.
    console.log("\n########## vaciando la pending list del GIN ...");
    const t0Flush = performance.now();
    await crudo("SELECT gin_clean_pending_list('orden_busqueda_texto_trgm_idx')");
    const msFlush = performance.now() - t0Flush;
    await crudo("ANALYZE orden");
    console.log(`   gin_clean_pending_list: ${msFlush.toFixed(0)} ms`);
    console.log("########## ESTADO B: estacionario (pending list vaciada)");
    const estacionario = await correr();

    // 3) E5 — coste de ESCRITURA.
    const e5 = await medirEscritura(cliente, crudo, consulta);

    // 4) Informe.
    imprimirInforme(estacionario, trasCarga, e5, opciones, tras, msFlush);
  } finally {
    if (!opciones.conservar) {
      await asegurarEsquema(cliente);
      await limpiar(cliente);
      // Borrar las filas NO devuelve el espacio: un GIN no encoge (reusa paginas libres, no
      // las devuelve al SO). Sin el REINDEX, el indice se queda en ~16 MB sobre una tabla de
      // 40 kB y la base de desarrollo arrastra el banco para siempre. `VACUUM` recupera las
      // tuplas muertas de la tabla, que son decenas de miles tras la siembra y los rollbacks.
      await cliente.$executeRawUnsafe("VACUUM (ANALYZE) orden");
      await cliente.$executeRawUnsafe('REINDEX INDEX "orden_busqueda_texto_trgm_idx"');
      const tam = (await cliente.$queryRawUnsafe(
        "SELECT count(*)::int filas, pg_size_pretty(pg_relation_size('orden')) tabla," +
          " pg_size_pretty(pg_relation_size('orden_busqueda_texto_trgm_idx')) idx FROM orden",
      )) as { filas: number; tabla: string; idx: string }[];
      console.log(
        `\nLimpieza terminada: ${tam[0].filas} filas, tabla=${tam[0].tabla}, indice=${tam[0].idx}.`,
      );
    } else {
      console.log("\n--conservar: NO se limpio. Corre `--solo-limpiar` cuando termines.");
    }
    await cliente.$disconnect();
  }
}

// --- Siembra y limpieza -----------------------------------------------------------------

async function contarOrdenes(prisma: PrismaClient): Promise<number> {
  const r = await (prisma.$queryRawUnsafe("SELECT count(*)::int n FROM orden") as Promise<
    { n: number }[]
  >);
  return r[0].n;
}

async function limpiar(prisma: PrismaClient): Promise<void> {
  const borradas = await prisma.$executeRawUnsafe(
    `DELETE FROM orden WHERE num_remision LIKE '${MARCA}%'`,
  );
  if (borradas > 0) console.log(`Borradas ${borradas} filas del banco.`);
}

async function sembrar(prisma: PrismaClient, filas: number): Promise<void> {
  const geo = (await prisma.$queryRawUnsafe(
    "SELECT DISTINCT zona_id, provincia_id, canton_id, distrito_id, tienda_id FROM orden" +
      " WHERE deleted_at IS NULL LIMIT 40",
  )) as {
    zona_id: string;
    provincia_id: string;
    canton_id: string;
    distrito_id: string | null;
    tienda_id: string;
  }[];
  if (geo.length === 0) {
    throw new Error(
      "La tabla `orden` esta vacia: el banco toma de ahi las FKs validas (zona, provincia," +
        " canton, tienda). Siembra primero con `pnpm run db:seed` y crea alguna orden.",
    );
  }
  const estados = (await prisma.$queryRawUnsafe(
    "SELECT id FROM order_status ORDER BY value",
  )) as { id: string }[];

  console.log(`Sembrando ${filas} ordenes (lotes de ${LOTE_SIEMBRA}) ...`);
  const t0 = performance.now();
  for (let desde = 1; desde <= filas; desde += LOTE_SIEMBRA) {
    const hasta = Math.min(desde + LOTE_SIEMBRA - 1, filas);
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO orden (
        id, num_guia, num_remision, estatus_id, destinatario, telefono_dest,
        tienda_id, zona_id, provincia_id, canton_id, distrito_id,
        producto, direccion, notas, peso, monto_cobrar,
        prioridad, cobra_comision, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        $1::int + g,
        '${MARCA}' || (CASE WHEN g % ${CADA_REMISION_NUMERICA} = 0
              THEN '2026-' || lpad(g::text, 6, '0')
              ELSE ($2::text[])[1 + (g % array_length($2::text[], 1))] || '-' || lpad(g::text, 7, '0')
              END),
        ($3::text[])[1 + (g % array_length($3::text[], 1))],
        (CASE WHEN g % ${CADA_MARIA} = 0
              THEN 'María'
              ELSE ($4::text[])[1 + (g % array_length($4::text[], 1))] END)
          || ' ' ||
        (CASE WHEN g % ${CADA_ZUNIGA} = 0
              THEN 'Zúñiga'
              ELSE ($5::text[])[1 + ((g / 7) % array_length($5::text[], 1))] END)
          || ' ' ||
        (CASE WHEN g % ${CADA_KOPPER} = 0 THEN 'Kopper'
              WHEN g % ${CADA_LIZANO} = 0 THEN 'Lizano'
              WHEN g % ${CADA_BARQUERO} = 0 THEN 'Barquero'
              WHEN g % ${CADA_TREJOS} = 0 THEN 'Trejos'
              ELSE ($5::text[])[1 + ((g / 211) % array_length($5::text[], 1))] END),
        CASE WHEN g % 2 = 0 THEN t.d ELSE substr(t.d, 1, 4) || '-' || substr(t.d, 5, 4) END,
        ($6::text[])[1 + (g % array_length($6::text[], 1))],
        ($7::text[])[1 + (g % array_length($7::text[], 1))],
        ($8::text[])[1 + (g % array_length($8::text[], 1))],
        ($9::text[])[1 + (g % array_length($9::text[], 1))],
        ($10::text[])[1 + (g % array_length($10::text[], 1))],
        'Producto de prueba ' || (g % 37),
        'Direccion de prueba ' || g || ', San Jose',
        'BENCH169',
        1.5, 12500.00,
        false, true,
        now() - ((g % 365) || ' days')::interval - ((g % 1440) || ' minutes')::interval,
        now()
      FROM generate_series($11::int, $12::int) g
      CROSS JOIN LATERAL (
        SELECT lpad(((((g::bigint * 7919) % 90000000) + 10000000))::text, 8, '0') AS d
      ) t
      `,
      GUIA_BASE,
      PREFIJOS_REMISION,
      estados.map((e) => e.id),
      NOMBRES,
      APELLIDOS,
      geo.map((g) => g.tienda_id),
      geo.map((g) => g.zona_id),
      geo.map((g) => g.provincia_id),
      geo.map((g) => g.canton_id),
      // Los cinco arrays de FKs van en el MISMO orden y se indexan con el MISMO `g % n`:
      // asi cada fila recibe una combinacion zona/provincia/canton/distrito COHERENTE,
      // tomada de una orden que ya existe (no se inventan jerarquias geograficas).
      geo.map((g) => g.distrito_id),
      desde,
      hasta,
    );
    process.stdout.write(`  ${hasta}/${filas}\r`);
  }
  console.log(`\nSiembra completada en ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
}

// --- Medicion de lectura ----------------------------------------------------------------

async function medirEscenario(
  espia: EspiaSql,
  prisma: PrismaClient,
  service: OrdenService,
  actor: Actor,
  escenario: Escenario,
  reps: number,
): Promise<Medicion> {
  console.log(`\n--- ${escenario.id}: ${escenario.titulo}`);
  for (let i = 0; i < CALENTAMIENTO; i++) await service.listar(escenario.input, actor);

  const wall: number[] = [];
  const findMany: number[] = [];
  const count: number[] = [];
  let total = 0;
  let consultas = 0;
  let sqlFindMany: EventoSql | undefined;
  let sqlCount: EventoSql | undefined;

  for (let i = 0; i < reps; i++) {
    const r = await espia.medir(() => service.listar(escenario.input, actor));
    if (r.valor.status !== "ok") throw new Error(`${escenario.id}: status ${r.valor.status}`);
    total = r.valor.total;
    wall.push(r.wall);
    consultas = r.sql.length;
    const fm = r.sql.filter(esFindManyDeOrden);
    const ct = r.sql.filter(esCountDeOrden);
    // Con fallback de guia (R10) hay DOS pares: se mide el ULTIMO, que es el que decide.
    if (fm.length > 0) {
      findMany.push(fm.reduce((s, e) => s + e.duration, 0));
      sqlFindMany = fm[fm.length - 1];
    }
    if (ct.length > 0) {
      count.push(ct.reduce((s, e) => s + e.duration, 0));
      sqlCount = ct[ct.length - 1];
    }
  }

  const planFindMany = sqlFindMany ? await explicar(prisma, sqlFindMany) : "";
  const planCount = sqlCount ? await explicar(prisma, sqlCount) : "";
  const recorre = `${planFindMany}\n${planCount}`.includes("Seq Scan on orden");
  const planForzado =
    recorre && sqlFindMany ? await explicar(prisma, sqlFindMany, { forzarIndice: true }) : "";
  const planSsd =
    recorre && sqlFindMany ? await explicar(prisma, sqlFindMany, { randomPageCost: RPC_SSD }) : "";
  console.log(
    `  total=${total} consultas/llamada=${consultas} ` +
      `wall p50=${ms(percentil(wall, 50))}ms p95=${ms(percentil(wall, 95))}ms`,
  );
  return {
    escenario,
    total,
    wall,
    findMany,
    count,
    consultas,
    sqlFindMany,
    sqlCount,
    planFindMany,
    planCount,
    planForzado,
    planSsd,
  };
}

/** `EXPLAIN (ANALYZE, BUFFERS)` del SQL EXACTO de Prisma, con sus parametros reales. */
async function explicar(
  prisma: PrismaClient,
  evento: EventoSql,
  opciones?: { forzarIndice?: boolean; randomPageCost?: number },
): Promise<string> {
  const params = (JSON.parse(evento.params) as unknown[]).map(convertirParametro);
  const sql = `EXPLAIN (ANALYZE, BUFFERS) ${evento.query}`;
  const leer = async (
    ejecutor: { $queryRawUnsafe: (s: string, ...p: unknown[]) => unknown },
  ): Promise<string> => {
    const filas = (await ejecutor.$queryRawUnsafe(sql, ...params)) as Record<string, string>[];
    return filas.map((f) => Object.values(f)[0]).join("\n");
  };
  if (!opciones?.forzarIndice && opciones?.randomPageCost === undefined) return leer(prisma);
  return prisma.$transaction(async (tx) => {
    if (opciones?.forzarIndice) await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    if (opciones?.randomPageCost !== undefined) {
      await tx.$executeRawUnsafe(`SET LOCAL random_page_cost = ${opciones.randomPageCost}`);
    }
    return leer(tx);
  });
}

/** Prisma serializa los parametros a JSON; los numericos vuelven como string. */
function convertirParametro(v: unknown): unknown {
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  return v;
}

// --- E5: coste de escritura -------------------------------------------------------------

interface BrazoE5 {
  nombre: string;
  muestras: number[];
}

async function medirEscritura(
  prisma: PrismaClient,
  crudo: (sql: string, ...p: unknown[]) => Promise<number>,
  consulta: <T>(sql: string, ...p: unknown[]) => Promise<T>,
): Promise<{ brazos: BrazoE5[]; tiempoAddColumn: number; tiempoCreateIndex: number }> {
  console.log(`\n--- E5: carga masiva de ${FILAS_E5} ordenes, ${REPS_E5} repeticiones por brazo`);
  const plantilla = await filasParaCarga(prisma);

  const brazos: BrazoE5[] = [];
  brazos.push({ nombre: "con columna + indice GIN", muestras: await cargar(prisma, plantilla) });

  console.log("  DROP INDEX orden_busqueda_texto_trgm_idx ...");
  await crudo('DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx"');
  brazos.push({ nombre: "con columna, SIN indice", muestras: await cargar(prisma, plantilla) });

  console.log("  ALTER TABLE orden DROP COLUMN busqueda_texto ...");
  await crudo('ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto"');
  brazos.push({ nombre: "SIN columna ni indice (pre-169)", muestras: await cargar(prisma, plantilla) });

  // Restauracion cronometrada: estos dos numeros son el coste REAL de aplicar la migracion
  // sobre una tabla de este tamaño, y alimentan la nota de despliegue (T5.3).
  const sentencias = sentenciasDe(fs.readFileSync(MIGRACION, "utf8"));
  const addColumn = sentencias.find((s) => s.includes("ADD COLUMN"));
  const createIndex = sentencias.find((s) => s.startsWith("CREATE INDEX"));
  if (!addColumn || !createIndex) throw new Error("migration.sql no tiene las sentencias esperadas");
  console.log("  restaurando columna generada ...");
  let t0 = performance.now();
  await crudo(addColumn);
  const tiempoAddColumn = performance.now() - t0;
  console.log("  restaurando indice GIN ...");
  t0 = performance.now();
  await crudo(createIndex);
  const tiempoCreateIndex = performance.now() - t0;
  await crudo("ANALYZE orden");

  // Brazo de control: se repite el PRIMER brazo tras restaurar. Si sale como el original, el
  // orden de los brazos no explica la diferencia; si sale muy distinto, la medicion es ruido.
  brazos.push({ nombre: "con columna + indice (control)", muestras: await cargar(prisma, plantilla) });

  const filas = await consulta<{ n: number }[]>(
    `SELECT count(*)::int n FROM orden WHERE num_remision LIKE '${MARCA}%'`,
  );
  console.log(`  filas del banco tras E5: ${filas[0].n} (las insertadas se revirtieron)`);
  return { brazos, tiempoAddColumn, tiempoCreateIndex };
}

type FilaCarga = Prisma.OrdenCreateManyInput;

async function filasParaCarga(prisma: PrismaClient): Promise<FilaCarga[]> {
  const fk = (await prisma.$queryRawUnsafe(
    "SELECT estatus_id, tienda_id, zona_id, provincia_id, canton_id, distrito_id FROM orden" +
      " WHERE deleted_at IS NULL LIMIT 1",
  )) as {
    estatus_id: string;
    tienda_id: string;
    zona_id: string;
    provincia_id: string;
    canton_id: string;
    distrito_id: string | null;
  }[];
  const f = fk[0];
  return Array.from({ length: FILAS_E5 }, (_, i) => ({
    numRemision: `${MARCA}E5-${Date.now()}-${i}`,
    estatusId: f.estatus_id,
    destinatario: `María ${APELLIDOS[i % APELLIDOS.length]} Zúñiga`,
    telefonoDest: `8${String(70000000 + i * 13).slice(0, 7)}`,
    tiendaId: f.tienda_id,
    zonaId: f.zona_id,
    provinciaId: f.provincia_id,
    cantonId: f.canton_id,
    distritoId: f.distrito_id,
    producto: "Producto de carga masiva",
    direccion: `Direccion ${i}`,
  }));
}

/**
 * Inserta el lote DENTRO de una transaccion que SIEMPRE se revierte. El trabajo de escritura
 * —incluido el mantenimiento del GIN— se hace de verdad y se mide; la base no se ensucia.
 */
async function cargar(prisma: PrismaClient, plantilla: FilaCarga[]): Promise<number[]> {
  const muestras: number[] = [];
  for (let rep = 0; rep < REPS_E5 + 1; rep++) {
    const data = plantilla.map((f, i) => ({
      ...f,
      numRemision: `${MARCA}E5-${rep}-${i}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    let dt = 0;
    try {
      await prisma.$transaction(async (tx) => {
        const t0 = performance.now();
        await tx.orden.createMany({ data, skipDuplicates: true });
        dt = performance.now() - t0;
        throw new Error("__revertir__");
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "__revertir__") throw e;
    }
    if (rep > 0) muestras.push(dt); // la 0 es calentamiento
  }
  console.log(`    p50=${ms(percentil(muestras, 50))}ms p95=${ms(percentil(muestras, 95))}ms`);
  return muestras;
}

// --- Restauracion defensiva del esquema -------------------------------------------------

/** Si E5 murio a mitad, la columna o el indice pueden faltar. Se reponen con el SQL LITERAL
 *  de la migracion (leido del archivo: no hay copia que pueda divergir). */
async function asegurarEsquema(prisma: PrismaClient): Promise<void> {
  const estado = (await prisma.$queryRawUnsafe(
    "SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_name='orden'" +
      " AND column_name='busqueda_texto') col," +
      " (SELECT count(*)::int FROM pg_indexes WHERE indexname='orden_busqueda_texto_trgm_idx') idx",
  )) as { col: number; idx: number }[];
  if (estado[0].col > 0 && estado[0].idx > 0) return;
  console.log("Reponiendo columna/indice de la migracion 169 ...");
  const sentencias = sentenciasDe(fs.readFileSync(MIGRACION, "utf8"));
  for (const s of sentencias) {
    if (s.includes("ADD COLUMN") && estado[0].col > 0) continue;
    if (s.startsWith("CREATE INDEX") && estado[0].idx > 0) continue;
    await prisma.$executeRawUnsafe(s);
  }
}

// --- Informe ----------------------------------------------------------------------------

function imprimirInforme(
  mediciones: Medicion[],
  trasCarga: Medicion[],
  e5: { brazos: BrazoE5[]; tiempoAddColumn: number; tiempoCreateIndex: number },
  opciones: Opciones,
  filasTabla: number,
  msFlush: number,
): void {
  const tabla = (titulo: string, filas: Medicion[]): void => {
    console.log(`\n${titulo}\n`);
    console.log("| Escenario | Coincidencias | findMany p50 | findMany p95 | count p50 | count p95 | total p50 | total p95 |");
    console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const m of filas) {
      console.log(
        `| ${m.escenario.id} ${m.escenario.titulo} | ${m.total} | ` +
          `${ms(percentil(m.findMany, 50))} | ${ms(percentil(m.findMany, 95))} | ` +
          `${ms(percentil(m.count, 50))} | ${ms(percentil(m.count, 95))} | ` +
          `${ms(percentil(m.wall, 50))} | ${ms(percentil(m.wall, 95))} |`,
      );
    }
  };
  console.log(`\n\n============ RESULTADOS (${opciones.reps} repeticiones, p95 = peor de ${opciones.reps}) ============`);
  tabla("### ESTADO B — estacionario (pending list del GIN vaciada). NUMEROS CANONICOS.", mediciones);
  tabla(
    `### ESTADO A — recien cargado (pending list SIN vaciar; vaciarla costo ${msFlush.toFixed(0)} ms)`,
    trasCarga,
  );

  console.log("\n--- EFECTO DE LA PENDING LIST DEL GIN (estado A vs B) ---");
  console.log("| Escenario | plan recien cargado | plan estacionario | findMany p50 A | findMany p50 B |");
  console.log("| --- | --- | --- | ---: | ---: |");
  for (const m of mediciones) {
    if (m.escenario.planEsperado !== "trigram") continue;
    const a = trasCarga.find((x) => x.escenario.id === m.escenario.id);
    const nombre = (x?: Medicion): string =>
      x === undefined ? "—" : x.planFindMany.includes("Seq Scan on orden") ? "Seq Scan" : "Bitmap Index Scan";
    console.log(
      `| ${m.escenario.id} | ${nombre(a)} | ${nombre(m)} | ` +
        `${ms(percentil(a?.findMany ?? [], 50))} | ${ms(percentil(m.findMany, 50))} |`,
    );
  }

  console.log("\n--- SQL EMITIDO POR PRISMA (verifica el escape de %/_ del design §4.3) ---");
  for (const m of mediciones) {
    console.log(`\n[${m.escenario.id}] findMany:\n${m.sqlFindMany?.query ?? "—"}`);
    console.log(`[${m.escenario.id}] params: ${m.sqlFindMany?.params ?? "—"}`);
    console.log(`[${m.escenario.id}] count:\n${m.sqlCount?.query ?? "—"}`);
    console.log(`[${m.escenario.id}] params: ${m.sqlCount?.params ?? "—"}`);
  }

  console.log("\n--- PLANES DE EJECUCION ---");
  for (const m of mediciones) {
    console.log(`\n===== ${m.escenario.id} findMany =====\n${m.planFindMany}`);
    console.log(`\n===== ${m.escenario.id} count =====\n${m.planCount}`);
    if (m.planForzado) {
      console.log(
        `\n===== ${m.escenario.id} findMany con enable_seqscan=off (contraste) =====\n${m.planForzado}`,
      );
    }
    if (m.planSsd) {
      console.log(
        `\n===== ${m.escenario.id} findMany con random_page_cost=${RPC_SSD} (contraste SSD) =====\n${m.planSsd}`,
      );
    }
  }

  console.log("\n--- ¿DONDE ABANDONA EL PLANIFICADOR EL INDICE? (escalera de selectividad) ---");
  console.log("| Escenario | Coincidencias | % tabla | plan por defecto (rpc=4) | plan con rpc=1.1 (SSD) |");
  console.log("| --- | ---: | ---: | --- | --- |");
  for (const m of mediciones) {
    if (m.escenario.planEsperado !== "trigram") continue;
    const porDefecto = m.planFindMany.includes("Seq Scan on orden") ? "Seq Scan" : "Bitmap Index Scan";
    const ssd = m.planSsd === "" ? "(mismo)" : m.planSsd.includes("Seq Scan on orden") ? "Seq Scan" : "Bitmap Index Scan";
    console.log(
      `| ${m.escenario.id} | ${m.total} | ${((m.total / filasTabla) * 100).toFixed(2)} % | ${porDefecto} | ${ssd} |`,
    );
  }

  console.log("\n--- ASERCIONES DE PLAN (R31) ---");
  let fallos = 0;
  for (const m of mediciones) {
    const planes = `${m.planFindMany}\n${m.planCount}`;
    const seq = planes.includes("Seq Scan on orden");
    const cuenta = m.escenario.exploratorio !== true;
    if (m.escenario.planEsperado === "trigram") {
      const usaIndice = planes.includes("Bitmap Index Scan on orden_busqueda_texto_trgm_idx");
      const a = informar(`${m.escenario.id}: Bitmap Index Scan on orden_busqueda_texto_trgm_idx`, usaIndice, cuenta);
      const b = informar(`${m.escenario.id}: NO hay 'Seq Scan on orden'`, !seq, cuenta);
      if (cuenta) fallos += a + b;
    } else if (m.escenario.planEsperado === "guia") {
      const a = informar(
        `${m.escenario.id}: Index Scan using orden_num_guia_key`,
        planes.includes("Index Scan using orden_num_guia_key"),
        cuenta,
      );
      const b = informar(`${m.escenario.id}: NO hay 'Seq Scan on orden'`, !seq, cuenta);
      if (cuenta) fallos += a + b;
    } else {
      console.log(`  (info) ${m.escenario.id}: sin asercion de plan; Seq Scan presente = ${seq}`);
    }
  }

  // M1: los dos escenarios selectivos de dos formas tienen que resolver el `OR` por el MISMO
  // indice, DOS veces (`BitmapOr` de dos `Bitmap Index Scan`). Si alguno cayera a un solo
  // scan es que una de las dos formas se perdio; si cayera a Seq Scan, el `OR` habria
  // inutilizado el indice — que es exactamente lo que no se puede dar por supuesto.
  for (const id of ["E6", "E7"]) {
    const m = mediciones.find((x) => x.escenario.id === id);
    if (!m) continue;
    const scans = (
      m.planFindMany.match(/Bitmap Index Scan on orden_busqueda_texto_trgm_idx/g) ?? []
    ).length;
    const ok = scans === 2 && m.planFindMany.includes("BitmapOr");
    fallos += informar(`${id}: BitmapOr de DOS Bitmap Index Scan (medido: ${scans})`, ok, true);
  }

  console.log("\n--- E5: coste de ESCRITURA del indice ---");
  console.log(`| Brazo | p50 (ms) | p95 (ms) | delta p50 vs pre-169 |`);
  console.log(`| --- | ---: | ---: | ---: |`);
  const pre = e5.brazos.find((b) => b.nombre.includes("pre-169"));
  const basePre = pre ? percentil(pre.muestras, 50) : Number.NaN;
  for (const b of e5.brazos) {
    const p50 = percentil(b.muestras, 50);
    const delta = Number.isNaN(basePre) ? "—" : `${(((p50 - basePre) / basePre) * 100).toFixed(1)} %`;
    console.log(`| ${b.nombre} | ${ms(p50)} | ${ms(percentil(b.muestras, 95))} | ${delta} |`);
  }
  console.log(
    `\nCoste de APLICAR la migracion sobre esta tabla:` +
      ` ADD COLUMN GENERATED = ${(e5.tiempoAddColumn / 1000).toFixed(2)} s,` +
      ` CREATE INDEX GIN = ${(e5.tiempoCreateIndex / 1000).toFixed(2)} s.`,
  );

  console.log(
    fallos === 0
      ? "\n>>> TODAS LAS ASERCIONES DE PLAN PASAN. R31 verificado empiricamente.\n"
      : `\n>>> ${fallos} ASERCION(ES) DE PLAN FALLARON. R31 NO esta demostrado.\n`,
  );
}

function informar(etiqueta: string, ok: boolean, cuenta: boolean): number {
  console.log(`  ${ok ? "OK  " : "FALLA"} ${cuenta ? "" : "(escalera, informativo) "}${etiqueta}`);
  return ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
