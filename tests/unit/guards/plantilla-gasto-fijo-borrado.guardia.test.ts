import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// FICHA 332 (T19, R21–R25) — **LA GUARDIA DE QUE EL ARBOL NO SIGA DICIENDO QUE LAS PLANTILLAS
// DE GASTO FIJO NO SE BORRAN.**
//
// Molde: `tests/unit/guards/decision5-revertida.guardia.test.ts` (feature 287) y su antecesor
// `d5-revertida` (feature 261). Este repo ya escribio dos veces esta misma guardia porque una
// decision revertida vive en soportes que envejecen por separado, y cada uno miente distinto:
//
//   (1) **El codigo** — hasta el 2026-08-29, catorce sitios de produccion afirmaban con autoridad
//       que una plantilla de gasto fijo NO se borra («sin borrado (R25)», «NO expone `delete`»,
//       «NUNCA borrar»). Quien los lea hoy concluye lo contrario de lo que hace el sistema.
//   (2) **`specs/45-wallet-gastos-sueldos`** — donde `45/R25` se firmo. Sin apendice, quien lo
//       lea dentro de seis meses creera que el borrado sigue prohibido y «arreglara» el codigo.
//   (3) **La migracion ya aplicada** — que tambien lo dice, y que NO SE TOCA: es la foto de su
//       fecha, y editar en sitio una migracion aplicada es el patron que en este repo ya produjo
//       drift. Su exclusion esta escrita aqui, con su motivo, y no es un descuido (R24).
//
// ⚠️ POR QUE SE COMPRUEBAN LAS DOS DIRECCIONES EN EL SPEC DE LA 45. El apendice APUNTA a la ficha
// 332, pero el texto original de `45/R25` **no se toca** (R23). Si esta guardia solo exigiera el
// puntero, un «ya que estamos» podria reescribir R25 «para dejarlo coherente» y borraria la unica
// prueba de que aquella decision se tomo a conciencia y con sus razones.
//
// ⚠️ Y POR QUE EL DETECTOR DE (a) DISTINGUE **AFIRMAR** DE **CITAR PARA REVOCAR**. R22 obliga a que
// cada nota diga QUE se revoca, y decirlo exige nombrar la frase vieja entre comillas («hasta el
// 2026-08-29 esta cabecera decia: NO expone `delete`»). Si el detector leyera esa cita como una
// afirmacion vigente, la unica forma de pasar (a) seria borrar la cita — y con ella la pieza que
// dice que hubo una decision anterior. Por eso un hallazgo NO cuenta si tiene una marca de
// revocacion CERCA; «cerca» y no «en el archivo», porque si bastara con nombrarla en cualquier
// parte, un archivo con la nota arriba podria afirmar lo contrario 500 lineas mas abajo y colar.
//
// **El detector se auto-prueba (bloque 0 + el describe final).** Una guardia estatica rota no
// falla: calla. En este repo ya paso —una guardia verde POR VACIA porque no encontraba NADA—, y
// hay tests de integracion que reportaron `passed` sin comprobar nada. Aqui: los archivos censados
// existen y ninguno se leyo en blanco, el censo tiene cota minima explicita, y cada detector se
// prueba contra un texto que SI infringe y otro que no, incluida una mutacion sobre un ARCHIVO
// REAL (un texto sintetico no habria visto el agujero de M16 en la guardia de la 287).
//
// La lectura es ESTATICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo,
// sin estar registrada en ninguna lista.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

/* -------------------------------------------------------------------------- */
/* El censo                                                                     */
/* -------------------------------------------------------------------------- */

/** Donde la revocacion vive ENTERA (design §4.1): la nota larga, con sus cuatro piezas. */
const ANCLA = "lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts";

/** Los dos archivos del spec de la 45 que llevan el apendice (R23). */
const SPEC_45_REQ = "specs/45-wallet-gastos-sueldos/requirements.md";
const SPEC_45_DESIGN = "specs/45-wallet-gastos-sueldos/design.md";

/** El design de ESTA ficha: ahi vive el contrato con la 333 (R25). */
const SPEC_332_DESIGN = "specs/332-eliminar-plantilla-gasto-fijo/design.md";

/** El contrato del servicio: el otro sitio donde R25 exige el traspaso a la 333. */
const CONTRATO_SERVICIO = "lib/interfaces/services/IGastoFijoPlantillaService.ts";

/**
 * El censo de codigo: los NUEVE archivos de produccion que afirmaban `45/R25` (sitios 1–15 del
 * censo de `design.md §4.1`, agrupados por archivo).
 *
 * `db/schema.prisma` entra por una REBANADA y no entero: es un archivo de ~2.100 lineas con
 * decenas de modelos, y buscar «2026-08-29» o «revoca» en cualquier parte de el daria por buena
 * una nota que estuviera 600 lineas mas abajo, hablando de otra cosa (l. 2117 usa «la revoca»
 * para el estado de un usuario). La nota tiene que estar JUNTO al modelo o no sirve.
 */
