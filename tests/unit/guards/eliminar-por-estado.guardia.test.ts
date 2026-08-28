import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// GUARDIA DEL ARNÉS — FICHA 319: EL CRITERIO DE ELIMINACIÓN, UNA SOLA FUENTE.
//
// **El defecto que la motiva, medido.** El 2026-08-28 había CERO órdenes eliminables de 429
// vivas en producción. El predicado exigía DOS condiciones a la vez —cero transiciones
// posteriores a la creación en el historial Y estado dentro de `ESTADOS_CREACION`— y generar la
// guía rompe las dos de un golpe: añade una fila de historial *y* mueve la orden a
// `en_bodega_central`. En cuanto una orden se numeraba, dejaba de poder borrarse para siempre.
// La ventana no era estrecha: estaba vacía.
//
// **Por qué hace falta una guardia estática y no bastan los tests de comportamiento.** Los
// tests de `eliminar-orden-service` y `eliminar-criterio-unico` miden lo que los servicios
// RESPONDEN, y eso cubre casi todo. Lo que no pueden ver es la reintroducción del conteo de
// transiciones *por una vía que ellos no alimentan*: si alguien vuelve a inyectar el historial
// —por ejemplo como dependencia opcional— los dobles de esas suites no le pasan ninguna, el
// criterio viejo no se dispara en el test y todo sigue verde mientras producción vuelve al
// agujero. Aquí se afirma la ESTRUCTURA: estos dos servicios no consultan el historial para
// decidir un borrado, y no declaran su propia lista de estados.
//
// **Las tres mutaciones con las que se verificó, medidas el 2026-08-28 sobre las 6 suites de la
// ficha (158 casos) y restauradas después:**
//   (a) meter `en_reparto` en `ESTADOS_ELIMINABLES` -> **5 rojos** en 3 archivos, ninguno aquí:
//       lo cazan los tests de comportamiento y el contrato literal. Esta guardia no lo ve, y no
//       tiene por qué: la lista es legítima donde está.
//   (b) volver a exigir el conteo de transiciones. Se probó en sus DOS formas:
//         · sigilosa (dependencia OPCIONAL + cableada en la Server Action, que es como volvería
//           de verdad sin que nadie se dé cuenta) -> **2 rojos, LOS DOS AQUÍ**. Las otras cinco
//           suites pasaron verdes: sus dobles no inyectan historial, así que el criterio viejo
//           no llega a dispararse. Ésta es la razón de existir de esta guardia.
//         · burda (dependencia requerida) -> 76 rojos + 3 errores de `typecheck`.
//   (c) darle al listado su propia lista de estados -> **4 rojos**: 1 aquí (R-B) y 3 de
//       comportamiento en `eliminar-criterio-unico` y `orden-service`.
//
// **Por qué el detector se auto-prueba.** Una guardia estática rota no falla: calla. Si el
// `readFileSync` apuntara a un archivo que ya no existe con el nombre esperado, o si el
// quitador de comentarios se comiera el archivo entero, todos los `not.toContain` pasarían
// encontrando la nada. Por eso el bloque 0 comprueba, contra respuestas conocidas, que el
// detector lee de verdad y que el quitador conserva el código y borra los comentarios.
//
// La lectura es ESTÁTICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

const ARCHIVOS = {
  autoriza: "lib/services/EliminarOrdenService.ts",
  ofrece: "lib/services/OrdenService.ts",
  // FICHA 320 (2026-08-28): el TERCER consumidor del criterio, el del canal por API key. Entra en
  // esta guardia el mismo día que nace, y por el motivo de siempre: es un servicio DISTINTO —su
  // autorización no se parece en nada a la de la app, que corta por rol `maestro` y no acota por
  // tienda— pero la pregunta «¿este estado admite borrado?» tiene que responderla EL MISMO sitio.
  // Si divergieran, la API aceptaría lo que la pantalla rechaza sobre la misma orden.
  apiBorra: "lib/services/ApiOrdenEliminacionService.ts",
  lista: "lib/types/order-status-eliminables.ts",
  dto: "lib/types/orden.ts",
} as const;

/** Los cuatro `value` de la decisión del humano, escritos a mano (no importados de `lib/`). */
const ESTADOS_DE_LA_DECISION = [
  "en_preparacion",
  "por_recolectar_en_tienda",
  "recolectando",
  "en_bodega_central",
] as const;

function leer(rel: string): string {
  return readFileSync(path.join(RAIZ, rel), "utf8");
}

