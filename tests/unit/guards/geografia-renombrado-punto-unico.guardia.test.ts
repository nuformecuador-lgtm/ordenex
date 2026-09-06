import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 375 — EL CATALOGO GEOGRAFICO SE RENOMBRA POR UN SOLO SITIO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// SUSTITUYE A `geografia-sin-renombrado.guardia.test.ts` (ficha 374 / R49), que exigia que NADIE
// escribiera `nombre` sobre `provincia`, `canton` ni `distrito`. Aquella prohibicion tenia una
// causa medida y no un principio: `scripts/seed-zonas.ts` resolvia la geografia POR NOMBRE y creaba
// lo que no encontraba, asi que un renombrado producia un duplicado ACTIVO en la siguiente corrida
// del seed y, a partir de ahi, «distrito ambiguo en el canton» en toda carga que lo mencionara.
//
// La ficha 375 quita la causa —`codigo_dta`, clave estable, y el seed cruzando por codigo— y con
// ella la prohibicion. Lo que NO desaparece es el riesgo de que el renombrado entre por la puerta
// de atras, y por eso la guardia se INVIERTE en vez de borrarse:
//
//   ⚠️ ESCRIBIR `nombre` SOBRE ESAS TRES TABLAS SOLO ES LEGAL EN `GeoRepository.renombrar`.
//
// Que protege, exactamente. Un `update` con `nombre` en cualquier otro punto de `lib/`:
//   * se saltaria la comprobacion de unicidad por clave NORMALIZADA, que vive en
//     `GeografiaService.renombrar`. El `@@unique([canton_id, nombre])` de la base compara
//     LITERALES, asi que dejaria convivir «San José» y «San Jose» — dos filas legales para Postgres
//     y UNA SOLA COSA AMBIGUA para `resolveGeo`, que indexa por `normalizeName`;
//   * y no dejaria fila en el registro de acciones, asi que nadie sabria quien cambio el nombre de
//     un territorio que aparece en ordenes y en descargas.
//
// Ninguna de las dos cosas rompe un test que no exista.
//
// COMO SE MIDE. Se recortan los argumentos de toda escritura de Prisma sobre las tres tablas
// (`update`, `updateMany`, `upsert`) en `lib/` y se exige que las que llevan `nombre` en su
// argumento esten TODAS en el archivo y el metodo declarados aqui. Con CONTRAPRUEBA sobre texto
// mutado en memoria y con CONTROL POSITIVO: si el renombrado legitimo desapareciera, el barrido
// tambien se pondria rojo (una guardia que sale verde por no encontrar nada es una guardia rota).
//
// ⚠️ EL `create` NO ENTRA, y es deliberado: dar de alta SI escribe el nombre. Lo que esta guardia
// acota es CAMBIARLO en una fila que ya existe.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const ARBOL = path.join(RAIZ, "lib");

/** El UNICO punto legal. */
const PUNTO_UNICO = "lib/repositories/GeoRepository.ts";

