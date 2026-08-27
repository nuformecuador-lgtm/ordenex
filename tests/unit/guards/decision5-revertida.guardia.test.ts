import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// FEATURE 287 (T12, R32/R33/R34/R35) — **LA GUARDIA DE QUE EL CODIGO Y EL SPEC NO MIENTAN.**
//
// Molde: `tests/unit/guards/d5-revertida.guardia.test.ts` (feature 261), que este repo ya escribio
// para exactamente este problema. Una decision revertida vive en TRES soportes que envejecen por
// separado, y cada uno miente de una forma distinta:
//
//   (1) `lib/interfaces/repositories/IUserRepository.ts` — ahi la Decision 5 se declara como regla
//       VIGENTE y con autoridad («NUNCA email, cedula ni passwordHash»). Es cierta para
//       `UpdateUsuarioData` y sigue siendolo (R35), pero desde el 2026-08-26 el maestro SI puede
//       RESTABLECER la contrasena por otra via. Sin la nota, quien lea el archivo concluye lo
//       contrario de lo que hace el sistema.
//   (2) `specs/25-gestion-usuarios/**` — donde la Decision 5 se firmo el 2026-07-10. Sin apendice,
//       quien lo lea dentro de seis meses creera que el reset sigue fuera de alcance.
//   (3) El arbol de codigo — R34: no puede quedar NINGUNA frase que afirme que el maestro no puede
//       tocar ni restablecer la contrasena de un usuario.
//
// ⚠️ POR QUE SE COMPRUEBAN LAS DOS DIRECCIONES EN EL SPEC. El apendice APUNTA a la ficha nueva,
// pero el texto original **no se toca** (R33). Si esta guardia solo exigiera el puntero, un «ya que
// estamos» podria reescribir la Decision 5 «para dejarlo coherente» y borraria la unica prueba de
// que aquella decision se tomo a conciencia y con sus razones.
//
// Cada detector es una FUNCION PURA con su AUTOCOMPROBACION: se le da un texto que SI infringe y
// otro que no. Sin eso, una guardia de prosa se queda verde POR VACIA en cuanto un rename deja de
// encajar — y este repo ya tuvo una guardia que no podia fallar nunca protegiendo justo lo que la
// ficha decidia.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "..", "..", "..");

/** Donde se declara la Decision 5 en el codigo, y donde vive ahora su reversion (R32). */
const CONTRATO = "lib/interfaces/repositories/IUserRepository.ts";
const SPEC_25_REQ = "specs/25-gestion-usuarios/requirements.md";
const SPEC_25_DESIGN = "specs/25-gestion-usuarios/design.md";

/** El censo de R34: el arbol de CODIGO. `specs/**` queda fuera A PROPOSITO — un spec es la foto
 *  de su momento y R33 exige que el texto original siga ahi VERBATIM; barrerlo por R34 pondria a
 *  las dos reglas a pelearse entre si. */
const RAICES_DEL_CENSO = [
  "lib/interfaces/repositories/IUserRepository.ts",
  "lib/interfaces/services/IUsuarioService.ts",
  "lib/services/UsuarioService.ts",
  "lib/actions/usuarios.ts",
  "lib/types/usuario.ts",
  "app/(app)/configuracion",
];

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia decision5-revertida: ${que}. La guardia NO pudo leer lo que vigila; se detiene en ` +
      `ROJO en vez de dar por buena una lectura vacia. Si el codigo se reorganizo, actualiza el ` +
      `censo — no borres la comprobacion.`,
  );
}

function leer(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!fs.existsSync(ruta)) reventar(`falta el archivo censado \`${rel}\``);
  return fs.readFileSync(ruta, "utf8");
}

function archivosDeCodigo(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...archivosDeCodigo(ruta));
    else if (/\.tsx?$/.test(entrada.name)) out.push(ruta);
  }
  return out;
}

const ARCHIVOS_CENSADOS: string[] = (() => {
  const out: string[] = [];
  for (const rel of RAICES_DEL_CENSO) {
    const ruta = path.join(RAIZ, rel);
    if (!fs.existsSync(ruta)) reventar(`la raiz del censo \`${rel}\` no existe`);
    if (fs.statSync(ruta).isDirectory()) out.push(...archivosDeCodigo(ruta));
    else out.push(ruta);
  }
  return [...new Set(out)];
})();

/* -------------------------------------------------------------------------- */
/* (a) R32 — la reversion, con sus SIETE piezas                                */
/* -------------------------------------------------------------------------- */

