import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * FICHA 368 (T8) — GUARDIA: LOS DOS MODALES DE ASIGNACIÓN COMPARTEN EL VOCABULARIO DE
 * MOTIVO -> MENSAJE, NUNCA UNO PROPIO COPIADO.
 *
 * `mensajeDireccionPorMotivo` (R11) traduce el `motivo` de una orden bloqueada por el gate de
 * asignabilidad por coordenadas (feature 92) a un mensaje de usuario. R5 exige el MISMO criterio
 * y el MISMO vocabulario en la bodega central y en la satélite — y eso solo está garantizado si
 * los dos modales IMPORTAN la función de un único sitio. Si alguno definiera su propio mapa
 * motivo->mensaje (copiando los literales), los dos textos podrían divergir en silencio el día
 * que `MOTIVO_A_MENSAJE` cambie en `geocodificacion-motivo-messages.ts` y nadie actualice la
 * copia — exactamente el defecto que este guardia convierte en rojo.
 *
 * Lee el CÓDIGO REAL de los dos archivos (no una copia de su texto): un `grep` de este mismo
 * archivo citando los literales prohibidos pasaría por casualidad; leer el árbol no.
 */

const RAIZ = path.resolve(__dirname, "../../..");

const RUTA_BODEGA = "app/(app)/ordenes/_components/AsignarBodegaModal.tsx";
const RUTA_SATELITE = "app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx";
const MODULO_COMPARTIDO = "@/app/(app)/_components/geocodificacion-motivo-messages";

/** Los cinco motivos literales que emite el gate de coordenadas (feature 92, R6 de la 368). */
const MOTIVOS_DEL_GATE = [
  "direccion_no_geocodificable",
  "geocodificacion_agotada",
  "geocodificacion_en_curso",
  "geocodificacion_encolada",
  "geocodificacion_no_encolable",
] as const;

function leer(rutaRelativa: string): string {
  return readFileSync(path.join(RAIZ, rutaRelativa), "utf8");
}

/**
 * El módulo del que un archivo importa `mensajeDireccionPorMotivo`, o `null` si no lo importa.
 * Exige que el nombre viaje DENTRO de las llaves de un `import { ... } from "...";` — así una
 * mención suelta en un comentario no cuenta como import real.
 */
function moduloDeImport(codigo: string, nombreImportado: string): string | null {
  const patron = new RegExp(
    `import\\s*\\{[^}]*\\b${nombreImportado}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`,
  );
  const match = codigo.match(patron);
  return match ? match[1]! : null;
}

describe("368/T8 — AsignarBodegaModal y AsignarSateliteModal importan mensajeDireccionPorMotivo del MISMO módulo", () => {
  it("AsignarBodegaModal.tsx importa mensajeDireccionPorMotivo de geocodificacion-motivo-messages", () => {
    const modulo = moduloDeImport(leer(RUTA_BODEGA), "mensajeDireccionPorMotivo");
    expect(modulo).toBe(MODULO_COMPARTIDO);
  });

  it("AsignarSateliteModal.tsx importa mensajeDireccionPorMotivo del MISMO módulo", () => {
    const modulo = moduloDeImport(leer(RUTA_SATELITE), "mensajeDireccionPorMotivo");
    expect(modulo).toBe(MODULO_COMPARTIDO);
  });

  it("los dos importan EXACTAMENTE el mismo módulo — ninguno lo trae de otro sitio", () => {
    const deBodega = moduloDeImport(leer(RUTA_BODEGA), "mensajeDireccionPorMotivo");
    const deSatelite = moduloDeImport(leer(RUTA_SATELITE), "mensajeDireccionPorMotivo");

    // No-vacuidad: si alguno no importara la función, esto ya habría fallado en los dos casos
    // de arriba, pero se repite aquí para que ESTA aserción no pase por comparar dos `null`.
    expect(deBodega).not.toBeNull();
    expect(deSatelite).not.toBeNull();

    expect(deBodega).toBe(deSatelite);
  });

  it("ninguno de los dos declara su PROPIO mapa motivo->mensaje: los cinco literales del gate no aparecen como string en el modal", () => {
    for (const ruta of [RUTA_BODEGA, RUTA_SATELITE]) {
      const codigo = leer(ruta);
      for (const motivo of MOTIVOS_DEL_GATE) {
        const comoStringDoble = codigo.includes(`"${motivo}"`);
        const comoStringSimple = codigo.includes(`'${motivo}'`);
        expect(
          comoStringDoble || comoStringSimple,
          `${ruta} no debe citar el literal "${motivo}" — el mapeo vive SOLO en geocodificacion-motivo-messages.ts`,
        ).toBe(false);
      }
    }
  });

  it("CONTRAPRUEBA: el detector SÍ caza un import de OTRO módulo (import ajeno, no import ausente)", () => {
    const importAjeno = `import { mensajeDireccionPorMotivo } from "./motivo-messages-copiado";`;
    const modulo = moduloDeImport(importAjeno, "mensajeDireccionPorMotivo");

    expect(modulo).toBe("./motivo-messages-copiado");
    expect(modulo).not.toBe(MODULO_COMPARTIDO);
  });

  it("CONTRAPRUEBA: el detector devuelve null cuando la función NO se importa en absoluto", () => {
    const sinImport = `const x = 1;\nfunction foo() { return "mensajeDireccionPorMotivo"; }`;
    expect(moduloDeImport(sinImport, "mensajeDireccionPorMotivo")).toBeNull();
  });

  it("CONTRAPRUEBA: el barrido de literales SÍ caza un mapa propio copiado con los motivos del gate", () => {
    const literalPropioCopiado = [
      `const MOTIVO_A_MENSAJE_LOCAL = new Map([`,
      `  ["direccion_no_geocodificable", "Dirección no encontrada"],`,
      `  ["geocodificacion_agotada", "Dirección no encontrada"],`,
      `]);`,
    ].join("\n");

    const cazados = MOTIVOS_DEL_GATE.filter(
      (motivo) =>
        literalPropioCopiado.includes(`"${motivo}"`) ||
        literalPropioCopiado.includes(`'${motivo}'`),
    );
    expect(cazados).toEqual(["direccion_no_geocodificable", "geocodificacion_agotada"]);
  });
});
