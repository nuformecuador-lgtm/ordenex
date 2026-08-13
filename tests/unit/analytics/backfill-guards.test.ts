import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

/**
 * Feature 125 / T4.1 — GUARDIA ESTRUCTURAL de la feature. Cubre R2, R4, R5, R8, R20, R29, R31,
 * R32 y R33.
 *
 * Por que existe: la 125 es una feature de FRONTERA. Todo su valor esta en lo que NO hace —no
 * agrega, no consulta, no expone superficie, no toca dinero, no anade esquema—, y lo que no
 * existe no se puede observar ejecutando nada. Un test de comportamiento pasaria igual de verde
 * el dia en que alguien meta aqui una consulta propia a la tabla del rollup «solo para
 * comprobar»: es el guardia el que ve el archivo.
 *
 * Se censa **solo el codigo**: los comentarios se retiran antes de buscar, misma decision (y
 * misma razon) que en `modulo-puro.guardia.test.ts` y en `analytics-daily-guards.test.ts`. Los
 * archivos de esta feature estan OBLIGADOS a nombrar en prosa lo que tienen prohibido usar —el
 * planificador explica por que bajo el horizonte no hay filas, el script explica por que no
 * copia la guarda de host—. Censar el texto crudo convertiria la documentacion que respeta el
 * contrato en una infraccion, y la salida rapida a ese rojo seria borrar los comentarios.
 *
 * El guardia NO puede pasar por vacio: la ultima seccion le pasa tres fixtures escritos a mano
 * (uno legitimo y dos infractores) y exige que los clasifique bien.
 */

const RAIZ = path.join(__dirname, "..", "..", "..");
const posix = (p: string) => p.split(path.sep).join("/");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, ...rel.split("/")), "utf8");
const existe = (rel: string) => fs.existsSync(path.join(RAIZ, ...rel.split("/")));

/**
 * Los archivos que ESTA feature anade. Lista EXACTA, y todas las rutas tienen que existir: una
 * entrada muerta convierte el censo en un comodin silencioso (misma regla que los allowlist de
 * la 124). Que la lista este COMPLETA lo comprueba el caso «el censo cubre todo lo que importa
 * los modulos de la 125».
 */
const ARCHIVOS_125 = [
  "lib/analytics/backfill-rango.ts",
  "lib/interfaces/services/IAnaliticaBackfillService.ts",
  "lib/services/AnaliticaBackfillService.ts",
  "scripts/backfill-analitica.ts",
];

/** Los modulos por cuyo import se reconoce a un consumidor de la 125. */
const MODULOS_125 = [
  "@/lib/analytics/backfill-rango",
  "@/lib/interfaces/services/IAnaliticaBackfillService",
  "@/lib/services/AnaliticaBackfillService",
  "@/scripts/backfill-analitica",
];

/**
 * Feature 126 / R19 — CONSUMIDORES EXTERNOS LEGITIMOS del planificador de la 125.
 *
 * Estos archivos NO son de la feature 125 y no se someten a sus reglas estructurales: son
 * consumidores. Estan aqui porque R19 de la **feature 126** les OBLIGA a reusar
 * `HORIZONTE_HISTORIAL_CR` / `esNoComparable` en vez de declarar una segunda constante de
 * horizonte —lo cual seria la clasica cifra duplicada que un dia diverge, y la 126 tiene su
 * propio censo (`operativa-cobertura.test.ts`) exigiendo que la fecha literal aparezca en UN
 * solo archivo del arbol: precisamente `lib/analytics/backfill-rango.ts`.
 *
 * Cuando la 125 escribio este caso no existia ningun consumidor fuera de la feature, asi que
 * «consumidor = archivo de la feature» era cierto. Con la 126 deja de serlo. La excepcion se
 * acota a lo minimo y va acompanada de DOS casos nuevos que la sostienen: uno prohibe que un
 * consumidor externo importe el SERVICIO o el SCRIPT del backfill (no solo el planificador
 * puro) y otro exige que cada entrada exista y siga importando la 125 de verdad.
 */
const CONSUMIDORES_EXTERNOS = ["lib/services/AnaliticaOperativaService.ts"];