/**
 * Quita comentarios de bloque y de línea. Sin esto la guardia sería inservible: los motivos de
 * la decisión están ESCRITOS en esos archivos y nombran los estados uno por uno, que es
 * exactamente lo que se quiere (`docs/conventions.md`: el motivo junto al código). Lo que se
 * prohíbe es que aparezcan en el CÓDIGO.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("guardia 319 / el criterio de eliminación tiene UNA sola fuente", () => {
  // --- 0. AUTOCOMPROBACIÓN DEL DETECTOR --------------------------------------------------
  describe("0 · el detector lee de verdad", () => {
    it.each(Object.entries(ARCHIVOS))("%s existe y no está vacío", (_clave, rel) => {
      expect(leer(rel).length).toBeGreaterThan(500);
    });

    it("el quitador de comentarios conserva el código y borra los comentarios", () => {
      const muestra = [
        "// esto es en_reparto en un comentario",
        "/* y esto tambien: en_reparto */",
        'const x = "en_bodega_central";',
      ].join("\n");
      const limpio = soloCodigo(muestra);
      expect(limpio).toContain('"en_bodega_central"');
      expect(limpio).not.toContain("en_reparto");
    });

    it("control POSITIVO: el módulo de la lista sí declara los cuatro estados en su código", () => {
      // Si esto fallara, los `not.toContain` de abajo estarían pasando por no encontrar nada.
      const codigo = soloCodigo(leer(ARCHIVOS.lista));
      for (const estado of ESTADOS_DE_LA_DECISION) {
        expect(codigo).toContain(`"${estado}"`);
      }
    });
  });

  // --- R-A · el conteo de transiciones NO vuelve -----------------------------------------
  describe("R-A · ningún servicio decide un borrado consultando el historial", () => {
    it.each([
      ["el que AUTORIZA", ARCHIVOS.autoriza],
      ["el que OFRECE el botón", ARCHIVOS.ofrece],
      ["el que BORRA por API", ARCHIVOS.apiBorra],
    ])("%s no menciona `idsConGestionPosteriorEnLote` en su código", (_quien, rel) => {
      // El criterio retirado. Su método sigue vivo en `IOrdenHistorialService` (deuda declarada
      // allí, sin consumidores): lo que no puede volver es a decidir un borrado.
      expect(soloCodigo(leer(rel))).not.toContain("idsConGestionPosteriorEnLote");
    });

    it("el service del borrado recibe UNA sola dependencia", () => {
      // Que no vuelva por la puerta de atrás: una segunda dependencia inyectada aquí sería, a
      // día de hoy, el historial otra vez.
      const codigo = soloCodigo(leer(ARCHIVOS.autoriza));
      expect(codigo).toContain("constructor(private readonly repo: EliminarOrdenRepo)");
      expect(codigo).not.toContain("historial");
    });
  });

  // --- R-B · una sola lista, y vive en su módulo -----------------------------------------
  describe("R-B · la lista no se copia ni se toma prestada de otra", () => {
    it.each([
      ["el que AUTORIZA", ARCHIVOS.autoriza],
      ["el que OFRECE el botón", ARCHIVOS.ofrece],
      ["el que BORRA por API", ARCHIVOS.apiBorra],
    ])("%s pregunta por `esEstadoEliminable`, no por una lista propia", (_quien, rel) => {
      const codigo = soloCodigo(leer(rel));
      expect(codigo).toContain("esEstadoEliminable");
      expect(codigo).toContain('from "@/lib/types/order-status-eliminables"');
      for (const estado of ESTADOS_DE_LA_DECISION) {
        // Un `value` literal en el código de un servicio es el primer paso de la divergencia.
        expect(codigo).not.toContain(`"${estado}"`);
      }
    });

    it.each([
      ["el que AUTORIZA", ARCHIVOS.autoriza],
      ["el que OFRECE el botón", ARCHIVOS.ofrece],
      ["el que BORRA por API", ARCHIVOS.apiBorra],
    ])("%s NO reutiliza `ESTADOS_CREACION` para decidir el borrado", (_quien, rel) => {
      // El atajo tentador, y el que hay que impedir: `ESTADOS_CREACION` también valida que una
      // orden NACE en un estado legal (`registrar-cambio-estado.ts`) y define métricas
      // (`lib/analytics/metrics.ts`). Ampliarla haría legal nacer en `en_bodega_central`.
      expect(soloCodigo(leer(rel))).not.toContain("ESTADOS_CREACION");
    });
  });

  // --- R-C · el campo del DTO no miente ---------------------------------------------------
  describe("R-C · el nombre del campo dice lo que el campo hace", () => {
    it.each([
      ["el DTO", ARCHIVOS.dto],
      ["el que OFRECE el botón", ARCHIVOS.ofrece],
      ["la pantalla", "app/(app)/ordenes/_components/OrdenesListado.tsx"],
    ])("%s ya no expone `sinGestion` para esto", (_quien, rel) => {
      // Se llamaba así cuando el criterio era «no tiene gestión». Hoy significa «está en un
      // estado que admite borrado»; dejar el nombre viejo haría que el próximo lector dedujera
      // la regla equivocada, que es el modo de fallo más caro de esta ficha.
      expect(soloCodigo(leer(rel))).not.toContain("sinGestion");
    });

    it("el DTO declara `eliminable`", () => {
      expect(soloCodigo(leer(ARCHIVOS.dto))).toContain("eliminable?: boolean");
    });
  });
});
