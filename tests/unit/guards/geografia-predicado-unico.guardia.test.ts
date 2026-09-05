import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 374 / G2 (R11) — EL PREDICADO DE DISPONIBILIDAD NO SE REIMPLEMENTA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// LA REGLA, en una frase mecanicamente comprobable:
//
//   NINGUN archivo de `lib/` fuera de `_shared/geografia-activa.ts` puede escribir el literal
//   `activo: true` ni `activo: false`.
//
// POR QUE ASI Y NO «no reimplementes el predicado». Porque hay que poder MEDIRLO. Un `where` y un
// `select` se parecen demasiado en el texto —los dos son `{ activo: true }`— y una guardia que
// tuviera que adivinar cual es cual acabaria callandose. Prohibiendo el LITERAL, las dos formas
// pasan por el modulo compartido: los `WHERE_*_DISPONIBLE` para lo que recorta y los
// `SELECT_*`/`SELECT_FLAG_PROPIO` para lo que proyecta. El nombre del simbolo dice cual es cual,
// que es informacion que el literal no da.
//
// QUE SE PIERDE SI ESTO NO EXISTE. Un `where: { activo: true }` escrito a mano en un repositorio
// es una SEGUNDA definicion de «disponible». La que divergiera dejaria fuera —o dentro— filas del
// catalogo sin romper ningun test: exactamente el argumento que ya justifica a
// `_shared/zona-colapso.ts`, escrito por su ficha.
//
// DOS COSAS QUE ESTA GUARDIA NO HACE, y se dicen para que no se supongan:
//   - NO barre `app/`. Ahi no hay Prisma: la pantalla recibe el arbol con el flag ya proyectado y
//     un componente puede escribir `activo: true` legitimamente al montar su estado.
//   - NO distingue `activo` de OTRAS tablas. Hoy el unico `activo` booleano del esquema es el de
//     los tres niveles geograficos; `gasto_fijo_plantilla` y `webhook_suscripcion` usan `activa`,
//     en femenino, y no entran. Si algun dia naciera otro `activo`, esta guardia obligaria a pasar
//     por aqui — que es exactamente lo que se quiere.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const ARBOL = path.join(RAIZ, "lib");
const FUENTE_UNICA = "lib/repositories/_shared/geografia-activa.ts";

/**
 * EL DETECTOR. Devuelve cada literal `activo: <booleano>` encontrado, con el texto que lo rodea
 * para que el mensaje del fallo diga DONDE mirar.
 */
export function literalesDeActivoEn(codigo: string): string[] {
  return [...codigo.matchAll(/\bactivo\s*:\s*(true|false)\b/g)].map((m) => `activo: ${m[1]}`);
}

function fuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) fuentes(completo, acc);
    else if (/\.tsx?$/.test(entrada)) acc.push(completo);
  }
  return acc;
}

function relativo(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

// ---------------------------------------------------------------------------------------------
// 0 — El detector, contra respuestas conocidas
// ---------------------------------------------------------------------------------------------

describe("374/G2 — el detector se prueba a si mismo", () => {
  const CUERPO_SANO = `
    async listDistritosLite() {
      const rows = await this.prisma.distrito.findMany({
        select: { id: true, nombre: true, ...SELECT_CADENA_DISTRITO },
      });
      return rows.map((r) => ({ id: r.id, disponible: disponibleDesdeCadena(r) }));
    }`;

  it("CONTRAPRUEBA (control positivo): el cuerpo que usa el fragmento compartido NO produce hallazgos", () => {
    expect(literalesDeActivoEn(CUERPO_SANO)).toEqual([]);
  });

  it("CONTRAPRUEBA: un `where: { activo: true }` escrito A MANO se detecta", () => {
    // Es la mutacion que el design nombra: alguien «mejora» la lectura recortando en el `WHERE`.
    // El resultado compila, pasa los tests de servicio y esconde los nodos retirados.
    const mutado = CUERPO_SANO.replace(
      "select: { id: true, nombre: true, ...SELECT_CADENA_DISTRITO },",
      "where: { activo: true },\n        select: { id: true, nombre: true },",
    );
    expect(literalesDeActivoEn(mutado)).toEqual(["activo: true"]);
  });

  it("CONTRAPRUEBA: un `select` con el literal tambien se detecta", () => {
    expect(literalesDeActivoEn("select: { activo: true, nombre: true }")).toEqual(["activo: true"]);
  });

  it("CONTRAPRUEBA: `activo: false` tambien", () => {
    expect(literalesDeActivoEn("where: { activo: false }")).toEqual(["activo: false"]);
  });

  it("no confunde una DECLARACION de tipo con un literal", () => {
    // `activo: boolean` en una interfaz es lo normal y no es una reimplementacion del predicado.
    expect(literalesDeActivoEn("export interface X { activo: boolean }")).toEqual([]);
    expect(literalesDeActivoEn("activo: z.boolean(),")).toEqual([]);
  });

  it("no confunde el mapeo de un DTO con un literal", () => {
    expect(literalesDeActivoEn("return { id: d.id, activo: d.activo };")).toEqual([]);
  });

  it("no toca `activa` (femenino), que es de OTRAS tablas", () => {
    expect(literalesDeActivoEn("where: { activa: true }")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 1 — Anti-vacuidad
// ---------------------------------------------------------------------------------------------

describe("374/G2 — el barrido lee de verdad", () => {
  it("la FUENTE UNICA existe y SI contiene los literales: son suyos", () => {
    // Control positivo sobre el arbol real. Si el modulo compartido dejara de tener literales, o
    // el detector dejara de encontrarlos, el caso de abajo estaria verde por no ver nada.
    const propios = literalesDeActivoEn(codigoSinComentarios(FUENTE_UNICA));
    expect(propios.length).toBeGreaterThanOrEqual(8);
  });

  it("`lib/` tiene un numero razonable de fuentes", () => {
    expect(fuentes(ARBOL).length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------------------------
// 2 — R11: el arbol real
// ---------------------------------------------------------------------------------------------

describe("374/R11 — toda referencia al flag pasa por `_shared/geografia-activa.ts`", () => {
  it("ningun otro archivo de `lib/` escribe `activo: true` ni `activo: false`", () => {
    const hallazgos: string[] = [];
    for (const archivo of fuentes(ARBOL)) {
      const rel = relativo(archivo);
      if (rel === FUENTE_UNICA) continue;
      for (const literal of literalesDeActivoEn(codigoSinComentarios(rel))) {
        hallazgos.push(`${rel}: ${literal}`);
      }
    }
    expect(
      hallazgos,
      "el predicado de disponibilidad geografica vive en `lib/repositories/_shared/geografia-activa.ts` " +
        "y en ningun otro sitio: usa `WHERE_*_DISPONIBLE` si la consulta RECORTA, o " +
        "`SELECT_FLAG_PROPIO`/`SELECT_CADENA_*` si solo PROYECTA. Dos copias son dos reglas que un " +
        "dia divergen, y la que divergiera dejaria fuera filas del catalogo sin romper ningun test",
    ).toEqual([]);
  });
});
