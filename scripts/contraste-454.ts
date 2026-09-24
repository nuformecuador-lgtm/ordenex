// FICHA 454 — corredor LOCAL del contraste historico (T3.1) y de la poblacion legada (T3.3).
//
// Uso (desde la raiz del repo, con la base local):
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/contraste-454.ts
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/contraste-454.ts --desde=2000-01-01
//   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/contraste-454.ts --autocomprobacion
//   (`--json` imprime las filas en JSON en vez de tabla)
//
// QUE HACE. Lee `scripts/contraste-454.sql` —la MISMA sentencia que se pega en produccion— y la
// ejecuta con `$queryRawUnsafe` dentro de una transaccion `READ ONLY` (Postgres rechaza cualquier
// escritura). Despues corre dos consultas que SOLO tienen sentido en local, porque usan `orden_evento`
// (tabla de la 454 que produccion aun no tiene):
//   · P0  — valida el PROXY «gestion de calle = no sintetica» que el SQL usa en produccion: ninguna
//           gestion con evento `gestion_registrada` puede ser clasificada como sintetica.
//   · T3.3 local — la poblacion legada con el filtro «sin evento» de verdad.
//
// --autocomprobacion. Un contraste que siempre da 0 no demuestra nada. Este modo inyecta en los CTE
// `src_*` del SQL (marcadores `/*FIX:<tabla>*/`) filas FICTICIAS —solo en el texto de la consulta,
// nunca en la base— construidas para producir exactamente UNA diferencia por bloque, y comprueba que
// cada bloque la cuenta (diferencias con fixture = diferencias sin fixture + 1). Si algun bloque no la
// ve, sale con codigo 1.
//
// GUARDA DE HOST (patron de `rollup-analitica-manual.ts`): aborta si `DATABASE_URL` no apunta a
// `localhost:5432/ordenex` (o un clon local `ordenex_<sufijo>`, FICHA 455). Produccion se contrasta por
// el MCP de Supabase, no con este script.
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { MOTIVO_RECHAZO_TOPE_INTENTOS } from "@/lib/repositories/CierresAdminRepository";

const HOST_LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
/** La base local compartida o un clon suyo por feature (`ordenex_455`); nunca otra. */
const BASE_LOCAL = /^ordenex(_[a-z0-9_]+)?$/;

function esBaseLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return HOST_LOCAL.has(host) && (u.port || "5432") === "5432" && BASE_LOCAL.test(u.pathname.replace(/^\//, ""));
  } catch {
    return false;
  }
}

/**
 * Motivo de las gestiones SINTETICAS del tope de intentos. FICHA 455 cambio el texto: las filas
 * escritas antes conservan el VIEJO y las nuevas llevan el NUEVO (la constante que escribe
 * `CierresAdminRepository`), asi que el contraste reconoce LOS DOS. Si solo viera el viejo, tras el
 * despliegue dejaria de reconocer en silencio las sinteticas nuevas y las contaria como de calle.
 */
const TOPE_VIEJO = "rechazada al aprobar el cierre: sin gestionar y sin intentos de entrega disponibles";
const TOPE_NUEVO = MOTIVO_RECHAZO_TOPE_INTENTOS;
const MOTIVOS_TOPE = [TOPE_VIEJO, TOPE_NUEVO] as const;

type Fila = Record<string, unknown>;

function plano(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (v !== null && typeof v === "object" && "toFixed" in (v as object)) return String(v);
  return v;
}

function limpiar(filas: Fila[]): Fila[] {
  return filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, plano(v)])));
}

/* -------------------------------------------------------------------------- */
/* SQL                                                                         */
/* -------------------------------------------------------------------------- */

const SQL_PATH = path.join(process.cwd(), "scripts", "contraste-454.sql");