const CENSO_CODIGO: readonly string[] = [
  "db/schema.prisma",
  ANCLA,
  "lib/repositories/GastoFijoPlantillaRepository.ts",
  CONTRATO_SERVICIO,
  "lib/services/GastoFijoPlantillaService.ts",
  "lib/types/gasto-fijo-plantilla.ts",
  "lib/actions/gasto-fijo-plantilla.ts",
  "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx",
  "app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx",
];

/**
 * Barrido extra SOLO para (a): la carpeta entera de la pantalla de wallet. El censo de arriba
 * es una lista fija y por tanto no ve un archivo NUEVO que naciera repitiendo la frase vieja;
 * este barrido si. Es barato porque los patrones de (a) son estrechos y estan atados a la
 * plantilla de gasto fijo o a `R25`, no a la palabra «borrar».
 */
const BARRIDO_A = "app/(app)/wallet/_components";

/**
 * ⛔ R24 — `db/migrations/**` QUEDA FUERA DEL CENSO, Y ESTE ES EL MOTIVO, ESCRITO.
 *
 * `db/migrations/20260713150000_gasto_fijo_plantilla/migration.sql` dice en su cabecera «NO se
 * borra (R25)» y AHI SE QUEDA. Una migracion ya aplicada es la FOTO de su fecha: el SQL que corrio
 * contra las bases es ese y no otro, y editarlo en sitio no llega nunca a las que ya lo aplicaron
 * —es el patron que en este repo ya produjo drift, documentado—. Su nota no cuenta como afirmacion
 * vigente a efectos de R21 porque nadie va a `db/migrations/` a averiguar si hoy se puede borrar
 * una plantilla: va al contrato del repositorio o al servicio, que son los que (a) y (b) vigilan.
 *
 * La exclusion se verifica en el bloque (e) por partida doble: ningun archivo del censo cae bajo
 * `db/migrations/`, y la migracion SIGUE diciendo lo que decia (si alguien la «dejara coherente»,
 * el testigo verbatim se pone rojo).
 */
const MOTIVO_EXCLUSION_MIGRACIONES =
  "migracion aplicada = foto de su fecha; editarla en sitio produce drift y no llega a las " +
  "bases que ya la aplicaron. Ver R24 de specs/332-eliminar-plantilla-gasto-fijo.";

const MIGRACION_INTOCABLE =
  "db/migrations/20260713150000_gasto_fijo_plantilla/migration.sql";

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia plantilla-gasto-fijo-borrado: ${que}. La guardia NO pudo leer lo que vigila; se ` +
      `detiene en ROJO en vez de dar por buena una lectura vacia. Si el codigo se reorganizo, ` +
      `actualiza el censo — no borres la comprobacion.`,
  );
}

function leer(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!fs.existsSync(ruta)) reventar(`falta el archivo censado \`${rel}\``);
  return fs.readFileSync(ruta, "utf8");
}

/* -------------------------------------------------------------------------- */
/* La rebanada del schema: la nota tiene que estar JUNTO al modelo             */
/* -------------------------------------------------------------------------- */

const SCHEMA = "db/schema.prisma";
const SCHEMA_DESDE = "// Feature 45 (design §1.2): plantilla recurrente de GASTO FIJO";
const SCHEMA_HASTA = "model GastoFijoPlantilla {";

/** El bloque de comentario del modelo `GastoFijoPlantilla` + su cabecera. */
export function rebanadaDelModelo(schema: string): string {
  const inicio = schema.indexOf(SCHEMA_DESDE);
  const fin = schema.indexOf(SCHEMA_HASTA);
  if (inicio === -1 || fin === -1 || fin <= inicio) {
    reventar(
      `no se pudo recortar el bloque de \`GastoFijoPlantilla\` en ${SCHEMA} ` +
        `(¿se movio o se reescribio la cabecera del modelo?)`,
    );
  }
  return schema.slice(inicio, fin + SCHEMA_HASTA.length);
}

/** El texto que (a) y (b) miran por archivo. Para el schema, solo su rebanada. */
function textoVigilado(rel: string): string {
  const bruto = leer(rel);
  return rel === SCHEMA ? rebanadaDelModelo(bruto) : bruto;
}

/* -------------------------------------------------------------------------- */
/* (a) R21 — ninguna afirmacion vigente de que no se puede borrar             */
/* -------------------------------------------------------------------------- */

