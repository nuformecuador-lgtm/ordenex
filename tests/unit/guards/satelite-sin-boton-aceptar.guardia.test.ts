import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { SIDEBAR_ITEMS } from "@/lib/auth/menu-visibility";

// Feature 278 (T5.1, R30/R31/R32/R33/R34/R35) — GUARD de NO-REINTRODUCCION del botón de
// recepción del `adminSatelite`. Molde: `tests/unit/guards/entregas-sin-recoleccion.test.ts`.
//
// QUÉ VIGILA, Y POR QUÉ HACE FALTA UN GUARD
// -----------------------------------------
// La 278 retiró la recepción que NO era por QR, entera y en las dos direcciones: en la
// pantalla se fue el botón «Aceptar» (por-orden y de lote) y en el servidor se fue la
// cadena que lo sostenía —la Server Action `recibirLote`, su esquema `recibirLoteSchema`,
// el método del servicio y el del repositorio—. Lo que queda es UN camino: el escáner.
//
// Eso es una AUSENCIA, y las ausencias se rompen sin que nadie se entere. Un merge futuro
// que devuelva el botón «porque estaba antes» falla AQUÍ, en un test de un segundo, y no
// en la bodega satélite con un paquete a medio recibir.
//
// LO QUE ESTE GUARD **NO** VIGILA, Y NO ES UN OLVIDO (R32)
// -------------------------------------------------------
// `lib/auth/menu-visibility.ts` queda FUERA de este censo de fuente, a propósito. Ese
// archivo fue el peor caso conocido del agujero del quitador de comentarios del repo: una
// ruta con comodín dentro de un comentario de línea abría un bloque que sólo se cerraba
// 151 líneas más abajo, y todo ese tramo —incluido el ítem del satélite— desaparecía del
// texto que lee cualquier guardia. La 278 cerró el agujero y lo dejó medido (T0.1/T1.0: 76
// líneas no vacías visibles antes, 156 después), pero eso es defensa en profundidad, no un
// permiso para volver a juzgar el menú leyendo texto. Los subítems se afirman sobre el
// VALOR importado `SIDEBAR_ITEMS`, aquí abajo y en `tests/unit/auth/menu-visibility.test.ts`.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/**
 * Ámbito: los cuatro archivos de la pantalla del satélite que tocaban el botón, MÁS los dos
 * de servidor de los que se retiró el camino en lote. Los seis, porque reintroducir el
 * botón sin su acción no compila y reintroducir la acción sin el botón no se ve.
 */
const ARCHIVOS = [
  "app/(app)/recepcion-satelite/_components/PorRecibirModule.tsx",
  "app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx",
  "app/(app)/recepcion-satelite/_components/SateliteOrderCard.tsx",
  "app/(app)/_components/PorAceptarSection.tsx",
  "lib/actions/recepcion-satelite.ts",
  "lib/types/recepcion-satelite.ts",
] as const;

/**
 * Prohibido en CÓDIGO EJECUTABLE de esos seis archivos (se lee sin comentarios: lo que se
 * juzga es lo que se ejecuta, no la explicación de por qué ya no está — y esos archivos
 * explican por escrito qué se retiró, que es justo lo que no debe borrarse para pasar).
 *
 * - `recibirLote` / `recibirLoteSchema`: la Server Action del lote y su esquema (R34/R35).
 * - `onAceptarUna` / `textoBotonUna`: las dos props con las que la sección cableaba el
 *   botón por-orden (R3).
 * - `mostrarAcciones`: la prop cuya ÚNICA función era ocultar ese botón; devolverla es
 *   devolver el hueco donde volvía a encajar (R3).
 * - `aceptarRecepcion`: el manejador del módulo que unía el botón con la acción (R1).
 */
const PROHIBIDOS = [
  "recibirLote",
  "recibirLoteSchema",
  "onAceptarUna",
  "textoBotonUna",
  "mostrarAcciones",
  "aceptarRecepcion",
] as const;

