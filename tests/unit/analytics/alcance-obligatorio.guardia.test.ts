import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
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
  return quitarComentarios(fuente);
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
/**
 * Los tipos OPACOS que valen como "consulta ya preparada". Son dos desde el 2026-08-17:
 *
 *  - `ConsultaAnalitica` (`lib/analytics/consulta.ts`) — las 25 metricas del catalogo.
 *  - `ConsultaConteoEntregas` (`lib/analytics/entregas-conteo.ts`) — el conteo de entregas,
 *    que NO sale de `analytics_daily` sino de la tabla `orden` viva, y por eso tiene su
 *    propio preparador. Se admite aqui porque cumple lo MISMO que se le exige al primero:
 *    marca `unique symbol`, de modo que la unica forma de tener uno es haber pasado por su
 *    resolutor de alcance.
 *
 * ⚠ ESTA LISTA NO ES UN CAJON. Un tipo nuevo entra si —y solo si— esta marcado con un
 * `unique symbol` que impida construirlo a mano. Meter aqui un tipo llano (un `interface`
 * normal con `filtro` y `alcance`) desarmaria el guardia entero sin que nada se pusiera rojo:
 * cualquier repositorio podria fabricarse el alcance que quisiera y seguir pasando el censo.
 */
const TIPOS_OPACOS = ["ConsultaAnalitica", "ConsultaConteoEntregas"] as const;

/** `as [unknown as] <Tipo>` para cualquiera de los opacos. */
const FORJA_LA_CONSULTA = new RegExp(
  `\\bas\\s+(?:unknown\\s+as\\s+)?(?:${TIPOS_OPACOS.join("|")})\\b`,
);

function recibeConsultaPreparada(codigo: string): boolean {
  // Forjarla NO es recibirla: si el archivo la fabrica con un cast, el censo no lo perdona
  // aunque la palabra aparezca por todas partes.
  if (FORJA_LA_CONSULTA.test(codigo)) return false;
  return new RegExp(`\\b(?:${TIPOS_OPACOS.join("|")})\\b`).test(codigo);
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

// El segundo tipo opaco entro en `TIPOS_OPACOS` el 2026-08-17. Este bloque es lo que impide
// que esa lista se convierta en un cajon: cada nombre que este dentro tiene que ganarse el
// sitio con una marca `unique symbol`, y tiene que caer si lo forjan igual que el primero.
describe("R18 · el segundo tipo opaco cumple lo mismo que el primero", () => {
  const FUENTES_OPACAS: Record<string, string> = {
    ConsultaAnalitica: "lib/analytics/consulta.ts",
    ConsultaConteoEntregas: "lib/analytics/entregas-conteo.ts",
  };

  // LA ASERCION QUE SOSTIENE TODO EL GUARDIA. Un tipo llano en `TIPOS_OPACOS` —una interfaz
  // normal con `filtro` y `alcance`— desarmaria el censo entero sin ponerse rojo: cualquier
  // repositorio podria construirse el alcance que quisiera y seguir pasando. La marca es lo
  // unico que convierte "menciona el tipo" en "paso por el resolutor".
  it.each(TIPOS_OPACOS)("«%s» esta marcado con un `unique symbol`", (tipo) => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, FUENTES_OPACAS[tipo]), "utf8");

    const marca = /declare const (\w+): unique symbol;/.exec(fuente);
    expect(marca, `${tipo} no declara marca: no puede estar en TIPOS_OPACOS`).not.toBeNull();

    // Y la marca esta DENTRO del tipo, no declarada al lado y olvidada: se toma el cuerpo de
    // la interfaz y se exige que el simbolo sea una de sus primeras propiedades.
    const cuerpo = fuente.slice(fuente.indexOf(`interface ${tipo}`), fuente.length);
    expect(cuerpo.slice(0, 200), `${tipo} declara la marca pero no la lleva dentro`).toContain(
      `[${marca?.[1]}]: true;`,
    );
  });

  it("cada nombre de la lista tiene un archivo fuente declarado y existente", () => {
    for (const tipo of TIPOS_OPACOS) {
      expect(FUENTES_OPACAS[tipo], `${tipo} sin fuente declarada en este test`).toBeDefined();
      expect(fs.existsSync(path.join(REPO_ROOT, FUENTES_OPACAS[tipo]))).toBe(true);
    }
  });

  it("forjar el tipo del conteo tampoco cuenta como recibirlo", () => {
    const forjador = `
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
export class ConteoRepository {
  async contar(filtro: unknown, alcance: unknown) {
    const c = { filtro, alcance } as unknown as ConsultaConteoEntregas;
    return this.prisma.orden.count({ where: { zonaId: (c as never)["x"] } });
  }
}
`;
    const v = violacionDeAlcanceObligatorio("forjador-conteo.ts", forjador);
    expect(v, "un cast a ConsultaConteoEntregas paso el censo").not.toBeNull();
    expect(v).toContain("orden");
  });

  it("y el repositorio real del conteo pasa porque lo RECIBE, no porque lo nombre", () => {
    // Se mira `ConteoPorStatusRepository` y no `ConteoEntregasRepository`: desde el 2026-08-18
    // aquel es el UNICO de los dos que toca la base —el otro delega en el y pliega—. Un
    // anti-vacio apuntando a un archivo que ya no consulta nada estaria verde POR VACIO, que
    // es justo el fallo que este bloque existe para evitar.
    const rel = "lib/repositories/ConteoPorStatusRepository.ts";
    const fuente = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

    expect(violacionDeAlcanceObligatorio(rel, fuente)).toBeNull();
    // Anti-vacio en las dos direcciones: el archivo SI consulta `orden` y SI esta en contexto
    // de analitica, asi que su ausencia del censo es una decision y no un descuido del detector.
    expect(fuente).toMatch(/queryRaw/);
    expect(fuente).toMatch(/"orden"/);
    expect(fuente).toContain("@/lib/analytics/");
    expect(FORJA_LA_CONSULTA.test(fuente), "forja el tipo opaco").toBe(false);
  });

  // Y el que PLIEGA no se escapa del censo por la puerta de atras. Hoy no consulta ninguna
  // tabla, asi que el detector no tiene nada que reprocharle — pero eso se comprueba, no se
  // supone: si volviera a consultar por su cuenta tendria que seguir recibiendo el tipo opaco
  // en vez de forjarlo, y esta asercion lo obliga.
  it("el repositorio que pliega tampoco forja el tipo opaco", () => {
    const rel = "lib/repositories/ConteoEntregasRepository.ts";
    const fuente = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

    expect(violacionDeAlcanceObligatorio(rel, fuente)).toBeNull();
    expect(FORJA_LA_CONSULTA.test(fuente), "forja el tipo opaco").toBe(false);
  });
});
