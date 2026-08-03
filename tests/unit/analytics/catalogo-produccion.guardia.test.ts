import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { METRICAS, getMetrica } from "@/lib/analytics/metrics";

// Feature 175 / T2.3 — GUARDIA de `estadoProduccion` (R1, R2, R3, R13, R14).
//
// Por que existe. `estadoProduccion` dice si una metrica TIENE PRODUCTOR, y la 133 va a
// elegir paneles leyendolo. Dos entradas mentian: `incidentes` (tiene columna real en
// `analytics_daily` y es el 4.o termino de las tres tasas) y `sin_gestionar` (la 126 la
// sirve derivandola del embudo). Dejarlas `declarada` habria borrado de pantalla dos KPI
// vivos, sin log y sin hueco visible. ⟨D11⟩ (humano, 2026-08-03, `progress/decision_175.md`)
// las paso a `producida`; esta guardia impide que la divergencia vuelva.
//
// NINGUN caso afirma el sintoma a secas: cada uno ATA el estado a su causa leyendo la
// fuente de verdad correspondiente en crudo (`db/schema.prisma`, el catalogo, el servicio
// de la 126, el arbol de archivos, `progress/`). Un `toBe("producida")` suelto fija el
// valor sin explicar por que, y no diria nada de la siguiente metrica que aparezca.
//
// ---------------------------------------------------------------------------
// DECISION DOCUMENTADA (R13): QUE CUENTA COMO "LEER" UNO DE LOS TRES CAMPOS
// ---------------------------------------------------------------------------
// El censo de R13 busca los identificadores `estadoProduccion`, `universo` y `derivadaDe`
// como PALABRA COMPLETA sobre el CODIGO del archivo, tras retirar comentarios de bloque y
// de linea (misma tecnica y misma razon que `modulo-puro.guardia.test.ts:19-30`). Motivo:
// la documentacion del repo esta OBLIGADA a nombrar lo que prohibe —
// `app/(app)/analitica/_components/operativo/catalogo-paneles.ts` cita los tres para
// PROHIBIRLOS y `lib/services/AnaliticaFinancieraService.ts:59` nombra el filtro en un
// comentario—, asi que censar el texto crudo convertiria el contrato escrito en violacion.
// Nombrar la trampa es obligatorio; usarla es lo prohibido.
//
// Por que NO se afina mas (p. ej. exigir un `.` delante o un `filter(`): la regla debe
// matar la mutacion en CUALQUIERA de sus formas —`m.estadoProduccion`, `{ estadoProduccion }`
// desestructurado, `m["estadoProduccion"]`, `listarMetricas({ estadoProduccion: ... })`—, y
// todas ellas escriben el identificador en el codigo. Buscar la palabra en el codigo es la
// regla mas laxa que sigue cubriendolas todas; los literales de cadena NO se retiran a
// proposito, porque el acceso por clave es una cadena.
//
// Las DOS unicas exclusiones son de archivo y estan nombradas: `lib/analytics/metrics.ts`
// (el catalogo, unico sitio legitimo donde se ESCRIBE el dato) y `lib/analytics/types.ts`
// (donde se DECLARA el tipo, sin ningun dato ni decision). Cualquier tercer archivo que
// nombre uno de los tres en codigo es una violacion de R13.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "db", "schema.prisma");
const METRICS_PATH = path.join(REPO_ROOT, "lib", "analytics", "metrics.ts");
const TYPES_PATH = path.join(REPO_ROOT, "lib", "analytics", "types.ts");
const SERVICIO_126_PATH = path.join(REPO_ROOT, "lib", "services", "AnaliticaOperativaService.ts");
const DIR_PROGRESS = path.join(REPO_ROOT, "progress");

const IDS_CATALOGO = new Set(METRICAS.map((m) => m.id));

/* -------------------------------------------------------------------------- */
/* Utilidades de lectura en crudo                                              */
/* -------------------------------------------------------------------------- */

