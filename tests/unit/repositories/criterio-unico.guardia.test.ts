// Feature 184 — Tanda H (T H.3) — GUARDIA de la SEGUNDA mitad de **R16**.
//
// R16 dice dos cosas, y hasta hoy solo una estaba probada:
//
//  1. «un metodo nuevo y su hermano paginado DEBEN emitir las MISMAS condiciones y el MISMO
//     orden» — cubierto por los diez casos de `historicos-paginados-where.test.ts`,
//     `colas-paginadas-where.test.ts` y `satelite-paginado-where.test.ts`, que ejecutan el
//     repositorio real y comparan los ARGUMENTOS de la consulta emitida (R14).
//  2. «el sistema NO DEBE contener dos declaraciones separadas del mismo criterio» — sin
//     ningun test. Esta guardia es esa mitad.
//
// **El hueco, medido.** Los diez casos comparan EMISIONES. Si alguien deshiciera una constante
// compartida y reescribiera el literal IDENTICO en cada metodo, las emisiones seguirian siendo
// iguales y los diez seguirian VERDES — con el criterio otra vez escrito dos veces, que es el
// estado del que sale esta feature: el hallazgo de la 184 es que el criterio duplicado aparecio
// en las SIETE tandas, con el `orderBy` escrito dos o tres veces en cada par, y en la tanda F la
// version cara: `alcanceWhere` —la guardia que decide si un `adminSatelite` ve el dinero de otra
// zona— estaba declarada TRES veces. Dos declaraciones no fallan el dia que nacen: fallan el dia
// que alguien toca una y no la otra, y ese dia no hay ninguna pantalla que lo diga.
//
// **Que forma de asercion.** Se descarto la version cruda de «cada literal de orden aparece una
// sola vez por archivo»: en `CierreBodegaRepository.ts` seria un FALSO ROJO —dos listados
// distintos, sobre dos tablas distintas (`cierre_dia` y `cierre_bodega`), ordenan los dos por
// `solicitadoAt: "desc"`, y son dos criterios, no uno repetido— y a la vez un falso verde,
// porque una copia en OTRO archivo no la veria. Lo que se afirma, por PAR de listado, es:
//
//   (b) el conjunto y su hermano paginado REFERENCIAN LA MISMA declaracion por nombre, y esa
//       declaracion existe UNA sola vez y a nivel de modulo; y
//   (a·scoped) ninguno de los dos escribe su criterio EN SITIO —ni `orderBy: {...}`, ni
//       `where: {...}`, ni `ORDER BY`/`WHERE` en SQL crudo— dentro de su cuerpo.
//
// (b) sin (a) pasaria con un metodo que leyera la constante y ademas llevara un literal; (a) sin
// (b) pasaria con DOS constantes distintas del mismo valor, que es justo el modo de fallo que
// los diez casos de emision no ven. Juntas, no queda sitio para la segunda declaracion.
//
// **Por que el detector se prueba a si mismo.** El precedente de la casa: en esta misma feature
// una guardia paso VERDE con su propio detector roto —encontraba cero porque no encontraba
// nada— y habria sido un adorno permanente. Una guardia estatica cuyo lector se rompa es
// indistinguible de un arbol limpio. Por eso aqui: el extractor se prueba contra texto sintetico
// con la respuesta conocida en las dos direcciones; cada escaneo lleva su control positivo sobre
// el arbol REAL; y las tres mutaciones que la guardia existe para cazar se aplican EN MEMORIA
// sobre el codigo real y se exige que la pongan roja, con la propia mutacion verificada.
//
// La lectura es ESTATICA (lo que el archivo dice), como `adaptador-conjunto.guardia.test.ts` y
// `cobertura-tablas.guardia.test.ts`. La selecciona `pnpm exec vitest run guard` por el nombre
// del archivo, sin estar registrada en ninguna lista.
import { readFileSync } from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Quita comentarios. En estos repositorios la prosa NOMBRA a proposito el literal que se retiro
 * («estaba escrito dos veces —una en el conjunto y otra en la pagina—») y sin esto el escaneo
 * leeria esa explicacion como una segunda declaracion: falso rojo permanente. Es el mismo helper
 * que usan los dos censos y la guardia del adaptador.
 */
