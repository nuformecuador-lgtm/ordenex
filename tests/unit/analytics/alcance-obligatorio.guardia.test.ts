import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 122 / T4.3 — GUARDIA de R18: NADIE CONSULTA ANALITICA SIN EL TIPO OPACO.
//
// Los tipos cubren el 90%: una firma que pide `ConsultaAnalitica` no se puede llamar con
// un filtro suelto. Lo que los tipos NO cubren es el 10% que mas duele: `$queryRaw`, un
// servicio que reconstruya el filtro a mano, un repositorio que lea `orden` "solo para un
// contador". Este censo mira ese 10%.
//
// ⚠ HOY EL CENSO REAL ESTA VACIO: las features 126 (operativa) y 127 (financiera) todavia
// no existen, asi que no hay ningun consumidor de analitica en `lib/{repositories,services,
// actions}`. Un guardia que solo mirase el repo estaria verde por vacio durante semanas y
// nadie sabria si funciona. Por eso el censo se AUTOCOMPRUEBA con fixtures sinteticos: un
// consumidor legitimo (que debe pasar) y dos infractores (que deben caer), incluido uno con
// `$queryRaw`.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const CAPAS = ["repositories", "services", "actions"];
const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

/** Las nueve tablas de analitica (`lib/analytics/types.ts`). */
const TABLAS_ANALITICA = [
  "analytics_daily",
  "orden",
  "gestion_orden",
  "orden_historial_estado",
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

/** Como se nombra cada tabla desde Prisma (`prisma.gestionOrden`, `prisma.orden`, ...). */
function nombrePrisma(tabla: string): string {
  const [primera, ...resto] = tabla.split("_");
  return primera + resto.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
}

function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function archivosDeCodigo(raiz: string): string[] {
  if (!fs.existsSync(raiz)) return [];
  const encontrados: string[] = [];
  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    const completa = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      if (DIRS_IGNORADOS.has(entrada.name)) continue;
      encontrados.push(...archivosDeCodigo(completa));
    } else if (entrada.name.endsWith(".ts") || entrada.name.endsWith(".tsx")) {
      encontrados.push(completa);
    }
  }
  return encontrados;
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/**
 * "Contexto de analitica" = el archivo importa algo de `lib/analytics/`. Es la definicion
 * honesta: un repositorio de ordenes que no toca analitica no tiene por que recibir el
 * tipo opaco, y exigirselo convertiria el guardia en ruido que alguien acabaria apagando.
 */