/**
 * ANCLAJE POSITIVO por archivo (R31). Sin esto, un guard que lea mal —o que lea un archivo
 * que el quitador se comió entero, que es el modo de fallo REAL de este repo— aprobaría el
 * vacío en verde. Si el anclaje no aparece en el texto ya barrido, el caso se pone rojo.
 *
 * En los dos de servidor el anclaje es el camino del QR —`recibirPorQr` en la acción,
 * `recibirSchema` en los tipos—: la MISMA pasada que comprueba que el lote no está
 * demuestra que el QR sigue.
 */
const ANCLAJES: Record<(typeof ARCHIVOS)[number], string> = {
  "app/(app)/recepcion-satelite/_components/PorRecibirModule.tsx": "EscanerRecepcion",
  "app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx":
    "SateliteOrdenesListado",
  "app/(app)/recepcion-satelite/_components/SateliteOrderCard.tsx": "RecepcionDetalle",
  "app/(app)/_components/PorAceptarSection.tsx": "PorAceptarSection",
  "lib/actions/recepcion-satelite.ts": "recibirPorQr",
  // El borde por QR vive aquí como `recibirSchema` (el hermano vivo del
  // `recibirLoteSchema` retirado): en este archivo NO hay ninguna acción, sólo esquemas y
  // tipos, así que su anclaje es el esquema y no el nombre de la Server Action.
  "lib/types/recepcion-satelite.ts": "recibirSchema",
};

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** Fuente sin comentarios: se juzga lo que el código EJECUTA, no lo que documenta. */
function codigo(rel: string): string {
  return quitarComentarios(leer(rel));
}

