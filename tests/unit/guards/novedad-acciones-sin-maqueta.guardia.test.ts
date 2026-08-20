// GUARDIA DEL ARNÉS — EN `/novedades` NINGÚN BOTÓN SE QUEDA SIN OPERACIÓN DETRÁS.
//
// Cubre **R37** (una acción declarada sin decir qué la produce no compila), **R38** (el productor
// existe y ALGÚN archivo de la pantalla lo usa), **R39** (la excusa de «no produce nada» es legible
// y caduca) y **R40** (los detectores se prueban contra fuente con la infracción plantada antes de
// afirmar nada sobre el árbol real).
//
// =================================================================================================
// EL INCIDENTE QUE LA MOTIVA, CON FECHAS Y MEDIDO
// =================================================================================================
//
// Del **2026-08-12 al 2026-08-20** la fila de «En devolución» tuvo un botón —rotulado «Devolver»
// hasta el 2026-08-19 y «Rechazar» desde entonces— cuyo handler era, entero:
//
//     function avisarNoDisponible() {
//       toast.info("Esta acción todavía no está disponible.");
//     }
//
// Ocho días de MAQUETA en producción con la suite entera en verde. Y el verde era **correcto**.
//
// **Por qué `superficie-de-uso.guardia.test.ts` no la vio, y no es un defecto suyo.** Aquella
// guardia mide ALCANZABILIDAD de módulos y de handlers, en tres capas, y ninguna de las tres ve una
// maqueta:
//
//  · **R-A** — acciones sin superficie: `avisarNoDisponible` **no es una Server Action**.
//  · **R-B** — componentes que nadie monta: `NovedadAcciones` **estaba montado**.
//  · **R-C** — handlers sin quien los llame: `avisarNoDisponible` **se referenciaba**, en
//    `NovedadesModule` (`onDevolver={avisarNoDisponible}`).
//
// Las tres pasaban, los ocho días, diciendo la verdad. Lo que faltaba no era una capa más de
// alcanzabilidad: era **atar el censo de botones al censo de operaciones**. El censo de botones lo
// creó la 236 (`ACCIONES_POR_GRUPO`, R18) y el de operaciones lo crea la 240
// (`PRODUCTOR_POR_ACCION`); esta guardia es el eslabón entre los dos.
//
// **Y por eso el rojo del handoff NO se apagó con una anotación.** Cuando el backend de esta misma
// ficha dejó `rechazarNovedad` existiendo sin pantalla que la llamara, `superficie-de-uso` se puso
// roja; la salida correcta era **cablear el botón**, no escribir `@sin-superficie`. Anotarlo habría
// sido, literalmente, volver a declarar la maqueta que la ficha venía a cerrar.
//
// =================================================================================================
// QUÉ LA PONE ROJA, EN CUATRO CASOS
// =================================================================================================
//
//  1. una acción nueva en la unión sin su productor → **no compila** (R37, lo hace el `satisfies`);
//  2. un productor citado que no existe, o cuyo módulo no lo exporta → **roja** (R38);
//  3. un productor real que **ningún archivo de `app/(app)/novedades/` importa** → **roja**: es el
//     cable cortado, y es el frente que la maqueta no habría pasado (R38);
//  4. un `sinOperacion` ausente, de relleno o de menos de 20 caracteres → **roja** (R39);
//  5. **el censo inverso**: la pantalla dispara una Server Action de fila que la tabla no declara →
//     **roja** (R38). Es el frente que caza el otro sabor de la recaída: bajar la celda a
//     `sinOperacion` con una excusa plausible y dejar el botón avisando por toast. La tabla dejaría
//     de ser el censo, que es la propiedad entera de la 236/R18.
//
// ⚠️ **EL CENSO SE ESCRIBE EN UN ARCHIVO DE TEST, NUNCA POR `node -e`.** Ahí `\b` llega como
// backspace y el censo miente en verde. Es la lección literal de `specs/238/tasks.md` T1.2.
//
// ⚠️ **Autocomprobación dentro de este mismo archivo (R40).** Los detectores se ejercen contra
// fuente sintético en las dos direcciones —sano y con la infracción plantada— antes de creerles nada
// sobre el árbol real. Una guardia estática rota no falla: **calla**, y su verde se lee igual que el
// bueno; en esta misma pila ya pasó una vez.
//
// La lectura es ESTÁTICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin
// estar registrada en ninguna lista.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  ACCIONES_POR_GRUPO,
  ACCIONES_SIN_GRUPO,
  PRODUCTOR_POR_ACCION,
  type AccionNovedad,
  type ProductorAccion,
} from "@/app/(app)/novedades/_components/novedad-acciones-catalogo";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");
const PANTALLA = "app/(app)/novedades";

