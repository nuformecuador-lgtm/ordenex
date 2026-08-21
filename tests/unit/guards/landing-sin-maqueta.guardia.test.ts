// GUARDIA DEL ARNÉS — EN LA SUPERFICIE PÚBLICA NINGÚN FORMULARIO PROMETE SIN PRODUCIR.
//
// Feature 253 (T8.3/T8.4). Cubre **R37** (existe una guardia para la landing), **R38** (el censo
// declara productor o motivo), **R39** (el productor existe **y** alguien lo importa **Y lo
// invoca**), **R40** (el censo va en las dos direcciones, y también contra el árbol de archivos),
// **R41** (los detectores se ejercitan contra fuente sintético antes de afirmar nada del árbol
// real) y **R42** (se selecciona sola con `pnpm exec vitest run guard`).
//
// =================================================================================================
// EL DEFECTO QUE LA MOTIVA, LEÍDO EN EL ÁRBOL — NO REPORTADO
// =================================================================================================
//
// `app/_landing/PostularRecursoModal.tsx` se declaraba a sí mismo **MAQUETA** en su cabecera. Su
// `handleSubmit`, tras validar, ejecutaba **exactamente dos líneas**:
//
//     setErrores({});
//     // TODO: aquí va el envío real cuando se decida el destino de la postulación.
//     setEnviado(true);
//
// …y `enviado === true` pintaba «Postulación enviada. Recibimos tus datos. Nuestro equipo te
// contacta al teléfono o al correo que dejaste.»
//
// **No fallaba: mentía.** Daba acuse de recibo de algo que no ocurría, en producción, en la landing
// pública, a personas que no tienen ninguna otra forma de enterarse. El humano lo descubrió
// postulando un vehículo y una bodega y no encontrándolos en ningún sitio: nunca salieron del
// navegador. Y no hay forma de saber cuántas se perdieron —no hay fila, no hay log, no hay correo.
//
// **Por qué ninguna red lo vio.** No existía **ni un** test de ese componente en el árbol. Y la
// guardia anti-maqueta que la 240 escribió para esta misma clase de defecto tiene su ámbito clavado
// en una constante del archivo —`const PANTALLA = "app/(app)/novedades"`—, así que **la landing
// quedaba fuera**. La 240 arregló un caso y dejó el agujero de proceso intacto; esta guardia es la
// mitad que faltaba.
//
// =================================================================================================
// QUÉ LA PONE ROJA, EN CINCO FRENTES
// =================================================================================================
//
//  1. un productor citado que no existe, no lleva `"use server"` o no exporta ese símbolo (R38);
//  2. un productor que **ningún archivo de una raíz pública importa Y invoca** (R39). ÉSTE es el
//     frente que la maqueta de la 253 no habría pasado, y el que caza también la variante sutil:
//     dejar el `import` en pie y borrar la invocación;
//  3. un `sinOperacion` vacío, de relleno o de menos de 20 caracteres (R38);
//  4. **censo inverso**: una raíz pública dispara una Server Action que el censo no declara (R40);
//  5. **censo del árbol**: un archivo con formulario de envío al que ninguna entrada apunta, y su
//     recíproco, una entrada que apunta a un archivo que ya no existe (R40).
//
// ⚠️ **Autocomprobación (R41).** Los detectores se ejercen contra fuente sintético en las dos
// direcciones —sano y con la infracción plantada, incluido el caso LITERAL de esta ficha— antes de
// creerles nada sobre el árbol real. Una guardia estática rota no falla: **calla**, y su verde se
// lee igual que el bueno.
//
// ⚠️ **Los detectores se COMPARTEN con la guardia de la 240** (`tests/fixtures/deteccion-maqueta.ts`,
// D7 firmada). No se copian: la corrección medida del 2026-08-20 —«el import en pie sin la
// invocación no cuenta»— no habría llegado nunca a una copia, y esa copia habría seguido en verde.
//
// La lectura es ESTÁTICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin
// estar registrada en ninguna lista.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  aristasDeImport,
  esModuloDeServidor,
  exportaLaAccion,
  faltaDelMotivo,
  fuenteDelModulo,
  importaElSimbolo,
  invocaElSimbolo,
} from "../../fixtures/deteccion-maqueta";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import {
  ARCHIVO_POR_SUPERFICIE,
  NO_SON_SUPERFICIES_DE_ENVIO,
  PRODUCTOR_POR_SUPERFICIE,
  RAICES_PUBLICAS,
  type ProductorSuperficie,
  type SuperficiePublica,
} from "../../fixtures/superficies-publicas";

