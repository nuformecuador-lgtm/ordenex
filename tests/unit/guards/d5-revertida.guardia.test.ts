import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

// FEATURE 261 (B9, R24/R25/R26/R33) — **LA GUARDIA DE QUE EL CODIGO Y EL SPEC NO MIENTAN.**
//
// Molde: `tests/unit/tablero-dia/d10-revertida.guardia.test.ts`, que la 259 escribio para el
// mismo problema sobre la MISMA ficha (la 246). Una decision revertida vive en DOS soportes que
// pueden envejecer por separado:
//
//   (1) `lib/interfaces/services/IMisAsignacionesService.ts` — ahi D5 se declaraba VIGENTE y con
//       autoridad: «NO oculta ni bloquea nada […] la reserva protege del CRON, no del mensajero
//       (decision D5, que la medicion M3 cerro)». Si ese texto se queda mientras el servicio
//       bloquea, el codigo miente al siguiente que lo lea. Y el censo se extiende a TODO el arbol
//       del portal del mensajero: la misma frase estaba copiada en dos cards.
//   (2) `specs/246-asignacion-por-dia/**` — donde D5 se firmo. Sin marca, quien lo lea dentro de
//       seis meses creera que sigue vigente.
//
// ⚠️ POR QUE LA MITAD (2) COMPRUEBA LAS DOS DIRECCIONES. Un spec es la foto de su momento: el
// apendice APUNTA a la ficha nueva, pero el texto original **no se toca**. Si esta guardia solo
// exigiera el puntero, un «ya que estamos» podria reescribir §D5 «para dejarlo coherente» y
// borraria la unica prueba de que aquella decision se tomo a conciencia y con sus razones.
//
// ⚠️ Y VIGILA UNA TERCERA COSA, QUE NO ES DECORATIVA (R33): que junto a la reversion este escrito
// que HOY NO EXISTE NINGUNA SUPERFICIE para corregir el dia de reparto de una orden ya asignada,
// con el puntero a la **ficha 262**. Un riesgo aceptado que solo vive en un spec es un riesgo que
// nadie vuelve a leer; este tiene que estar delante de quien abra el archivo donde se decide el
// bloqueo. Cuando la 262 aterrice, la nota se retira POR LA PUERTA —con fecha y motivo—, no por un
// «ya que estamos».
//
// Cada detector es una FUNCION PURA con su AUTOCOMPROBACION: se le da un texto que SI infringe y
// otro que no. Sin eso, una guardia de prosa se queda verde POR VACIA en cuanto un rename deja de
// encajar — y este repo ya tuvo una guardia que no podia fallar nunca protegiendo justo lo que la
// ficha decidia.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Donde se declaraba D5 y donde vive ahora su reversion (R24) + la nota de R33. */
const CONTRATO = "lib/interfaces/services/IMisAsignacionesService.ts";
const SPEC_246_REQ = "specs/246-asignacion-por-dia/requirements.md";
const SPEC_246_DESIGN = "specs/246-asignacion-por-dia/design.md";
const SCHEMA = "db/schema.prisma";

/**
 * EL CENSO DEL ARBOL DEL PORTAL. No es una lista de archivos conocidos: `app/(app)/
 * mis-asignaciones/**` se recorre ENTERO, asi que una card nueva que copie la frase entra sola.
 */
const RAICES_DEL_CENSO = [
  "lib/interfaces/services/IMisAsignacionesService.ts",
  "lib/services/MisAsignacionesService.ts",
  "lib/utils/dia-reparto-textos.ts",
  "app/(app)/mis-asignaciones",
];

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia d5-revertida: ${que}. La guardia NO pudo leer lo que vigila; se detiene en ROJO en ` +
      `vez de dar por buena una lectura vacia. Si el codigo se reorganizo, actualiza el censo — ` +
      `no borres la comprobacion.`,
  );
}

function leer(rel: string): string {
  const ruta = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(ruta)) reventar(`falta el archivo censado \`${rel}\``);
  return fs.readFileSync(ruta, "utf8");
}

/** Todos los `.ts`/`.tsx` bajo `dir`, recursivo. */
function archivosDeCodigo(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...archivosDeCodigo(ruta));
    else if (/\.tsx?$/.test(entrada.name)) out.push(ruta);
  }
  return out;
}