function esContextoDeAnalitica(codigo: string): boolean {
  return /["'](@\/lib\/analytics\/|\.\.?\/[^"']*analytics\/)/.test(codigo);
}

function consultaTablaDeAnalitica(codigo: string): string | null {
  for (const tabla of TABLAS_ANALITICA) {
    const modelo = nombrePrisma(tabla);
    if (new RegExp(`\\.\\s*${modelo}\\s*\\.\\s*(findMany|findFirst|count|aggregate|groupBy)`).test(codigo)) {
      return tabla;
    }
    if (new RegExp(`(queryRaw|executeRaw)[\\s\\S]{0,400}\\b${tabla}\\b`).test(codigo)) {
      return `${tabla} (SQL crudo)`;
    }
  }
  return null;
}

/**
 * Feature 126 / T11.1 (R28) — EL FORJADOR. Deuda (a) del review de la 122 del 2026-08-01.
 *
 * Hasta aqui `recibeConsultaPreparada` era `test(/\bConsultaAnalitica\b/)`: un censo POR
 * NOMBRE. Y un archivo que FORJA el tipo —`{ filtro, alcance } as unknown as
 * ConsultaAnalitica`— menciona la palabra, asi que pasaba el censo mientras se saltaba
 * entera la garantia que el tipo opaco existe para dar.
 *
 * No es un caso hipotetico: la marca `unique symbol` de `consulta.ts` impide construir el
 * valor a mano, pero NO impide un `as unknown as`, que es la salida que alguien encuentra a
 * los cinco minutos de pelearse con el compilador. El tipo cubre el 90%; esto es parte del
 * 10% que queda, igual que el `$queryRaw`.
 *
 * QUE CUENTA COMO FORJAR: cualquier asercion de tipo hacia `ConsultaAnalitica`, con o sin el
 * `unknown` intermedio. Lo que NO cuenta es RECIBIRLO en una firma o importarlo como tipo,
 * que es el uso legitimo y el unico que deja el recorte intacto.
 */
const FORJA_LA_CONSULTA = /\bas\s+(?:unknown\s+as\s+)?ConsultaAnalitica\b/;

function recibeConsultaPreparada(codigo: string): boolean {
  // Forjarla NO es recibirla: si el archivo la fabrica con un cast, el censo no lo perdona
  // aunque la palabra aparezca por todas partes.
  if (FORJA_LA_CONSULTA.test(codigo)) return false;
  return /\bConsultaAnalitica\b/.test(codigo);
}

/**
 * Devuelve el motivo si el archivo consulta analitica sin el tipo opaco. Es la funcion que
 * los tres fixtures ejercitan: si deja de detectar, el guardia entero se queda mudo.
 */
export function violacionDeAlcanceObligatorio(nombre: string, fuente: string): string | null {
  const codigo = soloCodigo(fuente);
  if (!esContextoDeAnalitica(codigo)) return null;
  const tabla = consultaTablaDeAnalitica(codigo);
  if (!tabla) return null;
  if (recibeConsultaPreparada(codigo)) return null;
  return `${nombre}: consulta ${tabla} en contexto de analitica sin recibir ConsultaAnalitica`;
}

const FIXTURE_LEGITIMO = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { whereOrden } from "@/lib/analytics/alcance-columnas";
export class EntregasAnaliticaRepository {
  async contar(consulta: ConsultaAnalitica) {
    return this.prisma.orden.count({ where: { ...whereOrden(consulta.alcance) } });
  }
}
`;

const FIXTURE_INFRACTOR_PRISMA = `
import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
export class EntregasAnaliticaRepository {
  async contar(filtro: AnaliticaFiltroInput) {
    return this.prisma.orden.count({ where: { zonaId: filtro.zona_id?.[0] } });
  }
}
`;

/**
 * Feature 126 / R28 — EL FORJADOR. Consulta la tabla, menciona `ConsultaAnalitica` por todas
 * partes... y la FABRICA con un cast en vez de recibirla. Con el censo por nombre pasaba.
 */
const FIXTURE_FORJADOR = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
import type { AlcanceDatos } from "@/lib/analytics/alcance";
export class OperativaAnaliticaRepository {
  async contar(filtro: AnaliticaFiltroInput, alcance: AlcanceDatos) {
    const c = { filtro, alcance } as unknown as ConsultaAnalitica;
    return this.prisma.orden.count({ where: { zonaId: c.filtro.zona_id?.[0] } });
  }
}
`;

const FIXTURE_INFRACTOR_RAW = `
import { getMetrica } from "@/lib/analytics/metrics";
export class RollupAnaliticaRepository {
  async serie(desde: Date) {
    void getMetrica("entregas");
    return this.prisma.$queryRaw\`SELECT fecha, SUM(valor) FROM analytics_daily WHERE fecha >= \${desde}\`;
  }
}
`;

/**
 * Feature 124 — la UNICA exencion del censo, NOMINAL y de un solo archivo.
 *
 * `AnaliticaRollupRepository` es el ESCRITOR del rollup diario, no un consumidor: lo invoca un
 * job programado que corre con service role, sin sesion de usuario y sin rol que resolver, y
 * su trabajo es escribir TODAS las filas de TODAS las zonas de la fecha. Recibir un
 * `ConsultaAnalitica` y recortarse por alcance seria exactamente el bug: el rollup quedaria
 * agregado a medias y las consultas de la 126 leerian numeros mutilados sin que nada fallara.
 * Cae en el censo porque importa `@/lib/analytics/rollup-dia` (contexto de analitica) y lee
 * `analytics_daily` con `$queryRaw` — las dos cosas, ciertas y legitimas.
 *
 * POR QUE UNA EXENCION NOMINAL Y NO AFLOJAR `violacionDeAlcanceObligatorio`: cualquier regla
 * general que dejase pasar a este archivo (por ejemplo «los `$queryRaw` sobre `analytics_daily`
 * no cuentan», o «los archivos con `Rollup` en el nombre no cuentan») amnistiaria tambien a
 * `FIXTURE_INFRACTOR_RAW`, que lee la MISMA tabla con la MISMA tecnica y debe seguir cayendo.
 * Se perderia la cobertura que la 122 monto para la 126/127. Una lista de un elemento, en
 * cambio, no tapa a nadie mas: un repositorio de analitica NUEVO sigue saliendo rojo.
 */
const EXENTOS_POR_SER_ESCRITORES = ["lib/repositories/AnaliticaRollupRepository.ts"];

describe("R18 · censo real sobre repositorios, servicios y acciones", () => {
  it("ningun archivo de lib/{repositories,services,actions} consulta analitica sin el tipo opaco", () => {
    const infractores = CAPAS.flatMap((capa) => archivosDeCodigo(path.join(REPO_ROOT, "lib", capa)))
      .filter((archivo) => !EXENTOS_POR_SER_ESCRITORES.includes(relativa(archivo)))
      .map((archivo) =>
        violacionDeAlcanceObligatorio(relativa(archivo), fs.readFileSync(archivo, "utf8")),
      )
      .filter((v): v is string => v !== null);

    expect(infractores).toEqual([]);
  });

  it("la exencion del escritor no queda colgada: el archivo existe y sigue siendo necesaria", () => {
    // Direccion 1 — si el escritor se borra o se renombra, la exencion se queda autorizando una
    // ruta imaginaria y, peor, el archivo NUEVO entra al censo sin que nadie lo haya pensado.
    for (const rel of EXENTOS_POR_SER_ESCRITORES) {
      const absoluta = path.join(REPO_ROOT, rel);
      expect(
        fs.existsSync(absoluta),
        `${rel} esta exento del censo de R18 pero no existe: retira la entrada o corrige la ruta`,
      ).toBe(true);

      // Direccion 2 — la exencion tiene que estar SOPORTANDO PESO. Si algun dia este archivo
      // deja de disparar el detector (porque pasa a recibir `ConsultaAnalitica`, o porque deja
      // de consultar la tabla), la entrada sobra y hay que quitarla: una exencion inerte es un
      // permiso latente que nadie recuerda revisar.
      expect(
        violacionDeAlcanceObligatorio(rel, fs.readFileSync(absoluta, "utf8")),
        `${rel} ya no dispara el detector: la exencion sobra, retirala del censo`,
      ).not.toBeNull();
    }
  });

  it("el censo mira archivos de verdad en las tres capas (no pasa por vacio por ruta mal calculada)", () => {
    for (const capa of CAPAS) {
      const archivos = archivosDeCodigo(path.join(REPO_ROOT, "lib", capa));
      expect(archivos.length, `lib/${capa} sin archivos censados`).toBeGreaterThan(0);
    }
  });
});

describe("R18 · autocomprobacion con fixtures sinteticos (126/127 aun no existen)", () => {
  it("acepta el consumidor legitimo que recibe ConsultaAnalitica", () => {
    expect(violacionDeAlcanceObligatorio("legitimo.ts", FIXTURE_LEGITIMO)).toBeNull();
  });

  it("rechaza el repositorio que consulta orden con el filtro parseado suelto", () => {
    const v = violacionDeAlcanceObligatorio("infractor-prisma.ts", FIXTURE_INFRACTOR_PRISMA);
    expect(v).not.toBeNull();
    expect(v).toContain("orden");
  });

  it("rechaza el repositorio que lee analytics_daily con SQL crudo", () => {
    const v = violacionDeAlcanceObligatorio("infractor-raw.ts", FIXTURE_INFRACTOR_RAW);
    expect(v).not.toBeNull();
    expect(v).toContain("SQL crudo");
  });

  it("no marca un repositorio que consulta orden FUERA del contexto de analitica", () => {
    const ajeno = `
      export class OrdenRepository {
        async listar() { return this.prisma.orden.findMany({ where: { deletedAt: null } }); }
      }
    `;
    expect(violacionDeAlcanceObligatorio("ajeno.ts", ajeno)).toBeNull();
  });

  it("un cast a ConsultaAnalitica no cuenta como recibirla", () => {
    // R28 / deuda (a) de la 122. El fixture consulta `orden` en contexto de analitica y
    // menciona `ConsultaAnalitica` tres veces, pero la FORJA: el recorte no viene de la 122,
    // viene de un filtro suelto que el propio repositorio recompone.
    const v = violacionDeAlcanceObligatorio("forjador.ts", FIXTURE_FORJADOR);
    expect(v, "un cast a ConsultaAnalitica paso el censo").not.toBeNull();
    expect(v).toContain("orden");
  });

  it("y tampoco el cast directo, sin el `unknown` intermedio", () => {
    const directo = FIXTURE_FORJADOR.replace(
      "as unknown as ConsultaAnalitica",
      "as ConsultaAnalitica",
    );
    expect(violacionDeAlcanceObligatorio("forjador-directo.ts", directo)).not.toBeNull();
  });

  it("el detector del forjador DISCRIMINA: recibirla en la firma sigue siendo legitimo", () => {
    // La direccion que importa para no convertir el guardia en ruido: el consumidor legitimo
    // NOMBRA el tipo en su firma y no lo forja en ningun sitio.
    expect(violacionDeAlcanceObligatorio("legitimo.ts", FIXTURE_LEGITIMO)).toBeNull();
    // Y un archivo que la recibe Y ADEMAS la forja en otra parte sigue siendo infractor: basta
    // un cast para que el recorte deje de estar garantizado.
    const mixto = FIXTURE_LEGITIMO + "\nconst otra = {} as ConsultaAnalitica;\n";
    expect(violacionDeAlcanceObligatorio("mixto.ts", mixto)).not.toBeNull();
  });

  it("no se deja enganar por una mencion de ConsultaAnalitica en un comentario", () => {
    const disfrazado = FIXTURE_INFRACTOR_PRISMA.replace(
      "export class",
      "// TODO: migrar a ConsultaAnalitica\nexport class",
    );
    expect(violacionDeAlcanceObligatorio("disfrazado.ts", disfrazado)).not.toBeNull();
  });
});