/** Extensiones que puede tener un módulo de `lib/actions/**`. */
const EXTENSIONES = [".ts", ".tsx"] as const;

/**
 * Las Server Actions que la pantalla importa y que **no son acciones de una FILA**, con su razón.
 *
 * `PRODUCTOR_POR_ACCION` declara lo que produce **un botón de la fila**. Estas cinco no lo son, y
 * meterlas en la tabla la convertiría en «todo lo que la pantalla llama», que es otra cosa y no
 * serviría para decidir botones. Van aquí, y no en un archivo aparte, por lo mismo que `EXENTOS` de
 * la guardia hermana: una lista que vive lejos del detector nadie la poda.
 *
 *  · **Los cuatro listados y el de la tercera pestaña** alimentan la LISTA, no una fila. Es la
 *    lectura que decide QUÉ se pinta; el censo de botones empieza después.
 *  · **`publicarNotaOrden` y `borrarNotaOrden`** son operaciones **de dentro** de la ventana del
 *    hilo, ya abierta. La fila declara la PUERTA (`listarNotasOrden`, la acción `conversacion`), no
 *    lo que se hace tras cruzarla — si no, cada control interno de cada modal tendría que ser una
 *    entrada de la tabla de botones.
 */
const NO_SON_ACCIONES_DE_FILA = new Set([
  "listarNovedadesAction",
  "listarNovedadesCompletoAction",
  "listarAyudaTiendaAction",
  "listarAyudaTiendaCompletoAction",
  "listarRechazosSlaTiendaAction",
  "publicarNotaOrden",
  "borrarNotaOrden",
]);

/**
 * Motivos que no son motivos. Misma lista, palabra por palabra, que `@sin-superficie`.
 *
 * Un detalle que se corrige respecto del original: allí la rama `-+` iba seguida de `\b`, y una raya
 * SOLA (`-`) no tiene frontera de palabra detrás, así que caía por la regla de longitud en vez de
 * por la de relleno. El agujero no existía —igual se denunciaba— pero el motivo que se le decía al
 * lector era el equivocado.
 */
const MOTIVO_VACIO = /^(?:(?:todo|tbd|fixme|xxx|pendiente|por decidir|n\/a)\b|-+$)/i;
const MOTIVO_MINIMO = 20;

// -------------------------------------------------------------------------------------------------
// El censo del árbol
// -------------------------------------------------------------------------------------------------

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

interface Modulo {
  ruta: string;
  /** El fuente SIN comentarios: la prosa de este repo nombra símbolos a propósito. */
  codigo: string;
}

const FUENTES: Modulo[] = listarFuentes(path.join(RAIZ, PANTALLA)).map((completo) => ({
  ruta: path.relative(RAIZ, completo).split(path.sep).join("/"),
  codigo: quitarComentarios(readFileSync(completo, "utf8")),
}));

// -------------------------------------------------------------------------------------------------
// Los detectores, como funciones PURAS del texto (así se les puede dar fuente sintético)
// -------------------------------------------------------------------------------------------------

/**
 * Una arista de import: qué símbolos trae un archivo, de qué módulo y si es de TIPO.
 *
 * ⚠️ `import type { … }` se marca aparte y **no cuenta como cableado**, y es la distinción que hace
 * útil a todo este archivo: `RechazarNovedadModal` importa `RechazarNovedadActionResult` con `import
 * type` del MISMO módulo del que importa la acción. Si los dos contaran igual, una pantalla que sólo
 * importara el TIPO del resultado —sin llamar a nada— pasaría por cableada. Un tipo se borra en
 * compilación: no dispara ninguna operación.
 */