/** Los archivos del censo, resueltos (archivo suelto o directorio recorrido entero). */
const ARCHIVOS_CENSADOS: string[] = (() => {
  const out: string[] = [];
  for (const rel of RAICES_DEL_CENSO) {
    const ruta = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(ruta)) reventar(`la raiz del censo \`${rel}\` no existe`);
    if (fs.statSync(ruta).isDirectory()) out.push(...archivosDeCodigo(ruta));
    else out.push(ruta);
  }
  return out;
})();

/* -------------------------------------------------------------------------- */
/* (a) Ninguna frase que afirme D5 VIGENTE                                     */
/* -------------------------------------------------------------------------- */

/**
 * Las frases que afirmaban D5 como vigente. Ya no describen lo que hace el sistema: desde la 261
 * una orden reservada para un dia posterior NO se puede recoger, ni escoger, ni gestionar.
 *
 * ⚠️ EL DETECTOR NORMALIZA LOS ESPACIOS antes de comparar, y no es un detalle: en JSX estas frases
 * estan partidas en varias lineas con sangria, y un patron literal NO las veria. La
 * autocomprobacion lo demuestra con una frase partida a mano.
 */
const FRASES_QUE_AFIRMAN_D5: readonly string[] = [
  "NO oculta ni bloquea nada",
  "no oculta ni bloquea nada",
  "protege del CRON, no del mensajero",
  "protege del corte de la noche, no del mensajero",
  // Basta la forma corta: como el detector busca subcadenas sobre el texto normalizado, esta
  // caza tambien «se puede recoger y gestionar igual». Dos entradas anidadas solo producirian
  // reportes duplicados.
  "puede recoger y gestionar igual",
  "que la medicion M3 cerro",
];

/** Colapsa todo espacio en blanco (incluidos saltos de linea y sangria de JSX) a un solo espacio. */
export function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

function frasesQueAfirmanD5(texto: string): string[] {
  const plano = normalizar(texto);
  return FRASES_QUE_AFIRMAN_D5.filter((frase) => plano.includes(normalizar(frase)));
}

/* -------------------------------------------------------------------------- */
/* (b) La reversion, con sus SEIS piezas                                       */
/* -------------------------------------------------------------------------- */

/**
 * Se exigen por separado para que el fallo diga CUAL falta en vez de un booleano. Las seis salen
 * de `design.md` §8.1 de la 261.
 */
const PIEZAS_DE_LA_REVERSION: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la decision por su nombre (D5)", patron: /\bD5\b/ },
  { nombre: "la fecha en que se ADOPTO (2026-08-20)", patron: /2026-08-20/ },
  { nombre: "la fecha de la REVERSION (2026-08-21)", patron: /2026-08-21/ },
  { nombre: "la palabra que dice que esta superada", patron: /REVERTIDA|SUPERSEDIDA|SUPERADA/i },
  {
    nombre: "el motivo (la medicion M3, refutada por la guia 17496963)",
    patron: /M3[\s\S]{0,400}17496963|17496963[\s\S]{0,400}M3/,
  },
  {
    nombre: "el puntero a la ficha (`specs/261-dia-reparto-protege`)",
    patron: /specs\/261-dia-reparto-protege/,
  },
];

function piezasDeLaReversionQueFaltan(texto: string): string[] {
  return PIEZAS_DE_LA_REVERSION.filter(({ patron }) => !patron.test(texto)).map(
    ({ nombre }) => nombre,
  );
}

/* -------------------------------------------------------------------------- */
/* (c) El apendice del spec de la 246                                          */
/* -------------------------------------------------------------------------- */

const PIEZAS_DEL_APENDICE: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la fecha del apendice (2026-08-21)", patron: /2026-08-21/ },
  { nombre: "que D5 fue supersedida", patron: /D5[\s\S]{0,80}supersedid/i },
  { nombre: "el puntero a la ficha 261", patron: /specs\/261-dia-reparto-protege/ },
];

function piezasDelApendiceQueFaltan(texto: string): string[] {
  return PIEZAS_DEL_APENDICE.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);
}

/* -------------------------------------------------------------------------- */
/* (d) Los testigos VERBATIM del §D5 original                                  */
/* -------------------------------------------------------------------------- */

/**
 * Elegidos para cubrir las tres partes de aquella decision —el enunciado, la recomendacion y el
 * requisito que produjo— y se comparan VERBATIM.
 *
 * ⛔ Si uno de estos se pone rojo, la respuesta NO es actualizar el testigo: es que alguien
 * reescribio el spec de la 246 en vez de anexarle el apendice.
 */