const RAIZ = path.resolve(__dirname, "../../..");

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

const FUENTES: Modulo[] = RAICES_PUBLICAS.flatMap((raiz) =>
  listarFuentes(path.join(RAIZ, raiz)).map((completo) => ({
    ruta: path.relative(RAIZ, completo).split(path.sep).join("/"),
    codigo: quitarComentarios(readFileSync(completo, "utf8")),
  })),
);

/**
 * ¿Este fuente declara un formulario que alguien puede ENVIAR?
 *
 * Se mira `<form` y `onSubmit=`, que son las dos formas en las que un envío existe en este árbol
 * (las tres superficies de hoy llevan las dos en la misma línea). Es a propósito una pregunta
 * ESTRUCTURAL y no de vocabulario: detectar el acuse por sus palabras —«enviada», «gracias»— sería
 * gameable con un cambio de copy, y su rojo hablaría de redacción en vez de conducta (design §9.3).
 *
 * Se le pasa el código YA sin comentarios: si no, esta misma prosa contaría como formulario.
 */
export function declaraFormularioDeEnvio(codigo: string): boolean {
  return /<form\b/.test(codigo) || /onSubmit\s*=/.test(codigo);
}

/** Las superficies que declaran una Server Action, con su superficie de origen. */
function superficiesConProductor(): Array<{
  superficie: SuperficiePublica;
  accionServidor: string;
  modulo: string;
}> {
  return Object.entries(
    PRODUCTOR_POR_SUPERFICIE as Record<SuperficiePublica, ProductorSuperficie>,
  )
    .filter(([, p]) => "accionServidor" in p)
    .map(([superficie, p]) => ({
      superficie: superficie as SuperficiePublica,
      accionServidor: (p as { accionServidor: string }).accionServidor,
      modulo: (p as { modulo: string }).modulo,
    }));
}

/** Las superficies que declaran NO producir ninguna operación, con su motivo. */
function superficiesSinOperacion(): Array<{
  superficie: SuperficiePublica;
  motivo: string;
}> {
  return Object.entries(
    PRODUCTOR_POR_SUPERFICIE as Record<SuperficiePublica, ProductorSuperficie>,
  )
    .filter(([, p]) => "sinOperacion" in p)
    .map(([superficie, p]) => ({
      superficie: superficie as SuperficiePublica,
      motivo: (p as { sinOperacion: string }).sinOperacion,
    }));
}

/** Toda Server Action de `lib/actions/**` que un archivo de una raíz pública importa como valor. */
function accionesQueLaSuperficieDispara(): Array<{ simbolo: string; ruta: string }> {
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
        // operación, y exigir que el censo los declare sería ruido.
        if (exportaLaAccion(fuente, simbolo)) encontradas.push({ simbolo, ruta: m.ruta });
      }
    }
  }
  return encontradas;
}

// =================================================================================================
// 0 — LOS DETECTORES, PROBADOS CONTRA RESPUESTAS CONOCIDAS (R41, las dos direcciones)
// =================================================================================================
//
// ⚠️ ESTE BLOQUE NO SE COMPARTE con la guardia de la 240, aunque los detectores sí. Es la
// contrapartida de extraerlos: un módulo compartido roto rompería las dos guardias a la vez, así
// que cada una los ejercita por su cuenta antes de creerles nada.