function cargarSql(desde: string | null): string {
  let sql = readFileSync(SQL_PATH, "utf8").replace(/\r\n/g, "\n");
  // FICHA 455 — el SQL se pega tal cual en produccion y no puede importar la constante: se comprueba
  // aqui que sus dos motivos del tope son EXACTAMENTE los de este script (el nuevo, el que escribe el
  // repositorio). Si alguien cambia el texto en un lado y no en el otro, el contraste no arranca.
  for (const [columna, motivo] of [["motivo_tope_viejo", TOPE_VIEJO], ["motivo_tope_nuevo", TOPE_NUEVO]] as const) {
    if (!sql.includes(`${literal(motivo, "text")} AS ${columna}`)) {
      throw new Error(`el SQL no declara ${columna} con el texto vigente del repositorio: ${motivo}`);
    }
  }
  if (desde !== null) {
    if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(desde)) throw new Error(`--desde invalido: ${desde}`);
    const antes = sql;
    sql = sql.replace(/'[^']*'::timestamp AS desde, -- @DESDE/, `'${desde}'::timestamp AS desde, -- @DESDE`);
    if (sql === antes) throw new Error("no se encontro el marcador @DESDE en el SQL");
  }
  // `$queryRawUnsafe` no admite el `;` final de una sentencia unica en todos los drivers.
  return sql.replace(/;\s*$/, "");
}

// P0 — el proxy de calle frente al evento REAL (solo local: produccion no tiene `orden_evento`).
const SQL_P0 = `
WITH sint AS (
  SELECT DISTINCT gestion_orden_id AS gid FROM orden_historial_estado
   WHERE gestion_orden_id IS NOT NULL
     AND origen_tipo IN ('escalado_devuelta_sla','rechazo_tope_intentos','reprogramacion_tienda','rechazo_tienda')
), ev AS (
  SELECT DISTINCT e.gestion_orden_id AS gid FROM orden_evento e
   WHERE e.tipo = 'gestion_registrada' AND e.gestion_orden_id IS NOT NULL
)
SELECT 'P0 proxy calle vs evento (local)' AS k, count(*) AS total_evaluado,
       count(*) FILTER (WHERE s.gid IS NOT NULL
                          OR g.motivo IN (${MOTIVOS_TOPE.map((m) => literal(m, "text")).join(", ")})) AS diferencias,
       array_to_string((array_agg(g.id ORDER BY g.id) FILTER (WHERE s.gid IS NOT NULL))[1:10], ' ; ') AS muestra_ids,
       'gestiones con evento gestion_registrada clasificadas como sinteticas por el proxy' AS nota
  FROM ev JOIN gestion_orden g ON g.id = ev.gid LEFT JOIN sint s ON s.gid = g.id`;

// T3.3 — variante local con el filtro «sin evento» de verdad.
const SQL_T33_LOCAL = `
SELECT 'T3.3 legada viva (local, sin evento)' AS k, count(*) AS total_evaluado, NULL::bigint AS diferencias,
       array_to_string((array_agg(g.id ORDER BY g.id))[1:10], ' ; ') AS muestra_ids,
       format('con evento (modelo nuevo) vivas no aprobadas: %s',
              (SELECT count(*) FROM gestion_orden g2 LEFT JOIN cierre_dia c2 ON c2.id = g2.cierre_id
                WHERE g2.anulada_at IS NULL AND (g2.cierre_id IS NULL OR c2.estado <> 'aprobado')
                  AND EXISTS (SELECT 1 FROM orden_evento e WHERE e.gestion_orden_id = g2.id AND e.tipo = 'gestion_registrada'))) AS nota
  FROM gestion_orden g LEFT JOIN cierre_dia c ON c.id = g.cierre_id
 WHERE g.anulada_at IS NULL AND (g.cierre_id IS NULL OR c.estado <> 'aprobado')
   AND NOT EXISTS (SELECT 1 FROM orden_evento e WHERE e.gestion_orden_id = g.id AND e.tipo = 'gestion_registrada')`;

/* -------------------------------------------------------------------------- */
/* Autocomprobacion: fixtures inyectados en el TEXTO de la consulta            */
/* -------------------------------------------------------------------------- */

type Tipo = "text" | "timestamp" | "date" | "numeric" | "boolean";