/**
 * Se exigen POR SEPARADO para que el fallo diga CUAL falta en vez de un booleano. Las siete salen
 * literalmente de R32 en `specs/287-maestro-restablece-contrasena/requirements.md`.
 */
const PIEZAS_DE_LA_REVERSION: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "(a) el nombre de la decision (Decision 5)", patron: /\bDecisi[oó]n 5\b/ },
  { nombre: "(b) la fecha en que se ADOPTO (2026-07-10)", patron: /2026-07-10/ },
  { nombre: "(c) la fecha de la REVERSION (2026-08-26)", patron: /2026-08-26/ },
  {
    nombre: "(d) la palabra que la marca como revertida/acotada",
    patron: /REVERTIDA|ACOTADA|REVERTIDO|SUPERSEDIDA/i,
  },
  {
    // ⚠️ ESTE PATRON SE ENDURECIO TRAS UNA MUTACION QUE SOBREVIVIO (M16, 2026-08-26). Antes pedia
    // «FIJAR … credencial» en una ventana, y eso lo satisface CUALQUIER frase de la nota que use
    // las dos palabras —por ejemplo «Restablecer no es fijar: ni siquiera el maestro elige que
    // credencial queda»—. Con eso, borrar la frase que dice el MOTIVO dejaba la guardia en verde:
    // medido, no supuesto. Ahora se exige la carga semantica que solo el motivo tiene —que el
    // maestro conociera la credencial DE ANTEMANO y pudiera REUSARLA EN SILENCIO—, que es
    // precisamente lo que hay que seguir protegiendo y lo que nadie puede deducir de «no es fijar».
    nombre: "(e) el motivo ORIGINAL que protegia (que el maestro no pudiera FIJAR una credencial)",
    patron: /FIJAR[\s\S]{0,250}(?:de antemano|reusar en silencio)/i,
  },
  {
    nombre:
      "(f) el alcance exacto: se revierte RESTABLECER (no FIJAR), y `updatePasswordHash` sigue " +
      "siendo la unica via (no `update`)",
    patron: /RESTABLECER[\s\S]{0,600}updatePasswordHash/,
  },
  {
    nombre: "(g) el puntero a la ficha (`specs/287-maestro-restablece-contrasena`)",
    patron: /specs\/287-maestro-restablece-contrasena/,
  },
];

export function piezasDeLaReversionQueFaltan(texto: string): string[] {
  return PIEZAS_DE_LA_REVERSION.filter(({ patron }) => !patron.test(texto)).map(
    ({ nombre }) => nombre,
  );
}

/* -------------------------------------------------------------------------- */
/* (b) R33 — el apendice fechado en el spec de la 25                           */
/* -------------------------------------------------------------------------- */

const PIEZAS_DEL_APENDICE: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "la fecha del apendice (2026-08-26)", patron: /2026-08-26/ },
  {
    nombre: "que la Decision 5 quedo ACOTADA/REVERTIDA en su clausula de alcance",
    patron: /Decisi[oó]n 5[\s\S]{0,200}(?:acotad|revertid)/i,
  },
  {
    nombre: "el puntero a la ficha 287 (`specs/287-maestro-restablece-contrasena`)",
    patron: /specs\/287-maestro-restablece-contrasena/,
  },
];

export function piezasDelApendiceQueFaltan(texto: string): string[] {
  return PIEZAS_DEL_APENDICE.filter(({ patron }) => !patron.test(texto)).map(({ nombre }) => nombre);
}

/* -------------------------------------------------------------------------- */
/* (c) R33 — los testigos VERBATIM del texto original                          */
/* -------------------------------------------------------------------------- */

/**
 * Cubren las tres partes de aquella decision —los campos editables, los NO editables y la clausula
 * de alcance que hoy se revierte— y se comparan VERBATIM.
 *
 * ⛔ Si uno se pone rojo, la respuesta NO es actualizar el testigo: es que alguien reescribio el
 * spec de la 25 en vez de anexarle el apendice.
 */
const TESTIGOS_DEL_ORIGINAL: readonly string[] = [
  "5. **Campos editables:** editable = `nombre`, `telefono`, `rolId`,",
  "   `tipoIdentificacionId`; NO editable = `email`, `cedula`. Reset de contraseña desde",
  "   edición: FUERA de alcance. (R16)",
];

export function testigosQueFaltan(texto: string): string[] {
  return TESTIGOS_DEL_ORIGINAL.filter((frase) => !texto.includes(frase));
}