const CABLEADO = `
  import { useState } from "react";
  import { postularRecurso } from "@/lib/actions/postulacion-recurso";
  import type { PostularRecursoResult } from "@/lib/actions/postulacion-recurso";
  export function PostularRecursoModal() {
    return postularRecurso({ tipo: "vehiculo" });
  }`;

/**
 * El cable cortado: el módulo se nombra, pero SÓLO para traerse tipos.
 *
 * ⚠️ **EL NOMBRE DEL SÍMBOLO IMPORTA.** Se importa **el mismo símbolo** que se pregunta, en sus dos
 * formas de tipo: si el fuente sólo trajera el tipo del resultado, el `false` vendría del NOMBRE y
 * no del `import type`, y la distinción no se estaría ejerciendo (agujero medido en la 240).
 */
const SOLO_EL_TIPO = `
  import type { postularRecurso, PostularRecursoResult } from "@/lib/actions/postulacion-recurso";
  export type Firma = typeof postularRecurso;
  export type X = PostularRecursoResult;`;

/** La otra forma del mismo cable cortado: el `type` en línea, dentro de unas llaves mixtas. */
const TIPO_EN_LINEA = `
  import { type postularRecurso, consultarRastreoPublico } from "@/lib/actions/postulacion-recurso";
  export type Firma = typeof postularRecurso;
  export const usar = () => consultarRastreoPublico;`;

/**
 * 💀 LA MAQUETA DE LA 253, EL CASO LITERAL DE ESTA FICHA.
 *
 * `handleSubmit` valida con zod y hace `setEnviado(true)`. No importa nada de `lib/actions/`, así
 * que no hay productor que valga: la pantalla promete y no produce. Vivió así en producción.
 */
const LA_MAQUETA_253 = `
  import { useState } from "react";
  import { z } from "zod";
  const formSchema = z.object({ nombre: z.string() });
  export function PostularRecursoModal() {
    const [enviado, setEnviado] = useState(false);
    const handleSubmit = (e) => {
      e.preventDefault();
      const parsed = formSchema.safeParse(valores);
      if (!parsed.success) return;
      setEnviado(true);
    };
    return <form onSubmit={handleSubmit} />;
  }`;

/**
 * 💀 LA QUINTA MAQUETA — la que sobrevivió a las dos guardias de la 240 hasta el 2026-08-20.
 *
 * El `import` sigue en pie y la invocación no está. Pasaba el frente 2 porque aquel frente medía el
 * `import`, y pasaba el linter porque `"lint": "eslint"` no lleva `--max-warnings=0`, así que
 * `no-unused-vars` es un *warning* y no rompe nada.
 */
const IMPORT_SIN_LLAMADA = `
  import { useState } from "react";
  import { postularRecurso } from "@/lib/actions/postulacion-recurso";
  export function PostularRecursoModal() {
    const [enviado, setEnviado] = useState(false);
    // Aqui llamaba a postularRecurso(...) y ahora solo pinta el acuse.
    return <form onSubmit={() => setEnviado(true)} />;
  }`;

/** Un componente con formulario de envío que el censo no nombra: el frente 5 debe verlo. */
const FORM_SIN_CENSO = `
  export function PostularOtraCosaModal() {
    return <form onSubmit={(e) => e.preventDefault()} />;
  }`;

/** Y su contrario: un archivo de la misma raíz que NO es una superficie de envío. */
const SIN_FORMULARIO = `
  export function LandingFooter() {
    return <footer><a href="/login">Ingresar</a></footer>;
  }`;