const TESTIGOS_DEL_D5_ORIGINAL: readonly string[] = [
  "**D5 · ¿El mensajero puede recoger y gestionar hoy una orden reservada para mañana?**",
  "**Recomendación: sí — visible, etiquetada y trabajable** (R22-R24). La reserva protege del **cron**,",
  "3. **La reserva no impide entregar hoy.** Por **D5**, un mensajero puede recoger y entregar hoy una",
  "**R24.** El sistema NO DEBE impedirle al mensajero recoger ni gestionar una orden reservada para",
];

function testigosQueFaltan(texto: string): string[] {
  return TESTIGOS_DEL_D5_ORIGINAL.filter((frase) => !texto.includes(frase));
}

/* -------------------------------------------------------------------------- */
/* (e) R33 — la nota del agujero abierto y el puntero a la 262                  */
/* -------------------------------------------------------------------------- */

/**
 * Las piezas de la nota que R33 exige EN EL CODIGO, en el sitio donde se decide el bloqueo. No
 * basta con nombrar la ficha: sin la frase, el numero «262» seria un puntero a nada; sin el
 * numero, la frase seria una queja sin dueño.
 */
const PIEZAS_DEL_AGUJERO: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  {
    nombre: "la frase que dice que NO hay superficie para corregir el dia",
    patron: /NO EXISTE NINGUNA SUPERFICIE|no existe ninguna superficie/i,
  },
  { nombre: "que lo que no se puede corregir es el DIA DE REPARTO", patron: /dia de reparto/i },
  { nombre: "el puntero a la ficha 262", patron: /ficha\s*\*{0,2}262/i },
  { nombre: "la salida que queda mientras tanto (un `UPDATE` a mano)", patron: /UPDATE.{0,20}a mano/i },
];

function piezasDelAgujeroQueFaltan(texto: string): string[] {
  return PIEZAS_DEL_AGUJERO.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);
}

/* -------------------------------------------------------------------------- */
/* El censo                                                                    */
/* -------------------------------------------------------------------------- */

