// @vitest-environment jsdom
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { construirDescarga } from "@/lib/utils/descarga-dataset";

import {
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA,
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO,
} from "@/app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas";
import {
  columnasDeVistaFinanciera,
  filasDeVistaFinanciera,
  vistaTemporalDelResultado,
} from "@/app/(app)/analitica/_components/export-financiero/export-financiero";
import {
  prepararExportFinanciero,
  TEXTO_EXPORT_VISTA_NO_TEMPORAL,
  type ConsultarFinanciera,
} from "@/app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera";

import {
  CUBOS_CON_FORMA_DE_UUID,
  dtoNoTemporalConUuids,
  dtoTemporalAcumulado,
  dtoTemporalConNeto,
  dtoTemporalSoloBruto,
  idDeLaUnicaVista,
} from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T6.2, BLINDADO). R10, R11 y R12.
// GUARDIA DE ALCANCE: nada de quien descarga —ni de a quien pertenece el dinero— llega al archivo.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con NOMBRE, no solo con numero.
//
// POR QUE ESTE ES EL GUARDIA CARO. Una pantalla se cierra; un archivo se guarda, se reenvia por
// WhatsApp y se abre seis meses despues (aviso §7 de la 122). Un identificador que sale en un
// archivo NO SE PUEDE RETIRAR. Por eso aqui no basta con que el objeto en memoria este limpio:
// se afirma sobre el TEXTO que produce `construirDescarga`.
//
// LOS TRES CRITERIOS DE «NO HECHO» de design §9.1 T-B, y donde se cumple cada uno:
//
//  1. «la asercion se hace sobre el objeto en memoria y no sobre el STRING». Un objeto correcto
//     que se serializa mal sigue siendo una fuga. -> bloque (c): todo se mide sobre el texto CSV.
//  2. «la fixture trae cubos ya inocuos». Con fechas en todos los casos, el archivo saldria limpio
//     aunque la exclusion de las vistas no temporales estuviera rota. -> bloque (d): la fixture (d)
//     trae UUIDS DE VERDAD y el mismo uuid se busca literalmente.
//  3. «el censo de columnas se compara contra la propia constante» (`COLUMNAS.map(...)` a los dos
//     lados). Es la tautologia que este repo lleva semanas cazando y que `progress/impl_189.md` §4
//     documenta con un caso real. -> bloque (b): las claves y los encabezados estan ESCRITOS A MANO.
//
// Y el guardia censa el ARBOL, no el diff (design §1.2): no caduca al mergear. Cada bloque trae su
// autocomprobacion por fixture sintetico.

const RAIZ = process.cwd();
const DIR_EXPORT = path.join(RAIZ, "app", "(app)", "analitica", "_components", "export-financiero");

/* -------------------------------------------------------------------------- */
/* Utilidades de censo (mismas dos decisiones que el guardia de frontera)       */
/* -------------------------------------------------------------------------- */

function recorrer(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) return recorrer(completo);
    return [".ts", ".tsx"].includes(path.extname(completo)) ? [completo] : [];
  });
}

function relativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/** Se censa solo el CODIGO: la cabecera del subarbol esta obligada a nombrar lo que no usa. */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

interface ArchivoCensado {
  readonly ruta: string;
  readonly codigo: string;
}

/** El subarbol se RECORRE: un archivo nuevo entra en el censo solo. */
const EXPORT: readonly ArchivoCensado[] = recorrer(DIR_EXPORT).map((archivo) => ({
  ruta: relativa(archivo),
  codigo: soloCodigo(readFileSync(archivo, "utf8")),
}));

/* -------------------------------------------------------------------------- */
/* (a) R10 — el vocabulario del ALCANCE no aparece en el subarbol               */
/* -------------------------------------------------------------------------- */