/** Las tres tablas, como delegado de Prisma. En minusculas y con `(?<![A-Za-z])` por `zonaDistrito`. */
const ESCRITURAS =
  /(?<![A-Za-z])(provincia|canton|distrito)\s*\.\s*(update|updateMany|upsert)\s*\(/g;

/** El bloque `{ … }` que empieza en `desde`, cerrado por llaves balanceadas. `null` si no cierra. */
function bloqueBalanceado(codigo: string, desde: number): string | null {
  const abre = codigo.indexOf("{", desde);
  if (abre === -1) return null;
  let profundidad = 0;
  for (let i = abre; i < codigo.length; i++) {
    if (codigo[i] === "{") profundidad++;
    else if (codigo[i] === "}") {
      profundidad--;
      if (profundidad === 0) return codigo.slice(abre, i + 1);
    }
  }
  return null;
}

/**
 * EL DETECTOR. Devuelve una entrada por cada escritura sobre las tres tablas cuyo argumento
 * mencione `nombre`.
 */
export function renombradosEn(codigo: string): string[] {
  const hallazgos: string[] = [];
  for (const encontrado of codigo.matchAll(ESCRITURAS)) {
    const desde = encontrado.index + encontrado[0].length - 1;
    const argumento = bloqueBalanceado(codigo, desde);
    if (argumento === null) {
      // Un argumento que no cierra es un detector roto, no una escritura sana: se REPORTA. Una
      // guardia que en la duda calla es justo la que falla.
      hallazgos.push(`${encontrado[1]}.${encontrado[2]}: el argumento no cierra`);
      continue;
    }
    if (/\bnombre\b/.test(argumento)) {
      hallazgos.push(`${encontrado[1]}.${encontrado[2]} escribe \`nombre\``);
    }
  }
  return hallazgos;
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

describe("375 — el detector se prueba a si mismo", () => {
  it("CONTRAPRUEBA (control positivo): el `update` del flag NO produce hallazgos", () => {
    expect(renombradosEn(`await tx.distrito.update({ where: { id }, data: { activo } });`)).toEqual(
      [],
    );
  });

  it("CONTRAPRUEBA: un `update` que escribe `nombre` SE DETECTA", () => {
    expect(renombradosEn(`await tx.distrito.update({ where: { id }, data: { nombre } });`)).toEqual([
      "distrito.update escribe `nombre`",
    ]);
  });

  it("CONTRAPRUEBA: tambien en `updateMany` y en `upsert`, y en los tres niveles", () => {
    expect(
      renombradosEn(`prisma.provincia.updateMany({ where: {}, data: { nombre: "X" } });`),
    ).toEqual(["provincia.updateMany escribe `nombre`"]);
    expect(
      renombradosEn(`prisma.canton.upsert({ where: {}, create: {}, update: { nombre } });`),
    ).toEqual(["canton.upsert escribe `nombre`"]);
  });

  it("el `create` del ALTA no se denuncia: dar de alta SI escribe el nombre", () => {
    expect(
      renombradosEn(`await this.prisma.distrito.create({ data: { nombre, cantonId } });`),
    ).toEqual([]);
  });

  it("`zonaDistrito.updateMany` no se denuncia: no es una de las tres tablas", () => {
    expect(renombradosEn(`await tx.zonaDistrito.updateMany({ data: { nombre } });`)).toEqual([]);
  });

  it("un argumento que no cierra se REPORTA en vez de darse por sano", () => {
    expect(renombradosEn(`prisma.distrito.update({ where: { id `)).toEqual([
      "distrito.update: el argumento no cierra",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 1 — Anti-vacuidad: el barrido SI encuentra escrituras sobre estas tablas
// ---------------------------------------------------------------------------------------------

describe("375 — el barrido alcanza escrituras reales", () => {
  it("hay al menos TRES escrituras sobre las tres tablas en `lib/` (el flag, `zona_especial` y el nombre)", () => {
    // Control positivo: si el detector no encontrara ninguna escritura, el caso de abajo estaria
    // verde por no mirar nada.
    let escrituras = 0;
    for (const archivo of fuentes(ARBOL)) {
      escrituras += [...codigoSinComentarios(relativo(archivo)).matchAll(ESCRITURAS)].length;
    }
    expect(escrituras).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------
// 2 — El renombrado existe, y esta EXACTAMENTE donde tiene que estar
// ---------------------------------------------------------------------------------------------

describe("375 — renombrar un nodo se escribe por un solo sitio", () => {
  it("el punto unico SI renombra (si dejara de hacerlo, la ficha estaria rota)", () => {
    const codigo = codigoSinComentarios(PUNTO_UNICO);
    expect(codigo.length, `${PUNTO_UNICO} se leyo vacio`).toBeGreaterThan(200);
    expect(
      renombradosEn(codigo).length,
      "GeoRepository ya no escribe `nombre`: o se movio el renombrado, o desaparecio",
    ).toBeGreaterThanOrEqual(1);
    // Y esta dentro de `renombrar`, no en cualquier otro metodo del mismo archivo.
    expect(codigo).toMatch(/async renombrar\(/);
  });

  it("NINGUN otro archivo de `lib/` escribe `nombre` sobre provincia, canton o distrito", () => {
    const hallazgos: string[] = [];
    for (const archivo of fuentes(ARBOL)) {
      const rel = relativo(archivo);
      if (rel === PUNTO_UNICO) continue;
      for (const hallazgo of renombradosEn(codigoSinComentarios(rel))) {
        hallazgos.push(`${rel}: ${hallazgo}`);
      }
    }
    expect(
      hallazgos,
      "un renombrado fuera de `GeoRepository.renombrar` se salta la unicidad por clave " +
        "NORMALIZADA (el UNIQUE de la base compara literales, y `resolveGeo` compara normalizado) " +
        "y ademas no deja fila en el registro de acciones",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: un renombrado colado en otro repositorio SE DETECTA", () => {
    // El mismo detector, sobre el cuerpo REAL de otro repositorio con una escritura inyectada.
    const real = codigoSinComentarios("lib/repositories/ZonaRepository.ts");
    expect(renombradosEn(real)).toEqual([]);
    const mutado = `${real}\nawait tx.distrito.update({ where: { id }, data: { nombre } });`;
    expect(renombradosEn(mutado)).toContain("distrito.update escribe `nombre`");
  });
});

// ---------------------------------------------------------------------------------------------
// 3 — La otra mitad: la superficie declarada
// ---------------------------------------------------------------------------------------------

describe("375 — el renombrado esta declarado en las tres capas y en ninguna mas", () => {
  it("la interfaz, el servicio y la accion lo declaran; el repositorio lo implementa", () => {
    const esperado: [string, RegExp][] = [
      ["lib/interfaces/repositories/IGeoRepository.ts", /\brenombrar\(/],
      ["lib/interfaces/services/IGeografiaService.ts", /\brenombrar\(/],
      ["lib/services/GeografiaService.ts", /async renombrar\(/],
      ["lib/actions/geografia.ts", /export async function renombrarNodoGeografico\(/],
      ["lib/repositories/GeoRepository.ts", /async renombrar\(/],
    ];
    for (const [rel, patron] of esperado) {
      const codigo = codigoSinComentarios(rel);
      expect(codigo.length, `${rel} se leyo vacio`).toBeGreaterThan(200);
      expect(codigo, `${rel} no declara el renombrado`).toMatch(patron);
    }
  });

  it("el renombrado NO toca `codigo_dta`: la clave estable no se reescribe al cambiar la etiqueta", () => {
    const codigo = codigoSinComentarios(PUNTO_UNICO);
    const cuerpo = codigo.slice(codigo.indexOf("async renombrar("));
    expect(cuerpo.length, "no se pudo recortar el cuerpo de `renombrar`").toBeGreaterThan(200);
    expect(
      cuerpo,
      "si `renombrar` escribiera `codigoDta`, la siguiente corrida del seed volveria a no " +
        "reconocer el nodo y lo duplicaria: es exactamente el defecto que esta ficha cierra",
    ).not.toMatch(/\bcodigoDta\b/);
  });
});
