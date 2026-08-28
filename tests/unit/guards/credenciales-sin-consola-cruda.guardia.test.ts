// GUARDIA DEL ARNÉS — SIN `console.log` CRUDO EN LOS MÓDULOS QUE MANEJAN CREDENCIALES.
//
// **El incidente que la motiva.** El commit `a876418f` (feature 92, 2026-08-14) dejó en
// `lib/clients/google-route-optimization.ts:154` un `console.log('optimizer***: token', token, url)`
// de depuración olvidado: imprimía el `access_token` OAuth2 EN CLARO y la URL (que lleva el
// `projectId` del proyecto GCP) en los logs de runtime de Vercel. Entró en `dev` y llegó hasta
// `prod` sin que nada lo cazara: no rompía ningún test, no lo veía `eslint`, y el propio archivo
// ya tenía a un metro de distancia (línea 147, hoy 146) el canal correcto —`describirToken(token)`
// de `lib/logging/optimizer-log.ts`, que dice `{ token: "PRESENTE", longitud: N }` y nunca el
// valor— así que la contradicción estaba delante de cualquiera que leyera el archivo entero, y
// nadie lo hizo. Hotfix a `prod`: se retiró la línea (commit de este mismo PR).
//
// **Por qué la regla es de carpeta y no de archivo.** El archivo que falló hoy no es el único que
// toca una credencial. `lib/clients/**` habla con proveedores externos (Google, WhatsApp, un
// webhook saliente) y `lib/auth/**` obtiene y valida tokens (ADC, Service Account, WIF, la sesión
// de la cookie). Las DOS carpetas comparten la misma exposición —un secreto que viaja por HTTP o
// por variable de entorno y que un `console.log` de depuración vuelca al log de la plataforma,
// legible por cualquiera con acceso al proyecto de Vercel— y las DOS tienen ya su canal de log con
// redacción (`optlog`/`opterror` de `lib/logging/optimizer-log.ts`, que jamás imprime el token
// entero: solo si llegó y cuántos caracteres mide). Un `console.log` crudo en cualquier módulo
// futuro de estas dos carpetas es la MISMA clase de error que el del incidente, y esta guardia lo
// cierra por carpeta para no depender de que alguien recuerde el caso concreto.
//
// **Alcance deliberado: `console.log`, no `console` a secas.** El encargo de este hotfix pide
// específicamente cerrar `console.log`; se implementa así, literal, para no ampliar un hotfix de
// seguridad a producción con una regla más ancha de la pedida. Queda escrito el hueco que deja: un
// `console.error(token)` o un `console.warn(url)` en estas mismas carpetas escaparían a esta
// guardia y serían igual de peligrosos. Medido en el árbol de este hotfix: HOY no hay ni un solo
// `console.error`/`warn`/`info`/`debug` en `lib/clients/**` ni en `lib/auth/**` (todo lo que no es
// `console.log` en esas carpetas ya pasa por `optlog`/`opterror`), así que ampliar la prohibición a
// `console` completo no rompería nada — pero es una decisión de alcance para otra ficha, no para
// este hotfix acotado.
//
// **La excepción conocida, y por qué se queda fuera de este hotfix.**
// `lib/clients/whatsapp-cloud.ts` tiene un `console.log` propio (línea ~415) que imprime la URL de
// la colección de plantillas de WhatsApp, con el `wabaId` interpolado. El `wabaId` es un
// identificador de cuenta de negocio de Meta, no una credencial reutilizable: quien lo lee no
// puede autenticarse con él. Es una infracción real de la MISMA regla (`console.log` crudo en
// `lib/clients/`) pero de severidad menor que un `access_token`, y no es la que motiva este hotfix
// de seguridad a producción. Se anota como EXCEPCIÓN explícita (con motivo, verificada por esta
// misma guardia) en vez de excluirse en silencio o arreglarse aquí: así la guardia queda ROJA para
// cualquier `console.log` NUEVO en el árbol vigilado, y esta única línea histórica queda citada
// por su nombre para que otra ficha la retire.
//
// **El censo se DESCUBRE del árbol** (recorrido de `lib/clients/` y `lib/auth/`, no una lista
// escrita a mano): un módulo nuevo de cualquiera de las dos carpetas entra solo al barrido. El
// control de no-vacuidad de abajo evita que un `ARBOLES` mal escrito, o que las carpetas se muevan,
// dejen esta guardia en verde por no haber mirado nada.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo, sin estar registrada en
// ninguna lista.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { lineasSinComentarios } from "../../fixtures/sin-comentarios";