/**
 * Las palabras con que se nombra el ambito de quien descarga.
 *
 * No es una lista de nombres bonitos: es el vocabulario con el que una cabecera de metadatos se
 * escribe sin darse cuenta («Alcance: <tiendaId>», «Rol: admin», «Sesion de …»). Ninguna de estas
 * palabras tiene nada que hacer en un modulo que solo proyecta filas de un DTO ya recibido.
 */
const VOCABULARIO_DEL_ALCANCE: readonly { readonly patron: RegExp; readonly motivo: string }[] = [
  { patron: /\btiendaId\b/, motivo: "nombra tiendaId" },
  { patron: /\bzonaId\b/, motivo: "nombra zonaId" },
  { patron: /\bmensajeroId\b/, motivo: "nombra mensajeroId" },
  { patron: /\busuarioId\b/, motivo: "nombra usuarioId" },
  { patron: /\bactor\b/i, motivo: "nombra al actor" },
  { patron: /\balcance\b/i, motivo: "nombra el alcance" },
  { patron: /\brol(?:es)?\b/i, motivo: "nombra el rol" },
  { patron: /\bsesi[oó]n\b/i, motivo: "nombra la sesion" },
  { patron: /\bcookies?\b/i, motivo: "nombra las cookies" },
  { patron: /next\/headers/, motivo: "importa next/headers" },
];

function vocabularioDelAlcance(codigo: string): string[] {
  return VOCABULARIO_DEL_ALCANCE.filter(({ patron }) => patron.test(codigo)).map(({ motivo }) => motivo);
}