const COLUMNAS: Record<string, [string, Tipo][]> = {
  cierre: [["id", "text"], ["mensajero_id", "text"], ["estado", "text"], ["created_at", "timestamp"],
    ["resuelto_at", "timestamp"], ["total_efectivo", "numeric"], ["total_pago_mensajero", "numeric"],
    ["total_ingreso_bodega_rechazos", "numeric"]],
  gestion: [["id", "text"], ["orden_id", "text"], ["mensajero_id", "text"], ["resultado", "text"],
    ["cierre_id", "text"], ["created_at", "timestamp"], ["anulada_at", "timestamp"],
    ["fecha_reprogramacion", "date"], ["causa", "text"], ["monto_recibido", "numeric"],
    ["pago_mensajero", "numeric"], ["ingreso_bodega_rechazo", "numeric"], ["indemnizacion", "numeric"],
    ["motivo", "text"]],
  hist: [["id", "text"], ["orden_id", "text"], ["origen", "text"], ["destino", "text"],
    ["origen_tipo", "text"], ["gestion_orden_id", "text"], ["created_at", "timestamp"]],
  csg: [["cierre_id", "text"], ["orden_id", "text"], ["created_at", "timestamp"]],
  detail: [["cierre_id", "text"], ["orden_id", "text"], ["tienda_id", "text"], ["monto_cobrar", "numeric"],
    ["cobra_comision", "boolean"], ["es_central", "boolean"], ["es_zona_especial", "boolean"],
    ["tarifa_id", "text"], ["tarifa_valor_flete", "numeric"], ["tarifa_valor_flete_gam", "numeric"],
    ["tarifa_valor_flete_devuelto", "numeric"], ["tarifa_valor_flete_devuelto_gam", "numeric"],
    ["tarifa_comision_cod", "numeric"], ["tarifa_iva_flete", "numeric"], ["tarifa_iva_comision_cod", "numeric"],
    ["tarifa_especial", "numeric"], ["tarifa_especial_devuelta", "numeric"]],
  wm: [["origen_id", "text"], ["tipo", "text"], ["categoria", "text"], ["monto", "numeric"]],
  wtm: [["origen_id", "text"], ["tienda_id", "text"], ["tipo", "text"], ["categoria", "text"], ["monto", "numeric"]],
  pmm: [["origen_id", "text"], ["mensajero_id", "text"], ["tipo", "text"], ["categoria", "text"], ["monto", "numeric"]],
};

type Valor = string | number | boolean | null;

function literal(v: Valor, tipo: Tipo): string {
  if (v === null) return `NULL::${tipo}`;
  if (typeof v === "boolean") return `${v}::boolean`;
  if (typeof v === "number") return `${v}::${tipo}`;
  return `'${v.replace(/'/g, "''")}'::${tipo}`;
}

function filasSql(tabla: string, filas: Record<string, Valor>[]): string {
  const cols = COLUMNAS[tabla];
  return filas
    .map((f) => {
      for (const k of Object.keys(f)) {
        if (!cols.some(([c]) => c === k)) throw new Error(`fixture ${tabla}: columna desconocida ${k}`);
      }
      return ` UNION ALL SELECT ${cols.map(([c, t]) => literal(f[c] ?? null, t)).join(", ")}`;
    })
    .join("\n");
}

const Z = "zz454-";
/** Marca de la fixture sintetica del tope: `inyectar` la sustituye por cada motivo de `MOTIVOS_TOPE`. */
const TOPE = "@MOTIVO_TOPE";
/**
 * FICHA 455 — lo que K4b atribuye a las sinteticas del tope se busca por el MOTIVO (su nota «ingreso ya
 * cobrado por las creadas»). La fixture lleva un ingreso propio y la autocomprobacion exige que la nota
 * suba exactamente eso con cada motivo: si el SQL dejara de reconocer uno, la nota no se moveria.
 */
