import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { METRICAS, getMetrica } from "@/lib/analytics/metrics";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

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
  return quitarComentarios(bloque[1])
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("@@"))
    .map((linea) => linea.split(/\s+/)[0]);
}

/**
 * El texto de la entrada del catalogo con ese `id`, comentarios incluidos.
 *
 * EL PARSEO SE COMPRUEBA ANTES DE USARLO, y no es paranoia de manual: medido durante este
 * chore, un `metrics.ts` con finales de linea CRLF hace que `\n  {\n` no case NUNCA. El
 * `split` devuelve entonces UN solo trozo —el archivo entero—, `encontrados.length` sigue
 * valiendo 1 y la guardia pasa a juzgar el fichero completo como si fuera el bloque de cada
 * metrica: el mensaje de fallo acusaba a `incidentes` de citar una fecha que esta a 250
 * lineas de su entrada. Un parser que se rompe sin decirlo es peor que no tenerlo (172).
 */
function bloqueDeEntrada(id: string): string {
  const fuente = fs.readFileSync(METRICS_PATH, "utf8");
  const bloques = fuente.split(/\n  \{\n/);
  expect(
    bloques.length,
    "metrics.ts no se partio en entradas (¿finales de linea CRLF?): el bloque de cada metrica " +
      "seria el archivo entero y toda la comprobacion de abajo miraria el texto equivocado",
  ).toBeGreaterThan(METRICAS.length);
  const encontrados = bloques.filter((b) => b.includes(`id: "${id}",`));
  expect(encontrados.length, `la entrada ${id} no se aisla en metrics.ts`).toBe(1);
  expect(
    encontrados[0].length,
    `el bloque de ${id} es casi el archivo entero: el corte por entradas no funciono`,
  ).toBeLessThan(fuente.length / 2);
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

/** Toda fecha ISO que aparece en un texto, en orden de aparicion. */
function fechasDe(texto: string): string[] {
  return texto.match(/\b20\d{2}-\d{2}-\d{2}\b/g) ?? [];
}

/**
 * Los ficheros de decision de `progress/` que un texto CITA, sin repetir. Solo `decision*.md`:
 * es el mismo universo que recorre `cambiosDecididosEnProgress()`, asi que citar una bitacora
 * (`impl_*.md`) no cuenta como respaldo de una fecha.
 */
function decisionesCitadas(texto: string): string[] {
  const nombres = [...texto.matchAll(/progress\/(decision[A-Za-z0-9_.-]*\.md)\b/g)].map((m) => m[1]);
  return [...new Set(nombres)];
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
  /** id de la metrica del catalogo que la decision toca. */
  readonly id: string;
  /** nombre del fichero de `progress/` donde el humano lo decidio. */
  readonly fichero: string;
  /**
   * Que se decidio: el `estadoProduccion` (regla 1) u otro campo del catalogo (regla 2).
   * Solo la primera permite afirmar el VALOR resultante; ver la comprobacion (c).
   */
  readonly motivo: "estado" | "campo";
}

/** Los campos de una entrada del catalogo, LEIDOS del catalogo y no escritos aqui. */
const CAMPOS_DEL_CATALOGO = new Set(Object.keys(METRICAS[0]));

/**
 * Deriva de un `decision_*.md` los cambios de catalogo que declara, SIN lista escrita a
 * mano. Funcion PURA sobre el texto para poder autocomprobarla: `cambiosDecididosEnProgress`
 * solo le da de comer los ficheros.
 *
 * DOS REGLAS, y la segunda es la que cierra el agujero que midio el review de la 183.
 *
 * · Regla 1 (`estado`) — una linea que nombre a la vez `declarada` y `producida` esta
 *   declarando un cambio de `estadoProduccion`, y los ids que cita entre comillas invertidas
 *   son las metricas afectadas. Es la regla original, intacta.
 *
 * · Regla 2 (`campo`) — una referencia `` `metrica.campo` `` (p. ej.
 *   `` `egresos.definicion.categorias` ``, `` `conciliacion_cierres.fuente.tablas` ``)
 *   apunta a UN campo de UNA entrada: la decision esta decidiendo sobre esa entrada.
 *
 * POR QUE HACIA FALTA LA REGLA 2. Medido en `progress/review_183.md` (M1): con solo la
 * regla 1, borrar del bloque de `egresos` la cita a `progress/decision_183.md` **y** su
 * fecha dejaba la guardia VERDE. ⟨D12⟩ no cambia ningun `estadoProduccion` —cambia
 * `definicion.categorias`—, asi que no habia sujeto derivado y nadie exigia la cita; lo
 * unico que saltaba era la fecha huerfana, es decir la INCOHERENCIA, no la AUSENCIA.
 *
 * POR QUE NO SE EXIGE CITA A TODAS LAS ENTRADAS: la mayoria del catalogo no tiene ninguna
 * decision humana detras y pedirsela seria pedir que se inventara. Lo que distingue a las
 * que si es que un documento de decision las NOMBRA JUNTO AL CAMPO que toca — y ese es
 * exactamente el criterio de la regla 2, no un listado.
 *
 * POR QUE NO BASTA CON QUE LA DECISION NOMBRE LA METRICA (una regla mas ancha que se
 * descarto midiendo): `decision_183.md` nombra tambien `ingreso_flete`,
 * `ingreso_comision_cod` e `ingreso_iva` —lo que ⟨D12⟩ decide sobre ellas es que el DTO
 * deja de publicar su `neto`—, y sus entradas del catalogo NO cambian. Exigirles cita
 * seria un falso positivo contra un catalogo correcto. Nombrar el campo es lo que separa
 * «esta decision cambia esta entrada» de «esta decision habla de esta metrica».
 */
function cambiosDeclaradosEnTexto(texto: string, fichero: string): CambioDecidido[] {
  const cambios: CambioDecidido[] = [];
  const anadir = (id: string, motivo: CambioDecidido["motivo"]) => {
    if (!IDS_CATALOGO.has(id)) return;
    if (cambios.some((c) => c.id === id && c.fichero === fichero)) return;
    cambios.push({ id, fichero, motivo });
  };

  for (const linea of texto.split("\n")) {
    // Regla 2 primero: es la mas especifica, y asi el `motivo` de una entrada que cumple
    // las dos queda en "estado", que es el que ademas fija el valor resultante.
    for (const m of linea.matchAll(/`([a-z_][a-z_0-9]*)\.([A-Za-z][A-Za-z0-9_]*)[A-Za-z0-9_.]*`/g)) {
      if (CAMPOS_DEL_CATALOGO.has(m[2])) anadir(m[1], "campo");
    }
    if (!linea.includes("declarada") || !linea.includes("producida")) continue;
    for (const m of linea.matchAll(/`([a-z_][a-z_0-9]*)(?:\.[A-Za-z]+)?`/g)) {
      const yaEsta = cambios.findIndex((c) => c.id === m[1] && c.fichero === fichero);
      if (yaEsta >= 0) cambios[yaEsta] = { id: m[1], fichero, motivo: "estado" };
      else anadir(m[1], "estado");
    }
  }
  return cambios;
}

function cambiosDecididosEnProgress(): CambioDecidido[] {
  const ficheros = fs.readdirSync(DIR_PROGRESS).filter((n) => /^decision.*\.md$/.test(n));
  return ficheros.flatMap((fichero) =>
    cambiosDeclaradosEnTexto(fs.readFileSync(path.join(DIR_PROGRESS, fichero), "utf8"), fichero),
  );
}

describe("R14 · el cambio de estadoProduccion lleva firma humana", () => {
  // MUTACION QUE ESTE CASO MATA: borrar del comentario de `incidentes` (o de cualquier otra
  // entrada afectada) la cita a su fichero de decision — p. ej. quitar
  // `progress/decision_175.md` de `metrics.ts:226-229`. Tambien muere si la decision no
  // lleva fecha, si el fichero citado no existe, o si el bloque escribe una fecha que ningun
  // documento citado respalda. Las tres, comprobadas de verdad: aplicadas, rojas, revertidas.
  //
  // ---------------------------------------------------------------------------------------
  // QUE VIGILA HOY QUE NO VIGILABA: LA AUSENCIA, NO SOLO LA INCOHERENCIA
  // ---------------------------------------------------------------------------------------
  // El review de la 183 (M1) midio que, con la regla original, borrar la cita Y la fecha a la
  // vez dejaba la guardia VERDE: solo saltaba si quedaba una fecha sin decision que la
  // respaldara. Vigilaba la INCOHERENCIA entre lo escrito, no la AUSENCIA de firma. El motivo
  // era el sujeto: ⟨D12⟩ cambia `definicion.categorias` y no `estadoProduccion`, asi que
  // `egresos` no era sujeto derivado de nada y nadie exigia su cita. La regla 2 de
  // `cambiosDeclaradosEnTexto` deriva tambien esos cambios; ver alli por que no se le exige
  // cita a toda entrada del catalogo y que separa a las que si.
  //
  // ---------------------------------------------------------------------------------------
  // POR QUE LA COMPROBACION (b) NO EXIGE UN SOLO FICHERO: UNA METRICA ACUMULA DECISIONES
  // ---------------------------------------------------------------------------------------
  // Nacida con la 175, esta guardia daba por supuesto «una metrica, una decision»: localizaba
  // EL fichero del cambio de `estadoProduccion` y exigia que TODA fecha del bloque estuviera
  // en EL. La 173 demostro que esa premisa es falsa. Una entrada del catalogo vive anos y
  // acumula decisiones de features distintas; hoy `egresos` cita dos, ambas legitimas y ambas
  // necesarias:
  //   · ⟨D8⟩  de la 127 (2026-08-02, `progress/decision_C2_127.md`) ratifico su `estadoProduccion`;
  //   · ⟨P4⟩  de la 173 (2026-08-03, `progress/decision_F2_173.md`) autorizo cambiar su DESCRIPCION,
  //     porque desde esa feature la cifra incluye el dinero entregado a las tiendas.
  // Con la premisa vieja, la fecha de ⟨P4⟩ era "una fecha que no aparece en decision_C2_127.md"
  // y la guardia se ponia roja contra un catalogo correcto. Borrar la ⟨P4⟩ para apagarla habria
  // sido mentir sobre por que la cifra de `egresos` crece.
  //
  // ESTO NO ES UN AFLOJAMIENTO, y la diferencia esta en que el respaldo sigue siendo OBLIGATORIO,
  // solo que se busca en el conjunto de decisiones que el PROPIO BLOQUE cita en vez de en una
  // sola fijada de antemano. El liston no baja en ningun frente:
  //   · una fecha inventada no aparece en ninguna decision citada  -> sigue roja;
  //   · citar un fichero que no existe para colar su fecha         -> roja (se comprueba que exista);
  //   · citar un fichero real pero sin fecha                       -> roja (se comprueba que este fechado);
  //   · citar la decision del cambio "de adorno", sin escribir ninguna de SUS fechas y colgando
  //     todas las del bloque de otro documento                     -> roja (ultima asercion).
  // El unico caso nuevo que pasa es el real: un bloque que cita dos decisiones fechadas y
  // escribe la fecha de cada una. Las comprobaciones (a) y (c) no cambiaron.
  it("todo cambio de catalogo decidido en `progress/` esta citado por su entrada", () => {
    // Autocomprobacion del DERIVADOR antes de usarlo, sobre texto sintetico. Sin esto, una
    // regla que dejara de casar —un formato de cita distinto, un campo renombrado— no pondria
    // la guardia roja: la dejaria SIN SUJETOS, o sea verde por vacio, que es el modo de fallo
    // que este bloque ya tuvo una vez.
    const [unaMetrica] = [...IDS_CATALOGO];
    expect(
      cambiosDeclaradosEnTexto(`\`${unaMetrica}.definicion.categorias\` gana una entrada`, "d.md"),
    ).toEqual([{ id: unaMetrica, fichero: "d.md", motivo: "campo" }]);
    expect(cambiosDeclaradosEnTexto(`\`${unaMetrica}.estadoProduccion\` cambia`, "d.md")).toEqual([
      { id: unaMetrica, fichero: "d.md", motivo: "campo" },
    ]);
    expect(
      cambiosDeclaradosEnTexto(`\`${unaMetrica}\`: "declarada" -> "producida"`, "d.md"),
    ).toEqual([{ id: unaMetrica, fichero: "d.md", motivo: "estado" }]);
    // Nombrar la metrica SIN nombrar un campo suyo no la convierte en sujeto: una decision
    // habla de muchas metricas y solo cambia la entrada de algunas (⟨D12⟩ nombra las tres de
    // Q1 y no toca su catalogo). Exigirles cita seria un falso positivo.
    expect(cambiosDeclaradosEnTexto(`\`${unaMetrica}\` se sigue sirviendo igual`, "d.md")).toEqual(
      [],
    );
    // Ni un campo sin metrica delante, ni un id que no existe, ni un campo inventado.
    expect(cambiosDeclaradosEnTexto("`definicion.categorias` cambia", "d.md")).toEqual([]);
    expect(cambiosDeclaradosEnTexto("`metrica_inventada.definicion` cambia", "d.md")).toEqual([]);
    expect(cambiosDeclaradosEnTexto(`\`${unaMetrica}.campo_inventado\` cambia`, "d.md")).toEqual([]);
    // Y una entrada que aparece por las dos reglas se declara "estado": es la que ademas fija
    // el valor resultante en la comprobacion (c).
    expect(
      cambiosDeclaradosEnTexto(
        `\`${unaMetrica}.definicion\` cambia\n\`${unaMetrica}\`: de "declarada" a "producida"`,
        "d.md",
      ),
    ).toEqual([{ id: unaMetrica, fichero: "d.md", motivo: "estado" }]);

    const cambios = cambiosDecididosEnProgress();

    // Sanidad: sin cambios derivados el caso seria vacuo. Y al exigir DOS ficheros distintos
    // se comprueba que la regla no vale solo para la 175: cubre tambien ⟨D8⟩ de la 127.
    expect(cambios.length, "no se derivo ningun cambio de estadoProduccion de progress/").
      toBeGreaterThanOrEqual(3);
    expect(new Set(cambios.map((c) => c.fichero)).size).toBeGreaterThanOrEqual(2);
    // Y las DOS reglas tienen sujeto real en el arbol: si una se rompiera, la otra la taparia
    // y el conteo de arriba seguiria cuadrando.
    for (const motivo of ["estado", "campo"] as const) {
      expect(
        cambios.filter((c) => c.motivo === motivo).length,
        `ninguna decision de progress/ deriva por la regla "${motivo}": la regla esta ciega`,
      ).toBeGreaterThanOrEqual(1);
    }

    // Autocomprobacion del lector de citas ANTES de usarlo: si devolviera [] por un cambio de
    // formato del comentario, el bucle de abajo no comprobaria NINGUN fichero y (b) pasaria por
    // ciega. Distingue ademas la decision de la bitacora, y no se traga un nombre inventado.
    expect(decisionesCitadas("ver `progress/decision_C2_127.md`)")).toEqual(["decision_C2_127.md"]);
    expect(decisionesCitadas("(`progress/decision_F2_173.md`): la DESCRIPCION cambia")).
      toEqual(["decision_F2_173.md"]);
    expect(decisionesCitadas("`progress/decision_175.md` y `progress/decision_175.md`")).
      toEqual(["decision_175.md"]);
    expect(decisionesCitadas("§H7 de `progress/impl_173-caja-tesoreria.md`")).toEqual([]);
    expect(decisionesCitadas("sin ninguna cita")).toEqual([]);

    for (const cambio of cambios) {
      const ruta = path.join(DIR_PROGRESS, cambio.fichero);
      const decision = fs.readFileSync(ruta, "utf8");

      // (a) la decision esta FECHADA (el patron de ⟨D8⟩: "Fecha: 2026-08-03").
      const fecha = /\b20\d{2}-\d{2}-\d{2}\b/.exec(decision);
      expect(fecha, `progress/${cambio.fichero} no lleva fecha`).not.toBeNull();

      // (b) la entrada del catalogo CITA ese fichero desde su propio comentario, y toda fecha
      // que escribe esta RESPALDADA por alguna de las decisiones que ella misma cita. Una
      // metrica acumula decisiones de varias features (ver la nota de arriba: `egresos` cita
      // ⟨D8⟩ de la 127 y ⟨P4⟩ de la 173), asi que el respaldo se busca en el conjunto citado y
      // no en un unico fichero — pero cada miembro de ese conjunto tiene que existir y estar
      // fechado, o citarlo no respaldaria nada.
      const bloque = bloqueDeEntrada(cambio.id);
      expect(
        bloque.includes(`progress/${cambio.fichero}`),
        `${cambio.id}: progress/${cambio.fichero} decide sobre su ${
          cambio.motivo === "estado" ? "estadoProduccion" : "entrada del catalogo"
        } y la entrada NO lo cita`,
      ).toBe(true);

      const citadas = decisionesCitadas(bloque);
      expect(citadas, `el bloque de ${cambio.id} no cita su propia decision`).
        toContain(cambio.fichero);

      const fechasRespaldadas = new Set<string>();
      for (const nombre of citadas) {
        const rutaCitada = path.join(DIR_PROGRESS, nombre);
        expect(
          fs.existsSync(rutaCitada),
          `${cambio.id} cita progress/${nombre}, que no existe`,
        ).toBe(true);
        const suyas = fechasDe(fs.readFileSync(rutaCitada, "utf8"));
        expect(suyas.length, `${cambio.id} cita progress/${nombre}, que no lleva fecha`).
          toBeGreaterThan(0);
        for (const f of suyas) fechasRespaldadas.add(f);
      }

      const fechasCitadas = fechasDe(bloque);
      expect(fechasCitadas.length, `${cambio.id} cita la decision sin fecha`).toBeGreaterThan(0);
      for (const citada of fechasCitadas) {
        expect(
          fechasRespaldadas.has(citada),
          `${cambio.id} cita la fecha ${citada}, que no aparece en ninguna de las decisiones ` +
            `que el propio bloque cita (${citadas.join(", ")})`,
        ).toBe(true);
      }

      // Y la decision DEL CAMBIO no se cita de adorno: al menos una de las fechas del bloque es
      // suya. Sin esto bastaria nombrar el fichero sin su fecha y colgar todas las del bloque de
      // cualquier otro documento, que es justo la firma que R14 exige.
      const fechasDelCambio = new Set(fechasDe(decision));
      expect(
        fechasCitadas.some((f) => fechasDelCambio.has(f)),
        `${cambio.id} cita progress/${cambio.fichero} sin escribir ninguna de sus fechas`,
      ).toBe(true);

      // (c) y el estado que la decision ratifico es el que el catalogo tiene hoy. SOLO para
      // los cambios de `estadoProduccion`: una decision sobre `definicion.categorias` no dice
      // nada del estado, y afirmar `producida` para ella seria fijar un valor que ese
      // documento nunca decidio — la clase de asercion que este archivo evita en su cabecera.
      if (cambio.motivo === "estado") {
        expect(getMetrica(cambio.id)!.estadoProduccion, cambio.id).toBe("producida");
      }
    }
  });
});