/**
 * Colapsa el espacio en blanco y quita las marcas de comentario al inicio de cada linea.
 *
 * Sin esto, una frase partida en dos lineas de comentario —«activar/desactivar (NUNCA\n// borrar,
 * R25…)»— tiene un `//` en medio que ningun patron literal atraviesa. Es exactamente como vive la
 * prosa en este repo, y la guardia de la 287 lo aprendio midiendolo.
 */
export function normalizar(texto: string): string {
  return texto.replace(/^[ \t]*(?:\/\/+|\*+|#|--)[ \t]?/gm, " ").replace(/\s+/g, " ");
}

const VENTANA_DE_REVOCACION = 400;
const MARCA_DE_REVOCACION = /REVOC|REVERTID|SUPERSED|hasta (?:el|esa fecha)|ficha 332/i;

/**
 * Las frases que hasta el 2026-08-29 afirmaban `45/R25`, tal como estaban escritas en el arbol
 * (censo de `design.md §4.1`). Son ESTRECHAS a proposito: «borrar» a secas aparece por todo el
 * repo —hay un `EliminarOrdenService`, una purga de postulaciones, reversas de pagos— y un
 * detector ancho convertiria esta guardia en ruido que nadie mira.
 */
const PATRONES_CADUCADOS: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "«sin borrado (R25)»", patron: /sin borrado/i },
  { nombre: "«NUNCA borrar»", patron: /nunca borrar/i },
  {
    nombre: "«NO expone `delete`»",
    patron: /no expone\s*[`'"«]?\s*delete/i,
  },
  {
    nombre: "«NO se borra (R25)»",
    patron: /no se borran?\s*[(«]?\s*R25/i,
  },
  {
    nombre: "«el sistema NO DEBE borrar plantillas»",
    patron: /no debe borrar (?:las )?plantillas/i,
  },
  {
    nombre: "«las plantillas no se pueden borrar»",
    patron: /plantillas?[^.]{0,60}no se (?:pueden?|puede)\s+borra/i,
  },
];

/** ¿Hay una marca de revocacion en la ventana alrededor del hallazgo? */
function revocadoCerca(plano: string, indice: number, largo: number): boolean {
  const desde = Math.max(0, indice - VENTANA_DE_REVOCACION);
  const hasta = Math.min(plano.length, indice + largo + VENTANA_DE_REVOCACION);
  return MARCA_DE_REVOCACION.test(plano.slice(desde, hasta));
}

export function frasesCaducadas(texto: string): string[] {
  const plano = normalizar(texto);
  const salida: string[] = [];
  for (const { nombre, patron } of PATRONES_CADUCADOS) {
    // `g` propio por iteracion: los patrones se declaran sin bandera global para que `.test()`
    // no arrastre `lastIndex` entre llamadas.
    const global = new RegExp(patron.source, `${patron.flags.replace("g", "")}g`);
    let m: RegExpExecArray | null;
    while ((m = global.exec(plano)) !== null) {
      if (m[0].length === 0) break;
      if (!revocadoCerca(plano, m.index, m[0].length)) {
        salida.push(nombre);
        break; // basta un hallazgo NO revocado por patron
      }
    }
  }
  return salida;
}

/* -------------------------------------------------------------------------- */
/* (b) R22 — la revocacion, con sus piezas                                    */
/* -------------------------------------------------------------------------- */

const PIEZA_PALABRA = { nombre: "(1) la palabra que la marca como REVOCADA", patron: /revoc/i };
const PIEZA_FECHA = { nombre: "(2) la fecha de la revocacion (2026-08-29)", patron: /2026-08-29/ };
const PIEZA_PUNTERO = {
  nombre: "(3) el puntero a la ficha (`specs/332-eliminar-plantilla-gasto-fijo`)",
  patron: /specs\/332-eliminar-plantilla-gasto-fijo/,
};
/**
 * El motivo, con sus DOS mitades y en este orden: la tabla acumula RUIDO, y el historico NO
 * DEPENDE de la plantilla. Se exige entero solo en el ANCLA (ver mas abajo) porque es la pieza
 * que un «ya que estamos» borraria sin pensarlo: sin ella la nota queda como un permiso nuevo y
 * nadie sabe que se estaba protegiendo antes ni por que dejo de hacer falta.
 */
const PIEZA_MOTIVO = {
  nombre: "(4) el motivo (la tabla acumula RUIDO y el historico NO DEPENDE de la plantilla)",
  patron: /ruido[\s\S]{0,300}(?:historico|hist[oó]rico|historial)[\s\S]{0,40}no depende/i,
};

const PIEZAS_DE_LA_NOTA_LARGA = [
  PIEZA_PALABRA,
  PIEZA_FECHA,
  PIEZA_PUNTERO,
  PIEZA_MOTIVO,
] as const;

/**
 * En los demas archivos se exigen TRES piezas y no las cuatro, y es una decision, no una rebaja
 * por comodidad: `design.md §4.1` fija que la nota larga va UNA sola vez —en el contrato del
 * repositorio, que es donde `45/R25` estaba enunciado con mas fuerza— y que el resto lleva una
 * linea con el puntero. Repetir el motivo entero en nueve archivos es la clase de prosa que se
 * copia mal y envejece en siete sitios a la vez; el puntero, en cambio, lleva al unico sitio
 * donde el motivo se mantiene al dia.
 */
const PIEZAS_DE_LA_LINEA_CORTA = [PIEZA_PALABRA, PIEZA_FECHA, PIEZA_PUNTERO] as const;

export function piezasQueFaltan(
  texto: string,
  piezas: readonly { readonly nombre: string; readonly patron: RegExp }[],
): string[] {
  const plano = normalizar(texto);
  return piezas.filter(({ patron }) => !patron.test(plano)).map(({ nombre }) => nombre);
}

/* -------------------------------------------------------------------------- */
/* (c) R23 — el apendice en el spec de la 45                                  */
/* -------------------------------------------------------------------------- */

const PIEZAS_DEL_APENDICE: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la marca SUPERSEDED", patron: /superseded/i },
  { nombre: "la fecha del apendice (2026-08-29)", patron: /2026-08-29/ },
  { nombre: "que quien lo supersede es la ficha 332", patron: /ficha 332/i },
  {
    nombre: "el puntero (`specs/332-eliminar-plantilla-gasto-fijo`)",
    patron: /specs\/332-eliminar-plantilla-gasto-fijo/,
  },
];

/* -------------------------------------------------------------------------- */
/* (d) R23 — los testigos VERBATIM del texto original de 45/R25               */
/* -------------------------------------------------------------------------- */

/**
 * Cubren las tres lineas de `45/R25` y la linea equivalente de su `design.md`, y se comparan
 * VERBATIM.
 *
 * ⛔ Si uno se pone rojo, la respuesta NO es actualizar el testigo: es que alguien reescribio el
 * spec de la 45 en vez de anexarle el apendice. Un spec es la foto de su fecha; «dejarlo
 * coherente» borra la prueba de que aquella decision se tomo a conciencia.
 */
const TESTIGOS_45_REQ: readonly string[] = [
  "- **R25** — El sistema DEBE permitir al maestro editar `concepto` y `monto` de una plantilla y",
  "  activarla/desactivarla; el sistema NO DEBE borrar plantillas (la desactivación —`activa = false`— es el",
  "  mecanismo para dejar de generar, preservando el historial y los egresos ya emitidos).",
];

const TESTIGOS_45_DESIGN: readonly string[] = [
  "  en el futuro, se DESACTIVA la plantilla (`activa=false`, R25) — no se borra ni la plantilla ni el egreso.",
];

export function testigosQueFaltan(texto: string, testigos: readonly string[]): string[] {
  return testigos.filter((frase) => !texto.includes(frase));
}

/* -------------------------------------------------------------------------- */
/* (f) R25 — el contrato con la ficha 333                                     */
/* -------------------------------------------------------------------------- */

const PIEZAS_DEL_TRASPASO: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "(1) nombra a la ficha 333", patron: /(?:ficha|la)\s*333/i },
  {
    nombre: "(2) los cobros pendientes se CANCELAN al borrar",
    patron: /cancel\w+[\s\S]{0,80}pendientes/i,
  },
  {
    nombre: "(3) en la MISMA operacion atomica (una transaccion que abarque los dos pasos)",
    patron: /misma operaci[oó]n at[oó]mica|transacci[oó]n que abarque/i,
  },
  {
    nombre: "(4) el numero se cuenta ANTES y se anuncia en la confirmacion",
    patron: /ANTES[\s\S]{0,200}confirmaci[oó]n/,
  },
];

/* -------------------------------------------------------------------------- */
/* 0 — La guardia mira lo que dice mirar                                      */
/* -------------------------------------------------------------------------- */

describe("(0) autocomprobacion del censo: la guardia mira lo que dice mirar", () => {
  it("los archivos censados existen y ninguno se leyo en blanco", () => {
    const todos = [
      ...CENSO_CODIGO,
      SPEC_45_REQ,
      SPEC_45_DESIGN,
      SPEC_332_DESIGN,
      MIGRACION_INTOCABLE,
    ];
    for (const rel of todos) {
      expect(fs.existsSync(path.join(RAIZ, rel)), `falta ${rel}`).toBe(true);
      expect(leer(rel).trim().length, `${rel} vino vacio`).toBeGreaterThan(0);
    }
  });

  it("el censo no esta vacio: son los NUEVE archivos de produccion, y la cota es explicita", () => {
    // Cota minima explicita: si alguien recorta el censo «porque ya no aplica», esto se pone
    // rojo antes de que la guardia empiece a pasar por vacia.
    expect(CENSO_CODIGO.length).toBeGreaterThanOrEqual(9);
    expect(new Set(CENSO_CODIGO).size, "hay archivos repetidos en el censo").toBe(
      CENSO_CODIGO.length,
    );
    expect(PATRONES_CADUCADOS.length).toBeGreaterThanOrEqual(6);
    expect(PIEZAS_DE_LA_NOTA_LARGA).toHaveLength(4);
    expect(PIEZAS_DEL_APENDICE).toHaveLength(4);
    expect(PIEZAS_DEL_TRASPASO).toHaveLength(4);
    expect(TESTIGOS_45_REQ.length + TESTIGOS_45_DESIGN.length).toBeGreaterThanOrEqual(4);
    for (const t of [...TESTIGOS_45_REQ, ...TESTIGOS_45_DESIGN]) {
      expect(t.length, `testigo demasiado corto: ${t}`).toBeGreaterThan(40);
    }
  });

  it("el barrido de (a) encuentra archivos de verdad en la carpeta de la wallet", () => {
    const archivos = archivosDeCodigo(path.join(RAIZ, BARRIDO_A));
    expect(archivos.length, "el barrido quedo vacio: no estaria mirando nada").toBeGreaterThan(5);
    expect(
      archivos.some((r) => r.endsWith("GastosFijosPlantillasPanel.tsx")),
      "el barrido no ve el panel, que es justo el archivo del que nace la ficha",
    ).toBe(true);
  });

  it("la rebanada del schema es el bloque del modelo, no el archivo entero", () => {
    const schema = leer(SCHEMA);
    const trozo = rebanadaDelModelo(schema);
    expect(trozo.length).toBeGreaterThan(200);
    // Que sea una REBANADA y no el archivo es lo que impide que una nota de otro modelo, 600
    // lineas mas abajo, satisfaga las piezas de (b) por accidente.
    expect(trozo.length).toBeLessThan(schema.length / 10);
    expect(trozo).toContain("model GastoFijoPlantilla {");
    expect(trozo).not.toContain("model WalletMovimiento {");
  });
});

function archivosDeCodigo(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...archivosDeCodigo(ruta));
    else if (/\.tsx?$/.test(entrada.name)) out.push(ruta);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* La regla                                                                    */
/* -------------------------------------------------------------------------- */

describe("(a) R21 — ningun archivo vivo afirma que las plantillas no se pueden borrar", () => {
  it("los nueve archivos del censo estan limpios de afirmaciones caducadas", () => {
    const infractores = CENSO_CODIGO.map((rel) => ({
      archivo: rel,
      frases: frasesCaducadas(textoVigilado(rel)),
    })).filter((x) => x.frases.length > 0);

    expect(
      infractores,
      "R21: desde el 2026-08-29 una plantilla de gasto fijo SI se elimina. Dejar escrito lo " +
        "contrario hace que el codigo mienta, y miente con autoridad justo donde alguien va a " +
        "buscar la regla. Si la frase es una CITA para revocarla, tiene que llevar la marca de " +
        "revocacion cerca (±400 caracteres).\n" + JSON.stringify(infractores, null, 2),
    ).toEqual([]);
  });

  it("tampoco lo afirma ningun otro archivo de la pantalla de wallet", () => {
    const infractores = archivosDeCodigo(path.join(RAIZ, BARRIDO_A))
      .map((ruta) => ({
        archivo: path.relative(RAIZ, ruta).replace(/\\/g, "/"),
        frases: frasesCaducadas(fs.readFileSync(ruta, "utf8")),
      }))
      .filter((x) => x.frases.length > 0);

    expect(infractores, JSON.stringify(infractores, null, 2)).toEqual([]);
  });
});

describe("(b) R22 — la revocacion esta escrita, con fecha, motivo y puntero", () => {
  it("el ANCLA lleva la nota LARGA con sus CUATRO piezas", () => {
    expect(
      piezasQueFaltan(leer(ANCLA), PIEZAS_DE_LA_NOTA_LARGA),
      `R22: \`${ANCLA}\` es donde \`45/R25\` estaba enunciado con mas fuerza y donde la nota va ` +
        "completa. Sin el motivo, la nota queda como un permiso nuevo y nadie sabe que se estaba " +
        "protegiendo; sin la fecha, dice «esto es asi» sin decir desde cuando dejo de ser lo " +
        "contrario; sin el puntero, no hay donde ir a leer la decision.",
    ).toEqual([]);
  });

  it("los ocho archivos restantes llevan al menos la linea con revocacion, fecha y puntero", () => {
    const faltantes = CENSO_CODIGO.filter((rel) => rel !== ANCLA)
      .map((rel) => ({
        archivo: rel,
        piezas: piezasQueFaltan(textoVigilado(rel), PIEZAS_DE_LA_LINEA_CORTA),
      }))
      .filter((x) => x.piezas.length > 0);

    expect(faltantes, JSON.stringify(faltantes, null, 2)).toEqual([]);
  });
});