const INGRESO_TOPE = 777;
const cierre = (id: string, mensajero: string, estado: string, creado: string, resuelto: string | null,
  extra: Partial<Record<"total_efectivo" | "total_pago_mensajero" | "total_ingreso_bodega_rechazos", number>> = {}) => ({
  id: Z + id, mensajero_id: Z + mensajero, estado, created_at: creado, resuelto_at: resuelto,
  total_efectivo: extra.total_efectivo ?? 0, total_pago_mensajero: extra.total_pago_mensajero ?? 0,
  total_ingreso_bodega_rechazos: extra.total_ingreso_bodega_rechazos ?? 0,
});
const gestion = (id: string, orden: string, mensajero: string, resultado: string, cierreId: string | null,
  creada: string, extra: Record<string, Valor> = {}) => ({
  id: Z + id, orden_id: Z + orden, mensajero_id: Z + mensajero, resultado,
  cierre_id: cierreId === null ? null : Z + cierreId, created_at: creada, ...extra,
});
const hist = (id: string, orden: string, origen: string | null, destino: string, origenTipo: string,
  gestionId: string | null, creada: string) => ({
  id: Z + id, orden_id: Z + orden, origen, destino, origen_tipo: origenTipo,
  gestion_orden_id: gestionId === null ? null : Z + gestionId, created_at: creada,
});
const detalle = (cierreId: string, orden: string, tarifa: Record<string, Valor> | null = null) => ({
  cierre_id: Z + cierreId, orden_id: Z + orden, tienda_id: Z + "t", monto_cobrar: 0, cobra_comision: false,
  es_central: false, es_zona_especial: false, tarifa_id: tarifa === null ? null : Z + "tarifa", ...(tarifa ?? {}),
});

