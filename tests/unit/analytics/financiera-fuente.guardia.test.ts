import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { listarMetricas } from "@/lib/analytics/metrics";
import type { TablaDinero } from "@/lib/analytics/types";

// Feature 127 / T B.1 — GUARDIA DE FUENTE EXCLUSIVA: R1, R2, R3, R33, R34.
//
// La consigna de la feature es que el dinero NUNCA se recalcula desde ordenes: la cifra del
// tablero y la cifra que alguien cobra tienen que venir del mismo sitio. Los tipos no alcanzan
// para eso —`$queryRaw` no tiene tipos, y un `include: { orden: true }` compila perfectamente—
// asi que el limite lo pone un censo de texto sobre los archivos de la feature.
//
// El universo permitido son las CINCO tablas de `TablaDinero`: los tres ledgers append-only y
// los dos snapshots de cierre. TODO lo demas esta prohibido, no solo las cuatro tablas de la
// analitica operativa:
//   - `analytics_daily` porque el rollup se deriva de `orden`/`gestion_orden` (leerlo seria
//     recalcular el dinero desde ordenes por la puerta de atras) y porque el R42 de la 124 se
//     lo prohibe a TODO el mundo. Si algun dia este diseño lo necesitara, eso es una
//     contradiccion declarada que va a la puerta T0, no una prohibicion que se afloja de paso;
//   - `orden`, `gestion_orden` y `orden_historial_estado` por la consigna;
//   - `usuario`, `zona` y el resto del esquema porque R33 dice "fuera del universo permitido",
//     y resolver el NOMBRE de una tienda con un join es la via mas facil de acabar filtrando
//     una identidad en una respuesta financiera (R14).
//
// R34 — EL CENSO SE AUTOCOMPRUEBA. Hoy la feature tiene tres modulos y ninguna consulta: un
// guardia escrito ahora estaria verde por vacio y nadie sabria si funciona hasta que fuese
// demasiado tarde. Por eso el detector se ejercita con fixtures sinteticos (uno legitimo y
// CUATRO infractores, incluido uno con SQL crudo y uno que se cuela por una relacion), y ademas
// hay casos que comprueban que el censo mira archivos de verdad.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/* -------------------------------------------------------------------------- */
/* 1. El universo permitido y su complemento                                   */
/* -------------------------------------------------------------------------- */

/**
 * Las cinco tablas de `TablaDinero`. El `satisfies` no es decorativo: añadir aqui una tabla
 * que no sea de dinero no compila, asi que el permiso no se puede ampliar de paso.
 */
const PERMITIDAS = [
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "cierre_dia",
  "cierre_bodega",
] as const satisfies readonly TablaDinero[];

const PERMITIDAS_SET: ReadonlySet<string> = new Set(PERMITIDAS);