function sinComentarios(fuente: string): string {
  return quitarComentarios(fuente);
}

/**
 * Un miembro de clase: dos espacios de sangria, modificadores opcionales, nombre y `(`.
 *
 * Se corta por SANGRIA y no por conteo de llaves a proposito: el `Prisma.sql` de la bodega
 * satelite lleva `${...}` dentro de plantillas, y un contador de llaves ingenuo se pierde ahi
 * —justo en el par que mas falta hace vigilar—.
 */
const MIEMBRO_DE_CLASE =
  /^ {2}(?:private |public |protected |readonly |static )*(?:async )?([a-zA-Z_$][\w$]*)\s*(?:\(|<)/gm;

interface Miembro {
  nombre: string;
  /** Del inicio de la firma al inicio del siguiente miembro: la declaracion y su cuerpo. */
  cuerpo: string;
}

function miembrosDe(codigo: string): Miembro[] {
  const marcas: { nombre: string; inicio: number }[] = [];
  for (const m of codigo.matchAll(MIEMBRO_DE_CLASE)) {
    marcas.push({ nombre: m[1]!, inicio: m.index! });
  }
  return marcas.map((marca, i) => {
    const siguiente = marcas[i + 1];
    return {
      nombre: marca.nombre,
      cuerpo: codigo.slice(marca.inicio, siguiente === undefined ? undefined : siguiente.inicio),
    };
  });
}

/**
 * Las formas de escribir el criterio EN SITIO. Las dos primeras son la version Prisma; las dos
 * ultimas la version SQL cruda, que es como vivia el criterio de la bodega satelite antes de la
 * tanda A (`condicionesSatelite`/`desdeSatelite`/`ordenBodegaSatelite`).
 */
const CRITERIO_EN_SITIO: { que: string; patron: RegExp }[] = [
  { que: "orderBy con un literal en vez de la constante compartida", patron: /orderBy\s*:\s*[[{]/ },
  { que: "where con un literal en vez del helper compartido", patron: /where\s*:\s*\{/ },
  { que: "ORDER BY escrito a mano en SQL", patron: /ORDER\s+BY/ },
  { que: "WHERE escrito a mano en SQL", patron: /\bWHERE\b/ },
];

interface Par {
  archivo: string;
  /** El listado del Anexo A al que pertenece el par, para que el fallo diga QUE se rompio. */
  listado: string;
  /** El metodo que devuelve el CONJUNTO entero (el del archivo de la descarga). */
  conjunto: string;
  /** Su hermano paginado (el que pinta la tabla). */
  pagina: string;
  /** Declaraciones unicas que construyen el WHERE. Vacio = el listado no acota nada. */
  seleccion: readonly string[];
  /** Declaraciones unicas que construyen el ORDER BY. */
  orden: readonly string[];
  /** Otros metodos que leen el MISMO criterio de seleccion (no necesariamente el orden). */
  tambien?: readonly string[];
  /** Metodos que comparten SOLO el orden: su `where` es legitimamente otro. */
  comparteOrden?: readonly string[];
}

/**
 * Los ONCE pares de la feature 184, tanda por tanda. Cada uno es «un conjunto sin recorte + su
 * hermano paginado» sobre el mismo filtro; el archivo de la descarga sale del primero y la tabla
 * del segundo, y R5 exige que la pagina N sea el segmento N del conjunto.
 */
const PARES: readonly Par[] = [
  // --- Tanda B ---
  {
    archivo: "lib/repositories/CierreBodegaRepository.ts",
    listado: "Cierres del dia a consolidar",
    conjunto: "findCierresDiaConsolidables",
    pagina: "findCierresDiaConsolidablesPaginado",
    seleccion: ["consolidablesWhere"],
    orden: ["ORDEN_CONSOLIDABLES"],
  },
  {
    archivo: "lib/repositories/CierreBodegaRepository.ts",
    listado: "Cierres de bodega solicitados (zona)",
    conjunto: "findCierresBodegaByZona",
    pagina: "findCierresBodegaByZonaPaginado",
    seleccion: ["cierresBodegaDeZonaWhere"],
    orden: ["ORDEN_CIERRES_BODEGA"],
  },
  // --- Tanda C ---
  {
    archivo: "lib/repositories/CierreDiaRepository.ts",
    listado: "Cierres solicitados por el mensajero",
    conjunto: "findCierresByMensajero",
    pagina: "findCierresByMensajeroPaginado",
    seleccion: ["cierresDeMensajeroWhere"],
    orden: ["ORDEN_CIERRES_MENSAJERO"],
  },
  // --- Tanda D: cola e historico PARTICIONAN el alcance; comparten orden con el listado viejo ---
  {
    archivo: "lib/repositories/CierresAdminRepository.ts",
    listado: "Cierres del dia — historico",
    conjunto: "findHistoricoCompleto",
    pagina: "findHistoricoPaginado",
    seleccion: ["historicoWhere"],
    orden: ["ORDEN_CIERRES_ADMIN"],
    comparteOrden: ["findCierresByAlcance"],
  },
  {
    archivo: "lib/repositories/CierresAdminRepository.ts",
    listado: "Cierres del dia pendientes",
    conjunto: "findColaCompleta",
    pagina: "findColaPaginada",
    seleccion: ["colaWhere"],
    orden: ["ORDEN_CIERRES_ADMIN"],
  },
  // --- Tanda E ---
  {
    archivo: "lib/repositories/CierresBodegaAdminRepository.ts",
    listado: "Cierres de bodega resueltos",
    conjunto: "findHistoricoCompleto",
    pagina: "findHistoricoPaginado",
    seleccion: ["historicoBodegaWhere"],
    orden: ["ORDEN_CIERRES_BODEGA_ADMIN"],
    comparteOrden: ["findCierresBodega"],
  },
  {
    archivo: "lib/repositories/CierresBodegaAdminRepository.ts",
    listado: "Cierres de bodega pendientes",
    conjunto: "findColaCompleta",
    pagina: "findColaPaginada",
    seleccion: ["colaBodegaWhere"],
    orden: ["ORDEN_CIERRES_BODEGA_ADMIN"],
  },
  // --- Tanda G: el unico par SIN acotamiento; su criterio de seleccion es «ninguno» ---
  {
    archivo: "lib/repositories/GastoFijoPlantillaRepository.ts",
    listado: "Plantillas de gasto fijo",
    conjunto: "listar",
    pagina: "listarPaginado",
    seleccion: [],
    orden: ["ORDEN_PLANTILLAS"],
    // `listarActivas` es el conjunto del CRON: su `where` es suyo, el orden no.
    comparteOrden: ["listarActivas"],
  },
  // --- Tanda F ---
  {
    archivo: "lib/repositories/IncidenteAdminRepository.ts",
    listado: "Incidentes — historico",
    conjunto: "findHistoricoCompleto",
    pagina: "findHistoricoPaginado",
    seleccion: ["historicoIncidentesWhere"],
    orden: ["ORDEN_INCIDENTES_ADMIN"],
    comparteOrden: ["findByAlcance"],
  },
  {
    archivo: "lib/repositories/IncidenteAdminRepository.ts",
    listado: "Incidentes pendientes",
    conjunto: "findColaCompleta",
    pagina: "findColaPaginada",
    seleccion: ["colaIncidentesWhere"],
    orden: ["ORDEN_INCIDENTES_ADMIN"],
  },
  // --- Tanda A: el unico en SQL crudo, y el que ademas alimenta la poda de la seleccion ---
  {
    archivo: "lib/repositories/OrdenRepository.ts",
    listado: "Ordenes de la bodega satelite",
    conjunto: "findRecepcionSateliteCompleta",
    pagina: "findRecepcionSatelitePaginada",
    seleccion: ["condicionesSatelite", "desdeSatelite"],
    orden: ["ordenBodegaSatelite"],
    // R19/R21: la vigencia de la seleccion pregunta por el MISMO conjunto filtrado.
    tambien: ["findIdsVigentesEnBodega"],
  },
];

/** Los siete repositorios que la feature 184 toco (`git diff origin/dev...HEAD -- lib/repositories/`). */
const ARCHIVOS = [...new Set(PARES.map((p) => p.archivo))];

function leer(archivo: string): string {
  return sinComentarios(readFileSync(path.join(RAIZ, archivo), "utf8"));
}

function ocurrencias(codigo: string, patron: RegExp): number {
  return codigo.match(new RegExp(patron.source, `${patron.flags.replace("g", "")}g`))?.length ?? 0;
}

/**
 * El DETECTOR. Devuelve la lista de violaciones de R16 (segunda mitad) que `codigo` comete para
 * `par`. Lista vacia = el par declara su criterio una sola vez y las dos consultas la leen.
 *
 * Es una funcion pura sobre el TEXTO para poder aplicarla, sin tocar el disco, tanto al codigo
 * real como a copias mutadas de el: sin eso, «la guardia se pone roja» seria una promesa.
 */
function violaciones(codigo: string, par: Par): string[] {
  const fallos: string[] = [];
  const miembros = miembrosDe(codigo);
  const donde = `${par.archivo} [${par.listado}]`;
  const compartidos = [...par.seleccion, ...par.orden];

  const cuerpoDe = (metodo: string): string | null => {
    const hits = miembros.filter((m) => m.nombre === metodo);
    if (hits.length !== 1) {
      fallos.push(`${donde}: \`${metodo}\` aparece ${hits.length} veces, no una`);
      return null;
    }
    const cuerpo = hits[0]!.cuerpo;
    // ANTI-VACUIDAD: si el corte no trajo la consulta, todo lo de abajo pasaria por no mirar nada.
    if (!/this\.prisma\./.test(cuerpo)) {
      fallos.push(`${donde}: el cuerpo extraido de \`${metodo}\` no contiene su consulta`);
      return null;
    }
    return cuerpo;
  };

  // (1) El conjunto, su pagina y los demas consumidores del mismo criterio.
  for (const metodo of [par.conjunto, par.pagina, ...(par.tambien ?? [])]) {
    const cuerpo = cuerpoDe(metodo);
    if (cuerpo === null) continue;

    // (a·scoped) Nada de criterio escrito en sitio.
    for (const { que, patron } of CRITERIO_EN_SITIO) {
      if (patron.test(cuerpo)) {
        fallos.push(`${donde}: \`${metodo}\` declara su criterio EN SITIO — ${que}`);
      }
    }
    // (b) Y lee, por nombre, la declaracion compartida. Los consumidores de `tambien` comparten
    //     la seleccion pero no siempre el orden (la vigencia de la seleccion no ordena nada).
    const exigidos = metodo === par.conjunto || metodo === par.pagina ? compartidos : par.seleccion;
    for (const nombre of exigidos) {
      if (!new RegExp(`\\b${nombre}\\b`).test(cuerpo)) {
        fallos.push(`${donde}: \`${metodo}\` no lee la declaracion compartida \`${nombre}\``);
      }
    }
    // El par sin acotamiento: su criterio de seleccion es «ninguno», y tiene que seguir siendolo
    // en los DOS. Un `where` que aparezca en uno solo es la divergencia en su forma mas simple.
    if (par.seleccion.length === 0 && /\bwhere\b/i.test(cuerpo)) {
      fallos.push(`${donde}: \`${metodo}\` gano un \`where\` que su hermano no tiene`);
    }
  }

  // (2) Los que comparten SOLO el orden: su `where` es legitimamente otro, el orden no.
  for (const metodo of par.comparteOrden ?? []) {
    const cuerpo = cuerpoDe(metodo);
    if (cuerpo === null) continue;
    if (/orderBy\s*:\s*[[{]/.test(cuerpo)) {
      fallos.push(`${donde}: \`${metodo}\` volvio a escribir el orden en sitio`);
    }
    for (const nombre of par.orden) {
      if (!new RegExp(`\\b${nombre}\\b`).test(cuerpo)) {
        fallos.push(`${donde}: \`${metodo}\` no lee el orden compartido \`${nombre}\``);
      }
    }
  }

  // (3) Y la declaracion es UNA, a nivel de modulo. Sin esto, dos constantes con el mismo valor
  //     —una por metodo— pasarian (1) y (2) enteros, que es exactamente el hueco que los diez
  //     casos de emision no ven.
  for (const nombre of compartidos) {
    const declaraciones = ocurrencias(codigo, new RegExp(`\\b(?:const|let|var|function)\\s+${nombre}\\b`));
    if (declaraciones !== 1) {
      fallos.push(`${donde}: \`${nombre}\` esta declarado ${declaraciones} veces, no una`);
    }
    if (!new RegExp(`^(?:export\\s+)?(?:const|function)\\s+${nombre}\\b`, "m").test(codigo)) {
      fallos.push(`${donde}: \`${nombre}\` no es una declaracion compartida a nivel de modulo`);
    }
  }

  return fallos;
}

/** Aplica una mutacion y EXIGE que haya cambiado algo: una mutacion que no muta no prueba nada. */
function mutar(codigo: string, reemplazos: [RegExp, string][]): string {
  let salida = codigo;
  for (const [patron, por] of reemplazos) {
    const antes = salida;
    salida = salida.replace(patron, por);
    expect(salida, `la mutacion \`${String(patron)}\` no encontro nada que cambiar`).not.toBe(antes);
  }
  return salida;
}

// ---------------------------------------------------------------------------
// 0 — El detector, probado contra la respuesta conocida
// ---------------------------------------------------------------------------

const PAR_SINTETICO: Par = {
  archivo: "(sintetico)",
  listado: "listado de prueba",
  conjunto: "findTodo",
  pagina: "findPaginado",
  seleccion: ["criterioWhere"],
  orden: ["ORDEN_X"],
};

const CLASE_SANA = [
  'const ORDEN_X: unknown = { createdAt: "desc" };',
  "function criterioWhere(z: string): unknown {",
  "  return { zonaId: z };",
  "}",
  "export class RepoDemo {",
  "  async findTodo(z: string) {",
  "    return this.prisma.cosa.findMany({ where: criterioWhere(z), orderBy: ORDEN_X });",
  "  }",
  "",
  "  async findPaginado(z: string, r: Rango) {",
  "    const where = criterioWhere(z);",
  "    return this.prisma.cosa.findMany({ where, orderBy: ORDEN_X, skip: r.skip });",
  "  }",
  "}",
].join("\n");

describe("guardia del criterio unico — el detector", () => {
  it("el extractor separa cada miembro de la clase y trae su consulta entera", () => {
    // Sin esto, un corte mal hecho deja los escaneos de abajo sobre cuerpos vacios y TODOS sus
    // `toEqual([])` pasan para siempre: la guardia seria un adorno con el defecto dentro.
    const miembros = miembrosDe(CLASE_SANA);
    expect(miembros.map((m) => m.nombre)).toEqual(["findTodo", "findPaginado"]);
    expect(miembros[0]!.cuerpo).toContain("criterioWhere(z)");
    expect(miembros[0]!.cuerpo, "el corte se comio la firma del metodo").toContain("findTodo");
    // Y NO se lleva el cuerpo del siguiente: si lo hiciera, un metodo limpio heredaria las
    // referencias del de al lado y el detector no distinguiria a cual pertenece cada criterio.
    expect(miembros[0]!.cuerpo).not.toContain("skip");
    expect(miembros[1]!.cuerpo).toContain("skip");
  });

  it("el detector ve el criterio EN SITIO y no confunde la referencia a la constante", () => {
    // Direccion 1 (impide el falso verde): las tres formas de reintroducir la segunda
    // declaracion tienen que salir.
    const literalRepetido = mutar(CLASE_SANA, [
      [/orderBy: ORDEN_X, skip/, 'orderBy: { createdAt: "desc" }, skip'],
      [/const ORDEN_X: unknown = \{ createdAt: "desc" \};\n/, ""],
    ]);
    expect(violaciones(literalRepetido, PAR_SINTETICO).join(" | ")).toMatch(/EN SITIO/);

    const segundaConstante = mutar(CLASE_SANA, [
      [
        /export class RepoDemo \{/,
        'const ORDEN_X2: unknown = { createdAt: "desc" };\nexport class RepoDemo {',
      ],
      [/orderBy: ORDEN_X, skip/, "orderBy: ORDEN_X2, skip"],
    ]);
    expect(violaciones(segundaConstante, PAR_SINTETICO).join(" | ")).toMatch(
      /no lee la declaracion compartida `ORDEN_X`/,
    );

    const whereEnSitio = mutar(CLASE_SANA, [[/const where = criterioWhere\(z\);/, ""], [/\{ where, orderBy/, "{ where: { zonaId: z }, orderBy"]]);
    expect(violaciones(whereEnSitio, PAR_SINTETICO).join(" | ")).toMatch(/EN SITIO/);

    // Direccion 2 (impide el falso rojo): un par sano no produce NINGUNA violacion, aunque el
    // texto mencione el nombre de la constante varias veces.
    expect(violaciones(CLASE_SANA, PAR_SINTETICO)).toEqual([]);
  });

  it("el detector no lee la prosa como codigo", () => {
    // Los repositorios de esta feature EXPLICAN en sus comentarios el literal que retiraron
    // («estaba escrito dos veces»). Si el escaneo lo leyera, la guardia seria un falso rojo
    // permanente y acabaria borrada.
    const conProsa = sinComentarios(
      [
        "/** Antes decia orderBy: { createdAt: \"desc\" } en los dos metodos. */",
        '// const ORDEN_X = { createdAt: "desc" };',
        CLASE_SANA,
      ].join("\n"),
    );
    expect(violaciones(conProsa, PAR_SINTETICO)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Anti-vacuidad sobre el arbol REAL
// ---------------------------------------------------------------------------

describe("R16 — el escaneo lee los repositorios de verdad", () => {
  it("los siete repositorios de la feature 184 existen, no estan vacios y traen sus once pares", () => {
    expect(ARCHIVOS.length, "cambio el conjunto de repositorios que la 184 toco").toBe(7);
    expect(PARES.length, "cambio el numero de pares conjunto/pagina de la feature").toBe(11);

    for (const archivo of ARCHIVOS) {
      const codigo = leer(archivo);
      expect(codigo.length, `${archivo} se leyo vacio`).toBeGreaterThan(1000);
      expect(codigo, `${archivo} no parece un repositorio`).toContain("this.prisma");
    }

    // Y el extractor encuentra miembros en TODOS: si en alguno sacara cero, ese archivo entero
    // pasaria la guardia sin ser mirado.
    for (const archivo of ARCHIVOS) {
      expect(miembrosDe(leer(archivo)).length, `${archivo}: el extractor no vio ningun metodo`)
        .toBeGreaterThan(3);
    }
  });

  it("CONTROL POSITIVO: el mismo detector SI ve los `orderBy` literales que viven fuera de los pares", () => {
    // «Cero criterios en sitio dentro de los pares» lo cumple igual un detector que no mire nada.
    // Lo que lo convierte en una afirmacion: el MISMO patron, sobre los MISMOS archivos, saca una
    // cifra alta fuera de los pares — porque los repositorios estan llenos de `orderBy` literales
    // legitimos (lecturas que no tienen hermano paginado y no participan de R16).
    const patron = /orderBy\s*:\s*[[{]/;
    const fuera = ARCHIVOS.map((archivo) => ocurrencias(leer(archivo), patron)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(fuera, "el detector no ve NI UN literal en 7 repositorios: esta roto").toBeGreaterThan(
      10,
    );
    // Y en el archivo mas grande, para que la suma no sea el unico testigo.
    expect(ocurrencias(leer("lib/repositories/OrdenRepository.ts"), patron)).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// R16 (segunda mitad) — una sola declaracion por criterio
// ---------------------------------------------------------------------------

describe("R16 — el criterio de cada par esta declarado UNA sola vez", () => {
  it.each(PARES.map((par) => [`${par.listado} (${path.basename(par.archivo)})`, par] as const))(
    "%s: el conjunto y su hermano paginado leen la MISMA declaracion, y es unica",
    (_titulo, par) => {
      expect(violaciones(leer(par.archivo), par)).toEqual([]);
    },
  );

  it("`alcanceWhere` de incidentes —la guardia de zona— sigue declarada UNA sola vez (tanda F)", () => {
    // El caso caro, y el motivo por el que esta guardia no es cosmetica. `alcanceWhere` decide si
    // un `adminSatelite` ve —y mueve— el dinero de otra zona. La tanda F la encontro escrita TRES
    // veces: la funcion, mas dos copias a mano, una en el `updateMany` que RESUELVE el incidente
    // y otra en el `count` que decide si el fallo fue `conflict` o `fuera_de_alcance`. Tres
    // declaraciones de una guardia de seguridad es una que se queda atras.
    const codigo = leer("lib/repositories/IncidenteAdminRepository.ts");

    expect(
      ocurrencias(codigo, /\bfunction\s+alcanceWhere\b/),
      "alcanceWhere dejo de estar declarada una sola vez",
    ).toBe(1);

    // Su HUELLA literal: la forma en que estaban escritas las copias a mano. Solo puede aparecer
    // dentro de la propia declaracion, y ni una vez mas.
    expect(
      ocurrencias(codigo, /orden:\s*\{\s*zonaId/),
      "volvio a aparecer un `orden: { zonaId ... }` escrito a mano: es una segunda declaracion " +
        "de la guardia que acota al adminSatelite (R16/R48)",
    ).toBe(1);
    const declaracion = codigo.slice(codigo.search(/\bfunction\s+alcanceWhere\b/));
    expect(declaracion.slice(0, 200), "la huella no esta dentro de `alcanceWhere`").toMatch(
      /orden:\s*\{\s*zonaId/,
    );

    // Y sigue teniendo consumidores: una guardia declarada una vez y usada cero veces no acota
    // nada. Seis llamadas + la declaracion.
    expect(
      ocurrencias(codigo, /\balcanceWhere\(/),
      "alcanceWhere se quedo sin consumidores: entonces «declarada una vez» no dice nada",
    ).toBeGreaterThanOrEqual(5);
  });

  it("`alcanceWhere` de los cierres del dia tambien es unica, y su huella no se repite", () => {
    const codigo = leer("lib/repositories/CierresAdminRepository.ts");
    expect(ocurrencias(codigo, /\bfunction\s+alcanceWhere\b/)).toBe(1);
    expect(
      ocurrencias(codigo, /destinoTipo:\s*alcance\.destinoTipo/),
      "volvio a escribirse a mano el acotamiento por destino: es la segunda declaracion",
    ).toBe(1);
    expect(ocurrencias(codigo, /\balcanceWhere\(/)).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// CONTROL POSITIVO POR MUTACION, sobre el codigo REAL
// ---------------------------------------------------------------------------

/**
 * Las tres mutaciones que R16 (segunda mitad) existe para cazar, aplicadas EN MEMORIA al codigo
 * real. No sustituyen a la corrida de mutacion a mano —esa esta en `progress/impl_184_H3_R16.md`,
 * con su recuento— pero la dejan REGISTRADA: si mañana alguien afloja el detector, estos casos
 * caen antes de que nadie tenga que volver a mutar el arbol.
 */
describe("R16 — el detector se pone ROJO ante la segunda declaracion", () => {
  const PAR_MENSAJERO = PARES.find((p) => p.orden.includes("ORDEN_CIERRES_MENSAJERO"))!;

  it("MUTACION 1: deshacer la constante y repetir el literal en los dos metodos", () => {
    // Es la mutacion que los DIEZ casos de emision no ven: los dos metodos siguen emitiendo
    // `{ solicitadoAt: "desc" }`, identico, asi que `cierre-dia-repository` y los `*-where`
    // siguen verdes. Aqui no.
    const real = leer(PAR_MENSAJERO.archivo);
    expect(violaciones(real, PAR_MENSAJERO), "el arbol real ya estaba roto").toEqual([]);

    const mutado = mutar(real, [
      [/const ORDEN_CIERRES_MENSAJERO[^;]+;/, ""],
      [/orderBy: ORDEN_CIERRES_MENSAJERO/g, 'orderBy: { solicitadoAt: "desc" }'],
    ]);
    expect(mutado).not.toContain("ORDEN_CIERRES_MENSAJERO");

    const fallos = violaciones(mutado, PAR_MENSAJERO);
    expect(fallos.length, "la guardia NO ve el literal repetido").toBeGreaterThan(0);
    expect(fallos.join(" | ")).toMatch(/findCierresByMensajero\` declara su criterio EN SITIO/);
    expect(fallos.join(" | ")).toMatch(/findCierresByMensajeroPaginado\` declara su criterio EN SITIO/);
  });

  it("MUTACION 2: una SEGUNDA constante con el mismo valor, una por metodo", () => {
    // La forma sutil, y la razon de que la asercion sea «la MISMA declaracion por nombre» y no
    // «el mismo valor»: dos constantes de valor identico emiten lo mismo hoy y divergen mañana.
    const real = leer(PAR_MENSAJERO.archivo);
    const mutado = mutar(real, [
      [
        /(const ORDEN_CIERRES_MENSAJERO[^;]+;)/,
        '$1\nconst ORDEN_CIERRES_MENSAJERO_PAGINA: Prisma.CierreDiaOrderByWithRelationInput = { solicitadoAt: "desc" };',
      ],
      [
        /orderBy: ORDEN_CIERRES_MENSAJERO,(\s*\n\s*skip)/,
        "orderBy: ORDEN_CIERRES_MENSAJERO_PAGINA,$1",
      ],
    ]);
    const fallos = violaciones(mutado, PAR_MENSAJERO);
    expect(fallos.join(" | "), "la guardia NO ve la segunda constante").toMatch(
      /findCierresByMensajeroPaginado\` no lee la declaracion compartida `ORDEN_CIERRES_MENSAJERO`/,
    );
  });

  it("MUTACION 3: reescribir el WHERE en sitio en el hermano paginado", () => {
    // La mitad de SELECCION. En este listado el criterio es el `mensajeroId`, que el servicio
    // escribe desde la sesion: dos declaraciones de eso es como un listado empieza a enseñar los
    // cierres de otro mensajero.
    const real = leer(PAR_MENSAJERO.archivo);
    const mutado = mutar(real, [
      [/const where = cierresDeMensajeroWhere\(mensajeroId\);/, "const where = { mensajeroId };"],
    ]);
    const fallos = violaciones(mutado, PAR_MENSAJERO);
    expect(fallos.join(" | "), "la guardia NO ve el where reescrito").toMatch(
      /findCierresByMensajeroPaginado\` no lee la declaracion compartida `cierresDeMensajeroWhere`/,
    );
  });

  it("MUTACION 4: el criterio en SQL crudo, de vuelta dentro del metodo de la bodega satelite", () => {
    // El par de la tanda A es el unico en SQL crudo: alli la segunda declaracion no es un objeto,
    // es un `ORDER BY`/`WHERE` escrito a mano — como vivia antes de que `condicionesSatelite`,
    // `desdeSatelite` y `ordenBodegaSatelite` salieran del metodo.
    const par = PARES.find((p) => p.conjunto === "findRecepcionSateliteCompleta")!;
    const real = leer(par.archivo);
    expect(violaciones(real, par), "el arbol real ya estaba roto").toEqual([]);

    const mutado = mutar(real, [
      // `(\s*)` y no `\n`: los archivos de este repo estan en CRLF y un `\n` literal no casa.
      [
        /\$\{ordenBodegaSatelite\(\)\}(\s*)LIMIT/,
        'ORDER BY o."prioridad" DESC, o."id" ASC$1LIMIT',
      ],
    ]);
    const fallos = violaciones(mutado, par);
    expect(fallos.join(" | "), "la guardia NO ve el ORDER BY escrito a mano").toMatch(
      /findRecepcionSatelitePaginada\` declara su criterio EN SITIO/,
    );
  });
});