/** Quita comentarios de bloque, de linea y trailing, para censar solo el codigo. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/**
 * Campos de un modelo de `db/schema.prisma`, leidos del ESQUEMA y no del cliente
 * generado (que puede estar sin generar o desactualizado). Mismo patron que
 * `definiciones-catalogo.guardia.test.ts:32-41` y `analytics-daily-contrato.test.ts:4-13`.
 */
function camposDelModelo(nombre: string): string[] {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  const bloque = new RegExp(`model ${nombre} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!bloque) throw new Error(`No se encontro el modelo ${nombre} en db/schema.prisma`);
  return bloque[1]
    .split("\n")
    .map((linea) => linea.replace(/\/\/.*$/, "").trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("@@"))
    .map((linea) => linea.split(/\s+/)[0]);
}

/** El texto de la entrada del catalogo con ese `id`, comentarios incluidos. */
function bloqueDeEntrada(id: string): string {
  const fuente = fs.readFileSync(METRICS_PATH, "utf8");
  const bloques = fuente.split(/\n  \{\n/);
  const encontrados = bloques.filter((b) => b.includes(`id: "${id}",`));
  expect(encontrados.length, `la entrada ${id} no se aisla en metrics.ts`).toBe(1);
  return encontrados[0];
}

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

/**
 * El arbol de PRODUCCION: `app/`, `lib/` y `components/`. Fuera quedan `tests/`,
 * `specs/`, `progress/`, `node_modules/` y `.next/` — no son codigo servido.
 */
function archivosDeProduccion(): string[] {
  return ["app", "lib", "components"].flatMap((d) => archivosDeCodigo(path.join(REPO_ROOT, d)));
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/** Los tres campos que R13 prohibe leer fuera del catalogo. */
const CAMPOS_VIGILADOS = ["estadoProduccion", "universo", "derivadaDe"] as const;

/** Campos vigilados que el CODIGO de este archivo nombra (los comentarios no cuentan). */
function camposLeidosEnCodigo(fuente: string): string[] {
  const codigo = soloCodigo(fuente);
  return CAMPOS_VIGILADOS.filter((campo) => new RegExp(`\\b${campo}\\b`).test(codigo));
}

/* -------------------------------------------------------------------------- */
/* R1 · `incidentes` tiene columna en el rollup, luego tiene productor         */
/* -------------------------------------------------------------------------- */

describe("R1 · incidentes no puede figurar sin productor", () => {
  // MUTACION QUE ESTE CASO MATA: volver `incidentes` a `estadoProduccion: "declarada"`
  // en `lib/analytics/metrics.ts`.
  it("`incidentes` declara productor porque tiene columna en el rollup", () => {
    const columnas = camposDelModelo("AnalyticsDaily");
    // Sanidad del censo del esquema: si el parseo devolviera [] o casi nada, el caso
    // pasaria por vacio en vez de por cierto.
    expect(columnas.length, "el parseo de AnalyticsDaily no leyo el modelo").toBeGreaterThan(10);
    expect(columnas, "el rollup ya no tiene columna incidentes: releer R1").toContain("incidentes");

    // La regla, DERIVADA del esquema: toda metrica cuyo id es una columna de medida real de
    // `analytics_daily` tiene productor por definicion — el rollup la escribe cada dia.
    const conColumnaPropia = METRICAS.filter((m) => columnas.includes(m.id));
    expect(
      conColumnaPropia.map((m) => m.id),
      "ninguna metrica del catalogo casa con una columna del rollup: el censo mira mal",
    ).toContain("incidentes");
    expect(conColumnaPropia.length).toBeGreaterThanOrEqual(4);

    for (const metrica of conColumnaPropia) {
      expect(
        metrica.estadoProduccion,
        `${metrica.id} tiene columna real en analytics_daily: no puede estar "declarada"`,
      ).toBe("producida");
    }

    // Y el comentario adjunto ya no puede afirmar lo contrario (R1, segunda mitad).
    const bloque = bloqueDeEntrada("incidentes");
    expect(/no la comprometen|sin productor/.test(bloque)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R2 · si una tasa se sirve, sus terminos tienen productor                    */
/* -------------------------------------------------------------------------- */

describe("R2 · los terminos de una razon tienen productor", () => {
  // MUTACION QUE ESTE CASO MATA: marcar `estadoProduccion: "declarada"` CUALQUIERA de las
  // metricas que aparecen como numerador o dentro del denominador de una razon del
  // catalogo (hoy `entregas`, `devoluciones`, `rechazos`, `incidentes`).
  //
  // Derivado a proposito, sin lista escrita a mano y sin nombrar ninguna metrica: la regla
  // real es «si una tasa se sirve, sus terminos tienen productor», y asi cubre las tasas
  // futuras sin que nadie toque este archivo (D2 del design).
  it("ninguna metrica citada en una `razon` esta `declarada`", () => {
    const conRazon = METRICAS.filter((m) => m.definicion.razon !== undefined);
    const terminos = new Set<string>();
    for (const metrica of conRazon) {
      const razon = metrica.definicion.razon!;
      terminos.add(razon.numerador);
      for (const id of razon.denominador) terminos.add(id);
    }

    // Sanidad: sin razones en el catalogo, o sin terminos, el caso seria vacuo.
    expect(conRazon.length, "el catalogo no declara ninguna razon: el censo mira mal").
      toBeGreaterThan(0);
    expect(terminos.size, "ninguna razon cita terminos").toBeGreaterThanOrEqual(4);

    for (const id of terminos) {
      const termino = getMetrica(id);
      expect(termino, `la razon cita "${id}", que no existe en el catalogo`).toBeDefined();
      expect(
        termino!.estadoProduccion,
        `"${id}" es termino de una tasa que se sirve: no puede estar "declarada"`,
      ).not.toBe("declarada");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R3 · `sin_gestionar` la sirve la 126, derivandola del embudo                */
/* -------------------------------------------------------------------------- */

describe("R3 · sin_gestionar no puede figurar sin productor", () => {
  // MUTACION QUE ESTE CASO MATA: volver `sin_gestionar` a `estadoProduccion: "declarada"`.
  it("`sin_gestionar` declara productor: la 126 la deriva del embudo", () => {
    // Fuente de verdad de "quien la sirve": el mapa metrica -> medida del rollup de la 126,
    // leido en crudo del servicio (`AnaliticaOperativaService.ts:85-95`). No se importa el
    // servicio: es la capa de servicios y este es un test del modulo puro.
    const servicio = soloCodigo(fs.readFileSync(SERVICIO_126_PATH, "utf8"));
    const cuerpo = /const MEDIDA_DE_METRICA[^{]*\{([\s\S]*?)\n\};/.exec(servicio);
    expect(cuerpo, "MEDIDA_DE_METRICA ya no se declara asi en la 126: releer R3").not.toBeNull();

    const servidas = new Map<string, string>();
    for (const m of cuerpo![1].matchAll(/^\s*([a-z_]+)\s*:\s*"([A-Za-z]+)"/gm)) {
      servidas.set(m[1], m[2]);
    }
    // Sanidad: si el parseo devolviera un mapa vacio, todo lo de abajo pasaria por vacio.
    expect(servidas.size, "no se parseo ninguna entrada de MEDIDA_DE_METRICA").
      toBeGreaterThanOrEqual(5);
    expect([...servidas.keys()]).toContain("sin_gestionar");

    // La causa, con todas las letras: se sirve de la MISMA medida que el embudo, o sea que
    // no tiene medida propia — se proyecta de `ordenes_por_estado`.
    expect(servidas.get("sin_gestionar")).toBe(servidas.get("ordenes_por_estado"));
    expect(getMetrica("sin_gestionar")!.definicion.derivadaDe).toBe("ordenes_por_estado");

    // La regla derivada: toda metrica del catalogo que la 126 sirve tiene productor.
    for (const id of servidas.keys()) {
      if (!IDS_CATALOGO.has(id)) continue;
      expect(
        getMetrica(id)!.estadoProduccion,
        `la 126 sirve "${id}" (MEDIDA_DE_METRICA): no puede estar "declarada"`,
      ).toBe("producida");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R13 · ninguna cifra cambia: nadie decide datos con estos tres campos        */
/* -------------------------------------------------------------------------- */

describe("R13 · los campos del catalogo no deciden datos en produccion", () => {
  // MUTACION QUE ESTE CASO MATA: que un archivo de produccion (un service, un repositorio,
  // un componente) filtre o calcule por `estadoProduccion`, `definicion.universo` o
  // `definicion.derivadaDe` — p. ej. `METRICAS.filter(m => m.estadoProduccion === "producida")`
  // dentro de `lib/services/AnaliticaOperativaService.ts`. Comprobada de verdad: aplicada,
  // roja, revertida.
  it("nadie fuera del catalogo decide datos por `estadoProduccion`, `universo` ni `derivadaDe`", () => {
    // Autocomprobacion del detector ANTES de usarlo: distingue lectura de mencion. Si esto
    // se relajara, el censo de abajo pasaria por ciego y no por limpio.
    expect(camposLeidosEnCodigo('// prohibido filtrar por estadoProduccion aqui\n')).toEqual([]);
    expect(camposLeidosEnCodigo('/* ni universo ni derivadaDe se leen */\n')).toEqual([]);
    expect(camposLeidosEnCodigo("const v = m.estadoProduccion;")).toEqual(["estadoProduccion"]);
    expect(camposLeidosEnCodigo('const { universo } = m.definicion;')).toEqual(["universo"]);
    expect(camposLeidosEnCodigo('if (m["derivadaDe"]) return null;')).toEqual(["derivadaDe"]);
    expect(
      camposLeidosEnCodigo('listarMetricas({ estadoProduccion: "producida" });'),
    ).toEqual(["estadoProduccion"]);

    const permitidos = new Set([path.resolve(METRICS_PATH), path.resolve(TYPES_PATH)]);
    const censados = archivosDeProduccion();

    // Sanidad del censo: si `archivosDeProduccion()` devolviera pocos archivos (ruta mal
    // calculada, filtro roto), el caso pasaria por no haber leido nada.
    expect(censados.length, "el censo de R13 apenas encontro archivos").toBeGreaterThan(300);
    for (const carpeta of ["app/", "lib/", "components/"]) {
      expect(
        censados.some((f) => relativa(f).startsWith(carpeta)),
        `el censo de R13 no esta mirando ${carpeta}`,
      ).toBe(true);
    }
    expect(censados.some((f) => relativa(f).includes("node_modules"))).toBe(false);
    // Y mira de verdad los dos archivos exentos: si no los alcanzara, tampoco alcanzaria a
    // sus vecinos, que son los que hay que vigilar.
    for (const exento of permitidos) {
      expect(censados.map((f) => path.resolve(f))).toContain(exento);
    }

    const infractores = censados
      .filter((archivo) => !permitidos.has(path.resolve(archivo)))
      .map((archivo) => ({
        archivo: relativa(archivo),
        campos: camposLeidosEnCodigo(fs.readFileSync(archivo, "utf8")),
      }))
      .filter((r) => r.campos.length > 0)
      .map((r) => `${r.archivo}: ${r.campos.join(", ")}`);

    expect(
      infractores,
      "leen campos del catalogo en produccion (R13: ninguna cifra puede depender de ellos)",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R14 · todo cambio de estadoProduccion cita una decision humana fechada      */
/* -------------------------------------------------------------------------- */

interface CambioDecidido {
  /** id de la metrica del catalogo cuyo `estadoProduccion` cambio. */
  readonly id: string;
  /** nombre del fichero de `progress/` donde el humano lo decidio. */
  readonly fichero: string;
}

/**
 * Deriva de `progress/` los cambios de `estadoProduccion` decididos por el humano, SIN
 * lista escrita a mano: una linea de un `decision_*.md` que nombre a la vez `declarada` y
 * `producida` esta declarando el cambio, y los ids que cita entre comillas invertidas
 * (`egresos`, `egresos.estadoProduccion`, `incidentes`...) son las metricas afectadas.
 * Asi la regla cubre tambien ⟨D8⟩ de la 127 y cualquier decision futura.
 */
function cambiosDecididosEnProgress(): CambioDecidido[] {
  const cambios: CambioDecidido[] = [];
  const ficheros = fs.readdirSync(DIR_PROGRESS).filter((n) => /^decision.*\.md$/.test(n));
  for (const fichero of ficheros) {
    const texto = fs.readFileSync(path.join(DIR_PROGRESS, fichero), "utf8");
    for (const linea of texto.split("\n")) {
      if (!linea.includes("declarada") || !linea.includes("producida")) continue;
      for (const m of linea.matchAll(/`([a-z_][a-z_0-9]*)(?:\.[A-Za-z]+)?`/g)) {
        if (IDS_CATALOGO.has(m[1]) && !cambios.some((c) => c.id === m[1] && c.fichero === fichero)) {
          cambios.push({ id: m[1], fichero });
        }
      }
    }
  }
  return cambios;
}

describe("R14 · el cambio de estadoProduccion lleva firma humana", () => {
  // MUTACION QUE ESTE CASO MATA: borrar del comentario de `incidentes` (o de cualquier otra
  // entrada afectada) la cita a su fichero de decision — p. ej. quitar
  // `progress/decision_175.md` de `metrics.ts:226-229`. Tambien muere si la decision no
  // lleva fecha, o si el fichero citado no existe.
  it("todo cambio de `estadoProduccion` cita una decision humana registrada en `progress/`", () => {
    const cambios = cambiosDecididosEnProgress();

    // Sanidad: sin cambios derivados el caso seria vacuo. Y al exigir DOS ficheros distintos
    // se comprueba que la regla no vale solo para la 175: cubre tambien ⟨D8⟩ de la 127.
    expect(cambios.length, "no se derivo ningun cambio de estadoProduccion de progress/").
      toBeGreaterThanOrEqual(3);
    expect(new Set(cambios.map((c) => c.fichero)).size).toBeGreaterThanOrEqual(2);

    for (const cambio of cambios) {
      const ruta = path.join(DIR_PROGRESS, cambio.fichero);
      const decision = fs.readFileSync(ruta, "utf8");

      // (a) la decision esta FECHADA (el patron de ⟨D8⟩: "Fecha: 2026-08-03").
      const fecha = /\b20\d{2}-\d{2}-\d{2}\b/.exec(decision);
      expect(fecha, `progress/${cambio.fichero} no lleva fecha`).not.toBeNull();

      // (b) la entrada del catalogo CITA ese fichero desde su propio comentario, y la fecha
      // que escribe es una de las del fichero (no una inventada).
      const bloque = bloqueDeEntrada(cambio.id);
      expect(
        bloque.includes(`progress/${cambio.fichero}`),
        `${cambio.id} cambio de estadoProduccion sin citar progress/${cambio.fichero}`,
      ).toBe(true);
      const fechasDeLaDecision = new Set(decision.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? []);
      const fechasCitadas = bloque.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? [];
      expect(fechasCitadas.length, `${cambio.id} cita la decision sin fecha`).toBeGreaterThan(0);
      for (const citada of fechasCitadas) {
        expect(
          fechasDeLaDecision.has(citada),
          `${cambio.id} cita la fecha ${citada}, que no aparece en progress/${cambio.fichero}`,
        ).toBe(true);
      }

      // (c) y el estado que la decision ratifico es el que el catalogo tiene hoy.
      expect(getMetrica(cambio.id)!.estadoProduccion, cambio.id).toBe("producida");
    }
  });
});