describe("253/R41 — 0: los detectores de esta guardia no están rotos", () => {
  it("ve el símbolo cuando el archivo lo importa DE VERDAD", () => {
    expect(
      importaElSimbolo(CABLEADO, "lib/actions/postulacion-recurso", "postularRecurso"),
    ).toBe(true);
  });

  it("AUTOCOMPROBACIÓN: un `import type` NO cuenta como cableado", () => {
    expect(
      importaElSimbolo(SOLO_EL_TIPO, "lib/actions/postulacion-recurso", "postularRecurso"),
    ).toBe(false);
    // Y la arista SÍ se ve; lo que cambia es que está marcada como de tipo.
    expect(aristasDeImport(SOLO_EL_TIPO)).toHaveLength(1);
    expect(aristasDeImport(SOLO_EL_TIPO)[0].esTipo).toBe(true);
    // CONTROL POSITIVO de que el detector no dice `false` por otra razón.
    expect(
      importaElSimbolo(CABLEADO, "lib/actions/postulacion-recurso", "postularRecurso"),
    ).toBe(true);
  });

  it("AUTOCOMPROBACIÓN: el `type` EN LÍNEA, dentro de unas llaves mixtas, tampoco cablea", () => {
    expect(
      importaElSimbolo(TIPO_EN_LINEA, "lib/actions/postulacion-recurso", "postularRecurso"),
    ).toBe(false);
    // Y su par: el símbolo que SÍ viaja como valor en esa misma línea sí cuenta.
    expect(
      importaElSimbolo(
        TIPO_EN_LINEA,
        "lib/actions/postulacion-recurso",
        "consultarRastreoPublico",
      ),
    ).toBe(true);
    // El CONTRATO de `aristasDeImport`: `simbolos` son los que viajan como VALOR, ni uno más.
    expect(aristasDeImport(TIPO_EN_LINEA)[0].simbolos).toEqual([
      "consultarRastreoPublico",
    ]);
  });

  it("💀 AUTOCOMPROBACIÓN: LA MAQUETA DE LA 253 no pasa — valida y sólo hace `setEnviado(true)`", () => {
    // El fuente que vivió en producción. No cita ninguna acción, así que no hay productor.
    expect(
      importaElSimbolo(LA_MAQUETA_253, "lib/actions/postulacion-recurso", "postularRecurso"),
    ).toBe(false);
    expect(invocaElSimbolo(LA_MAQUETA_253, "postularRecurso")).toBe(false);
    expect(
      aristasDeImport(LA_MAQUETA_253).some((a) => a.modulo.includes("lib/actions/")),
    ).toBe(false);
    // Y sin embargo ES una superficie de envío: por eso el frente 5 lo ve y exige que esté censada.
    expect(declaraFormularioDeEnvio(LA_MAQUETA_253)).toBe(true);
  });

  it("ve la LLAMADA cuando el archivo la invoca de verdad", () => {
    expect(invocaElSimbolo(CABLEADO, "postularRecurso")).toBe(true);
  });

  it("💀 AUTOCOMPROBACIÓN: el `import` en pie SIN la llamada NO cuenta como cableado", () => {
    // ⭑ La quinta forma de replantar la maqueta: importar y no llamar. El import SÍ está —y por eso
    // el frente viejo de la 240 pasaba—, la invocación NO.
    expect(
      importaElSimbolo(
        IMPORT_SIN_LLAMADA,
        "lib/actions/postulacion-recurso",
        "postularRecurso",
      ),
    ).toBe(true);
    expect(invocaElSimbolo(IMPORT_SIN_LLAMADA, "postularRecurso")).toBe(false);
  });

  it("AUTOCOMPROBACIÓN: nombrarla en un COMENTARIO no es llamarla", () => {
    expect(
      invocaElSimbolo(
        `// llama a postularRecurso({ tipo }) cuando toque
export const x = 1;`,
        "postularRecurso",
      ),
    ).toBe(false);
  });

  it("AUTOCOMPROBACIÓN: mencionar el símbolo sin paréntesis tampoco es llamarlo", () => {
    // `accionServidor: "postularRecurso"` es exactamente esto: el censo NOMBRA la acción. Si eso
    // contara, el censo se cablearía a sí mismo y el frente 2 no mediría nada.
    expect(
      invocaElSimbolo(
        'export const T = { accionServidor: "postularRecurso" };',
        "postularRecurso",
      ),
    ).toBe(false);
  });

  it("AUTOCOMPROBACIÓN: un productor INVENTADO no existe en el árbol", () => {
    expect(fuenteDelModulo("lib/actions/postular-lo-que-nadie-escribio")).toBeNull();
    const real = fuenteDelModulo("lib/actions/postulacion-recurso");
    expect(real).not.toBeNull();
    expect(esModuloDeServidor(real as string)).toBe(true);
    expect(exportaLaAccion(real as string, "postularRecurso")).toBe(true);
    expect(exportaLaAccion(real as string, "postularLoQueSea")).toBe(false);
  });

  it("AUTOCOMPROBACIÓN: los motivos de relleno se denuncian, y el bueno no", () => {
    expect(faltaDelMotivo("")).toBe("está vacío");
    expect(faltaDelMotivo("   ")).toBe("está vacío");
    expect(faltaDelMotivo("TODO")).toContain("de relleno");
    expect(faltaDelMotivo("pendiente de decidir con el humano")).toContain("de relleno");
    expect(faltaDelMotivo("-")).toContain("de relleno");
    expect(faltaDelMotivo("no envía nada")).toContain("caracteres");
    expect(
      faltaDelMotivo(
        "abre el marcador del telefono del navegador: no muta nada en el servidor",
      ),
    ).toBe("");
  });

  it("💀 AUTOCOMPROBACIÓN: el detector de formularios ve `FORM_SIN_CENSO` y no ve lo que no lo es", () => {
    // Las dos direcciones. Sin la segunda, un detector que devolviera `true` a ciegas denunciaría
    // el árbol entero y alguien acabaría apagando la guardia; sin la primera, no vería nada.
    expect(declaraFormularioDeEnvio(FORM_SIN_CENSO)).toBe(true);
    expect(declaraFormularioDeEnvio(SIN_FORMULARIO)).toBe(false);
    // Y la forma sin `onSubmit`, que también es un envío (Server Action por `action=`).
    expect(declaraFormularioDeEnvio('export const X = () => <form action={x} />;')).toBe(
      true,
    );
  });

  it("el censo LEYÓ el árbol de verdad: hay archivos, con código, y las cuatro entradas", () => {
    // Anti-vacuidad. Una guardia que no encuentra nada denuncia cero infracciones y su verde es
    // indistinguible del bueno.
    expect(FUENTES.length).toBeGreaterThanOrEqual(12);
    expect(FUENTES.every((m) => m.codigo.trim().length > 0)).toBe(true);
    // Las DOS raíces están representadas (D10: la guardia cubre toda la superficie pública).
    for (const raiz of RAICES_PUBLICAS) {
      expect(FUENTES.some((m) => m.ruta.startsWith(`${raiz}/`)), raiz).toBe(true);
    }
    expect(Object.keys(PRODUCTOR_POR_SUPERFICIE).sort()).toEqual(
      Object.keys(ARCHIVO_POR_SUPERFICIE).sort(),
    );
    expect(Object.keys(PRODUCTOR_POR_SUPERFICIE)).toHaveLength(4);
    expect(superficiesConProductor().length).toBe(4);
  });
});