export interface AristaImport {
  readonly modulo: string;
  readonly simbolos: readonly string[];
  readonly esTipo: boolean;
}

/** `import { a, b as c } from "…"`, en una línea o en varias. */
const IMPORT_NOMBRADO = /import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*["']([^"'\n]+)["']/g;

export function aristasDeImport(codigo: string): AristaImport[] {
  const aristas: AristaImport[] = [];
  for (const m of codigo.matchAll(IMPORT_NOMBRADO)) {
    const simbolos = m[2]
      .split(",")
      .map((crudo) => crudo.trim())
      // `import { x as y }` cablea `x`: el nombre local da igual, lo que se dispara es el export.
      // Y un `type X` suelto dentro de unas llaves mixtas tampoco cablea nada.
      .filter((crudo) => crudo.length > 0 && !/^type\s/.test(crudo))
      .map((crudo) => crudo.split(/\s+as\s+/)[0].trim())
      .filter((s) => s.length > 0);
    aristas.push({
      modulo: m[3],
      simbolos,
      esTipo: Boolean(m[1]),
    });
  }
  return aristas;
}

/**
 * ¿`codigo` importa `simbolo` DE `modulo` como valor (no como tipo)?
 *
 * El módulo se compara contra el especificador con alias (`@/lib/actions/x`) y contra el propio
 * `lib/actions/x`, con la extensión opcional. No se admite un `import * as`: importar el espacio de
 * nombres entero no dice que se use ESA acción, y aceptarlo dejaría un agujero por el que pasaría
 * cualquier módulo con sólo nombrarlo.
 */
export function importaElSimbolo(
  codigo: string,
  modulo: string,
  simbolo: string,
): boolean {
  const admitidos = new Set([
    modulo,
    `@/${modulo}`,
    `${modulo}.ts`,
    `@/${modulo}.ts`,
  ]);
  return aristasDeImport(codigo).some(
    (a) => !a.esTipo && admitidos.has(a.modulo) && a.simbolos.includes(simbolo),
  );
}

/** El fuente de un módulo de `lib/actions/**`, o `null` si no existe ningún archivo con ese nombre. */
export function fuenteDelModulo(modulo: string): string | null {
  for (const ext of EXTENSIONES) {
    const completo = path.join(RAIZ, `${modulo}${ext}`);
    if (existsSync(completo)) return readFileSync(completo, "utf8");
  }
  return null;
}

/** ¿El fuente declara `export async function <simbolo>`? (sin comentarios: la prosa los nombra). */
export function exportaLaAccion(fuente: string, simbolo: string): boolean {
  const codigo = quitarComentarios(fuente);
  return new RegExp(`export\\s+async\\s+function\\s+${simbolo}\\b`).test(codigo);
}

