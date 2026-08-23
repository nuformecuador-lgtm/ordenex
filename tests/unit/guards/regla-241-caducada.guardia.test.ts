import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * FEATURE 271 (T8.2, R51) — GUARDIA: LA PROSA DE LA REGLA CADUCADA NO SOBREVIVE EN `lib/`.
 *
 * POR QUE EXISTE. El 2026-08-20 la feature 241 firmó una regla —«RECIBIR ASIGNACIONES NUNCA se
 * bloquea»— y la escribió en NUEVE sitios del árbol. El 2026-08-23 el humano revirtió esa mitad.
 * Un comentario que afirma una regla derogada no es ruido: es la instrucción que el próximo lector
 * va a seguir, y este repo tiene la lección escrita —«la prosa de este repo miente más que su
 * código, y nada la vigila»—. Esta guardia es lo que la vigila.
 *
 * RECORRE EL ÁRBOL DE ARCHIVOS, no el grafo de imports: por eso ningún `vitest --changed` la
 * selecciona por relación y por eso el gate corre TODAS las guardias siempre.
 *
 * ⚠️ ALCANCE DECLARADO: `lib/` — la capa que esta pasada de BACKEND toca. `app/` queda FUERA a
 * propósito y con fecha: `CierreDiaModule.tsx` conserva su copia del aviso con la frase caducada
 * («Sí puedes seguir recibiendo asignaciones…»), y quien la retira es la tarea **T9.1** de la
 * pasada de frontend, que sustituye esa copia por `avisoBloqueo(detalle, { conCta: false })`.
 * Cuando eso ocurra, `RAICES` pasa a incluir `app` y esta guardia cubre R51 entero. Dejarlo
 * escrito aquí es la diferencia entre una ausencia DECIDIDA y un olvido.
 */

/** Las frases que la ficha 271 deroga. Cada una estuvo VIVA en el árbol hasta el 2026-08-23. */
const FRASES_CADUCADAS: { patron: RegExp; porque: string }[] = [
  {
    patron: /NUNCA se bloquea/i,
    porque: "la regla 2 de la 241 («recibir asignaciones NUNCA se bloquea») quedó revertida",
  },
  {
    patron: /seguir recibiendo asignaciones/i,
    porque: "prometía al mensajero una actividad que el servidor ahora rechaza",
  },
  {
    patron: /recibir asignaciones no se bloquea/i,
    porque: "es la misma afirmación derogada, dicha en minúsculas",
  },
  {
    patron: /recibir trabajo no se bloquea/i,
    porque: "es la variante que vivía en `asignarRecoleccion` (Q1 la revirtió)",
  },
  {
    patron: /seguir recogiendo en tiendas/i,
    porque: "la recolección TAMBIÉN se bloquea desde Q1 (2026-08-23)",
  },
];

/** Raíces que la guardia censa. Ver el aviso de alcance de la cabecera. */
const RAICES = ["lib"];

const EXTENSIONES = [".ts", ".tsx"];

function archivosDe(raiz: string): string[] {
  const salida: string[] = [];
  const pila = [raiz];
  while (pila.length > 0) {
    const dir = pila.pop() as string;
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        if (entrada === "node_modules" || entrada === ".next") continue;
        pila.push(ruta);
        continue;
      }
      if (EXTENSIONES.some((e) => entrada.endsWith(e))) salida.push(ruta);
    }
  }
  return salida;
}

describe("271/T8.2 · guardia — la regla firmada el 2026-08-20 no sobrevive en `lib/` (R51)", () => {
  const archivos = RAICES.flatMap(archivosDe);

  it("el censo encuentra archivos (si no, la guardia no estaría midiendo nada)", () => {
    // Anti-vacuidad: una guardia que recorre cero archivos pasa siempre.
    expect(archivos.length).toBeGreaterThan(100);
  });

  it.each(FRASES_CADUCADAS.map((f) => [f.patron.source, f.patron, f.porque] as const))(
    "ninguna línea de `lib/` dice «%s»",
    (_fuente, patron, porque) => {
      const culpables: string[] = [];
      for (const archivo of archivos) {
        const lineas = readFileSync(archivo, "utf8").split("\n");
        lineas.forEach((linea, i) => {
          if (patron.test(linea)) culpables.push(`${archivo}:${i + 1}  ${linea.trim()}`);
        });
      }
      expect(
        culpables,
        `Frase CADUCADA por la feature 271 (${porque}).\n` +
          `La regla vigente: LIBRE si N<=1 y V=0; en cualquier otro caso BLOQUEADO para gestionar,\n` +
          `cobrar Y recibir trabajo nuevo —reparto Y recolección—.\n` +
          `Reescribe estas líneas, no borres la guardia:\n${culpables.join("\n")}`,
      ).toEqual([]);
    },
  );

  it("y la regla NUEVA sí está escrita donde vive el predicado (no basta con borrar la vieja)", () => {
    // Borrar una frase caducada sin poner la nueva deja al lector sin regla, que es peor: la
    // deduciría del código, y el código no dice POR QUÉ.
    const fuente = readFileSync("lib/utils/bloqueo-cierre.ts", "utf8");
    expect(fuente).toMatch(/2026-08-23/);
    expect(fuente).toMatch(/LIBRE si N <= 1 Y V = 0/i);
    // Y dice qué parte de la 241 sobrevive, que es la mitad que se pierde al revertir a lo bruto.
    expect(fuente).toMatch(/SOBREVIVE/);
  });
});