// =================================================================================================
// FRENTE 1 — EL PRODUCTOR EXISTE (R38)
// =================================================================================================

describe("253/R38 — toda superficie pública cita una Server Action que EXISTE", () => {
  it("el módulo declarado existe, es de servidor y exporta ese símbolo", () => {
    const rotos: string[] = [];
    for (const { superficie, accionServidor, modulo } of superficiesConProductor()) {
      const fuente = fuenteDelModulo(modulo);
      if (fuente === null) {
        rotos.push(`${superficie}: el módulo \`${modulo}\` no existe en el árbol`);
        continue;
      }
      if (!esModuloDeServidor(fuente)) {
        rotos.push(`${superficie}: \`${modulo}\` no lleva "use server"`);
      }
      if (!exportaLaAccion(fuente, accionServidor)) {
        rotos.push(
          `${superficie}: \`${modulo}\` no exporta \`export async function ${accionServidor}\``,
        );
      }
    }
    expect(
      rotos,
      "una superficie pública cita un productor que no está donde dice. Es el modo de fallo de " +
        "`test-citado-desaparecido.guardia.test.ts`: una cita que ya no apunta a nada. O se " +
        "corrige la cita, o se declara `sinOperacion` con su motivo escrito.",
    ).toEqual([]);
  });
});