// Un mundo pequeño, en 2030 para no mezclarse con nada, con UNA diferencia por bloque. Cada entrada
// dice que bloque debe verla y por que; el resto de filas estan puestas para NO contaminar a los demas.
const FIXTURES: Record<string, Record<string, Valor>[]> = {
  cierre: [
    cierre("c1", "m", "aprobado", "2030-01-01 20:00:00", "2030-01-02 10:00:00"), // K1, K2, K3
    cierre("c2", "m", "aprobado", "2030-01-03 08:00:00", "2030-01-03 10:00:00", { total_ingreso_bodega_rechazos: 500 }), // K4a
    cierre("c3", "m2", "vencido", "2030-01-05 00:00:00", null), // K5a (corte)
    cierre("c4", "m2", "aprobado", "2030-01-04 17:00:00", "2030-01-04 18:00:00"), // K5b
    cierre("c5", "m5", "solicitado", "2030-01-05 09:00:00", null), // K6, K7a
    cierre("c6", "m4", "aprobado", "2030-01-07 22:00:00", "2030-01-08 10:00:00"), // K7b
    cierre("c7", "m3", "aprobado", "2030-01-09 08:00:00", "2030-01-09 10:00:00"), // K8a
    cierre("c8", "m3", "aprobado", "2030-01-09 08:00:00", "2030-01-09 10:01:00"), // K8b
    cierre("c9", "m3", "aprobado", "2030-01-09 08:00:00", "2030-01-09 10:02:00"), // K8c
    cierre("c10", "m3", "aprobado", "2030-01-09 08:00:00", "2030-01-09 10:03:00", { total_pago_mensajero: 1700 }), // K8d
    cierre("c11", "m3", "aprobado", "2030-01-09 08:00:00", "2030-01-09 10:04:00"), // K8e
  ],
  gestion: [
    // K1: la gestion dice `entregada` pero su transicion real llevo la orden a `rechazada`.
    gestion("g1", "o1", "m", "entregado", "c1", "2030-01-01 12:00:00"),
    // K2: `devuelta` de calle con solo la fila de anclaje (lo que escribe el modelo nuevo): la via vieja
    // no la cuenta y la nueva si.
    gestion("g2", "o2", "m", "novedad", "c1", "2030-01-01 13:00:00"),
    // K3/K4b: la sintetica del tope (su fila de historial la hace «tope» real con 0 intentos).
    gestion("g3s", "o3", "m", "devolucion_a_origen_por_rechazo", null, "2030-01-02 10:00:01", { motivo: TOPE, ingreso_bodega_rechazo: INGRESO_TOPE }),
    // K5a: gestion de calle sin cierre ANTES del corte de c3 que barrio su orden.
    gestion("g5", "o5", "m2", "reprogramado", null, "2030-01-04 15:00:00"),
    // K5b: g6 en c4 (aprobado antes del corte) pero NO era la mas reciente al aprobar (g6b, anulada
    // despues): ni pendiente ni aplicada.
    gestion("g6", "o6", "m2", "entregado", "c4", "2030-01-04 16:00:00"),
    gestion("g6b", "o6", "m2", "entregado", null, "2030-01-04 17:30:00", { anulada_at: "2030-01-04 20:00:00" }),
    // K6: `rechazada` de calle en c5 (solicitado) cuando la 139 la devolvio.
    gestion("g7", "o7", "m5", "devolucion_a_origen_por_rechazo", "c5", "2030-01-05 08:00:00"),
    // K7a: `reprogramada` de calle vencida hoy, cierre sin aprobar, y aun asi se libero.
    gestion("g8", "o8", "m5", "reprogramado", "c5", "2030-01-05 08:30:00", { fecha_reprogramacion: "2030-01-07" }),
    // K7b/K4c: `devuelta` not_found aprobada a las 10:00 y escalada a las 12:00 (ventana de 24 h viva).
    gestion("g9", "o9", "m4", "novedad", "c6", "2030-01-07 20:00:00", { causa: "not_found" }),
    gestion("g9s", "o9", "m4", "devolucion_a_origen_por_rechazo", null, "2030-01-08 12:00:00"),
    // K8a..K8e
    gestion("g10", "o10", "m3", "entregado", "c7", "2030-01-09 07:00:00"),
    gestion("g11", "o11", "m3", "entregado", "c8", "2030-01-09 07:00:00", { monto_recibido: 5000 }),
    gestion("g12", "o12", "m3", "entregado", "c9", "2030-01-09 07:00:00", { monto_recibido: 3000 }),
    gestion("g13", "o13", "m3", "entregado", "c10", "2030-01-09 07:00:00", { pago_mensajero: 1700 }),
    gestion("g14", "o14", "m3", "incidente", "c11", "2030-01-09 07:00:00", { indemnizacion: 800 }),
  ],
  hist: [
    hist("h1", "o1", "en_reparto", "devolucion_a_origen_por_rechazo", "gestion", "g1", "2030-01-01 12:00:00"),
    hist("h2", "o2", "en_reparto", "novedad", "anclaje_devolucion", "g2", "2030-01-02 10:00:01"),
    hist("h3a", "o3", "en_reparto", "novedad_interna", "corte_sin_gestionar", null, "2030-01-01 23:59:00"),
    hist("h3b", "o3", "novedad_interna", "devolucion_a_origen_por_rechazo", "rechazo_tope_intentos", "g3s", "2030-01-02 10:00:01"),
    hist("h5", "o5", "en_reparto", "novedad_interna", "corte_sin_gestionar", null, "2030-01-05 00:00:00"),
    hist("h7", "o7", "devolucion_a_origen_por_rechazo", "por_devolver_a_tienda", "devolucion_rechazada", null, "2030-01-06 10:00:00"),
    hist("h8", "o8", "reprogramado", "en_bodega_central", "liberacion_reprogramada", null, "2030-01-07 06:00:00"),
    hist("h9a", "o9", "en_reparto", "devolucion_por_confirmar", "gestion", "g9", "2030-01-07 20:00:00"),
    hist("h9b", "o9", "devolucion_por_confirmar", "novedad", "anclaje_devolucion", "g9", "2030-01-08 10:00:01"),
    hist("h9c", "o9", "novedad", "devolucion_a_origen_por_rechazo", "escalado_devuelta_sla", "g9s", "2030-01-08 12:00:00"),
    hist("h10", "o10", "en_reparto", "entregado", "gestion", "g10", "2030-01-09 07:00:00"),
    hist("h11", "o11", "en_reparto", "entregado", "gestion", "g11", "2030-01-09 07:00:00"),
    hist("h12", "o12", "en_reparto", "entregado", "gestion", "g12", "2030-01-09 07:00:00"),
    hist("h13", "o13", "en_reparto", "entregado", "gestion", "g13", "2030-01-09 07:00:00"),
    hist("h14", "o14", "en_reparto", "incidente", "incidente", "g14", "2030-01-09 07:00:00"),
  ],
  csg: [
    { cierre_id: Z + "c1", orden_id: Z + "o3", created_at: "2030-01-01 23:59:00" },
    { cierre_id: Z + "c3", orden_id: Z + "o5", created_at: "2030-01-05 00:00:00" },
  ],
  detail: [
    detalle("c1", "o1"), detalle("c1", "o2"), detalle("c4", "o6"), detalle("c6", "o9"),
    detalle("c7", "o10", { tarifa_valor_flete: 1000, tarifa_iva_flete: 13 }),
    detalle("c8", "o11"), detalle("c9", "o12"), detalle("c10", "o13"), detalle("c11", "o14"),
  ],
  wm: [
    // K8a: falta el IVA del flete (esperado 1000 + 130).
    { origen_id: Z + "c7", tipo: "ingreso", categoria: "ingreso_flete", monto: 1000 },
    // K8b: la caja COD es coherente con el ledger (4000), pero el ledger no con la gestion (5000).
    { origen_id: Z + "c8", tipo: "ingreso", categoria: "ingreso_cod_recaudado", monto: 4000 },
    // K8c: la caja COD no casa con el ledger (2500 vs 3000).
    { origen_id: Z + "c9", tipo: "ingreso", categoria: "ingreso_cod_recaudado", monto: 2500 },
    // K8d: el egreso de caja no es P.
    { origen_id: Z + "c10", tipo: "egreso", categoria: "egreso_pago_mensajero", monto: 1600 },
    // K8e: ningun egreso de indemnizacion para un incidente de 800.
  ],
  wtm: [
    { origen_id: Z + "c7", tienda_id: Z + "t", tipo: "debito", categoria: "flete", monto: 1000 },
    { origen_id: Z + "c7", tienda_id: Z + "t", tipo: "debito", categoria: "iva_flete", monto: 130 },
    { origen_id: Z + "c8", tienda_id: Z + "t", tipo: "credito", categoria: "cod_recaudado", monto: 4000 },
    { origen_id: Z + "c9", tienda_id: Z + "t", tipo: "credito", categoria: "cod_recaudado", monto: 3000 },
  ],
  pmm: [
    { origen_id: Z + "c10", mensajero_id: Z + "m3", tipo: "devengo", categoria: "pago_devengado", monto: 1700 },
  ],
};

