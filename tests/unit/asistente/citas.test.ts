import { describe, it, expect } from "vitest";

import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { contextoPara } from "@/lib/asistente/contexto";
import { citasDe, hrefDeDocumento, textoSinMarcadores } from "@/lib/asistente/citas";
import { MARCADOR_CITA_ABRE, MARCADOR_CITA_CIERRA } from "@/lib/asistente/instrucciones";

/**
 * ⭑ FICHA 436 · R23, R24, R25 — LAS CITAS SE VALIDAN CONTRA EL CONJUNTO ENTREGADO.
 *
 * Los slugs son los REALES del catálogo, no inventados aquí: una cita que apunta a un documento que
 * no existe y una que apunta a uno que existe pero no es de esa persona son dos fallos distintos, y
 * los dos se prueban con el árbol de verdad.
 */

const docs = await leerCatalogoAyuda();
const deMensajero = contextoPara(docs, "mensajero");
const deMaestro = contextoPara(docs, "maestro");

const cita = (slug: string) => `${MARCADOR_CITA_ABRE}${slug}${MARCADOR_CITA_CIERRA}`;

describe("R23 — un documento señalado se convierte en enlace a /ayuda/<slug>", () => {
  it("⭑ con los slugs REALES del catálogo", () => {
    const respuesta = `Tenés que ir a Reparto. ${cita("mensajero/reparto")}`;
    expect(citasDe(respuesta, deMensajero)).toEqual([
      {
        slug: "mensajero/reparto",
        titulo: docs.find((d) => d.slug === "mensajero/reparto")!.titulo,
        href: "/ayuda/mensajero/reparto",
      },
    ]);
  });

  it("varios documentos producen varios enlaces, en orden de aparición y sin repetir", () => {
    const respuesta = `${cita("mensajero/reparto")} y ${cita("mensajero/por-recoger")} y otra vez ${cita("mensajero/reparto")}`;
    expect(citasDe(respuesta, deMensajero).map((c) => c.slug)).toEqual([
      "mensajero/reparto",
      "mensajero/por-recoger",
    ]);
  });

  it("el href es el mismo que usa el módulo de ayuda", () => {
    expect(hrefDeDocumento("oficina/wallet-caja")).toBe("/ayuda/oficina/wallet-caja");
  });
});

describe("R24 — una cita que NO estaba en el conjunto entregado se descarta", () => {
  it("⭑⭑ un slug de OFICINA en una respuesta de mensajero no pinta ningún enlace", () => {
    // El caso que da nombre al requisito. `oficina/wallet-caja` EXISTE —no es un invento— pero no
    // estaba en el contexto de esa persona: pintarlo la llevaría a la puerta que la 433 cerró, y
    // además le confirmaría que ese documento existe.
    const respuesta = `La caja se explica acá ${cita("oficina/wallet-caja")}`;
    expect(citasDe(respuesta, deMensajero)).toEqual([]);
    // Y el CONTROL que hace que este caso no sea vacuo: para el maestro, ese mismo marcador sí
    // produce el enlace. O sea que lo que descarta es la pertenencia al conjunto, no el marcador.
    expect(citasDe(respuesta, deMaestro).map((c) => c.slug)).toEqual(["oficina/wallet-caja"]);
  });

  it("⭑ un slug INEXISTENTE tampoco se pinta (ni para el maestro, que lo puede leer todo)", () => {
    const respuesta = `Mirá ${cita("oficina/como-forrarse")} y ${cita("mensajero/inexistente")}`;
    expect(citasDe(respuesta, deMaestro)).toEqual([]);
    expect(citasDe(respuesta, deMensajero)).toEqual([]);
  });

  it("lo bueno y lo malo mezclados: se queda sólo lo bueno", () => {
    const respuesta = `${cita("mensajero/reparto")} ${cita("oficina/cierres")} ${cita("no/existe")}`;
    expect(citasDe(respuesta, deMensajero).map((c) => c.slug)).toEqual(["mensajero/reparto"]);
  });

  it("un marcador a medio cerrar no se interpreta como cita", () => {
    expect(citasDe(`${MARCADOR_CITA_ABRE}mensajero/reparto`, deMensajero)).toEqual([]);
  });
});

describe("R25 — sin señales no hay sección de fuentes", () => {
  it("⭑ una respuesta sin marcadores no produce ninguna cita", () => {
    expect(citasDe("Andá a Mi bodega y tocá Cerrar. No hay más.", deMensajero)).toEqual([]);
  });

  it("y el texto queda intacto cuando no había marcadores que quitar", () => {
    const texto = "Andá a Mi bodega y tocá Cerrar.";
    expect(textoSinMarcadores(texto)).toBe(texto);
  });
});

describe("los marcadores no se le enseñan a nadie", () => {
  it("⭑ se quitan TODOS, también los descartados", () => {
    // Dejar visible un `[[doc:oficina/wallet-caja]]` que se descartó le estaría diciendo a un
    // mensajero el nombre exacto del documento que no puede leer: el enlace no se pinta, pero el
    // dato se escapa igual.
    const respuesta = `Para repartir, mirá esto. ${cita("mensajero/reparto")} ${cita("oficina/wallet-caja")}`;
    const limpio = textoSinMarcadores(respuesta);
    expect(limpio).toBe("Para repartir, mirá esto.");
    expect(limpio).not.toContain("wallet-caja");
    expect(limpio).not.toContain("[[doc:");
  });
});