const RAIZ = path.resolve(__dirname, "../../..");

// =================================================================================================
// Censo — descubierto del árbol, con control de no-vacuidad
// =================================================================================================

/** Las dos carpetas que manejan credenciales (design de este hotfix). */
const CARPETAS = ["lib/clients", "lib/auth"] as const;

const EXTENSION_FUENTE = /\.(ts|tsx)$/;

function listarFuentes(dir: string, acumulado: string[] = []): string[] {
  if (!existsSync(dir)) return acumulado;
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acumulado);
    else if (EXTENSION_FUENTE.test(entrada.name)) acumulado.push(completo);
  }
  return acumulado;
}

interface Modulo {
  ruta: string;
  /** Sin comentarios, pero con el MISMO número de líneas que el archivo original: el índice
   *  `i` de este array es la línea `i + 1` del archivo, que es lo que se reporta en un hallazgo. */
  lineas: string[];
}

const MODULOS: Modulo[] = CARPETAS.flatMap((carpeta) => listarFuentes(path.join(RAIZ, carpeta)))
  .map((completo) => ({
    ruta: path.relative(RAIZ, completo).split(path.sep).join("/"),
    lineas: lineasSinComentarios(readFileSync(completo, "utf8")),
  }))
  .sort((a, b) => a.ruta.localeCompare(b.ruta));

function moduloDe(ruta: string): Modulo {
  const m = MODULOS.find((x) => x.ruta === ruta);
  if (!m) throw new Error(`guardia credenciales-sin-consola-cruda: \`${ruta}\` no está en el censo`);
  return m;
}

// =================================================================================================
// El detector
// =================================================================================================

/** `console.log(`, con cualquier espacio alrededor del punto o de los paréntesis. No caza
 *  `console.error`/`warn`/`info`/`debug` — ver el porqué del alcance en la cabecera. */
const CONSOLE_LOG = /\bconsole\s*\.\s*log\s*\(/;

interface Hallazgo {
  ruta: string;
  linea: number; // 1-based
}

function hallazgosDe(modulos: Modulo[]): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const { ruta, lineas } of modulos) {
    lineas.forEach((linea, i) => {
      if (CONSOLE_LOG.test(linea)) salida.push({ ruta, linea: i + 1 });
    });
  }
  return salida;
}

function claveDe(h: Hallazgo): string {
  return `${h.ruta}:${h.linea}`;
}

// =================================================================================================
// La ÚNICA excepción, con motivo y verificada: ver la cabecera.
// =================================================================================================

const EXCEPCIONES: Record<string, string> = {
  "lib/clients/whatsapp-cloud.ts:415":
    "loguea la URL de la colección de plantillas de WhatsApp, con el `wabaId` interpolado. Es un " +
    "identificador de cuenta de Meta, no una credencial reutilizable (a diferencia del " +
    "`access_token` OAuth2 del incidente que motiva esta guardia): severidad menor. Queda fuera " +
    "del hotfix de seguridad a producción a propósito, para no ampliar su alcance; se cita aquí " +
    "para que otra ficha la retire.",
};

// =================================================================================================
// 0 — Control de no-vacuidad: el censo se recorrió de verdad
// =================================================================================================

describe("0 — el censo de lib/clients y lib/auth no está vacío", () => {
  it("se encontraron módulos de las dos carpetas y ninguno vino vacío", () => {
    // Medido en este árbol: 7 archivos en lib/clients + 9 en lib/auth = 16. El umbral se deja
    // con margen para no reventar por un archivo de más o de menos.
    expect(MODULOS.length, "el recorrido de lib/clients y lib/auth no encontró nada").toBeGreaterThanOrEqual(
      10,
    );
    expect(MODULOS.some((m) => m.ruta.startsWith("lib/clients/"))).toBe(true);
    expect(MODULOS.some((m) => m.ruta.startsWith("lib/auth/"))).toBe(true);
    for (const m of MODULOS) {
      expect(m.lineas.join("\n").trim().length, `${m.ruta} quedó vacío tras quitar comentarios`).toBeGreaterThan(
        0,
      );
    }
  });

  it("CONTROL POSITIVO: el archivo del incidente sigue en el censo y ya NO tiene el console.log", () => {
    const modulo = moduloDe("lib/clients/google-route-optimization.ts");
    expect(
      hallazgosDe([modulo]),
      "el `console.log(token, url)` del incidente (commit a876418f) sigue presente: el hotfix no " +
        "se aplicó",
    ).toEqual([]);
    // Y el canal correcto sigue ahí: si esto desapareciera, el archivo dejó de describir el token.
    expect(modulo.lineas.join("\n")).toContain("describirToken(token)");
  });

  it("cada excepción declarada sigue existiendo, en la línea que dice, con un console.log real", () => {
    // Una excepción sin motivo vivo es la allowlist que este repo evita: si el archivo se movió,
    // la línea cambió o el console.log ya no está, esta guardia obliga a podar la excepción en vez
    // de arrastrarla indefinidamente.
    for (const clave of Object.keys(EXCEPCIONES)) {
      const [ruta, lineaTexto] = clave.split(":");
      const modulo = MODULOS.find((m) => m.ruta === ruta);
      expect(modulo, `la excepción \`${clave}\` ya no existe en el árbol: sobra, hay que podarla`).toBeDefined();
      const numeroLinea = Number(lineaTexto);
      const contenido = (modulo as Modulo).lineas[numeroLinea - 1] ?? "";
      expect(
        CONSOLE_LOG.test(contenido),
        `la excepción \`${clave}\` ya no tiene un console.log en esa línea: sobra, hay que podarla`,
      ).toBe(true);
    }
  });
});

