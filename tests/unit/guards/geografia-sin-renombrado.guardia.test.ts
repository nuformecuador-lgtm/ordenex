import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 374 / G3 (R49) — EL CATALOGO GEOGRAFICO NO SE RENOMBRA. TODAVIA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTA FUERA DE ALCANCE, Y ESTA MEDIDO. `scripts/seed-zonas.ts` resuelve el padre por
// nombre EXACTO y, si no lo encuentra, CREA (`:109-140`). Renombrar un nodo sin una clave estable
// —`codigo_dta`, que llegara en la ficha siguiente— haria que la proxima corrida del seed creara
// un DUPLICADO ACTIVO con el nombre viejo. Y a partir de ahi `resolveGeo` responderia
// «distrito ambiguo en el canton» a TODA carga que lo mencione, porque su indice colapsa por
// `normalizeName` y encontraria dos filas.
//
// Añadir y desactivar NO corren ese riesgo, y por eso si entran en esta ficha: el seed no crea lo
// que ya existe (`findFirst` por nombre -> lo encuentra -> NO escribe) y no toca el flag de nada.
//
// El humano lo fijo como frontera el 2026-09-05: «el renombrado queda fuera».
//
// COMO SE MIDE. Se recortan los argumentos de toda escritura de Prisma sobre las tres tablas
// (`update`, `updateMany`, `upsert`) en `lib/` y se exige que NINGUNA lleve `nombre` en su `data`.
// Con CONTRAPRUEBA sobre texto mutado en memoria.
//
// ⚠️ EL `create` NO ENTRA, y es deliberado: dar de alta SI escribe el nombre —es lo que hace el
// alta de esta misma ficha—. Lo que R49 prohibe es CAMBIARLO en una fila que ya existe.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const ARBOL = path.join(RAIZ, "lib");

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

describe("374/G3 — el detector se prueba a si mismo", () => {
  const SANO = `await tx.distrito.update({ where: { id }, data: { activo } });`;

  it("CONTRAPRUEBA (control positivo): el `update` del flag NO produce hallazgos", () => {
    expect(renombradosEn(SANO)).toEqual([]);
  });

  it("CONTRAPRUEBA: un `update` que escribe `nombre` SE DETECTA", () => {
    const mutado = `await tx.distrito.update({ where: { id }, data: { nombre } });`;
    expect(renombradosEn(mutado)).toEqual(["distrito.update escribe `nombre`"]);
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

describe("374/G3 — el barrido alcanza escrituras reales", () => {
  it("hay al menos DOS escrituras sobre las tres tablas en `lib/` (el flag y `zona_especial`)", () => {
    // Control positivo: si el detector no encontrara ninguna escritura, el caso de abajo estaria
    // verde por no mirar nada.
    let escrituras = 0;
    for (const archivo of fuentes(ARBOL)) {
      escrituras += [...codigoSinComentarios(relativo(archivo)).matchAll(ESCRITURAS)].length;
    }
    expect(escrituras).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------------------------
// 2 — R49: el arbol real
// ---------------------------------------------------------------------------------------------

describe("374/R49 — ninguna escritura de `lib/` cambia el nombre de un nodo", () => {
  it("cero hallazgos en todo el arbol", () => {
    const hallazgos: string[] = [];
    for (const archivo of fuentes(ARBOL)) {
      const rel = relativo(archivo);
      for (const hallazgo of renombradosEn(codigoSinComentarios(rel))) {
        hallazgos.push(`${rel}: ${hallazgo}`);
      }
    }
    expect(
      hallazgos,
      "renombrar sin una clave estable haria que la proxima corrida de `scripts/seed-zonas.ts` " +
        "creara un duplicado ACTIVO con el nombre viejo, y a partir de ahi toda carga que lo " +
        "mencione moriria con «distrito ambiguo en el canton». Es la ficha siguiente, no esta",
    ).toEqual([]);
  });

  it("ni la interfaz ni el servicio ni la accion declaran nada que renombre", () => {
    // La otra mitad, por si alguien lo intentara sin tocar Prisma directamente.
    const superficie = [
      "lib/interfaces/repositories/IGeoRepository.ts",
      "lib/interfaces/services/IGeografiaService.ts",
      "lib/services/GeografiaService.ts",
      "lib/actions/geografia.ts",
    ];
    for (const rel of superficie) {
      const codigo = codigoSinComentarios(rel);
      expect(codigo.length, `${rel} se leyo vacio`).toBeGreaterThan(200);
      expect(codigo, `${rel} declara algo que renombra`).not.toMatch(
        /\b(renombrar|renombrarNodo|actualizarNombre|cambiarNombre)\b/i,
      );
    }
  });
});