describe("R10/184 (a) · el subarbol de export no nombra el alcance del actor", () => {
  it("ningun archivo del subarbol nombra el alcance de quien descarga", () => {
    const infractores = EXPORT.flatMap(({ ruta, codigo }) =>
      vocabularioDelAlcance(codigo).map((motivo) => `${ruta}: ${motivo}`),
    );
    expect(
      infractores,
      "el archivo lleva la cabecera de columnas y sus filas, y nada mas: una constante de contexto es la primera piedra de una cabecera de metadatos",
    ).toEqual([]);
  });

  it("el censo mira archivos de verdad y ninguno quedo vacio al retirar comentarios", () => {
    expect(EXPORT.length, "el censo de (a) no encuentra el subarbol").toBeGreaterThanOrEqual(3);
    for (const { ruta, codigo } of EXPORT) {
      expect(codigo.trim().length, `${ruta} quedo vacio: el censo no mira nada`).toBeGreaterThan(0);
    }
  });

  it("autocomprobacion (a): detecta el vocabulario y no lo confunde con el codigo legitimo", () => {
    const prohibidos = [
      'const meta = { clave: "alcance", valor: actor.tiendaId };',
      "const zona = filtro.zonaId;",
      "const quien = sesion.usuarioId;",
      'filas.unshift({ periodo: "Rol", grano: rol });',
      'import { cookies } from "next/headers";',
      "const asignado = fila.mensajeroId;",
    ];
    for (const caso of prohibidos) {
      expect(vocabularioDelAlcance(caso), caso).not.toEqual([]);
    }

    const legitimos = [
      "periodo: fila.cubo,",
      "const vista = datos.vistas.find((c) => c.id === vistaId);",
      "return { resultado, columnas: columnasDeVistaFinanciera(vista) };",
      "const preparado = await prepararExportFinanciero(metricaId, vistaId);",
      // «control» y «metricaId» contienen trozos de palabras del vocabulario y NO son el
      // vocabulario: el censo casa palabras enteras.
      "const control = columnas.current; const id = datos.metricaId;",
      soloCodigo("// el archivo NO declara el alcance del actor: ni tiendaId, ni zonaId, ni el rol"),
    ];
    for (const caso of legitimos) {
      expect(vocabularioDelAlcance(caso), caso).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (b) R10/R11 — el contrato de columnas, contra una lista ESCRITA A MANO       */
/* -------------------------------------------------------------------------- */

/**
 * Las claves y los encabezados, ESCRITOS A MANO. No se derivan de la constante que se esta
 * juzgando: `COLUMNAS.map(...)` a los dos lados pasa igual despues de añadir una columna
 * «Alcance», que es exactamente la mutacion que este bloque existe para matar.
 */
const CLAVES_ESPERADAS = [
  "periodo",
  "grano",
  "metrica",
  "bruto",
  "neto",
  "moneda",
  "cifra",
  "limitacion_conocida",
];

const ENCABEZADOS_ESPERADOS = [
  "Periodo",
  "Grano",
  "Metrica",
  "Bruto",
  "Neto",
  "Moneda",
  "Tipo de cifra",
  "Limitacion conocida",
];

const CLAVES_ESPERADAS_SOLO_BRUTO = [
  "periodo",
  "grano",
  "metrica",
  "bruto",
  "moneda",
  "cifra",
  "limitacion_conocida",
];

const ENCABEZADOS_ESPERADOS_SOLO_BRUTO = [
  "Periodo",
  "Grano",
  "Metrica",
  "Bruto",
  "Moneda",
  "Tipo de cifra",
  "Limitacion conocida",
];

describe("R10/184 (b) · ninguna columna declara el alcance del actor", () => {
  it("las columnas del archivo son EXACTAMENTE las declaradas, escritas a mano", () => {
    expect(COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.map((c) => c.clave)).toEqual(CLAVES_ESPERADAS);
    expect(COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.map((c) => c.encabezado)).toEqual(
      ENCABEZADOS_ESPERADOS,
    );
    expect(COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.map((c) => c.clave)).toEqual(
      CLAVES_ESPERADAS_SOLO_BRUTO,
    );
    expect(COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.map((c) => c.encabezado)).toEqual(
      ENCABEZADOS_ESPERADOS_SOLO_BRUTO,
    );
  });

  it("y ninguna clave ni ningun encabezado nombra un identificador ni el alcance", () => {
    const textos = [...CLAVES_ESPERADAS, ...ENCABEZADOS_ESPERADOS];
    for (const texto of textos) {
      expect(vocabularioDelAlcance(texto), `la columna "${texto}" nombra el alcance`).toEqual([]);
      // Ni `id` a secas ni ningun `xxxId`/`xxx_id`, que es la firma de un identificador interno.
      expect(IDENTIFICADOR_INTERNO.test(texto), `la columna "${texto}" es un id`).toBe(false);
    }
  });

  it("autocomprobacion (b): una columna de alcance añadida a mano cae en las dos aserciones", () => {
    const conAlcance = [...COLUMNAS_DESCARGA_ANALITICA_FINANCIERA, { clave: "tiendaId", encabezado: "Alcance" }];
    expect(conAlcance.map((c) => c.clave)).not.toEqual(CLAVES_ESPERADAS);
    expect(vocabularioDelAlcance("tiendaId")).not.toEqual([]);
    expect(vocabularioDelAlcance("Alcance")).not.toEqual([]);
    for (const clave of ["tiendaId", "zonaId", "mensajeroId", "usuario_id", "id"]) {
      expect(IDENTIFICADOR_INTERNO.test(clave), clave).toBe(true);
    }
    for (const clave of [...CLAVES_ESPERADAS, "moneda", "periodo"]) {
      expect(IDENTIFICADOR_INTERNO.test(clave), clave).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* (c) R10 — el TEXTO del archivo, que es lo unico que de verdad circula        */
/* -------------------------------------------------------------------------- */

/**
 * La firma de un identificador interno en una clave o un encabezado: `id` a secas, `xxx_id` o el
 * `xxxId` en camel.
 *
 * NO se reusa la de la guardia de la 170 (`columnas-sensibles.guardia.test.ts`): aquella lleva
 * `/i`, y con la bandera de mayusculas su lookbehind `(?<![a-z])` tambien casa la `a` de
 * `tiendaId`, asi que el camel se le escapa. Aqui se escribe sensible a mayusculas a proposito, y
 * la autocomprobacion de (b) lo demuestra sobre `tiendaId`.
 */
const IDENTIFICADOR_INTERNO = /^id$|_id$|[a-z0-9]Id$/;

/** Cualquier forma de uuid, completa o truncada, tal como pide R10. */
const FORMA_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** El texto CSV que produciria la descarga de una vista, con SU juego de columnas. */
async function textoDelArchivo(datos: ReturnType<typeof dtoTemporalConNeto>): Promise<string> {
  const vista = datos.vistas[0]!;
  const archivo = await construirDescarga({
    tipo: "csv",
    titulo: datos.etiqueta,
    columnas: columnasDeVistaFinanciera(vista),
    filas: filasDeVistaFinanciera(datos, vista),
  });
  return String(archivo.contenido);
}

describe("R10/184 (c) · ninguna celda del TEXTO del archivo declara el alcance del actor", () => {
  it("el texto del archivo no contiene ninguna forma de uuid ni ninguna palabra del alcance", async () => {
    for (const datos of [dtoTemporalConNeto(), dtoTemporalSoloBruto(), dtoTemporalAcumulado()]) {
      const texto = await textoDelArchivo(datos);

      expect(texto.length, "el archivo salio vacio: la asercion no mediria nada").toBeGreaterThan(0);
      expect(FORMA_UUID.test(texto), `${datos.metricaId}: el archivo lleva un identificador`).toBe(false);
      // El vocabulario del alcance, sobre el TEXTO y no sobre el objeto: un objeto correcto que se
      // serializa mal sigue siendo una fuga.
      expect(vocabularioDelAlcance(texto), datos.metricaId).toEqual([]);
    }
  });

  it("el archivo empieza por la cabecera de columnas: no hay cabecera de metadatos", async () => {
    const datos = dtoTemporalConNeto();
    const vista = datos.vistas[0]!;
    const texto = await textoDelArchivo(datos);
    const lineas = texto.split("\r\n").filter((linea) => linea !== "");

    // La PRIMERA linea es la cabecera declarada, escrita a mano. Un bloque de metadatos («Alcance:
    // …», «Generado por …») empujaria la cabecera hacia abajo y ademas rompe `read_csv`.
    expect(lineas[0]).toBe(ENCABEZADOS_ESPERADOS.join(","));

    // Y hay EXACTAMENTE una linea por fila del DTO, ni una mas: una fila de metadatos al final
    // —que es donde suele acabar— tambien se veria aqui.
    expect(lineas).toHaveLength(vista.filas.length + 1);
  });

  it("autocomprobacion (c): la sonda ve el uuid y la fila de metadatos cuando SI estan", async () => {
    // Un archivo sintetico que SI lleva lo prohibido: si estas aserciones no lo vieran, las de
    // arriba serian verdes por incapacidad, no por limpieza.
    const datos = dtoTemporalConNeto();
    const vista = datos.vistas[0]!;
    const columnas = columnasDeVistaFinanciera(vista);
    const filas = filasDeVistaFinanciera(datos, vista);

    const conFuga = await construirDescarga({
      tipo: "csv",
      titulo: datos.etiqueta,
      columnas,
      filas: [
        { ...filas[0]!, periodo: "Alcance", grano: CUBOS_CON_FORMA_DE_UUID[0] },
        ...filas,
      ],
    });
    const texto = String(conFuga.contenido);

    expect(FORMA_UUID.test(texto)).toBe(true);
    expect(texto).toContain(CUBOS_CON_FORMA_DE_UUID[0]);
    expect(vocabularioDelAlcance(texto)).not.toEqual([]);
    expect(texto.split("\r\n").filter((l) => l !== "")).toHaveLength(filas.length + 2);
  });
});

/* -------------------------------------------------------------------------- */
/* (d) R12 — una vista NO temporal no produce archivo, y su fixture trae uuids   */
/* -------------------------------------------------------------------------- */

/** El borde doblado: devuelve el DTO que se le pida, sin tocar el servicio. */
function bordeQueDevuelve(datos: unknown): ConsultarFinanciera {
  return async () => ({ status: "ok", datos }) as Awaited<ReturnType<ConsultarFinanciera>>;
}

describe("R12/184 (d) · una vista no temporal no produce archivo aunque sus cubos vengan con identificadores", () => {
  it("una vista no temporal no produce archivo aunque sus cubos vengan con identificadores", async () => {
    const datos = dtoNoTemporalConUuids();
    const vistaId = idDeLaUnicaVista(datos);

    // SANIDAD DE LA FIXTURE (criterio 2 de §9.1 T-B): los cubos son uuids DE VERDAD y estan en el
    // DTO. Con cubos ya inocuos este caso seria un verde gratuito.
    expect(datos.vistas[0]!.filas.map((fila) => fila.cubo)).toEqual([...CUBOS_CON_FORMA_DE_UUID]);
    expect(FORMA_UUID.test(CUBOS_CON_FORMA_DE_UUID[0])).toBe(true);
    expect(datos.vistas[0]!.filas.length).toBeGreaterThan(0);

    // La seleccion se niega: no hay vista que proyectar.
    expect(vistaTemporalDelResultado(datos, vistaId)).toBeNull();

    // Y el control no produce archivo: devuelve el mensaje de R12 y NINGUNA fila.
    const { resultado } = await prepararExportFinanciero(
      datos.metricaId,
      vistaId,
      bordeQueDevuelve(datos),
    );
    expect(resultado.status).toBe("error");
    if (resultado.status !== "error") throw new Error("no es error");
    expect(resultado.mensaje).toBe(TEXTO_EXPORT_VISTA_NO_TEMPORAL);
    // NINGUN uuid viaja en el mensaje tampoco: el uuid se busca LITERALMENTE.
    expect(resultado.mensaje).not.toContain(CUBOS_CON_FORMA_DE_UUID[0]);
    expect(FORMA_UUID.test(resultado.mensaje)).toBe(false);
  });

  it("y una vista TEMPORAL si produce archivo: la exclusion es de las no temporales, no de todo", async () => {
    // Contrapeso. Sin esto, un export que no produjera archivo NUNCA pasaria igual este bloque, y
    // R12 estaria «cumplido» por no funcionar.
    const datos = dtoTemporalConNeto();
    const vistaId = idDeLaUnicaVista(datos);

    expect(vistaTemporalDelResultado(datos, vistaId)).not.toBeNull();

    const { resultado } = await prepararExportFinanciero(
      datos.metricaId,
      vistaId,
      bordeQueDevuelve(datos),
    );
    expect(resultado.status).toBe("ok");
    if (resultado.status !== "ok") throw new Error("no es ok");
    expect(resultado.filas.length).toBe(datos.vistas[0]!.filas.length);
  });

  it("autocomprobacion (d): si la seleccion aceptara la vista no temporal, el archivo llevaria el uuid", async () => {
    // La mutacion de R12, ejecutada AQUI en vez de descrita: se proyecta la vista no temporal a
    // mano —saltandose la seleccion— y se comprueba que el archivo resultante contiene el uuid
    // literal. Es la prueba de que la exclusion no es documental: si `vistaTemporalDelResultado`
    // dejara pasar esta vista, el texto de arriba tendria dentro un identificador crudo.
    const datos = dtoNoTemporalConUuids();
    const vista = datos.vistas[0]!;
    const archivo = await construirDescarga({
      tipo: "csv",
      titulo: datos.etiqueta,
      columnas: columnasDeVistaFinanciera(vista),
      filas: filasDeVistaFinanciera(datos, vista),
    });
    const texto = String(archivo.contenido);

    expect(texto).toContain(CUBOS_CON_FORMA_DE_UUID[0]);
    expect(FORMA_UUID.test(texto)).toBe(true);
  });
});