describe("(c)+(d) R23 — el spec de la 45 lleva el apendice Y conserva su texto original", () => {
  it("(c) `requirements.md` de la 45 apunta a la 332, con SUPERSEDED, fecha y puntero", () => {
    expect(
      piezasQueFaltan(leer(SPEC_45_REQ), PIEZAS_DEL_APENDICE),
      "R23: `45/R25` se firmo en ese spec. Sin puntero, quien lo lea dentro de seis meses creera " +
        "que el borrado sigue prohibido y «arreglara» el codigo que hoy si borra.",
    ).toEqual([]);
  });

  it("(c) `design.md` de la 45 tambien lo lleva, junto a la linea del cron", () => {
    expect(piezasQueFaltan(leer(SPEC_45_DESIGN), PIEZAS_DEL_APENDICE)).toEqual([]);
  });

  it("(d) el texto original de `45/R25` sigue VERBATIM: el apendice se AÑADE, no reescribe", () => {
    expect(
      testigosQueFaltan(leer(SPEC_45_REQ), TESTIGOS_45_REQ),
      "Un spec es la foto de su momento. Si falta un testigo, alguien reescribio `45/R25` «para " +
        "dejarlo coherente» y con ello borro la prueba de que aquella decision se tomo a " +
        "conciencia y con sus razones.",
    ).toEqual([]);
  });

  it("(d) la linea equivalente del `design.md` de la 45 tambien sigue VERBATIM", () => {
    expect(testigosQueFaltan(leer(SPEC_45_DESIGN), TESTIGOS_45_DESIGN)).toEqual([]);
  });
});

