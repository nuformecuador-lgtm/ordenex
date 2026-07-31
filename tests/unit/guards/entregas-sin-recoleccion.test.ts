import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Feature 167 (R33/R34) — GUARD de NO-REINTRODUCCION. Molde de
// `tests/unit/guards/recoleccion-no-contamina.test.ts` (incluida su `sinComentarios`).
//
// R33 y R34 son AUSENCIAS, y las ausencias se rompen sin que nadie se entere. La 157 habia
// montado la recoleccion en tienda DENTRO del modulo de Entregas, y ahi el mensajero no la
// encontraba: el bloque de escaneo desaparecia justo cuando la lista estaba vacia, que es
// cuando iba a buscarlo. La 167 la saco a su pagina propia y dejo Entregas sin ni un rastro
// —ni lista, ni escaner, ni aviso, ni conteo, ni enlace (decision 2 del humano)—.
//
// Cualquier merge futuro que reintroduzca el panel "porque estaba antes" falla AQUI, en un
// test de un segundo, en vez de fallar en la pantalla del mensajero en la calle.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Ambito del corte limpio: los tres archivos de Entregas que montaban la recoleccion. */
const ARCHIVOS = [
  "app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx",
  "app/(app)/mis-asignaciones/page.tsx",
  "lib/services/MisAsignacionesService.ts",
] as const;

/**
 * Lo prohibido en esos tres archivos:
 * - `RecoleccionModule`: el componente del apartado, hoy en `/recoleccion` (R33). Es el NOMBRE
 *   VIVO: hasta el cierre del review vigilaba `RecoleccionTiendaPanel`, que ya no existe en el
 *   arbol, asi que ese tercio del guard protegia contra algo imposible — reintroducirlo con su
 *   nombre actual pasaba en verde (hueco m3, demostrado por mutacion y cerrado aqui).
 * - `porRecolectar`: el tercer bucket del contrato de Entregas, retirado (R33/R34).
 * - `recolectando`: el estado de la recoleccion asignada. Entregas lee EXACTAMENTE
 *   `["por_recoger","en_reparto"]`; leer este estado seria volver a arrastrar esas ordenes
 *   a los KPIs, al mapa y al filtro (R34/R36).
 */
const PROHIBIDOS = ["RecoleccionModule", "porRecolectar", "recolectando"] as const;

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * Fuente sin comentarios: se juzga lo que el codigo EJECUTA, no lo que documenta. Se quitan
 * las lineas `//` (como en `recoleccion-no-contamina.test.ts`) y ademas los bloques `/* *\/`
 * y `/** *\/`, porque el corte limpio dejo escrito EN COMENTARIO por que la recoleccion ya no
 * esta aqui — y esa explicacion es justo lo que no debe borrarse para que el guard pase.
 */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("//"))
    .join("\n");
}

describe("Feature 167 — Entregas no monta ninguna superficie de recoleccion (R33/R34)", () => {
  for (const rel of ARCHIVOS) {
    for (const prohibido of PROHIBIDOS) {
      it(`${rel} no menciona \`${prohibido}\` en codigo ejecutable`, () => {
        expect(sinComentarios(leer(rel))).not.toContain(prohibido);
      });
    }
  }

  it("la lectura de Entregas pide EXACTAMENTE los dos estados de su propio flujo (R34)", () => {
    const src = sinComentarios(leer("lib/services/MisAsignacionesService.ts"));
    const llamada = src.match(/findMisAsignaciones\(\s*actor\.usuarioId,\s*\[([^\]]*)\]/);

    expect(llamada, "no se encontro la llamada a findMisAsignaciones").not.toBeNull();
    // Dos constantes, ni una mas: la forma fuerte de R34 es que la lista sea CERRADA.
    const estados = llamada![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(estados).toEqual(["ORIGEN_RECOGER", "ESTADO_EN_REPARTO"]);
  });

  it("el guard mira archivos que EXISTEN (si se renombran, se actualiza aqui)", () => {
    // Un guard que lee un archivo inexistente pasaria en verde sin proteger nada; peor, un
    // `readFileSync` que reviente se leeria como fallo de infraestructura. Se comprueba.
    for (const rel of ARCHIVOS) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
  });

  it("el apartado de recoleccion SIGUE existiendo en su pagina propia (R1)", () => {
    // La otra mitad del corte: que Entregas no lo monte no puede significar que se perdiera.
    // Si alguien borra el apartado nuevo, este guard deja de ser una mejora y pasa a tapar
    // una regresion — el mensajero se quedaria otra vez sin forma de recolectar.
    for (const rel of [
      "app/(app)/recoleccion/page.tsx",
      "app/(app)/recoleccion/_components/RecoleccionModule.tsx",
      "app/(app)/recoleccion/_components/RecolectadasHoyLista.tsx",
      "app/(app)/recoleccion/_components/useRecolectarPorGuia.ts",
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
  });
});