// La fila que cada bloque TIENE que señalar en su muestra (T3.3 no tiene diferencias: se mide su conteo).
const ID_ESPERADO: Record<string, string> = {
  K1: Z + "g1",
  K2: Z + "o2",
  K3: `${Z}o3@${Z}c1`,
  K4a: Z + "c2",
  K4b: `${Z}o3@${Z}c1`,
  K4c: Z + "h9c",
  K5a: `${Z}o5@${Z}c3`,
  K5b: `${Z}o6@${Z}c3`,
  K6: Z + "h7",
  K7a: Z + "h8",
  K7b: Z + "h9c",
  K8a: Z + "c7",
  K8b: Z + "c8",
  K8c: Z + "c9",
  K8d: Z + "c10",
  K8e: Z + "c11",
};

/** `motivoTope`: el texto que lleva la fixture sintetica del tope (se corre con cada uno de `MOTIVOS_TOPE`). */
function inyectar(sql: string, motivoTope: string): string {
  let out = sql;
  for (const [tabla, filas] of Object.entries(FIXTURES)) {
    const marcador = `/*FIX:${tabla}*/`;
    if (!out.includes(marcador)) throw new Error(`marcador ${marcador} ausente en el SQL`);
    const conMotivo = filas.map((f) => (f.motivo === TOPE ? { ...f, motivo: motivoTope } : f));
    out = out.replace(marcador, `${marcador}\n${filasSql(tabla, conMotivo)}`);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Ejecucion                                                                   */
/* -------------------------------------------------------------------------- */

async function soloLectura(sqls: string[]): Promise<Fila[][]> {
  const prisma = getPrismaClient();
  try {
    return await prisma.$transaction(async (tx) => {
      // Primera sentencia de la transaccion: a partir de aqui Postgres rechaza toda escritura.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const out: Fila[][] = [];
      for (const s of sqls) out.push(limpiar(await tx.$queryRawUnsafe<Fila[]>(s)));
      return out;
    }, { timeout: 120_000 });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!esBaseLocal(process.env.DATABASE_URL)) {
    console.error("ABORTA: DATABASE_URL no apunta a localhost:5432/ordenex (ni a un clon ordenex_<sufijo>). Produccion se contrasta por el MCP de Supabase.");
    process.exit(2);
  }
  const desdeArg = args.find((a) => a.startsWith("--desde="))?.slice("--desde=".length) ?? null;
  const auto = args.includes("--autocomprobacion");

  if (!auto) {
    const [k, p0, t33] = await soloLectura([cargarSql(desdeArg), SQL_P0, SQL_T33_LOCAL]);
    const filas = [...k, ...p0, ...t33];
    if (args.includes("--json")) console.log(JSON.stringify(filas, null, 1));
    else console.table(filas);
    return;
  }

  // Autocomprobacion: por defecto la poblacion empieza en 2030-01-01, donde SOLO viven las fixtures, para
  // que la muestra de cada bloque sea exactamente la fila sembrada y se pueda comprobar POR ID (no solo por
  // conteo: un +1 de otra fila no vale). Los datos reales siguen entrando en las subconsultas (conteos de
  // intentos, «mas reciente», etc.), asi que tambien se mide que no contaminan. `--desde=` lo cambia.
  //
  // FICHA 455: la pasada se repite con la sintetica del tope llevando el motivo VIEJO y luego el NUEVO;
  // las dos tienen que salir enteras (si el SQL dejara de reconocer uno, la sintetica contaria como
  // gestion de calle y algun bloque perderia su diferencia sembrada o ganaria otra).
  const base = cargarSql(desdeArg ?? "2030-01-01");
  const [sin, ...conPorMotivo] = await soloLectura([base, ...MOTIVOS_TOPE.map((m) => inyectar(base, m))]);
  const porK = new Map(sin.map((f) => [String(f.k), f]));
  let fallos = 0;
  const tabla = conPorMotivo.flatMap((con, i) => con.map((f) => {
    const k = String(f.k);
    const antes = porK.get(k);
    const esT33 = k.startsWith("T3.3");
    const dAntes = Number(esT33 ? antes?.total_evaluado : antes?.diferencias);
    const dCon = Number(esT33 ? f.total_evaluado : f.diferencias);
    const esperado = esT33 ? 5 : 1; // T3.3: g3s, g5, g7, g8, g9s
    const idEsperado = ID_ESPERADO[k.split(" ")[0]] ?? null;
    const muestra = String(f.muestra_ids ?? "");
    const ingresoTope = (fila: Fila | undefined): number =>
      Number(/ingreso ya cobrado por las creadas=([\d.]+)/.exec(String(fila?.nota ?? ""))?.[1] ?? NaN);
    const tope = !k.startsWith("K4b") || ingresoTope(f) - ingresoTope(antes) === INGRESO_TOPE;
    const ok = dCon - dAntes === esperado && (idEsperado === null || muestra.includes(idEsperado)) && tope;
    if (!ok) fallos += 1;
    return { motivo_tope: i === 0 ? "viejo" : "nuevo", k, sin_fixture: dAntes, con_fixture: dCon, esperado_delta: esperado, id_sembrado: idEsperado, detecta: ok ? "SI" : "NO", muestra: muestra.slice(0, 90) };
  }));
  console.table(tabla);
  for (const motivo of ["viejo", "nuevo"]) {
    const filas = tabla.filter((t) => t.motivo_tope === motivo);
    console.log(`motivo del tope ${motivo}: ${filas.filter((t) => t.detecta === "SI").length}/${filas.length} bloques detectan su diferencia`);
  }
  if (fallos > 0) {
    console.error(`AUTOCOMPROBACION ROJA: ${fallos} bloque(s) no ven su diferencia sembrada`);
    process.exit(1);
  }
  console.log("AUTOCOMPROBACION VERDE: cada bloque detecta su diferencia sembrada, con los dos motivos del tope");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