/** Modelos del esquema, con su nombre de tabla real (`@@map`) y su nombre en el cliente. */
function modelosDelEsquema(): readonly { readonly modelo: string; readonly tabla: string }[] {
  const schema = fs.readFileSync(path.join(REPO_ROOT, "db", "schema.prisma"), "utf8");
  return [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map((m) => {
    const nombre = m[1];
    const mapeo = m[2].match(/@@map\("([^"]+)"\)/);
    return {
      modelo: nombre[0].toLowerCase() + nombre.slice(1),
      tabla: mapeo ? mapeo[1] : nombre.toLowerCase(),
    };
  });
}

const MODELOS = modelosDelEsquema();
const PROHIBIDOS = MODELOS.filter((m) => !PERMITIDAS_SET.has(m.tabla));

/**
 * Relaciones que NO se llaman como su modelo y que llevan fuera del universo. Son las que un
 * repositorio de esta feature podria tener a mano sin darse cuenta: `wallet_tienda_movimiento`
 * tiene `tienda`, `cierre_dia` tiene `mensajero` y `destinoZona`, los tres ledgers tienen
 * `registrador`. Todas apuntan a `usuario` o a `zona`, y todas serian una identidad entrando
 * en una respuesta de dinero.
 */
const RELACIONES_FUERA_DEL_UNIVERSO = [
  "tienda",
  "mensajero",
  "registrador",
  "zona",
  "destinoZona",
  "resueltoPorUsuario",
  "solicitadoPorUsuario",
  "gestiones",
  "detalle",
];

const OPERACIONES_PRISMA =
  "findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany";

/* -------------------------------------------------------------------------- */
/* 2. El detector                                                              */
/* -------------------------------------------------------------------------- */

/** Un comentario no es una consulta: la prosa que EXPLICA por que no se lee `orden` no infringe. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Devuelve el motivo si el archivo nombra una tabla fuera del universo permitido, o `null`.
 * Es la funcion que los fixtures ejercitan: si deja de detectar, este archivo se pone rojo
 * aunque el repo siga limpio.
 */
export function fuenteProhibida(nombre: string, fuente: string): string | null {
  const codigo = soloCodigo(fuente);

  // R2 — `analytics_daily` no se nombra NI UNA VEZ en codigo, con o sin Prisma de por medio.
  if (/\banalytics_daily\b|\banalyticsDaily\b/.test(codigo)) {
    return `${nombre}: nombra analytics_daily, que R2 prohibe a esta feature (y R42 de la 124 a todo el mundo)`;
  }

  for (const { modelo, tabla } of PROHIBIDOS) {
    if (new RegExp(`\\.\\s*${modelo}\\s*\\.\\s*(${OPERACIONES_PRISMA})`).test(codigo)) {
      return `${nombre}: consulta ${tabla}, que esta fuera del universo permitido (TablaDinero)`;
    }
    if (new RegExp(`(queryRaw|executeRaw)(Unsafe)?[\\s\\S]{0,400}\\b${tabla}\\b`).test(codigo)) {
      return `${nombre}: nombra ${tabla} (SQL crudo), que esta fuera del universo permitido`;
    }
    if (new RegExp(`\\b${modelo}\\s*:\\s*true\\b`).test(codigo)) {
      return `${nombre}: trae ${tabla} por relacion (include/select), que esta fuera del universo permitido`;
    }
  }

  for (const relacion of RELACIONES_FUERA_DEL_UNIVERSO) {
    if (new RegExp(`\\b${relacion}\\s*:\\s*true\\b`).test(codigo)) {
      return `${nombre}: trae la relacion ${relacion}, que sale del universo permitido (y mete una identidad en una cifra)`;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* 3. Que archivos son "de la feature"                                         */
/* -------------------------------------------------------------------------- */

/**
 * Los modulos que el design.md §3 declara. Se listan TODOS, incluidos los que aun no existen
 * (tandas C-E): asi, en cuanto se creen, entran al censo sin que nadie tenga que acordarse de
 * añadirlos aqui.
 */
const ARCHIVOS_DECLARADOS = [
  "lib/types/analitica-financiera.ts",
  "lib/config/analitica-financiera.ts",
  "lib/interfaces/repositories/IIngresosAnaliticaRepository.ts",
  "lib/interfaces/repositories/IRecaudoAnaliticaRepository.ts",
  "lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository.ts",
  "lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository.ts",
  "lib/interfaces/services/IAnaliticaFinancieraService.ts",
  "lib/repositories/IngresosAnaliticaRepository.ts",
  "lib/repositories/RecaudoAnaliticaRepository.ts",
  "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
  "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
  "lib/services/AnaliticaFinancieraService.ts",
  "lib/actions/analitica-financiera.ts",
];

/**
 * Un archivo TAMBIEN es de la feature si importa uno de sus modulos. La lista de arriba se
 * queda corta en cuanto alguien parta un repositorio en dos; el descubrimiento por import no.
 */
const HUELLA_DE_LA_FEATURE =
  /analitica-financiera|AnaliticaFinanciera|(Ingresos|Recaudo|CuentasPorPagar|ConciliacionCierres)AnaliticaRepository/;

const DIRS_IGNORADOS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

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

const relativa = (abs: string) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");

/** Los declarados que existen HOY en el arbol. */
function declaradosExistentes(): readonly string[] {
  return ARCHIVOS_DECLARADOS.filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)));
}

/** Los que entran al censo por el brazo de descubrimiento, sin mirar la lista declarada. */
function descubiertosPorImport(): readonly string[] {
  return archivosDeCodigo(path.join(REPO_ROOT, "lib"))
    .map(relativa)
    .filter((rel) => HUELLA_DE_LA_FEATURE.test(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")))
    .sort();
}

function archivosDeLaFeature(): readonly string[] {
  return [...new Set([...declaradosExistentes(), ...descubiertosPorImport()])].sort();
}

/* -------------------------------------------------------------------------- */
/* 4. El censo real                                                            */
/* -------------------------------------------------------------------------- */

describe("R1/R2/R3/R33 · censo de fuente sobre los archivos de la 127", () => {
  it("ningun archivo de la feature nombra una tabla fuera de TablaDinero", () => {
    const infractores = archivosDeLaFeature()
      .map((rel) => fuenteProhibida(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")))
      .filter((v): v is string => v !== null);

    expect(infractores).toEqual([]);
  });

  it("el censo mira los TRECE modulos declarados, todos: no pasa por conjunto vacio ni recortado", () => {
    // ⚠ POR QUE NO HAY UNA IGUALDAD EXACTA CONTRA UNA LISTA DE TRECE (cierre del menor 1 del
    // review, 2026-08-02). El censo tiene DOS brazos: la lista declarada y el descubrimiento por
    // import. El segundo es abierto por diseño —en cuanto la 132 o la 134 escriban un modulo que
    // importe algo de la 127, entrara solo—, asi que un `toEqual([...trece])` sobre el censo
    // ENTERO seria una lista que se desactualiza sola y que el siguiente empujaria hacia abajo.
    // Lo que si se puede exigir, y es estrictamente mas fuerte que el `>= 3` de antes, son las
    // tres igualdades de abajo: ninguna de ellas sobrevive a que se borre un archivo del censo.
    const censados = archivosDeLaFeature();
    const declarados = declaradosExistentes();
    const descubiertos = descubiertosPorImport();

    // (1) IGUALDAD EXACTA sobre la lista declarada: los TRECE existen, ni uno menos. Antes se
    //     podian borrar diez y el ancla `>= 3` seguia verde.
    expect([...declarados].sort()).toEqual([...ARCHIVOS_DECLARADOS].sort());

    // (2) Y los trece estan DENTRO del censo. El censo puede tener mas (brazo de import), nunca
    //     menos: la diferencia en el sentido que importa es vacia.
    expect(ARCHIVOS_DECLARADOS.filter((rel) => !censados.includes(rel))).toEqual([]);

    // (3) El brazo de descubrimiento esta VIVO, no solo presente. Si la huella dejara de casar
    //     (feature renombrada, regex rota), el censo se reduciria en silencio a la lista de
    //     arriba y nadie se enteraria; estos seis lo impiden. No se exige igualdad exacta aqui
    //     por lo dicho al principio: el conjunto descubierto crece con las features vecinas.
    expect(
      [
        "lib/repositories/IngresosAnaliticaRepository.ts",
        "lib/repositories/RecaudoAnaliticaRepository.ts",
        "lib/repositories/CuentasPorPagarAnaliticaRepository.ts",
        "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
        "lib/services/AnaliticaFinancieraService.ts",
        "lib/actions/analitica-financiera.ts",
      ].filter((rel) => !descubiertos.includes(rel)),
    ).toEqual([]);

    // (4) Y cada archivo censado se lee de verdad: nada entra al censo como ruta fantasma.
    expect(censados).not.toEqual([]);
    for (const rel of censados) {
      expect(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").length, rel).toBeGreaterThan(0);
    }
  });

  it("el complemento del universo no esta vacio: hay esquema que leer y modelos que prohibir", () => {
    expect(MODELOS.length).toBeGreaterThan(20);
    expect(PROHIBIDOS.map((m) => m.tabla)).toContain("orden");
    expect(PROHIBIDOS.map((m) => m.tabla)).toContain("gestion_orden");
    expect(PROHIBIDOS.map((m) => m.tabla)).toContain("usuario");
    expect(PROHIBIDOS.map((m) => m.tabla)).not.toContain("wallet_movimiento");
  });
});

describe("R4 · el universo permitido es exactamente el que declara el catalogo", () => {
  it("las tablas de las ocho financieras y las cinco de TablaDinero son el mismo conjunto", () => {
    const delCatalogo = new Set(
      listarMetricas({ dominio: "financiera" }).flatMap((m) => [...m.fuente.tablas]),
    );
    expect([...delCatalogo].sort()).toEqual([...PERMITIDAS].sort());
  });
});

/* -------------------------------------------------------------------------- */
/* 5. R34 — autocomprobacion con fixtures                                      */
/* -------------------------------------------------------------------------- */

const FIXTURE_LEGITIMO = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class IngresosAnaliticaRepository {
  async sumarPorCategoria(consulta: ConsultaAnalitica) {
    return this.prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where: {
        categoria: { in: consulta.metrica.definicion.categorias },
        fechaMovimiento: { gte: consulta.rango.desde, lt: consulta.rango.hasta },
      },
      _sum: { monto: true },
      orderBy: [{ categoria: "asc" }, { tipo: "asc" }],
    });
  }
}
`;

const FIXTURE_LEGITIMO_LAS_CINCO = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class ConciliacionCierresAnaliticaRepository {
  async todo(consulta: ConsultaAnalitica) {
    await this.prisma.cierreDia.groupBy({ by: ["estado"], where: { resueltoAt: { gte: consulta.rango.desde } } });
    await this.prisma.cierreBodega.groupBy({ by: ["estado"] });
    await this.prisma.walletMovimiento.groupBy({ by: ["origenId"] });
    await this.prisma.walletTiendaMovimiento.groupBy({ by: ["origenId"] });
    await this.prisma.pagoMensajeroMovimiento.groupBy({ by: ["origenId"] });
  }
}
`;

const FIXTURE_INFRACTOR_ORDEN = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class RecaudoAnaliticaRepository {
  async porTienda(consulta: ConsultaAnalitica) {
    return this.prisma.orden.aggregate({ _sum: { montoCobrar: true }, where: { createdAt: { gte: consulta.rango.desde } } });
  }
}
`;

const FIXTURE_INFRACTOR_RAW = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class RecaudoAnaliticaRepository {
  async porTienda(consulta: ConsultaAnalitica) {
    return this.prisma.$queryRaw\`SELECT tienda_id, SUM(monto) FROM gestion_orden WHERE creado >= \${consulta.rango.desde}\`;
  }
}
`;

const FIXTURE_INFRACTOR_ROLLUP = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class IngresosAnaliticaRepository {
  async serie(consulta: ConsultaAnalitica) {
    return this.prisma.analyticsDaily.groupBy({ by: ["fecha"], _sum: { entregas: true } });
  }
}
`;

const FIXTURE_INFRACTOR_RELACION = `
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
export class RecaudoAnaliticaRepository {
  async porTienda(consulta: ConsultaAnalitica) {
    return this.prisma.walletTiendaMovimiento.findMany({
      where: { fechaMovimiento: { gte: consulta.rango.desde } },
      include: { tienda: true },
    });
  }
}
`;

describe("R34 · el detector se autocomprueba: acepta lo legitimo y cae con los infractores", () => {
  it("acepta el repositorio que solo consulta la caja principal", () => {
    expect(fuenteProhibida("legitimo.ts", FIXTURE_LEGITIMO)).toBeNull();
  });

  it("acepta un repositorio que toca las CINCO tablas del universo", () => {
    expect(fuenteProhibida("legitimo-cinco.ts", FIXTURE_LEGITIMO_LAS_CINCO)).toBeNull();
  });

  it("rechaza el que recalcula el dinero desde orden (R1)", () => {
    const v = fuenteProhibida("infractor-orden.ts", FIXTURE_INFRACTOR_ORDEN);
    expect(v).not.toBeNull();
    expect(v).toContain("orden");
  });

  it("rechaza el que baja a gestion_orden con SQL crudo (R3/R33)", () => {
    const v = fuenteProhibida("infractor-raw.ts", FIXTURE_INFRACTOR_RAW);
    expect(v).not.toBeNull();
    expect(v).toContain("SQL crudo");
    expect(v).toContain("gestion_orden");
  });

  it("rechaza el que lee el rollup diario (R2)", () => {
    const v = fuenteProhibida("infractor-rollup.ts", FIXTURE_INFRACTOR_ROLLUP);
    expect(v).not.toBeNull();
    expect(v).toContain("analytics_daily");
  });

  it("rechaza el que se sale del universo por una relacion (R3/R14)", () => {
    const v = fuenteProhibida("infractor-relacion.ts", FIXTURE_INFRACTOR_RELACION);
    expect(v).not.toBeNull();
    expect(v).toContain("tienda");
  });

  it("rechaza el include de orden aunque no haya consulta directa", () => {
    const disfrazado = FIXTURE_LEGITIMO.replace("_sum: { monto: true },", "include: { orden: true },");
    expect(fuenteProhibida("include-orden.ts", disfrazado)).not.toBeNull();
  });

  it("no marca la PROSA que explica por que no se lee orden ni analytics_daily", () => {
    const conComentarios = `
      // El dinero NUNCA se recalcula desde orden ni desde gestion_orden, y analytics_daily
      // esta prohibido por el R42 de la 124.
      /* Tampoco se hace prisma.orden.findMany({ include: { tienda: true } }) aqui. */
      ${FIXTURE_LEGITIMO}
    `;
    expect(fuenteProhibida("con-prosa.ts", conComentarios)).toBeNull();
  });

  it("y no se deja enganar por un infractor escondido detras de un comentario", () => {
    const disfrazado = `// no leemos orden, de verdad\n${FIXTURE_INFRACTOR_ORDEN}`;
    expect(fuenteProhibida("disfrazado.ts", disfrazado)).not.toBeNull();
  });
});