describe("Feature 278 — la recepción del satélite es SOLO por QR (R30)", () => {
  for (const rel of ARCHIVOS) {
    for (const prohibido of PROHIBIDOS) {
      it(`${rel} no menciona \`${prohibido}\` en código ejecutable`, () => {
        expect(codigo(rel)).not.toContain(prohibido);
      });
    }
  }

  // R30, la otra vía: el botón no tiene por qué volver con su nombre viejo. La forma más
  // barata de reintroducirlo es un `<Button>` propio dentro del `renderItem` de cada
  // tarjeta — que es EXACTAMENTE como estaba duplicado antes de esta ficha.
  it("ninguno de los dos módulos de la pantalla importa `Button` (la vía del botón propio en renderItem)", () => {
    for (const rel of [
      "app/(app)/recepcion-satelite/_components/PorRecibirModule.tsx",
      "app/(app)/_components/PorAceptarSection.tsx",
    ]) {
      const src = codigo(rel);
      expect(src, `${rel} volvió a importar Button`).not.toContain(
        "@/components/ui/button",
      );
      expect(src, `${rel} volvió a montar un <Button>`).not.toContain("<Button");
    }
  });

  it("R4: el fuente de PorAceptarSection ya no afirma que la comparta el mensajero ni que ofrezca acción en lote", () => {
    // ESTE caso mira el texto COMPLETO (con comentarios) a propósito: lo que R4 corrige es
    // la documentación, no el código. Por eso lleva su propio anclaje positivo.
    const bruto = leer("app/(app)/_components/PorAceptarSection.tsx");
    expect(bruto, "el archivo no es el que se cree").toContain(
      "export function PorAceptarSection",
    );

    expect(bruto).not.toContain("compartida (mensajero / adminSatelite)");
    expect(bruto).not.toContain("acción en lote +");
    expect(bruto).not.toContain("Banner de contador + acción en lote");
    expect(bruto).not.toContain("tarjetas con botón");
  });

  // ---------------------------------------------------------------------------------
  // Anti-vacuidad (R31), tres capas. Una guardia que lee mal pasa igual de verde.
  // ---------------------------------------------------------------------------------

  it("el guard mira archivos que EXISTEN (si se renombran, se actualiza aquí)", () => {
    for (const rel of ARCHIVOS) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
  });

  it("el texto YA SIN COMENTARIOS de cada archivo conserva su anclaje positivo", () => {
    for (const rel of ARCHIVOS) {
      const src = codigo(rel);
      expect(src.trim().length, `${rel} quedó vacío tras quitar comentarios`).toBeGreaterThan(200);
      expect(src, `${rel} perdió su anclaje ${ANCLAJES[rel]}`).toContain(ANCLAJES[rel]);
    }
  });

  it("la detección DISPARA sobre una cadena de control con el botón dentro", () => {
    // Que los `not.toContain` de arriba estén verdes no prueba que sepan encontrar nada.
    // Aquí se les da un texto que SÍ tiene lo prohibido y se comprueba que lo ven.
    const CONTROL = [
      "const aceptarRecepcion = async (id: string) => {",
      '  await recibirLote({ ordenIds: [id] });',
      "};",
      "<PorAceptarSection",
      "  onAceptarUna={aceptarRecepcion}",
      '  textoBotonUna="Aceptar"',
      "  mostrarAcciones={!sinZona}",
      "/>",
      "const schema = recibirLoteSchema;",
    ].join("\n");

    const detectados = PROHIBIDOS.filter((p) => quitarComentarios(CONTROL).includes(p));
    expect(detectados).toEqual([...PROHIBIDOS]);
  });

  // R33 — el defecto que ciega a las guardias no puede volver por la puerta de esta ficha.
  it("R33: ninguna línea que nombre una subruta del satélite abre un bloque de comentario", () => {
    const sospechosas: string[] = [];
    for (const rel of [...ARCHIVOS, "lib/auth/menu-visibility.ts"]) {
      leer(rel)
        .split("\n")
        .forEach((linea, i) => {
          if (!linea.includes("/recepcion-satelite")) return;
          const posLinea = linea.indexOf("//");
          const posBloque = linea.indexOf("/" + "*");
          if (posLinea !== -1 && posBloque !== -1 && posBloque > posLinea) {
            sospechosas.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(sospechosas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------
// R32 — los subítems se juzgan por VALOR, no por fuente. Este bloque está en el mismo
// archivo que el censo de texto justamente para que quede escrito, al lado, por qué el
// menú NO entra en ese censo.
// ---------------------------------------------------------------------------------
describe("Feature 278 — el menú del satélite se juzga sobre SIDEBAR_ITEMS (R32)", () => {
  it("el ítem del portal declara sus dos subítems, leídos del valor importado", () => {
    const item = SIDEBAR_ITEMS.find((i) => i.href === "/recepcion-satelite");
    expect(item, "sin ítem /recepcion-satelite en SIDEBAR_ITEMS").toBeDefined();
    // Anti-vacuidad: el valor importado trae el menú entero, no una lista recortada.
    expect(SIDEBAR_ITEMS.length).toBeGreaterThan(5);
    expect(item!.children?.map((c) => c.href)).toEqual([
      "/recepcion-satelite/por-recibir",
      "/recepcion-satelite/en-bodega",
    ]);
  });

  it("las dos subrutas del menú corresponden a páginas que EXISTEN en el árbol", () => {
    // Lo que un censo de fuente no puede darte: que el href no apunte a una ruta muerta.
    const item = SIDEBAR_ITEMS.find((i) => i.href === "/recepcion-satelite");
    const rutas = (item!.children ?? []).map(
      (c) => `app/(app)${c.href}/page.tsx`,
    );
    expect(rutas).toHaveLength(2);
    for (const rel of rutas) {
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `falta ${rel}`).toBe(true);
    }
    // Y la ruta del padre sigue existiendo: es la que redirige (no se borró).
    expect(
      fs.existsSync(path.join(REPO_ROOT, "app/(app)/recepcion-satelite/page.tsx")),
    ).toBe(true);
  });
});