describe("(e) R24 — `db/migrations/**` queda FUERA del censo, con su motivo escrito", () => {
  it("ningun archivo del censo cae bajo `db/migrations/`", () => {
    const colados = CENSO_CODIGO.filter((rel) => rel.startsWith("db/migrations/"));
    expect(
      colados,
      "R24: una migracion aplicada no se edita. Si entra al censo, (a) la marcaria como " +
        "infractora y el siguiente en pasar por aqui la «arreglaria» en sitio.\n" +
        MOTIVO_EXCLUSION_MIGRACIONES,
    ).toEqual([]);
  });

  it("la migracion aplicada SIGUE diciendo lo que decia: nadie la dejo «coherente»", () => {
    // El testigo verbatim de su cabecera. Es la otra mitad de la exclusion: excluirla del censo
    // no sirve de nada si alguien la reescribe igualmente por su cuenta.
    const sql = leer(MIGRACION_INTOCABLE);
    expect(sql).toMatch(/NO se borra \(R25\)/);
  });

  it("el motivo de la exclusion esta escrito en ESTE archivo, no es un descuido", () => {
    // Declarativo a proposito: la constante vive aqui y su texto es el que un lector se
    // encuentra al preguntarse «¿y por que la migracion no esta?». Si alguien la vacia para
    // acallar la guardia, esto se pone rojo.
    expect(MOTIVO_EXCLUSION_MIGRACIONES.length).toBeGreaterThan(80);
    expect(MOTIVO_EXCLUSION_MIGRACIONES).toMatch(/foto de su fecha/i);
    expect(MOTIVO_EXCLUSION_MIGRACIONES).toMatch(/drift/i);
  });
});