const DIRS_CODIGO = ["app", "lib", "scripts", "components", "hooks", "providers", "e2e"];
const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function recorrer(dir: string): string[] {
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      salida.push(...recorrer(rel));
    } else if (EXTENSIONES.includes(path.extname(entrada.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

const ARCHIVOS_CODIGO = DIRS_CODIGO.flatMap(recorrer).map(posix);

/** Fuente sin comentarios de linea ni de bloque, conservando las cadenas. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/* -------------------------------------------------------------------------- */
/* Las reglas, como funciones puras: son lo que los fixtures ejercitan          */
/* -------------------------------------------------------------------------- */

/** Las tablas de analitica que esta feature no puede nombrar ni consultar. */
const TABLAS_ANALITICA = ["analytics_daily", "analyticsDaily"];

/** Las cinco tablas de dinero (R5). Ni leerlas, ni escribirlas, ni nombrarlas. */
const TABLAS_DINERO = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
];

/**
 * Las diez medidas del rollup. Que aparezcan aqui significaria que la 125 esta redefiniendo lo
 * que la 124 ya define: dos definiciones capaces de divergir en silencio, que es exactamente lo
 * que D1 evita al hacer que esta feature CONSUMA el agregador.
 */
const MEDIDAS_ROLLUP = [
  "ordenes_creadas",
  "ordenes_estado_stock",
  "primer_intento_ok",
  "seg_ciclo_acum",
  "seg_ciclo_n",
  "causa_devolucion",
];

/** Formas de consultar la base, cualquiera que sea la tabla. */
const CONSULTAS = [
  /\$queryRaw/,
  /\$executeRaw/,
  /\bprisma\s*\.\s*[a-z][A-Za-z]*\s*\.\s*(findMany|findFirst|findUnique|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
];

/** Superficie que R2 prohibe: HTTP, cron, job recurrente o Server Action. */
const SUPERFICIE = [
  { patron: /(^|\s)["']use server["']/, motivo: 'declara "use server"' },
  { patron: /\bexport\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/, motivo: "declara un route handler" },
  { patron: /\bNextResponse\b|\bNextRequest\b/, motivo: "habla HTTP con Next" },
  { patron: /\bRecurrenciaSpec\b|\bJobHandler\b/, motivo: "declara un job recurrente" },
];

/** Cualquier URL de conexion escrita en el codigo (R29). */
const URL_DE_CONEXION = /(postgres(?:ql)?|mysql|mongodb|redis):\/\//;

/**
 * `catch` cuyo cuerpo esta vacio (R31). Se aplica sobre el codigo SIN comentarios a proposito:
 * un `catch { /* da igual *\/ }` se traga el error igual de silenciosamente, y el comentario no
 * lo convierte en manejado.
 */
const CATCH_VACIO = /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/;

/** DDL de esquema: si aparece aqui, la feature esta anadiendo modelo (R5). */
const DDL = /\b(CREATE\s+TABLE|ALTER\s+TABLE|ADD\s+COLUMN|DROP\s+TABLE|CREATE\s+INDEX)\b/i;

/**
 * Todas las infracciones estructurales de UN archivo de la 125. Es la funcion que los fixtures
 * ejercitan: si dejara de detectar, el guardia entero se queda mudo y verde.
 */
export function infraccionesEstructurales(nombre: string, fuente: string): string[] {
  const codigo = soloCodigo(fuente);
  const motivos: string[] = [];

  for (const tabla of TABLAS_ANALITICA) {
    if (codigo.includes(tabla)) motivos.push(`${nombre}: nombra la tabla de analitica "${tabla}"`);
  }
  for (const consulta of CONSULTAS) {
    if (consulta.test(codigo)) motivos.push(`${nombre}: consulta la base directamente`);
  }
  for (const tabla of TABLAS_DINERO) {
    if (codigo.includes(tabla)) motivos.push(`${nombre}: menciona la tabla de dinero "${tabla}"`);
  }
  for (const medida of MEDIDAS_ROLLUP) {
    if (codigo.includes(medida)) motivos.push(`${nombre}: redefine la medida del rollup "${medida}"`);
  }
  for (const { patron, motivo } of SUPERFICIE) {
    if (patron.test(codigo)) motivos.push(`${nombre}: ${motivo}`);
  }
  if (URL_DE_CONEXION.test(codigo)) motivos.push(`${nombre}: lleva una URL de conexion escrita`);
  if (CATCH_VACIO.test(codigo)) motivos.push(`${nombre}: tiene un catch vacio`);
  if (DDL.test(codigo)) motivos.push(`${nombre}: contiene DDL de esquema`);
  if (/from\s+["']@\/lib\/analytics\/ranges["']/.test(codigo)) {
    motivos.push(`${nombre}: usa los presets de ranges (mes es una ventana movil, no un mes)`);
  }
  return motivos;
}

/* -------------------------------------------------------------------------- */
/* El censo sobre los archivos de verdad                                       */
/* -------------------------------------------------------------------------- */

describe("el censo de la 125 mira archivos que existen y no se le escapa ninguno", () => {
  it("las cuatro rutas censadas existen: una entrada muerta seria un comodin silencioso", () => {
    for (const rel of ARCHIVOS_125) {
      expect(existe(rel), `${rel} no existe: actualiza la lista del guardia`).toBe(true);
    }
    expect(ARCHIVOS_CODIGO.length).toBeGreaterThan(100);
    for (const rel of ARCHIVOS_125) expect(ARCHIVOS_CODIGO).toContain(rel);
  });

  it("el censo cubre todo lo que importa los modulos de la 125", () => {
    // Si manana nace un quinto archivo de la feature y no entra en la lista, este caso lo caza.
    const consumidores = ARCHIVOS_CODIGO.filter((rel) => {
      const codigo = soloCodigo(leer(rel));
      return MODULOS_125.some((m) => codigo.includes(`"${m}"`) || codigo.includes(`'${m}'`));
    });
    const fuera = consumidores.filter(
      (rel) => !ARCHIVOS_125.includes(rel) && !CONSUMIDORES_EXTERNOS.includes(rel),
    );
    expect(fuera, "archivos que usan la 125 y el guardia no esta censando").toEqual([]);
  });

  // Feature 126 / R19 — LA CONTRAPARTIDA DE LA EXCEPCION DE ARRIBA, y es mas estricta que
  // ella. Un consumidor externo puede importar el PLANIFICADOR PURO (el horizonte y su
  // predicado, que es lo que R19 de la 126 le OBLIGA a reusar) y NADA MAS. Importar el
  // SERVICIO o el SCRIPT del backfill desde una ruta por request seria meter un recomputo de
  // fechas pasadas en el camino caliente, que es exactamente lo que R2 de la 125 prohibe.
  it("un consumidor externo solo puede importar el planificador puro, nunca el servicio", () => {
    const MODULOS_PROHIBIDOS_FUERA = MODULOS_125.filter((m) => !m.endsWith("/backfill-rango"));
    const infractores: string[] = [];
    for (const rel of CONSUMIDORES_EXTERNOS) {
      const codigo = soloCodigo(leer(rel));
      for (const m of MODULOS_PROHIBIDOS_FUERA) {
        if (codigo.includes(`"${m}"`) || codigo.includes(`'${m}'`)) {
          infractores.push(`${rel} :: importa ${m}`);
        }
      }
    }
    expect(
      infractores,
      "un consumidor externo de la 125 solo puede reusar `backfill-rango` (planificador PURO). " +
        "El servicio y el script son el backfill, y el backfill no vive en una ruta por request.",
    ).toEqual([]);
  });

  it("la excepcion SOPORTA PESO: cada consumidor externo existe y de verdad importa la 125", () => {
    // Direccion 1 — una entrada que apunta a un archivo inexistente es un comodin silencioso.
    // Direccion 2 — y una que ya no importe la 125 sobra: se retira, no se deja «por si acaso».
    for (const rel of CONSUMIDORES_EXTERNOS) {
      expect(existe(rel), `${rel} esta exento del censo de la 125 pero no existe`).toBe(true);
      const codigo = soloCodigo(leer(rel));
      expect(
        MODULOS_125.some((m) => codigo.includes(`"${m}"`) || codigo.includes(`'${m}'`)),
        `${rel} ya no importa la 125: retira la entrada de CONSUMIDORES_EXTERNOS`,
      ).toBe(true);
    }
  });
});

describe("R4 · los archivos de la 125 no contienen queryRaw, prisma.<modelo> ni el nombre de ninguna tabla de analitica", () => {
  it("ninguno consulta la base ni nombra la tabla del rollup en codigo", () => {
    const infracciones = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter(
      (m) => /consulta la base|tabla de analitica/.test(m),
    );
    expect(infracciones).toEqual([]);
  });

  it("ninguno declara una segunda definicion de las medidas del rollup", () => {
    const infracciones = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter(
      (m) => m.includes("redefine la medida"),
    );
    expect(infracciones).toEqual([]);
  });

  it("las filas salen del agregador de la 124 y de ningun otro sitio", () => {
    // La contracara en verde: la ausencia de consultas no demuestra que se llame a quien toca.
    const servicio = soloCodigo(leer("lib/services/AnaliticaBackfillService.ts"));
    expect(servicio).toMatch(/rollup\.agregarFecha\(/);
    expect(servicio).toMatch(/IAnaliticaRollupService/);
    const llamadas = servicio.match(/agregarFecha\(/g) ?? [];
    expect(llamadas.length, "hay mas de una llamada al agregador en el iterador").toBe(1);
  });
});

describe("R2 · censo: ningun archivo bajo app/api, lib/services/jobs ni con «use server» referencia el backfill", () => {
  it("ni el backfill declara superficie, ni nadie con superficie lo importa", () => {
    const propias = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter((m) =>
      /use server|route handler|HTTP|job recurrente/.test(m),
    );
    expect(propias, "un archivo de la 125 declara superficie").toEqual([]);

    const sospechosos = ARCHIVOS_CODIGO.filter(
      (rel) =>
        rel.startsWith("app/api/") ||
        rel.startsWith("lib/services/jobs/") ||
        /(^|\s)["']use server["']/.test(soloCodigo(leer(rel))),
    );
    expect(sospechosos.length, "el censo de superficie no esta mirando nada").toBeGreaterThan(10);

    const importadores = sospechosos.filter((rel) => {
      const codigo = soloCodigo(leer(rel));
      return MODULOS_125.some((m) => codigo.includes(m));
    });
    expect(
      importadores,
      "el backfill es un script one-shot: exponerlo por HTTP, por cron, por la cola o como " +
        "Server Action le daria un disparador que nadie esta mirando",
    ).toEqual([]);
  });
});

describe("R5 · la feature no anade carpetas bajo db/migrations, no modifica db/schema.prisma y no menciona las cinco tablas de dinero", () => {
  it("no hay migracion de la 125 ni rastro suyo en el schema", () => {
    const migraciones = fs
      .readdirSync(path.join(RAIZ, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(migraciones.length).toBeGreaterThan(10);
    expect(migraciones.filter((n) => /backfill|125/i.test(n))).toEqual([]);

    // El schema NO puede ganar modelo, enum ni tabla por esta feature. La palabra «backfill»
    // ya aparece cuatro veces en prosa (la 101, la 123 y dos comentarios de columnas), asi que
    // buscarla a secas seria un rojo por documentacion ajena: lo que se censa es la DECLARACION.
    const schema = leer("db/schema.prisma");
    expect(schema).not.toMatch(/\b(model|enum)\s+\w*Backfill/i);
    expect(schema).not.toMatch(/@@map\(["']\w*backfill\w*["']\)/i);
    expect(schema).not.toMatch(/AnaliticaBackfill/);

    // Y ningun archivo de la feature lleva DDL dentro.
    const conDDL = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter((m) =>
      m.includes("DDL"),
    );
    expect(conDDL).toEqual([]);
  });

  it("ninguno de los archivos menciona ninguna de las cinco tablas de dinero", () => {
    const infracciones = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter(
      (m) => m.includes("tabla de dinero"),
    );
    expect(infracciones).toEqual([]);
    // Ni siquiera en prosa: no hay ninguna razon legitima para nombrarlas aqui.
    for (const rel of ARCHIVOS_125) {
      for (const tabla of TABLAS_DINERO) expect(leer(rel), `${rel} nombra ${tabla}`).not.toContain(tabla);
    }
  });
});

describe("R8 · 0 imports de @/lib/analytics/ranges en los archivos de la 125", () => {
  it("el rango es de calendario y no sale de los presets: «mes» es una ventana movil de 30 dias", () => {
    const infracciones = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter(
      (m) => m.includes("presets de ranges"),
    );
    expect(infracciones).toEqual([]);
    // La contracara: el recorrido SI sale de `fecha-cr`.
    expect(soloCodigo(leer("lib/analytics/backfill-rango.ts"))).toMatch(
      /from\s+["']@\/lib\/utils\/fecha-cr["']/,
    );
  });
});

describe("R20 · el horizonte se declara una sola vez y su comentario cita la migracion", () => {
  it("la constante vive en un solo archivo y su procedencia existe de verdad", () => {
    const declaradores = ARCHIVOS_CODIGO.filter((rel) =>
      /HORIZONTE_HISTORIAL_CR\s*=/.test(soloCodigo(leer(rel))),
    );
    expect(declaradores).toEqual(["lib/analytics/backfill-rango.ts"]);

    const fuente = leer("lib/analytics/backfill-rango.ts");
    expect(fuente).toMatch(/20260713120000_orden_historial_estado/);
    expect(fuente, "el comentario tiene que decir que la migracion fue ADITIVA").toMatch(/aditiva/i);
    expect(fuente, "y que NO backfilleo nada: es lo que hace util al horizonte").toMatch(
      /sin backfill/i,
    );
    expect(existe("db/migrations/20260713120000_orden_historial_estado/migration.sql")).toBe(true);
  });
});

describe("R29 · 0 literales de URL de conexion en los archivos de la 125", () => {
  it("ninguno lleva una URL ni una credencial escrita", () => {
    const infracciones = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter(
      (m) => m.includes("URL de conexion"),
    );
    expect(infracciones).toEqual([]);
    // La contracara: el destino sale de la variable de entorno, no de una constante.
    expect(soloCodigo(leer("scripts/backfill-analitica.ts"))).toMatch(/env\.DATABASE_URL/);
  });
});

describe("R31 · 0 catch vacios en los archivos de la 125", () => {
  it("todo catch hace algo: devolver un motivo, registrar la fecha o propagar", () => {
    const infracciones = ARCHIVOS_125.flatMap((rel) => infraccionesEstructurales(rel, leer(rel))).filter(
      (m) => m.includes("catch vacio"),
    );
    expect(infracciones).toEqual([]);
  });
});

describe("R33 · la 125 no toca los modulos del escritor de la 124 salvo lib/config/analitica-rollup.ts", () => {
  /** Los diez modulos del escritor, tal y como los declaran los guardias de la 124. */
  const MODULOS_ESCRITOR_124 = [
    "lib/interfaces/repositories/IAnaliticaRollupRepository.ts",
    "lib/interfaces/services/IAnaliticaRollupService.ts",
    "lib/repositories/AnaliticaRollupRepository.ts",
    "lib/services/AnaliticaRollupService.ts",
    "lib/services/jobs/analitica-rollup-diario-handler.ts",
    "lib/services/jobs/analitica-rollup-diario-encolado.ts",
    "lib/analytics/rollup-dia.ts",
    "scripts/seed-jobs-analitica-rollup-diario.ts",
    "scripts/rollup-analitica-manual.ts",
  ];

  it("ningun modulo del escritor nombra en codigo a la 125: la dependencia va en un solo sentido", () => {
    for (const rel of MODULOS_ESCRITOR_124) {
      expect(existe(rel), `${rel} ya no existe: la lista de la 124 caduco`).toBe(true);
      const codigo = soloCodigo(leer(rel));
      for (const modulo of MODULOS_125) {
        expect(codigo, `${rel} referencia ${modulo}`).not.toContain(modulo);
      }
      expect(codigo).not.toContain("AnaliticaBackfillService");
      expect(codigo).not.toContain("planificarBackfill");
    }
  });

  it("el unico archivo de la 124 que la 125 amplia es el de configuracion, y solo suma", () => {
    const config = leer("lib/config/analitica-rollup.ts");
    // Lo que ya habia sigue estando: la 125 no sustituye ni retira nada de la 124.
    expect(config).toMatch(/export\s+const\s+UMBRAL_AVISO_FILAS_CORRIDA\b/);
    expect(config).toMatch(/export\s+const\s+TIMEOUT_TX_ROLLUP_MS\b/);
    expect(config).toMatch(/export\s+const\s+FALLOS_CONSECUTIVOS_QUE_ABORTAN\b/);
    // Y la constante de la 125 vive AHI y en ningun otro sitio (R47 de la 124).
    const declaradores = ARCHIVOS_CODIGO.filter((rel) =>
      /FALLOS_CONSECUTIVOS_QUE_ABORTAN\s*=/.test(soloCodigo(leer(rel))),
    );
    expect(declaradores).toEqual(["lib/config/analitica-rollup.ts"]);
  });
});

/* -------------------------------------------------------------------------- */
/* R32 — autocomprobacion por fixtures                                         */
/* -------------------------------------------------------------------------- */

/**
 * Fixture LEGITIMO: la forma real de un archivo de la 125 —importa el planificador y el
 * contrato de la 124, llama al agregador y no consulta nada—. Si el guardia lo marcara, seria
 * un guardia que obliga a escribir la feature de otra manera.
 */
const FIXTURE_LEGITIMO = `
import { esNoComparable } from "@/lib/analytics/backfill-rango";
import type { IAnaliticaRollupService } from "@/lib/interfaces/services/IAnaliticaRollupService";
export class Iterador {
  constructor(private readonly rollup: IAnaliticaRollupService) {}
  async correr(fechas: string[]) {
    for (const fecha of fechas) {
      const r = await this.rollup.agregarFecha(fecha);
      void esNoComparable(fecha);
      void r.filasEscritas;
    }
  }
}
`;

/** Infractor 1: se calcula las filas por su cuenta leyendo la tabla del rollup. */
const FIXTURE_INFRACTOR_CONSULTA = `
import { prisma } from "@/lib/db";
export async function filasDe(fecha: string) {
  return prisma.$queryRaw\`SELECT SUM(ordenes_creadas) FROM analytics_daily WHERE fecha = \${fecha}\`;
}
`;

/** Infractor 2: le pone al backfill un disparador HTTP que nadie esta mirando. */
const FIXTURE_INFRACTOR_SUPERFICIE = `
import { NextResponse } from "next/server";
import { AnaliticaBackfillService } from "@/lib/services/AnaliticaBackfillService";
export async function POST(request: Request) {
  const servicio = new AnaliticaBackfillService(rollup, deps);
  try {
    await servicio.ejecutar(await request.json());
  } catch {
  }
  return NextResponse.json({ ok: true });
}
`;

describe("R32 · el guardia detecta sus fixtures sinteticos: uno legitimo y dos infractores", () => {
  it("el fixture legitimo no produce ni una infraccion", () => {
    expect(infraccionesEstructurales("legitimo.ts", FIXTURE_LEGITIMO)).toEqual([]);
  });

  it("el infractor que consulta la tabla del rollup cae por consulta, por tabla y por medida", () => {
    const motivos = infraccionesEstructurales("infractor-consulta.ts", FIXTURE_INFRACTOR_CONSULTA);
    expect(motivos.some((m) => m.includes("tabla de analitica"))).toBe(true);
    expect(motivos.some((m) => m.includes("consulta la base"))).toBe(true);
    expect(motivos.some((m) => m.includes("redefine la medida"))).toBe(true);
  });

  it("el infractor que expone superficie cae por route handler, por HTTP y por catch vacio", () => {
    const motivos = infraccionesEstructurales("infractor-superficie.ts", FIXTURE_INFRACTOR_SUPERFICIE);
    expect(motivos.some((m) => m.includes("route handler"))).toBe(true);
    expect(motivos.some((m) => m.includes("HTTP"))).toBe(true);
    expect(motivos.some((m) => m.includes("catch vacio"))).toBe(true);
  });

  it("las demas reglas tambien discriminan, una por una", () => {
    const casos: ReadonlyArray<{ fuente: string; espera: string }> = [
      { fuente: 'const URL = "postgresql://u:p@host:5432/base";', espera: "URL de conexion" },
      { fuente: '"use server";\nexport async function correrBackfill() {}', espera: "use server" },
      { fuente: 'export const spec: RecurrenciaSpec = { siguiente: () => x };', espera: "job recurrente" },
      { fuente: 'await prisma.$executeRaw`ALTER TABLE analytics_daily ADD COLUMN x int`;', espera: "DDL" },
      { fuente: 'import { rango } from "@/lib/analytics/ranges";', espera: "presets de ranges" },
      { fuente: 'const t = await prisma.walletMovimiento.findMany(); // wallet_movimiento', espera: "consulta la base" },
      { fuente: 'const q = "SELECT * FROM cierre_dia";', espera: "tabla de dinero" },
      { fuente: "try { f(); } catch (e) {}", espera: "catch vacio" },
    ];
    for (const { fuente, espera } of casos) {
      const motivos = infraccionesEstructurales("x.ts", fuente);
      expect(motivos.join(" | "), `no detecto: ${espera} en ${fuente}`).toContain(espera);
    }
  });

  it("y NO marca lo que solo aparece en un comentario: la prosa que explica el contrato", () => {
    const prosa = `
// Este script NO nombra analytics_daily, no usa $queryRaw y no toca cierre_dia.
/* Tampoco declara "use server" ni un route handler con export async function GET. */
export const x = 1;
`;
    expect(infraccionesEstructurales("prosa.ts", prosa)).toEqual([]);
  });
});