// =================================================================================================
// CONTRAPRUEBA — el detector caza lo que tiene que cazar, y no confunde el canal correcto
// =================================================================================================

describe("CONTRAPRUEBA — el detector no está roto", () => {
  it("CONSOLE_LOG reconoce console.log en sus formas comunes, y no confunde optlog/console.error", () => {
    expect(CONSOLE_LOG.test("console.log('x')")).toBe(true);
    expect(CONSOLE_LOG.test("console.log(token, url)")).toBe(true);
    expect(CONSOLE_LOG.test("  console . log(  'x'  )")).toBe(true); // espaciado atípico
    expect(CONSOLE_LOG.test("console.error('x')")).toBe(false);
    expect(CONSOLE_LOG.test("console.warn('x')")).toBe(false);
    expect(CONSOLE_LOG.test("optlog('paso', { token })")).toBe(false);
    expect(CONSOLE_LOG.test("opterror('paso', error)")).toBe(false);
  });

  it("hallazgosDe localiza la línea exacta (1-based) de un console.log inyectado en un módulo real", () => {
    const real = moduloDe("lib/auth/google-sa-token.ts");
    const lineasConInyeccion = [...real.lineas];
    lineasConInyeccion.splice(5, 0, "console.log('token', token)");

    expect(hallazgosDe([real])).toEqual([]);
    expect(hallazgosDe([{ ruta: real.ruta, lineas: lineasConInyeccion }])).toEqual([
      { ruta: real.ruta, linea: 6 },
    ]);
  });

  it("un console.log fuera de la lista de excepciones queda SIN cubrir por claveDe", () => {
    const hallazgo: Hallazgo = { ruta: "lib/auth/google-sa-token.ts", linea: 999 };
    expect(EXCEPCIONES[claveDe(hallazgo)]).toBeUndefined();
    const conocida: Hallazgo = { ruta: "lib/clients/whatsapp-cloud.ts", linea: 415 };
    expect(EXCEPCIONES[claveDe(conocida)]).toBeDefined();
  });
});

// =================================================================================================
// La regla — ningún console.log crudo en lib/clients/** ni en lib/auth/**, salvo la excepción citada
// =================================================================================================

describe("credenciales — ningún console.log crudo en lib/clients/ ni en lib/auth/", () => {
  it("ningún módulo de las dos carpetas llama a console.log fuera de la excepción declarada", () => {
    const hallazgos = hallazgosDe(MODULOS)
      .map((h) => ({ ...h, clave: claveDe(h) }))
      .filter((h) => EXCEPCIONES[h.clave] === undefined);

    expect(
      hallazgos.map((h) => h.clave),
      "estos módulos manejan credenciales (`lib/clients/**` habla con proveedores externos, " +
        "`lib/auth/**` obtiene y valida tokens) y ya tienen su canal de log con redacción " +
        "(`optlog`/`opterror` de `lib/logging/optimizer-log.ts`). Un `console.log` crudo aquí es " +
        "la misma clase de fuga que imprimió el access_token OAuth2 en producción el 2026-08-14 " +
        "(commit a876418f, `lib/clients/google-route-optimization.ts:154`). Usa `optlog`/`opterror`," +
        " o si el dato es de verdad seguro de imprimir, documenta por qué junto a la línea y añade " +
        "la excepción aquí con su motivo.",
    ).toEqual([]);
  });
});