// =================================================================================================
// FRENTE 2 — EL PRODUCTOR ESTÁ CABLEADO (R39). ÉSTE ES EL QUE LA MAQUETA NO HABRÍA PASADO.
// =================================================================================================

describe("253/R39 — y algún archivo de la superficie pública la IMPORTA Y la LLAMA", () => {
  it("cada productor se importa Y se invoca dentro de una raíz pública", () => {
    const sinCable: string[] = [];
    for (const { superficie, accionServidor, modulo } of superficiesConProductor()) {
      const importadores = FUENTES.filter((m) =>
        importaElSimbolo(m.codigo, modulo, accionServidor),
      );
      if (importadores.length === 0) {
        sinCable.push(`${superficie} → \`${accionServidor}\` (${modulo}): nadie la importa`);
        continue;
      }
      // ⭑ EL ESLABÓN QUE FALTABA EN LA 240 HASTA EL 2026-08-20: importar no es disparar.
      const invocadores = importadores.filter((m) => invocaElSimbolo(m.codigo, accionServidor));
      if (invocadores.length === 0) {
        sinCable.push(
          `${superficie} → \`${accionServidor}\` (${modulo}): la importan ` +
            `${importadores.map((m) => m.ruta).join(", ")} pero NINGUNA la llama`,
        );
      }
    }
    expect(
      sinCable,
      "una superficie PÚBLICA promete un resultado que NINGÚN archivo suyo produce: es la maqueta " +
        "de `PostularRecursoModal`, que validaba, pintaba «Postulación enviada» y no enviaba nada. " +
        "Ojo con el sabor sutil: dejar el `import` y borrar la invocación deja el formulario igual " +
        "de muerto, y el linter no lo caza porque `no-unused-vars` es un *warning*. Se arregla " +
        "CABLEANDO el formulario. Anotarlo para callar la guardia sería volver a declarar la maqueta.",
    ).toEqual([]);
  });

  it("y el que la llama es un archivo REAL, con la arista nombrada (anti-vacuidad)", () => {
    // Si `importaElSimbolo` o `invocaElSimbolo` estuvieran rotos y devolvieran `true` a ciegas, el
    // caso de arriba pasaría sin medir nada. Esto fija el mapa concreto: qué archivo DISPARA cada
    // operación pública, hoy. Se construye con el detector de INVOCACIÓN, no con el de import: si
    // alguien relajase el frente, esta lista cambiaría y habría que reescribirla a mano.
    const mapa = superficiesConProductor().map(({ accionServidor, modulo }) => {
      const invocadores = FUENTES.filter(
        (m) =>
          importaElSimbolo(m.codigo, modulo, accionServidor) &&
          invocaElSimbolo(m.codigo, accionServidor),
      ).map((m) => m.ruta);
      return `${accionServidor} ← ${invocadores.sort().join(", ")}`;
    });
    expect(mapa.sort()).toEqual([
      "consultarRastreoPublico ← app/_landing/RastreoDialog.tsx",
      "postularMensajero ← app/postulacion/_components/PostulacionForm.tsx",
      "postularRecurso ← app/_landing/PostularRecursoModal.tsx",
      "postularRecurso ← app/_landing/PostularRecursoModal.tsx",
    ]);
  });
});