/* -------------------------------------------------------------------------- */
/* (d) R34 — ninguna frase que afirme que el maestro no puede restablecer      */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ EL DETECTOR NORMALIZA ESPACIOS **Y MARCAS DE COMENTARIO** antes de comparar: en este repo la
 * prosa vive en comentarios partidos en varias lineas, y una frase como «el maestro no puede\n//
 * restablecer …» tiene un `//` en medio que un patron literal no atraviesa. Medido: sin quitar la
 * marca, ese caso NO se cazaba.
 *
 * ⚠️ ES DELIBERADAMENTE ESTRECHO. La nota de reversion que R32 exige dice cosas como «el maestro
 * no ESCRIBE ninguna contrasena» y «no pudiera FIJAR una credencial», que siguen siendo VERDAD y
 * son justo lo que se conserva. Un detector ancho («no … contrasena») las cazaria y pondria a R32
 * y R34 a pelearse. Lo que R34 prohibe es AFIRMAR que el maestro no puede TOCAR o RESTABLECER.
 *
 * ⚠️ Y DISTINGUE **AFIRMAR** DE **CITAR PARA REVERTIR**, que es la tension real de esta ficha y no
 * un detalle: R32(f) obliga a que la nota diga el alcance EXACTO de lo revertido, y decirlo exige
 * nombrar la clausula —«Reset de contrasena desde edicion: FUERA de alcance»— entre comillas. Si
 * el detector leyera esa cita como una afirmacion, la unica forma de pasar R34 seria borrar la
 * cita, y con ella la unica pieza que dice QUE se revirtio. Por eso un hallazgo NO cuenta si tiene
 * una marca de reversion CERCA (±400 caracteres del texto normalizado). «Cerca» y no «en el
 * archivo» a proposito: si bastara con que la palabra REVERTIDA apareciera en cualquier parte, un
 * archivo con la nota arriba podria afirmar lo contrario 500 lineas mas abajo y colar.
 */
const VENTANA_DE_REVERSION = 400;
const MARCA_DE_REVERSION = /REVERTID|ACOTAD|se revierte|SUPERSEDID/i;
const PATRONES_CADUCADOS: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  {
    nombre: "«Reset de contrasena desde edicion: FUERA de alcance»",
    patron: /reset de contrase[nñ]a[\s\S]{0,40}fuera de alcance/i,
  },
  {
    nombre: "«el maestro no puede restablecer/cambiar/rotar la contrasena»",
    patron: /(?:maestro|admin\w*)\s+no\s+(?:puede|podr[aá])\s+(?:\w+\s+){0,3}(?:restablecer|resetear|rotar|cambiar)\b/i,
  },
  {
    nombre: "«no hay (ninguna) forma/via de restablecer la contrasena»",
    patron: /no\s+(?:hay|existe)\s+(?:\w+\s+){0,3}(?:forma|via|vía|manera)\s+de\s+(?:restablecer|resetear|rotar)/i,
  },
  {
    nombre: "«el modulo de usuarios no toca la contrasena»",
    patron: /m[oó]dulo de usuarios no toca la contrase[nñ]a/i,
  },
];