/** ¿El fuente es un módulo de servidor? Sin `"use server"` no hay Server Action que disparar. */
export function esModuloDeServidor(fuente: string): boolean {
  return /^\s*["']use server["']/m.test(fuente);
}

/**
 * R39 — qué le pasa a un `sinOperacion` para no valer. Cadena vacía = está bien.
 *
 * Se devuelve el MOTIVO del rechazo y no un booleano: una guardia que sólo dice «no» obliga a leer
 * su fuente para saber qué arreglar.
 */
export function faltaDelMotivo(motivo: string): string {
  const limpio = motivo.trim();
  if (limpio.length === 0) return "está vacío";
  if (MOTIVO_VACIO.test(limpio)) return `es de relleno (\`${limpio}\`)`;
  if (limpio.length < MOTIVO_MINIMO)
    return `tiene ${limpio.length} caracteres y el mínimo son ${MOTIVO_MINIMO}`;
  return "";
}

/** Las entradas que declaran una Server Action, con su acción de origen. */
function entradasConProductor(): Array<{
  accion: AccionNovedad;
  accionServidor: string;
  modulo: string;
}> {
  return Object.entries(PRODUCTOR_POR_ACCION as Record<AccionNovedad, ProductorAccion>)
    .filter(([, p]) => "accionServidor" in p)
    .map(([accion, p]) => ({
      accion: accion as AccionNovedad,
      accionServidor: (p as { accionServidor: string }).accionServidor,
      modulo: (p as { modulo: string }).modulo,
    }));
}

/** Las entradas que declaran NO producir ninguna operación, con su motivo. */
function entradasSinOperacion(): Array<{ accion: AccionNovedad; motivo: string }> {
  return Object.entries(PRODUCTOR_POR_ACCION as Record<AccionNovedad, ProductorAccion>)
    .filter(([, p]) => "sinOperacion" in p)
    .map(([accion, p]) => ({
      accion: accion as AccionNovedad,
      motivo: (p as { sinOperacion: string }).sinOperacion,
    }));
}

// =================================================================================================
// 0 — LOS DETECTORES, PROBADOS CONTRA RESPUESTAS CONOCIDAS (R40, las dos direcciones)
// =================================================================================================

const CABLEADO = `
  import { useState } from "react";
  import { rechazarNovedad } from "@/lib/actions/resolver-novedad";
  import type { RechazarNovedadActionResult } from "@/lib/actions/resolver-novedad";
  export function RechazarNovedadModal() {
    return rechazarNovedad({ ordenId: "x", motivo: "y" });
  }`;

/**
 * El cable cortado: el módulo se nombra, pero SÓLO para traerse tipos.
 *
 * ⚠️ **EL NOMBRE DEL SÍMBOLO IMPORTA, y por poco se escribe mal.** La primera versión de este
 * fuente sólo traía `RechazarNovedadActionResult`, así que preguntar por `rechazarNovedad` daba
 * `false` **por el nombre**, no por el `import type` — y el caso pasaba en verde con el detector
 * mutado (medido: la mutación que borra `!a.esTipo` sobrevivía). Aquí se importa **el mismo
 * símbolo** que se pregunta, en sus dos formas de tipo, que es lo único que ejerce la distinción.
 */
const SOLO_EL_TIPO = `
  import type { rechazarNovedad, RechazarNovedadActionResult } from "@/lib/actions/resolver-novedad";
  export type Firma = typeof rechazarNovedad;
  export type X = RechazarNovedadActionResult;`;

/** La otra forma del mismo cable cortado: el `type` en línea, dentro de unas llaves mixtas. */
const TIPO_EN_LINEA = `
  import { type rechazarNovedad, reprogramarNovedad } from "@/lib/actions/resolver-novedad";
  export type Firma = typeof rechazarNovedad;
  export const usar = () => reprogramarNovedad;`;

/** La maqueta, tal cual vivió ocho días: el botón avisa y no llama a nada. */
const LA_MAQUETA = `
  import { useToast } from "@/hooks/useToast";
  export function NovedadesModule() {
    const toast = useToast();
    function avisarNoDisponible() {
      toast.info("Esta accion todavia no esta disponible.");
    }
    return avisarNoDisponible;
  }`;

const IMPORT_MULTILINEA = `
  import {
    borrarNotaOrden,
    listarNotasOrden as leerHilo,
    publicarNotaOrden,
  } from "@/lib/actions/orden-notas";`;

describe("0 — los detectores de esta guardia no están rotos (R40)", () => {
  it("ve el símbolo cuando el archivo lo importa DE VERDAD", () => {
    expect(
      importaElSimbolo(CABLEADO, "lib/actions/resolver-novedad", "rechazarNovedad"),
    ).toBe(true);
  });

  it("AUTOCOMPROBACIÓN: un `import type` NO cuenta como cableado", () => {
    // Es el falso positivo que dejaría esta guardia sin sujeto: un tipo se borra en compilación y
    // no dispara ninguna operación. `RechazarNovedadModal` importa las DOS cosas del mismo módulo,
    // así que si el detector no distinguiera, bastaría con el tipo para pasar por cableado.
    expect(
      importaElSimbolo(SOLO_EL_TIPO, "lib/actions/resolver-novedad", "rechazarNovedad"),
    ).toBe(false);
    // Y la arista SÍ se ve; lo que cambia es que está marcada como de tipo.
    expect(aristasDeImport(SOLO_EL_TIPO)).toHaveLength(1);
    expect(aristasDeImport(SOLO_EL_TIPO)[0].esTipo).toBe(true);
    // CONTROL POSITIVO de que el detector no está diciendo `false` por otra razón: el MISMO
    // fuente, con el MISMO módulo, sí ve el símbolo cuando la arista no es de tipo.
    expect(
      importaElSimbolo(CABLEADO, "lib/actions/resolver-novedad", "rechazarNovedad"),
    ).toBe(true);
  });

  it("AUTOCOMPROBACIÓN: el `type` EN LÍNEA, dentro de unas llaves mixtas, tampoco cablea", () => {
    // `import { type x, y }` es la forma que más se escribe hoy, y la que se colaría si el filtro
    // sólo mirara el `import type` de cabecera.
    expect(
      importaElSimbolo(TIPO_EN_LINEA, "lib/actions/resolver-novedad", "rechazarNovedad"),
    ).toBe(false);
    // Y su par: el símbolo que SÍ viaja como valor en esa misma línea sí cuenta.
    expect(
      importaElSimbolo(TIPO_EN_LINEA, "lib/actions/resolver-novedad", "reprogramarNovedad"),
    ).toBe(true);
    // Y el CONTRATO de `aristasDeImport`, escrito: `simbolos` son los que viajan como VALOR, ni uno
    // más. Sin esta línea el filtro del `type` en línea es un mutante EQUIVALENTE —medido: borrarlo
    // dejaba los 15 casos en verde— porque `"type rechazarNovedad"` tampoco coincide con el nombre
    // desnudo en el `includes`. Aquí es donde el filtro se observa.
    expect(aristasDeImport(TIPO_EN_LINEA)[0].simbolos).toEqual(["reprogramarNovedad"]);
  });

  it("AUTOCOMPROBACIÓN: LA MAQUETA no pasa — no cita ninguna acción", () => {
    // El fuente de los ocho días. Ninguna de las tres capas de `superficie-de-uso` lo denunciaba;
    // aquí no hay import de `lib/actions/**` y por tanto no hay productor que valga.
    expect(
      importaElSimbolo(LA_MAQUETA, "lib/actions/resolver-novedad", "rechazarNovedad"),
    ).toBe(false);
    expect(
      aristasDeImport(LA_MAQUETA).some((a) => a.modulo.includes("lib/actions/")),
    ).toBe(false);
  });

  it("lee imports de VARIAS líneas y con alias (`as`)", () => {
    // Es la forma real de `HiloNotasNovedadModal`. Si el detector sólo viera imports de una línea,
    // ese productor saldría «no cableado» y la guardia sería ruido que alguien acabaría apagando.
    const [arista] = aristasDeImport(IMPORT_MULTILINEA);
    expect(arista.modulo).toBe("@/lib/actions/orden-notas");
    expect(arista.simbolos).toEqual([
      "borrarNotaOrden",
      "listarNotasOrden",
      "publicarNotaOrden",
    ]);
    expect(
      importaElSimbolo(IMPORT_MULTILINEA, "lib/actions/orden-notas", "listarNotasOrden"),
    ).toBe(true);
  });

  it("AUTOCOMPROBACIÓN: un productor INVENTADO no existe en el árbol", () => {
    expect(fuenteDelModulo("lib/actions/rechazar-que-nadie-escribio")).toBeNull();
    // Y uno real cuyo módulo NO exporta ese símbolo tampoco pasa: la cita apunta a nada, que es el
    // modo de fallo de `test-citado-desaparecido.guardia.test.ts`.
    const real = fuenteDelModulo("lib/actions/resolver-novedad");
    expect(real).not.toBeNull();
    expect(exportaLaAccion(real as string, "rechazarNovedad")).toBe(true);
    expect(exportaLaAccion(real as string, "rechazarLoQueSea")).toBe(false);
  });

  it("AUTOCOMPROBACIÓN: los motivos de relleno se denuncian, y el bueno no", () => {
    expect(faltaDelMotivo("")).toBe("está vacío");
    expect(faltaDelMotivo("   ")).toBe("está vacío");
    expect(faltaDelMotivo("TODO")).toContain("de relleno");
    expect(faltaDelMotivo("pendiente de decidir con el humano")).toContain("de relleno");
    expect(faltaDelMotivo("-")).toContain("de relleno");
    expect(faltaDelMotivo("no muta nada")).toContain("caracteres");
    // El motivo REAL de la única entrada sin operación sale limpio.
    expect(
      faltaDelMotivo(
        "abre el marcador del telefono y WhatsApp del navegador: no muta nada en el servidor",
      ),
    ).toBe("");
  });

  it("el censo LEYÓ el árbol de verdad: hay archivos, con código, y las ocho entradas", () => {
    // Anti-vacuidad. Una guardia que no encuentra nada denuncia cero infracciones y su verde es
    // indistinguible del bueno.
    expect(FUENTES.length).toBeGreaterThanOrEqual(8);
    expect(FUENTES.every((m) => m.codigo.trim().length > 0)).toBe(true);
    // El censo de operaciones cubre EXACTAMENTE el de botones. Lo garantiza el `satisfies` en el
    // typecheck (R37); aquí se afirma además en ejecución, porque un `satisfies` silenciado con un
    // `as` dejaría de reclamarlo y nada lo diría.
    const declaradas = new Set<string>([
      ...ACCIONES_POR_GRUPO.ayuda,
      ...ACCIONES_POR_GRUPO.devolucion,
      ...ACCIONES_SIN_GRUPO,
    ]);
    expect(Object.keys(PRODUCTOR_POR_ACCION).sort()).toEqual([...declaradas].sort());
    expect(Object.keys(PRODUCTOR_POR_ACCION)).toHaveLength(8);
    // Y hay de las DOS clases: si todas fueran `sinOperacion`, los frentes 1 y 2 no ejercerían
    // nada; si ninguna lo fuera, el frente 3 tampoco.
    expect(entradasConProductor().length).toBeGreaterThanOrEqual(6);
    expect(entradasSinOperacion().length).toBeGreaterThanOrEqual(1);
  });
});

// =================================================================================================
// FRENTE 1 — EL PRODUCTOR EXISTE (R38)
// =================================================================================================

describe("240/R38 — toda acción cita una Server Action que EXISTE", () => {
  it("el módulo declarado existe, es de servidor y exporta ese símbolo", () => {
    const rotos: string[] = [];
    for (const { accion, accionServidor, modulo } of entradasConProductor()) {
      const fuente = fuenteDelModulo(modulo);
      if (fuente === null) {
        rotos.push(`${accion}: el módulo \`${modulo}\` no existe en el árbol`);
        continue;
      }
      if (!esModuloDeServidor(fuente)) {
        rotos.push(`${accion}: \`${modulo}\` no lleva "use server"`);
      }
      if (!exportaLaAccion(fuente, accionServidor)) {
        rotos.push(
          `${accion}: \`${modulo}\` no exporta \`export async function ${accionServidor}\``,
        );
      }
    }
    expect(
      rotos,
      "una acción de `/novedades` cita un productor que no está donde dice. Es el modo de fallo de " +
        "`test-citado-desaparecido.guardia.test.ts`: una cita que ya no apunta a nada. O se " +
        "corrige la cita, o se declara `sinOperacion` con su motivo escrito.",
    ).toEqual([]);
  });
});

// =================================================================================================
// FRENTE 2 — EL PRODUCTOR ESTÁ CABLEADO (R38). ÉSTE ES EL QUE LA MAQUETA NO HABRÍA PASADO.
// =================================================================================================

describe("240/R38 — y algún archivo de la pantalla la IMPORTA", () => {
  it("cada productor tiene al menos un importador dentro de `app/(app)/novedades/`", () => {
    const sinCable: string[] = [];
    for (const { accion, accionServidor, modulo } of entradasConProductor()) {
      const importadores = FUENTES.filter((m) =>
        importaElSimbolo(m.codigo, modulo, accionServidor),
      );
      if (importadores.length === 0) {
        sinCable.push(`${accion} → \`${accionServidor}\` (${modulo}): nadie la importa`);
      }
    }
    expect(
      sinCable,
      "un botón de `/novedades` declara una operación que NINGÚN archivo de la pantalla llama: es " +
        "el cable cortado, y es exactamente el estado en el que «Rechazar» vivió del 2026-08-12 al " +
        "2026-08-20 avisando por toast. Se arregla CABLEANDO el botón. Anotarlo para callar la " +
        "guardia sería volver a declarar la maqueta.",
    ).toEqual([]);
  });

  it("y el importador es un archivo REAL, con la arista nombrada (anti-vacuidad)", () => {
    // Si `importaElSimbolo` estuviera roto y devolviera `true` a ciegas, el caso de arriba pasaría
    // sin medir nada. Esto fija el mapa concreto: qué archivo cablea cada operación, hoy.
    const mapa = entradasConProductor().map(({ accionServidor, modulo }) => {
      const importadores = FUENTES.filter((m) =>
        importaElSimbolo(m.codigo, modulo, accionServidor),
      ).map((m) => m.ruta.replace(`${PANTALLA}/_components/`, ""));
      return `${accionServidor} ← ${importadores.sort().join(", ")}`;
    });
    expect(mapa.sort()).toEqual([
      "gestionarDesdeAyuda ← GestionarDesdeAyudaModal.tsx",
      "gestionarDesdeAyuda ← GestionarDesdeAyudaModal.tsx",
      "habilitarNovedad ← NovedadesModule.tsx",
      "listarNotasOrden ← HiloNotasNovedadModal.tsx",
      "rechazarNovedad ← RechazarNovedadModal.tsx",
      "registrarIntentoContactoOrden ← IntentoContactoAccion.tsx",
      "reprogramarNovedad ← ReprogramarNovedadModal.tsx",
    ]);
  });
});

// =================================================================================================
// FRENTE 3 — LA EXCUSA ES LEGIBLE Y CADUCA (R39)
// =================================================================================================

describe("240/R39 — «no produce ninguna operación» exige un motivo escrito", () => {
  it("ningún `sinOperacion` está vacío, es de relleno ni es telegráfico", () => {
    const malos = entradasSinOperacion()
      .map(({ accion, motivo }) => ({ accion, falta: faltaDelMotivo(motivo) }))
      .filter(({ falta }) => falta !== "")
      .map(({ accion, falta }) => `${accion}: el motivo ${falta}`);
    expect(
      malos,
      "declarar que un botón no produce ninguna operación es una decisión, y una decisión sin su " +
        "razón escrita es la allowlist que no queríamos, con otro nombre. Misma regla, palabra por " +
        "palabra, que `@sin-superficie` en `superficie-de-uso.guardia.test.ts`.",
    ).toEqual([]);
  });

});

// =================================================================================================
// FRENTE 4 — EL CENSO INVERSO (R38). ÉSTE CAZA LA RECAÍDA CON LA EXCUSA PUESTA.
// =================================================================================================
//
// Los frentes 1 y 2 van de la TABLA al árbol: lo que la tabla cita, ¿existe y está cableado? Éste va
// del árbol A LA TABLA: lo que la pantalla dispara, ¿lo declara la tabla?
//
// **Por qué hace falta, dicho con la recaída concreta que cierra.** Un frente 2 solo se apaga con un
// gesto de tres segundos: bajar la celda a `rechazar: { sinOperacion: "…" }` con una excusa
// plausible de más de veinte caracteres y volver a poner el `toast.info`. La operación seguiría en
// el árbol, la excusa pasaría el frente 3, y los frentes 1 y 2 ya no tendrían nada que mirar. Con
// este frente eso es rojo: `rechazarNovedad` la importa la pantalla y ninguna acción la declara.
//
// **Y la caducidad de `@sin-superficie`, en su versión de aquí:** «una excepción que sobrevive a su
// motivo es basura». Si mañana `contacto` ganara una Server Action y alguien no moviera su entrada,
// la excusa seguiría describiendo un mundo que ya no existe — y este frente lo dice.
describe("240/R38 — y la tabla declara TODO lo que la fila dispara (censo inverso)", () => {
  /** Toda Server Action de `lib/actions/**` que un archivo de la pantalla importa como valor. */
  function accionesQueLaPantallaDispara(): Array<{ simbolo: string; ruta: string }> {
    const encontradas: Array<{ simbolo: string; ruta: string }> = [];
    for (const m of FUENTES) {
      for (const arista of aristasDeImport(m.codigo)) {
        if (arista.esTipo) continue;
        const modulo = arista.modulo.replace(/^@\//, "").replace(/\.tsx?$/, "");
        if (!modulo.startsWith("lib/actions/")) continue;
        const fuente = fuenteDelModulo(modulo);
        if (fuente === null) continue;
        for (const simbolo of arista.simbolos) {
          // Sólo los `export async function`: un tipo o una constante del mismo módulo no es una
          // operación, y exigir que la tabla los declare sería ruido.
          if (exportaLaAccion(fuente, simbolo)) encontradas.push({ simbolo, ruta: m.ruta });
        }
      }
    }
    return encontradas;
  }

  it("ninguna Server Action de fila se dispara sin estar declarada en la tabla", () => {
    const declaradas = new Set(entradasConProductor().map((e) => e.accionServidor));
    const huerfanas = accionesQueLaPantallaDispara()
      .filter(({ simbolo }) => !declaradas.has(simbolo))
      .filter(({ simbolo }) => !NO_SON_ACCIONES_DE_FILA.has(simbolo))
      .map(({ simbolo, ruta }) => `${simbolo} (lo dispara ${ruta})`);
    expect(
      huerfanas,
      "la pantalla de `/novedades` dispara una operación que `PRODUCTOR_POR_ACCION` no declara. O " +
        "es la acción de un botón —y entonces va en la tabla, que es EL censo de lo que la fila " +
        "ofrece (236/R18)— o no lo es, y entonces va en `NO_SON_ACCIONES_DE_FILA` con su motivo " +
        "escrito. Lo que no puede es no estar en ninguna de las dos: así es como una celda se " +
        "degrada a `sinOperacion` con una excusa plausible mientras el botón vuelve a avisar por " +
        "toast, y nadie se entera.",
    ).toEqual([]);
  });

  it("y el detector VE de verdad las acciones de la pantalla (anti-vacuidad)", () => {
    // Si `accionesQueLaPantallaDispara` estuviera roto —devolviendo lista vacía— el caso de arriba
    // pasaría sin medir nada, que es exactamente cómo una guardia estática miente en verde.
    const simbolos = new Set(accionesQueLaPantallaDispara().map((e) => e.simbolo));
    expect(simbolos.size).toBeGreaterThanOrEqual(10);
    // Las seis de fila, nombradas: si alguna dejara de verse, este frente se quedaría sin sujeto.
    for (const s of [
      "rechazarNovedad",
      "reprogramarNovedad",
      "habilitarNovedad",
      "listarNotasOrden",
      "registrarIntentoContactoOrden",
      "gestionarDesdeAyuda",
    ]) {
      expect([...simbolos], s).toContain(s);
    }
    // Y las exentas también se ven: la lista de exentos no está tapando un detector ciego.
    expect([...simbolos]).toContain("publicarNotaOrden");
    expect([...simbolos]).toContain("listarNovedadesAction");
  });

  it("la lista de exentos no tiene basura: todo lo que exime, la pantalla lo dispara HOY", () => {
    // La caducidad, en la dirección de los exentos. Un nombre que ya nadie importa es una excepción
    // que sobrevivió a su motivo, y crece hasta que nadie lee ninguna.
    const disparadas = new Set(accionesQueLaPantallaDispara().map((e) => e.simbolo));
    const muertos = [...NO_SON_ACCIONES_DE_FILA].filter((s) => !disparadas.has(s));
    expect(muertos, "exentos que ya nadie importa: se borran").toEqual([]);
  });
});
