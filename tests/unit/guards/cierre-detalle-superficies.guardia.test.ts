import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 264 (Q1/R30) — GUARDIA: **toda** superficie que renderice el comprobante detallado de
 * un cierre pasa la lista de órdenes sin gestionar Y su marca de registro.
 *
 * ── POR QUÉ HACE FALTA UNA GUARDIA Y NO BASTA EL TYPECHECK
 * `ordenesSinGestion` y `sinGestionRegistrado` son **opcionales** en
 * `CierreFacturaDetalleProps`, y lo son por una razón buena: una docena de dobles de test montan
 * la hoja con lo mínimo y obligarles a inventar una lista vacía no probaría nada. El precio es
 * que **el compilador no dice ni una palabra** si una pantalla de producción se las deja. El
 * resultado sería la hoja pintando la sección en el detalle del admin y callándosela en el del
 * mensajero: exactamente el arreglo a medias que corrigió la 263, y con el agravante de que la
 * pantalla del mensajero es la de quien tiene el cierre bloqueado por esas mismas órdenes.
 *
 * ── POR QUÉ RECORRE ARCHIVOS Y NO IMPORTA NADA
 * No hay nada que importar: lo que se vigila es una AUSENCIA en un JSX. Ninguna selección por
 * grafo de imports traería este archivo al ejecutar un cambio en `CierreDiaModule.tsx`
 * (`docs/verification.md`), y por eso las guardias de este repo se ejecutan SIEMPRE, también en
 * el gate rápido.
 *
 * ── LO QUE NO AFIRMA
 * Que las props lleven el valor CORRECTO. Aquí se comprueba que se pasan y de dónde salen —del
 * resultado del servidor, no de un literal—; que ese resultado traiga la lista de ESE cierre lo
 * sostienen `cierre-sin-gestion-sql-real.test.ts` (el `WHERE`) y los tests de servicio.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const APP = path.join(RAIZ, "app");

/** El componente vigilado, por su nombre de etiqueta JSX. */
const COMPONENTE = "CierreFacturaDetalle";

/** Las dos props que ninguna superficie puede omitir (R30). */
const PROPS_OBLIGATORIAS = ["ordenesSinGestion", "sinGestionRegistrado"] as const;

/** Todos los `.tsx` de `app/**`, recursivo. */
function tsxDeApp(dir: string = APP): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...tsxDeApp(completa));
    else if (entrada.name.endsWith(".tsx")) salida.push(completa);
  }
  return salida;
}

/** Un uso concreto del componente: el archivo y el texto de su etiqueta de apertura. */
interface Uso {
  archivo: string;
  etiqueta: string;
}

/**
 * Los usos de `<CierreFacturaDetalle …>` en `app/**`, con la prosa ya fuera (quitador
 * compartido, feature 209): un ejemplo dentro de un comentario no es una superficie.
 *
 * La etiqueta se corta en el primer `/>` o `>` de nivel superior, contando llaves para no
 * partirla dentro de una expresión con `{}` (las props de esta hoja las llevan casi todas).
 */
function usosEnApp(): Uso[] {
  const usos: Uso[] = [];
  for (const archivo of tsxDeApp()) {
    // El archivo que DECLARA el componente no lo renderiza: se salta por ruta, no por heurística.
    if (path.basename(archivo) === "cierre-factura.tsx") continue;
    const fuente = quitarComentarios(readFileSync(archivo, "utf8"));

    let desde = fuente.indexOf(`<${COMPONENTE}`);
    while (desde !== -1) {
      let llaves = 0;
      let i = desde;
      for (; i < fuente.length; i += 1) {
        const c = fuente[i];
        if (c === "{") llaves += 1;
        else if (c === "}") llaves -= 1;
        else if (c === ">" && llaves === 0) break;
      }
      usos.push({
        archivo: path.relative(RAIZ, archivo).replaceAll("\\", "/"),
        etiqueta: fuente.slice(desde, i + 1),
      });
      desde = fuente.indexOf(`<${COMPONENTE}`, i);
    }
  }
  return usos;
}

const USOS = usosEnApp();

describe("feature 264 — el detalle del cierre pinta la sección en TODAS sus superficies (R30)", () => {
  /**
   * Autocomprobación. Sin esto, una ruta mal resuelta o un `readdirSync` sobre una carpeta vacía
   * darían CERO usos y todos los casos de abajo pasarían en verde sin haber mirado nada — que es
   * el modo de fallo que este repo ya se ha comido varias veces.
   */
  it("el censo encuentra de verdad las superficies que montan el comprobante", () => {
    expect(
      tsxDeApp().length,
      "el barrido de `app/**` no encontró apenas archivos: está midiendo un árbol vacío",
    ).toBeGreaterThan(50);
    expect(
      USOS.length,
      "no se encontró ningún `<CierreFacturaDetalle>` en `app/**`. O el componente se renombró " +
        "—y esta guardia se quedó vigilando un nombre muerto— o el extractor está roto.",
    ).toBeGreaterThanOrEqual(2);

    // Las dos superficies conocidas, nombradas: si mañana aparece una tercera, el caso de abajo
    // la exige igual, pero esta lista deja constancia de cuáles se revisaron a mano.
    const archivos = [...new Set(USOS.map((u) => u.archivo))].sort();
    expect(archivos).toEqual([
      "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
      "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
    ]);
  });

  it.each(USOS.map((u) => [u.archivo, u] as const))(
    "%s pasa las DOS props de la sección de órdenes sin gestionar",
    (archivo, uso) => {
      // La etiqueta se cortó de verdad: si el extractor devolviera una cadena mínima, un
      // `toContain` sobre ella podría fallar por el motivo equivocado (o pasar por casualidad).
      expect(
        uso.etiqueta.length,
        `no se pudo aislar la etiqueta de <${COMPONENTE}> en ${archivo}`,
      ).toBeGreaterThan(40);

      for (const prop of PROPS_OBLIGATORIAS) {
        expect(
          uso.etiqueta,
          `${archivo} monta el comprobante detallado SIN pasarle \`${prop}\`. Las dos props son ` +
            "opcionales en el tipo por los dobles de test, así que el typecheck no caza este " +
            "olvido: la hoja pintaría la sección en una pantalla y la callaría en la otra, que " +
            "es el arreglo a medias que se corrigió en la 263 (R30).",
        ).toContain(`${prop}=`);
      }
    },
  );

  it("ninguna superficie inventa el valor: las dos props salen del detalle del servidor", () => {
    for (const uso of USOS) {
      for (const prop of PROPS_OBLIGATORIAS) {
        const valor = uso.etiqueta.match(
          new RegExp(`${prop}=\\{([^}]*)\\}`),
        )?.[1];
        expect(valor, `\`${prop}\` en ${uso.archivo} no se pasa como expresión`).toBeTruthy();
        expect(
          (valor ?? "").trim(),
          `${uso.archivo} pasa \`${prop}\` con un literal en vez del dato del servidor. Un ` +
            "`[]` o un `true` escritos a mano son exactamente la mentira que R28 prohíbe: la " +
            "pantalla diría «no hubo ninguna» sin haber preguntado.",
        ).toMatch(/^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/);
      }
    }
  });
});