// =================================================================================================
// FRENTE 3 — LA EXCUSA ES LEGIBLE Y CADUCA (R38)
// =================================================================================================

describe("253/R38 — «no produce ninguna operación» exige un motivo escrito", () => {
  it("ningún `sinOperacion` está vacío, es de relleno ni es telegráfico", () => {
    const malos = superficiesSinOperacion()
      .map(({ superficie, motivo }) => ({ superficie, falta: faltaDelMotivo(motivo) }))
      .filter(({ falta }) => falta !== "")
      .map(({ superficie, falta }) => `${superficie}: el motivo ${falta}`);
    expect(
      malos,
      "declarar que un formulario público no produce ninguna operación es una decisión, y una " +
        "decisión sin su razón escrita es la allowlist que no queríamos, con otro nombre. Misma " +
        "regla, palabra por palabra, que `@sin-superficie`.",
    ).toEqual([]);
  });

  it("hoy NINGUNA superficie pública se declara sin operación, y eso se dice en voz alta", () => {
    // No es decorativo: si mañana alguien baja una superficie a `sinOperacion` con una excusa
    // plausible, este caso cambia y obliga a mirar por qué. Un formulario público que no produce
    // nada es, por definición, una promesa sin destino.
    expect(superficiesSinOperacion()).toEqual([]);
  });
});

// =================================================================================================
// FRENTE 4 — EL CENSO INVERSO (R40). ÉSTE CAZA LA RECAÍDA CON LA EXCUSA PUESTA.
// =================================================================================================
//
// Los frentes 1 y 2 van del CENSO al árbol: lo que el censo cita, ¿existe y está cableado? Éste va
// del árbol AL CENSO: lo que la superficie pública dispara, ¿lo declara el censo?
//
// Sin él, apagar el frente 2 cuesta tres segundos: bajar la entrada a `{ sinOperacion: "…" }` con
// una excusa de más de veinte caracteres y volver a poner el `setEnviado(true)`. La operación
// seguiría en el árbol y los frentes 1 y 2 ya no tendrían nada que mirar.
describe("253/R40 — y el censo declara TODO lo que la superficie pública dispara", () => {
  it("ninguna Server Action pública se dispara sin estar declarada en el censo", () => {
    const declaradas = new Set(superficiesConProductor().map((e) => e.accionServidor));
    const huerfanas = accionesQueLaSuperficieDispara()
      .filter(({ simbolo }) => !declaradas.has(simbolo))
      .filter(({ simbolo }) => !NO_SON_SUPERFICIES_DE_ENVIO.has(simbolo))
      .map(({ simbolo, ruta }) => `${simbolo} (lo dispara ${ruta})`);
    expect(
      huerfanas,
      "una raíz pública dispara una operación que `PRODUCTOR_POR_SUPERFICIE` no declara. O es el " +
        "envío de un formulario —y entonces va en el censo— o no lo es, y entonces va en " +
        "`NO_SON_SUPERFICIES_DE_ENVIO` con su motivo escrito. Lo que no puede es no estar en " +
        "ninguna de las dos: así es como se añade un modal nuevo sin tocar el censo y se vuelve al " +
        "punto de partida.",
    ).toEqual([]);
  });

  it("y el detector VE de verdad las acciones públicas (anti-vacuidad)", () => {
    const simbolos = new Set(accionesQueLaSuperficieDispara().map((e) => e.simbolo));
    // R44: el rastreo público de la 229 queda declarado como productor REAL, no como excepción.
    for (const s of [
      "consultarRastreoPublico",
      "postularRecurso",
      "postularMensajero",
      "obtenerConteosPublicos",
    ]) {
      expect([...simbolos], s).toContain(s);
    }
    expect(simbolos.size).toBeGreaterThanOrEqual(4);
  });

  it("la lista de exentos no tiene basura: todo lo que exime, la superficie lo dispara HOY", () => {
    // La caducidad, en la dirección de los exentos. Un nombre que ya nadie importa es una excepción
    // que sobrevivió a su motivo, y crece hasta que nadie lee ninguna.
    const disparadas = new Set(accionesQueLaSuperficieDispara().map((e) => e.simbolo));
    const muertos = [...NO_SON_SUPERFICIES_DE_ENVIO].filter((s) => !disparadas.has(s));
    expect(muertos, "exentos que ya nadie importa: se borran").toEqual([]);
  });
});