/** Colapsa el espacio en blanco y quita las marcas de comentario al inicio de cada linea. */
export function normalizar(texto: string): string {
  return texto.replace(/^[ \t]*(?:\/\/+|\*+|#)[ \t]?/gm, " ").replace(/\s+/g, " ");
}

/** ¿Hay una marca de reversion en la ventana alrededor de la posicion del hallazgo? */
function reveridoCerca(plano: string, indice: number, largo: number): boolean {
  const desde = Math.max(0, indice - VENTANA_DE_REVERSION);
  const hasta = Math.min(plano.length, indice + largo + VENTANA_DE_REVERSION);
  return MARCA_DE_REVERSION.test(plano.slice(desde, hasta));
}

export function frasesCaducadas(texto: string): string[] {
  const plano = normalizar(texto);
  const salida: string[] = [];
  for (const { nombre, patron } of PATRONES_CADUCADOS) {
    // `g` propio por iteracion: los patrones de arriba se declaran sin bandera global para que
    // `.test()` no arrastre `lastIndex` entre llamadas.
    const global = new RegExp(patron.source, `${patron.flags.replace("g", "")}g`);
    let m: RegExpExecArray | null;
    while ((m = global.exec(plano)) !== null) {
      if (m[0].length === 0) break; // seguro contra un patron que pudiera casar vacio
      if (!reveridoCerca(plano, m.index, m[0].length)) {
        salida.push(nombre);
        break; // basta un hallazgo NO revertido por patron
      }
    }
  }
  return salida;
}

/* -------------------------------------------------------------------------- */
/* 0 — El censo: la guardia mira lo que dice mirar                             */
/* -------------------------------------------------------------------------- */

describe("(0) la guardia mira lo que dice mirar", () => {
  it("los archivos censados existen, y ninguno se leyo en blanco", () => {
    for (const rel of [CONTRATO, SPEC_25_REQ, SPEC_25_DESIGN]) {
      expect(fs.existsSync(path.join(RAIZ, rel)), `falta ${rel}`).toBe(true);
    }
    if (ARCHIVOS_CENSADOS.length === 0) reventar("el censo de codigo quedo vacio");
    // Hoy son los cinco archivos sueltos + el arbol de `configuracion`. La cota va holgada.
    expect(ARCHIVOS_CENSADOS.length).toBeGreaterThanOrEqual(6);
    for (const ruta of ARCHIVOS_CENSADOS) {
      expect(fs.readFileSync(ruta, "utf8").trim().length, `${ruta} vino vacio`).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* La regla                                                                     */
/* -------------------------------------------------------------------------- */

describe("(a) R32 — el contrato declara la reversion con sus siete piezas", () => {
  it("estan la decision, las dos fechas, la palabra, el motivo, el alcance y el puntero", () => {
    expect(
      piezasDeLaReversionQueFaltan(leer(CONTRATO)),
      "R32: la Decision 5 no se borra a secas ni se deja intacta: se AMPLIA con su reversion. " +
        "Sin el motivo original, alguien la revierte entera por no entender que protegia; sin " +
        "las fechas, la nota dice «esto era asi» sin decir desde cuando dejo de serlo; y sin el " +
        "alcance, nadie sabe que lo que se revierte es RESTABLECER y no FIJAR.",
    ).toEqual([]);
  });

  it("el comentario ORIGINAL de la Decision 5 sigue en el contrato: se amplia, no se sustituye", () => {
    // R32 pide anadir la reversion; el spec (T12) pide explicitamente NO borrar el original.
    expect(leer(CONTRATO)).toContain("Feature 25/R16: solo los campos editables por el maestro");
  });
});

describe("(b)+(c) R33 — el spec de la 25 lleva el apendice Y conserva su texto original", () => {
  it("(b) `requirements.md` apunta a la ficha 287, con fecha y con la palabra de acotada", () => {
    expect(
      piezasDelApendiceQueFaltan(leer(SPEC_25_REQ)),
      "R33: la Decision 5 se firmo en ese spec. Sin puntero, quien lo lea dentro de seis meses " +
        "creera que el reset de contrasena sigue fuera de alcance.",
    ).toEqual([]);
  });

  it("(b) `design.md` de la 25 tambien lo lleva, junto a la A6 que hablaba del «reset futuro»", () => {
    expect(piezasDelApendiceQueFaltan(leer(SPEC_25_DESIGN))).toEqual([]);
  });

  it("(c) el texto original de la Decision 5 sigue VERBATIM: el apendice no es una reescritura", () => {
    expect(
      testigosQueFaltan(leer(SPEC_25_REQ)),
      "Un spec es la foto de su momento. El apendice se AÑADE; el texto original no se toca. Si " +
        "falta un testigo, alguien reescribio la Decision 5 «para dejarlo coherente» y con ello " +
        "borro la prueba de que se tomo a conciencia y con sus razones.",
    ).toEqual([]);
  });
});

describe("(d) R34 — no queda en el codigo ninguna afirmacion caducada", () => {
  it("ningun archivo del censo dice que el maestro no puede restablecer la contrasena", () => {
    const infractores = ARCHIVOS_CENSADOS.map((ruta) => ({
      archivo: path.relative(RAIZ, ruta).replace(/\\/g, "/"),
      frases: frasesCaducadas(fs.readFileSync(ruta, "utf8")),
    })).filter((x) => x.frases.length > 0);

    expect(
      infractores,
      "R34: desde el 2026-08-26 el maestro SI puede restablecer la contrasena de un usuario. " +
        "Dejar escrito lo contrario hace que el codigo mienta, y miente con autoridad justo " +
        "donde alguien va a ir a buscar la regla.\n" + JSON.stringify(infractores, null, 2),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* AUTOCOMPROBACION — sin esto, la guardia podria estar verde por vacia        */
/* -------------------------------------------------------------------------- */

describe("autocomprobacion: los detectores marcan y NO marcan lo que dicen", () => {
  it("(a) exige TODAS las piezas: quitar una sola la delata", () => {
    const completo =
      "Decision 5, firmada el 2026-07-10, queda ACOTADA Y PARCIALMENTE REVERTIDA el 2026-08-26 " +
      "(specs/287-maestro-restablece-contrasena). Protegia que el maestro no pudiera FIJAR una " +
      "credencial de otra persona, una que el conociera de antemano; eso sigue intacto. Lo que " +
      "se revierte es solo su clausula de alcance: el maestro YA PUEDE RESTABLECER la contrasena, " +
      "y va por updatePasswordHash, no por update.";
    expect(piezasDeLaReversionQueFaltan(completo)).toEqual([]);

    expect(piezasDeLaReversionQueFaltan(completo.replace("2026-08-26", "hace poco"))).toEqual([
      "(c) la fecha de la REVERSION (2026-08-26)",
    ]);
    expect(
      piezasDeLaReversionQueFaltan(completo.replace("specs/287-maestro-restablece-contrasena", "la ficha")),
    ).toEqual(["(g) el puntero a la ficha (`specs/287-maestro-restablece-contrasena`)"]);
    // ⭑ La pieza que un «ya que estamos» borraria sin pensarlo: sin el motivo original, la nota
    //   queda como un permiso nuevo y nadie sabe que habia que seguir protegiendo.
    expect(
      piezasDeLaReversionQueFaltan(
        completo.replace(
          "Protegia que el maestro no pudiera FIJAR una credencial de otra persona, una que el conociera de antemano; eso sigue intacto. ",
          "",
        ),
      ),
    ).toEqual([
      "(e) el motivo ORIGINAL que protegia (que el maestro no pudiera FIJAR una credencial)",
    ]);

    // Una nota que solo diga «revertida» no salva NI UNA pieza mas que la palabra.
    expect(piezasDeLaReversionQueFaltan("REVERTIDA, ver la ficha 287")).toHaveLength(
      PIEZAS_DE_LA_REVERSION.length - 1,
    );
  });

  it("(e) REGRESION M16 — borrar el motivo del contrato REAL pone la pieza en rojo", () => {
    // ⭑ ESTE CASO NACE DE UNA MUTACION QUE SOBREVIVIO. La autocomprobacion de arriba usa un texto
    //   sintetico, y por eso no vio el agujero: el patron viejo («FIJAR … credencial» en una
    //   ventana) quedaba satisfecho por OTRA frase de la nota real —«Restablecer no es fijar: ni
    //   siquiera el maestro elige que credencial queda»—, asi que borrar el motivo NO ponia nada
    //   rojo. Aqui la mutacion se aplica al ARCHIVO DE VERDAD, que es la unica forma de que este
    //   agujero no se reabra.
    const real = leer(CONTRATO);
    expect(piezasDeLaReversionQueFaltan(real)).toEqual([]);

    const sinMotivo = real.replace(
      "// impedia que el maestro pudiera FIJAR una credencial de otra persona —una que el\n" +
        "// conociera de antemano y pudiera reusar en silencio—. Eso sigue INTACTO: el maestro no",
      "// decia otra cosa. Eso sigue INTACTO: el maestro no",
    );
    expect(sinMotivo, "la mutacion no encajo: este caso estaria midiendo el vacio").not.toBe(real);
    expect(piezasDeLaReversionQueFaltan(sinMotivo)).toEqual([
      "(e) el motivo ORIGINAL que protegia (que el maestro no pudiera FIJAR una credencial)",
    ]);
  });

  it("(a) el detector NO es vacio: son siete piezas y ninguna trivial", () => {
    expect(PIEZAS_DE_LA_REVERSION).toHaveLength(7);
    for (const p of PIEZAS_DE_LA_REVERSION) expect(p.nombre.length).toBeGreaterThan(20);
  });

  it("(b) el apendice sin puntero no cuela", () => {
    const bueno =
      "APÉNDICE — 2026-08-26: la Decisión 5 queda acotada por la feature 287. Ver " +
      "`specs/287-maestro-restablece-contrasena`.";
    expect(piezasDelApendiceQueFaltan(bueno)).toEqual([]);
    expect(
      piezasDelApendiceQueFaltan(
        "APÉNDICE — 2026-08-26: la Decisión 5 queda acotada por la feature 287.",
      ),
    ).toEqual(["el puntero a la ficha 287 (`specs/287-maestro-restablece-contrasena`)"]);
  });

  it("(c) el detector de testigos cae si el original se reescribe, aunque sea «equivalente»", () => {
    const original = leer(SPEC_25_REQ);
    expect(testigosQueFaltan(original)).toEqual([]);
    const reescrito = original.replace(
      "   edición: FUERA de alcance. (R16)",
      "   edición: [DEROGADO por la 287]. (R16)",
    );
    expect(reescrito).not.toBe(original); // si no, el testigo estaria midiendo el vacio
    expect(testigosQueFaltan(reescrito)).toEqual(["   edición: FUERA de alcance. (R16)"]);
  });

  it("(c) los testigos NO son vacios: son tres y ninguno es una cadena corta", () => {
    expect(TESTIGOS_DEL_ORIGINAL).toHaveLength(3);
    for (const t of TESTIGOS_DEL_ORIGINAL) expect(t.length).toBeGreaterThan(30);
  });

  it("(d) caza la frase aunque este PARTIDA en varias lineas, como en un comentario de bloque", () => {
    // ⭑ El caso que justifica que `normalizar` quite tambien las marcas `//`: sin eso, el `//`
    //   que hay entre «no puede» y «restablecer» rompia el patron y la frase pasaba. Medido.
    const comoEnCodigo = `
      // Feature 25 / Decision 5: reset de contrasena
      //   desde edicion: FUERA de alcance. El maestro no puede
      //   restablecer la contrasena de nadie.
    `;
    expect(frasesCaducadas(comoEnCodigo).sort()).toEqual(
      [
        "«Reset de contrasena desde edicion: FUERA de alcance»",
        "«el maestro no puede restablecer/cambiar/rotar la contrasena»",
      ].sort(),
    );
  });

  it("(d) NO marca la nota de reversion, que dice cosas parecidas y SIGUEN siendo verdad", () => {
    // ⭑ El caso que justifica que el detector sea estrecho: si cazara «no … contrasena», R32 y
    //   R34 se pelearian y la unica salida seria borrar la nota que R32 exige.
    expect(frasesCaducadas(leer(CONTRATO))).toEqual([]);
    const nota =
      "El maestro no ESCRIBE ninguna contrasena: el sistema la genera. Sigue sin poder FIJAR " +
      "una credencial que conozca de antemano. Este tipo no admite passwordHash.";
    expect(frasesCaducadas(nota)).toEqual([]);
  });

  it("(d) CITAR la clausula para revertirla no cuenta; AFIRMARLA a secas si", () => {
    // ⭑ LA TENSION REAL DE ESTA FICHA, en tres lineas. R32(f) obliga a nombrar la clausula que
    //   se revierte, entre comillas. Si el detector leyera esa cita como afirmacion, la unica
    //   salida seria borrarla — y con ella la pieza que dice QUE se revirtio.
    const citada =
      "DECISION 5 — ACOTADA Y PARCIALMENTE REVERTIDA EL 2026-08-26. Se revierte SOLO su clausula " +
      "de alcance («Reset de contrasena desde edicion: FUERA de alcance»): el maestro YA PUEDE " +
      "restablecer la contrasena de un usuario.";
    expect(frasesCaducadas(citada)).toEqual([]);

    const afirmada = "Reset de contrasena desde edicion: FUERA de alcance. (Decision 5, R16)";
    expect(frasesCaducadas(afirmada)).toEqual([
      "«Reset de contrasena desde edicion: FUERA de alcance»",
    ]);
  });

  it("(d) una marca de reversion LEJOS no excusa la afirmacion", () => {
    // ⭑ Sin ventana, un archivo con la nota de reversion en la cabecera podria afirmar lo
    //   contrario 500 lineas mas abajo y colar. La ventana es lo que lo impide.
    const lejos =
      "DECISION 5 REVERTIDA el 2026-08-26." +
      " relleno".repeat(120) + // >400 caracteres de distancia
      " El maestro no puede restablecer la contrasena de nadie.";
    expect(frasesCaducadas(lejos)).toEqual([
      "«el maestro no puede restablecer/cambiar/rotar la contrasena»",
    ]);
  });

  it("(d) el detector NO es vacio: son cuatro patrones", () => {
    expect(PATRONES_CADUCADOS).toHaveLength(4);
  });

  it("`normalizar` colapsa saltos y sangria, que es de lo que depende (d)", () => {
    expect(normalizar("a\n   b\t c")).toBe("a b c");
  });
});