describe("(0) la guardia mira lo que dice mirar", () => {
  it("los archivos censados existen y el censo del portal NO esta vacio", () => {
    for (const rel of [CONTRATO, SPEC_246_REQ, SPEC_246_DESIGN, SCHEMA]) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
    // Un censo vacio pasa todos los `every` del mundo. Hoy son el contrato, el servicio, el
    // modulo de textos y una docena larga de archivos del portal; la cota es holgada a proposito.
    if (ARCHIVOS_CENSADOS.length === 0) reventar("el censo del portal quedo vacio");
    expect(ARCHIVOS_CENSADOS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("(a) no queda en el arbol ninguna frase que afirme D5 como vigente (R24)", () => {
  it("ni en el contrato, ni en el servicio, ni en el portal del mensajero", () => {
    const infractores = ARCHIVOS_CENSADOS.map((ruta) => ({
      archivo: path.relative(REPO_ROOT, ruta).replace(/\\/g, "/"),
      frases: frasesQueAfirmanD5(fs.readFileSync(ruta, "utf8")),
    })).filter((x) => x.frases.length > 0);

    expect(
      infractores,
      "Estas frases describian la decision D5 como vigente: «la reserva protege del CRON, no del " +
        "mensajero». Desde el 2026-08-21 es FALSO — una orden reservada para un dia posterior no " +
        "se puede recoger, ni escoger, ni gestionar. Dejarlas escritas hace que el codigo mienta, " +
        "y miente con autoridad justo donde alguien va a ir a buscar la regla.\n" +
        JSON.stringify(infractores, null, 2),
    ).toEqual([]);
  });
});

describe("(b) el contrato declara la reversion con sus seis piezas (R24)", () => {
  it("estan la decision, las dos fechas, la palabra, el motivo y el puntero", () => {
    expect(
      piezasDeLaReversionQueFaltan(leer(CONTRATO)),
      "R24: la decision vieja no se borra a secas, se SUSTITUYE por la reversion con fecha y " +
        "motivo. Sin el motivo, alguien la revierte de vuelta por no entenderla; sin las fechas, " +
        "la nota dice «esto fue asi» sin decir desde cuando dejo de serlo.",
    ).toEqual([]);
  });
});

describe("(c)+(d) el spec de la 246 lleva el apendice Y conserva su texto original (R25)", () => {
  it("(c) §D5 apunta a la ficha 261, con fecha y con la palabra de superseded", () => {
    expect(
      piezasDelApendiceQueFaltan(leer(SPEC_246_REQ)),
      "R25: D5 se firmo en ese spec. Sin puntero, quien lo lea dentro de seis meses creera que " +
        "el mensajero sigue pudiendo recoger y gestionar una orden reservada.",
    ).toEqual([]);
  });

  it("(c) el design de la 246 tambien lo lleva, en la linea que afirmaba «no se bloquea nada»", () => {
    expect(piezasDelApendiceQueFaltan(leer(SPEC_246_DESIGN))).toEqual([]);
  });

  it("(d) el texto original de §D5 sigue VERBATIM: el apendice no es una reescritura", () => {
    expect(
      testigosQueFaltan(leer(SPEC_246_REQ)),
      "Un spec es la foto de su momento. El apendice se AÑADE; el texto original no se toca. Si " +
        "falta un testigo, alguien reescribio §D5 para «dejarlo coherente» y con ello borro la " +
        "prueba de que aquella decision se tomo a conciencia y con sus razones.",
    ).toEqual([]);
  });
});

describe("(e) R33 — el agujero abierto esta escrito EN EL CODIGO, con el puntero a la 262", () => {
  it("la nota vive junto a la reversion, en el sitio donde se decide el bloqueo", () => {
    expect(
      piezasDelAgujeroQueFaltan(leer(CONTRATO)),
      "R33: hoy NO existe ninguna superficie para corregir el dia de reparto de una orden ya " +
        "asignada, y este bloqueo la hace falta. Con D5 vigente el escape era el propio mensajero " +
        "(recogia y entregaba igual); al cerrarlo, un lote mal marcado queda inalcanzable para " +
        "TODO EL MUNDO hasta que llegue ese dia, y la unica salida es un `UPDATE` a mano en " +
        "produccion. El riesgo lo acepto el humano el 2026-08-22 y lo resuelve la ficha 262. Un " +
        "riesgo aceptado que solo vive en un spec es un riesgo que nadie vuelve a leer.",
    ).toEqual([]);
  });
});

describe("(R23) esta ficha NO toca el esquema", () => {
  it("`db/schema.prisma` sigue declarando `fecha_reparto` exactamente igual", () => {
    // R23 dicho como testigo VERBATIM: la columna existe desde la 246 y no cambia de tipo, de
    // nulabilidad ni de mapeo. Si esta linea se mueve, es que apareció una migracion que el spec
    // dijo que no hacia falta.
    expect(leer(SCHEMA)).toContain(
      'fechaReparto           DateTime? @map("fecha_reparto") @db.Date',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* AUTOCOMPROBACION — los detectores marcan y NO marcan lo que dicen           */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion: sin esto, la guardia podria estar verde por vacia", () => {
  it("(a) caza la frase aunque este PARTIDA en varias lineas, como en JSX", () => {
    // ⭑ El caso que justifica la normalizacion. Asi estaba escrita de verdad en
    // `PosOrderCardMosaico.tsx`, con sangria y saltos de linea en medio.
    const comoEnJsx = `
      {/* R23/R24 — la marca no oculta ni bloquea nada: la card sigue entera y la orden se
          puede recoger y gestionar igual. La reserva protege del corte de la noche, no del
          mensajero (decisión D5). */}
    `;
    expect(frasesQueAfirmanD5(comoEnJsx).sort()).toEqual(
      [
        "no oculta ni bloquea nada",
        "protege del corte de la noche, no del mensajero",
        "puede recoger y gestionar igual",
      ].sort(),
    );
  });

  it("(a) y NO marca el texto que la sustituye", () => {
    const nuevo =
      "la reserva protege del CRON y tambien del mensajero: una orden reservada para un dia " +
      "posterior no se puede recoger ni gestionar. R23 sigue: no se oculta nada.";
    expect(frasesQueAfirmanD5(nuevo)).toEqual([]);
  });

  it("(a) el detector NO es vacio: hay siete frases y ninguna trivial", () => {
    expect(FRASES_QUE_AFIRMAN_D5).toHaveLength(6);
    for (const frase of FRASES_QUE_AFIRMAN_D5) expect(frase.length).toBeGreaterThan(15);
  });

  it("(b) exige TODAS las piezas: quitar una sola la delata", () => {
    const completo =
      "D5 se adopto el 2026-08-20 y queda REVERTIDA el 2026-08-21: la medicion M3 quedo refutada " +
      "por la guia 17496963 en produccion. Ver `specs/261-dia-reparto-protege`.";
    expect(piezasDeLaReversionQueFaltan(completo)).toEqual([]);
    // Sin la fecha de reversion, la nota diria «esto fue asi» sin decir desde cuando dejo de serlo.
    expect(piezasDeLaReversionQueFaltan(completo.replace("2026-08-21", "hace poco"))).toEqual([
      "la fecha de la REVERSION (2026-08-21)",
    ]);
    // Y sin el motivo, alguien la revierte de vuelta por no entenderla.
    expect(piezasDeLaReversionQueFaltan(completo.replace("17496963", "una guia"))).toEqual([
      "el motivo (la medicion M3, refutada por la guia 17496963)",
    ]);
    expect(piezasDeLaReversionQueFaltan("un comentario cualquiera")).toHaveLength(
      PIEZAS_DE_LA_REVERSION.length,
    );
  });

  it("(b) el motivo exige M3 Y la guia CERCA: dos menciones sueltas y lejanas no cuelan", () => {
    // Si el patron fuera «M3 en alguna parte» y «17496963 en alguna parte», dos frases sin
    // relacion en extremos del archivo pasarian por un motivo escrito.
    const lejos = `M3 dice algo.${" x".repeat(400)} La guia 17496963 existe.`;
    expect(piezasDeLaReversionQueFaltan(lejos)).toContain(
      "el motivo (la medicion M3, refutada por la guia 17496963)",
    );
  });

  it("(c) el apendice sin puntero no cuela", () => {
    const bueno =
      "APÉNDICE — 2026-08-21: D5 fue SUPERSEDIDA por la feature 261. Ver " +
      "`specs/261-dia-reparto-protege`.";
    expect(piezasDelApendiceQueFaltan(bueno)).toEqual([]);
    expect(
      piezasDelApendiceQueFaltan("APÉNDICE — 2026-08-21: D5 fue SUPERSEDIDA por la feature 261."),
    ).toEqual(["el puntero a la ficha 261"]);
  });

  it("(d) el detector de testigos cae si el original se reescribe, aunque sea «equivalente»", () => {
    const original = leer(SPEC_246_REQ);
    expect(testigosQueFaltan(original)).toEqual([]);
    // Una reescritura «coherente» del enunciado: cambia el sentido y el testigo lo caza.
    const reescrito = original.replace(
      "**R24.** El sistema NO DEBE impedirle al mensajero recoger ni gestionar una orden reservada para",
      "**R24.** [DEROGADO] El sistema impide al mensajero recoger ni gestionar una orden reservada para",
    );
    expect(reescrito).not.toBe(original); // si no, el testigo estaria midiendo el vacio
    expect(testigosQueFaltan(reescrito)).toEqual([
      "**R24.** El sistema NO DEBE impedirle al mensajero recoger ni gestionar una orden reservada para",
    ]);
  });

  it("(d) los testigos NO son vacios: hay cuatro y ninguno es una cadena corta", () => {
    expect(TESTIGOS_DEL_D5_ORIGINAL).toHaveLength(4);
    for (const frase of TESTIGOS_DEL_D5_ORIGINAL) expect(frase.length).toBeGreaterThan(40);
  });

  it("(e) la nota del agujero sin el numero de la ficha no cuela", () => {
    const buena =
      "⚠️ Hoy NO EXISTE NINGUNA SUPERFICIE para corregir el dia de reparto de una orden ya " +
      "asignada; la unica salida es un `UPDATE` a mano en produccion. Lo resuelve la ficha 262.";
    expect(piezasDelAgujeroQueFaltan(buena)).toEqual([]);
    expect(piezasDelAgujeroQueFaltan(buena.replace("la ficha 262", "otra ficha"))).toEqual([
      "el puntero a la ficha 262",
    ]);
    // Y una nota que solo nombre la ficha, sin decir QUE pasa, tampoco vale.
    expect(piezasDelAgujeroQueFaltan("pendiente: ver la ficha 262")).toEqual([
      "la frase que dice que NO hay superficie para corregir el dia",
      "que lo que no se puede corregir es el DIA DE REPARTO",
      "la salida que queda mientras tanto (un `UPDATE` a mano)",
    ]);
  });

  it("`normalizar` colapsa saltos y sangria, que es de lo que depende (a)", () => {
    expect(normalizar("a\n   b\t c")).toBe("a b c");
    expect(normalizar("  ya  esta  ")).toBe(" ya esta ");
  });
});