// =================================================================================================
// FRENTE 5 — EL CENSO DEL ÁRBOL (R40). LA COMPENSACIÓN DE NO TENER `satisfies` EN PRODUCCIÓN.
// =================================================================================================
//
// El censo vive en `tests/`, así que nada de producción lo consume y no hay typecheck que reclame
// una superficie nueva. Lo compensa este frente: barre los archivos de las raíces públicas y exige
// que todo el que declare un formulario de envío esté apuntado por alguna entrada. Y su recíproco:
// una entrada que apunta a un archivo que ya no existe es una cita rota.
describe("253/R40 — el árbol y el censo dicen lo mismo, en las dos direcciones", () => {
  it("todo archivo público con formulario de envío está apuntado por el censo", () => {
    const censados = new Set(Object.values(ARCHIVO_POR_SUPERFICIE));
    const huerfanos = FUENTES.filter(
      (m) => declaraFormularioDeEnvio(m.codigo) && !censados.has(m.ruta),
    ).map((m) => m.ruta);
    expect(
      huerfanos,
      "hay un formulario de envío bajo una raíz pública que `ARCHIVO_POR_SUPERFICIE` no nombra. Sin " +
        "este frente, basta con añadir un modal nuevo y no tocar el censo para volver exactamente " +
        "al punto de partida: una pantalla que promete sin que nadie compruebe que produce.",
    ).toEqual([]);
  });

  it("todo archivo que el censo nombra EXISTE y sigue teniendo su formulario", () => {
    const rotos: string[] = [];
    for (const [superficie, ruta] of Object.entries(ARCHIVO_POR_SUPERFICIE)) {
      if (!existsSync(path.join(RAIZ, ruta))) {
        rotos.push(`${superficie}: \`${ruta}\` ya no existe`);
        continue;
      }
      const m = FUENTES.find((f) => f.ruta === ruta);
      if (!m) {
        rotos.push(`${superficie}: \`${ruta}\` está fuera de las raíces públicas censadas`);
        continue;
      }
      if (!declaraFormularioDeEnvio(m.codigo)) {
        rotos.push(`${superficie}: \`${ruta}\` ya no declara ningún formulario de envío`);
      }
    }
    expect(
      rotos,
      "una entrada del censo apunta a un archivo que se movió, se borró o dejó de ser un " +
        "formulario. Una excepción que sobrevive a su motivo es basura, y un censo con citas rotas " +
        "deja de ser un censo.",
    ).toEqual([]);
  });

  it("y el barrido ENCUENTRA formularios de verdad (anti-vacuidad)", () => {
    // Si `declaraFormularioDeEnvio` devolviera `false` a ciegas, los dos casos de arriba pasarían
    // sin medir nada: cero huérfanos porque cero formularios.
    const conFormulario = FUENTES.filter((m) => declaraFormularioDeEnvio(m.codigo))
      .map((m) => m.ruta)
      .sort();
    expect(conFormulario).toEqual([
      "app/_landing/PostularRecursoModal.tsx",
      "app/_landing/RastreoDialog.tsx",
      "app/postulacion/_components/PostulacionForm.tsx",
    ]);
  });
});