describe("(f) R25 — el traspaso a la ficha 333 esta escrito donde se lee", () => {
  it("en el docstring de `eliminarPlantilla` (contrato del servicio)", () => {
    expect(
      piezasQueFaltan(leer(CONTRATO_SERVICIO), PIEZAS_DEL_TRASPASO),
      "R25: la 332 no implementa la cancelacion de cobros pendientes —es de la 333—, pero SI " +
        "DEBE dejar escrito el contrato: cancelar en la misma operacion atomica y contar ANTES " +
        "para anunciar el numero en la confirmacion. Sin esto, la 333 llega y no hay nada que " +
        "cumplir.",
    ).toEqual([]);
  });

  it("y en `specs/332-eliminar-plantilla-gasto-fijo/design.md`", () => {
    expect(piezasQueFaltan(leer(SPEC_332_DESIGN), PIEZAS_DEL_TRASPASO)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* AUTOCOMPROBACION — sin esto, la guardia podria estar verde POR VACIA        */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion: los detectores marcan y NO marcan lo que dicen", () => {
  it("(a) caza la frase aunque este PARTIDA en dos lineas de comentario", () => {
    const comoEnCodigo = `
      // Panel CRUD de plantillas de gasto fijo: permite crear/editar y
      //   activar/desactivar (NUNCA borrar, R25: la desactivacion es el mecanismo).
    `;
    expect(frasesCaducadas(comoEnCodigo)).toEqual(["«NUNCA borrar»"]);
  });

  it("(a) marca cada una de las seis frases del censo cuando se afirman a secas", () => {
    const afirmaciones: readonly [string, string][] = [
      ["Sin borrado (R25): la desactivacion es el mecanismo.", "«sin borrado (R25)»"],
      ["activar/desactivar (NUNCA borrar, R25).", "«NUNCA borrar»"],
      ["El repositorio NO expone `delete` (R25).", "«NO expone `delete`»"],
      ["Configuracion mutable que NO se borra (R25).", "«NO se borra (R25)»"],
      ["El sistema NO DEBE borrar plantillas.", "«el sistema NO DEBE borrar plantillas»"],
      [
        "Las plantillas de gasto fijo no se pueden borrar por diseño.",
        "«las plantillas no se pueden borrar»",
      ],
    ];
    for (const [frase, esperada] of afirmaciones) {
      expect(frasesCaducadas(frase), `no se cazo: ${frase}`).toContain(esperada);
    }
    // Y el detector no es un «todo vale»: un texto vecino que NO afirma nada de esto pasa.
    expect(
      frasesCaducadas(
        "El pago no se borra: queda a la vista y el dinero vuelve al saldo con un movimiento nuevo.",
      ),
    ).toEqual([]);
    expect(frasesCaducadas("EliminarOrdenService borra las ordenes seleccionadas.")).toEqual([]);
  });

  it("(a) CITAR la frase para revocarla no cuenta; AFIRMARLA a secas si", () => {
    // ⭑ LA TENSION REAL DE ESTA FICHA. R22 obliga a nombrar la frase vieja entre comillas; si el
    //   detector la leyera como afirmacion, la unica salida seria borrar la cita — y con ella la
    //   prueba de que hubo una decision anterior.
    const citada =
      "FICHA 332: hasta el 2026-08-29 esta cabecera decia «NO expone `delete` (R25)». Esa " +
      "decision quedo REVOCADA por decision humana de esa fecha: el contrato de abajo SI " +
      "declara `eliminar`.";
    expect(frasesCaducadas(citada)).toEqual([]);

    const afirmada = "El repositorio NO expone `delete` (R25): la desactivacion es el mecanismo.";
    expect(frasesCaducadas(afirmada)).toEqual(["«NO expone `delete`»"]);
  });

  it("(a) una marca de revocacion LEJOS no excusa la afirmacion", () => {
    // Sin ventana, un archivo con la nota de revocacion en la cabecera podria afirmar lo
    // contrario 500 lineas mas abajo y colar.
    const lejos =
      "FICHA 332: el «sin borrado» de 45/R25 queda REVOCADO el 2026-08-29." +
      " relleno".repeat(120) + // > 400 caracteres de distancia
      " Las plantillas de gasto fijo no se pueden borrar.";
    expect(frasesCaducadas(lejos)).toEqual(["«las plantillas no se pueden borrar»"]);
  });

  it("(a) REGRESION sobre un ARCHIVO REAL: una frase añadida al panel se caza", () => {
    // ⭑ La autocomprobacion sintetica de arriba no prueba que el detector lea BIEN el archivo de
    //   verdad; en la guardia de la 287 ese hueco dejo sobrevivir una mutacion. Aqui la mutacion
    //   se aplica al panel REAL: hoy esta limpio, y una linea añadida al final —lejos de
    //   cualquier marca de revocacion— tiene que ponerlo rojo.
    const panel = leer("app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx");
    expect(frasesCaducadas(panel)).toEqual([]);

    const mutado = `${panel}\n// Nota: las plantillas de gasto fijo no se pueden borrar.\n`;
    expect(mutado).not.toBe(panel);
    expect(frasesCaducadas(mutado)).toEqual(["«las plantillas no se pueden borrar»"]);
  });

  it("(b) exige TODAS las piezas: quitar una sola la delata", () => {
    const completa =
      "La ficha 332 revoca el «sin borrado» de 45/R25 con decision humana del 2026-08-29. " +
      "Motivo: la tabla acumula ruido y el historico no depende de la plantilla (no hay FK). " +
      "Puntero: specs/332-eliminar-plantilla-gasto-fijo.";
    expect(piezasQueFaltan(completa, PIEZAS_DE_LA_NOTA_LARGA)).toEqual([]);

    expect(
      piezasQueFaltan(completa.replace("2026-08-29", "hace poco"), PIEZAS_DE_LA_NOTA_LARGA),
    ).toEqual(["(2) la fecha de la revocacion (2026-08-29)"]);
    expect(
      piezasQueFaltan(
        completa.replace("specs/332-eliminar-plantilla-gasto-fijo", "la ficha nueva"),
        PIEZAS_DE_LA_NOTA_LARGA,
      ),
    ).toEqual(["(3) el puntero a la ficha (`specs/332-eliminar-plantilla-gasto-fijo`)"]);
    // ⭑ La pieza que un «ya que estamos» borraria: sin el motivo, la nota es un permiso nuevo.
    expect(
      piezasQueFaltan(
        completa.replace(
          "Motivo: la tabla acumula ruido y el historico no depende de la plantilla (no hay FK). ",
          "",
        ),
        PIEZAS_DE_LA_NOTA_LARGA,
      ),
    ).toEqual([
      "(4) el motivo (la tabla acumula RUIDO y el historico NO DEPENDE de la plantilla)",
    ]);

    // Una nota que solo diga «revocado» no salva ni una pieza mas que la palabra.
    expect(piezasQueFaltan("REVOCADO, ver la ficha 332", PIEZAS_DE_LA_NOTA_LARGA)).toHaveLength(
      PIEZAS_DE_LA_NOTA_LARGA.length - 1,
    );
  });

  it("(b) REGRESION sobre un ARCHIVO REAL: borrar el motivo del ANCLA la pone en rojo", () => {
    const real = leer(ANCLA);
    expect(piezasQueFaltan(real, PIEZAS_DE_LA_NOTA_LARGA)).toEqual([]);

    // Se borra la frase del MOTIVO tal como esta escrita en el archivo. Si el `replace` no
    // encaja, el caso estaria midiendo el vacio y el `not.toBe` lo delata.
    const sinMotivo = real.replace(/MOTIVO:[\s\S]*?se detiene ahi\./, "MOTIVO: por algo sera.");
    expect(sinMotivo, "la mutacion no encajo: este caso estaria midiendo el vacio").not.toBe(real);
    expect(piezasQueFaltan(sinMotivo, PIEZAS_DE_LA_NOTA_LARGA)).toEqual([
      "(4) el motivo (la tabla acumula RUIDO y el historico NO DEPENDE de la plantilla)",
    ]);
  });

  it("(c) un apendice sin puntero no cuela", () => {
    const bueno =
      "⚠️ SUPERSEDED 2026-08-29 por la ficha 332 (`specs/332-eliminar-plantilla-gasto-fijo`).";
    expect(piezasQueFaltan(bueno, PIEZAS_DEL_APENDICE)).toEqual([]);
    expect(
      piezasQueFaltan("⚠️ SUPERSEDED 2026-08-29 por la ficha 332.", PIEZAS_DEL_APENDICE),
    ).toEqual(["el puntero (`specs/332-eliminar-plantilla-gasto-fijo`)"]);
  });

  it("(d) el detector de testigos cae si el original se reescribe, aunque sea «equivalente»", () => {
    const original = leer(SPEC_45_REQ);
    expect(testigosQueFaltan(original, TESTIGOS_45_REQ)).toEqual([]);

    const reescrito = original.replace(
      "el sistema NO DEBE borrar plantillas",
      "el sistema PUEDE borrar plantillas [actualizado por la 332]",
    );
    expect(reescrito).not.toBe(original); // si no, el testigo estaria midiendo el vacio
    expect(testigosQueFaltan(reescrito, TESTIGOS_45_REQ)).toEqual([
      "  activarla/desactivarla; el sistema NO DEBE borrar plantillas (la desactivación —`activa = false`— es el",
    ]);
  });

  it("(f) el traspaso a medias no cuela: falta la pieza que falte, se dice cual", () => {
    const completo =
      "CONTRATO CON LA FICHA 333: al eliminar una plantilla se cancelan sus cobros pendientes " +
      "en la misma operacion atomica que la borra, y se cuentan ANTES para que la confirmacion " +
      "anuncie «se cancelaran 2 cobros pendientes».";
    expect(piezasQueFaltan(completo, PIEZAS_DEL_TRASPASO)).toEqual([]);
    expect(
      piezasQueFaltan(
        completo.replace("en la misma operacion atomica que la borra, y", "y"),
        PIEZAS_DEL_TRASPASO,
      ),
    ).toEqual([
      "(3) en la MISMA operacion atomica (una transaccion que abarque los dos pasos)",
    ]);
  });

  it("`normalizar` colapsa saltos, sangria y marcas de comentario", () => {
    expect(normalizar("a\n   b\t c")).toBe("a b c");
    expect(normalizar("// uno\n//   dos")).toBe(" uno dos");
    expect(normalizar("-- sql\n-- comentario")).toBe(" sql comentario");
  });
});
