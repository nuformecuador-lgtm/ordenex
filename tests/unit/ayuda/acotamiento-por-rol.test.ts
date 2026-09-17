import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import {
  documentoVisiblePara,
  documentosVisiblesPara,
  filtrarDocumentos,
  mapaRutaDocumento,
} from "@/lib/ayuda/documento";

// ⭑ FICHA 433 — EL ACOTAMIENTO POR ROL: «un mensajero no debe ver la ayuda de Wallet ni
// tropezarse con ella en el buscador».
//
// POR QUÉ LOS ESPERADOS VAN COMO LITERALES Y NO DERIVADOS. La forma fácil de escribir esto
// sería `expect(visibles(mensajero)).toEqual(documentosVisiblesPara(docs, "mensajero"))`, que
// es una tautología: pasa igual si la regla acota, si acota mal o si no acota nada. Los slugs
// de abajo están ESCRITOS A MANO, leídos del frontmatter de los archivos. Si alguien relaja la
// regla, este archivo es el que se pone rojo.

const docs = await leerResumenesAyuda();
const slugs = (rol: RolValue | null) =>
  documentosVisiblesPara(docs, rol)
    .map((d) => d.slug)
    .sort();

describe("R1 — el mensajero ve LO SUYO y nada del dinero de la empresa", () => {
  it("ve exactamente sus cinco documentos, más los dos públicos y el de entrar", () => {
    // Escrito a mano desde el `roles:` de cada archivo. `mensajero/ranking.md` lo declara
    // también para maestro/admin, y los tres de `publico/` valen para cualquiera.
    expect(slugs("mensajero")).toEqual([
      "mensajero/cierre-del-dia",
      "mensajero/por-recoger",
      "mensajero/ranking",
      "mensajero/recoleccion",
      "mensajero/reparto",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
    ]);
  });

  it("NO ve ninguno de los cuatro documentos de Wallet", () => {
    for (const slug of [
      "oficina/wallet-caja",
      "oficina/wallet-mensajeros",
      "oficina/wallet-satelites",
      "oficina/wallet-tiendas",
    ]) {
      const doc = docs.find((d) => d.slug === slug);
      expect(doc, `falta el documento ${slug}`).toBeDefined();
      expect(documentoVisiblePara(doc!, "mensajero")).toBe(false);
    }
  });

  it("y TAMPOCO se tropieza con ellos en el buscador: no están en la lista sobre la que busca", () => {
    // El buscador filtra la lista que el índice ya recibió ACOTADA. Esta es la mitad del
    // requisito que un test sobre `filtrarDocumentos` a solas no comprobaría.
    const suyos = documentosVisiblesPara(docs, "mensajero");
    expect(filtrarDocumentos(suyos, "wallet")).toEqual([]);
    expect(filtrarDocumentos(suyos, "Wallet")).toEqual([]);

    // Y el mismo término SÍ encuentra algo para quien sí puede leerlo: si no, este caso
    // pasaría también con un buscador que no encuentra nada nunca.
    expect(filtrarDocumentos(documentosVisiblesPara(docs, "maestro"), "wallet").length).toBe(4);
  });

  it("el buscador ignora las tildes (en la calle nadie escribe «Recolección» con tilde)", () => {
    const suyos = documentosVisiblesPara(docs, "mensajero");
    expect(filtrarDocumentos(suyos, "recoleccion").map((d) => d.slug)).toEqual([
      "mensajero/recoleccion",
    ]);
  });
});

describe("R2 — los otros roles", () => {
  it("el adminTienda ve lo suyo y NO la ayuda de órdenes de la oficina", () => {
    expect(slugs("adminTienda")).toEqual([
      "compartido/analitica",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
      "tienda/mi-wallet",
      "tienda/novedades",
      "tienda/ordenes",
    ]);
  });

  it("el adminSatelite NO ve el histórico de acciones, que es sólo del maestro", () => {
    const acciones = docs.find((d) => d.slug === "oficina/historico-acciones");
    expect(acciones).toBeDefined();
    expect(documentoVisiblePara(acciones!, "adminSatelite")).toBe(false);
    expect(documentoVisiblePara(acciones!, "admin")).toBe(false);
    expect(documentoVisiblePara(acciones!, "maestro")).toBe(true);
  });

  it("sin sesión no se ve NADA: la regla es lista blanca, no lista negra", () => {
    expect(slugs(null)).toEqual([]);
  });

  it("`apiKey` es una cuenta de máquina y no lee documentación", () => {
    expect(slugs("apiKey")).toEqual([]);
  });
});

describe("R3 — /ordenes es la única ruta con dos documentos, y cada rol recibe el suyo", () => {
  it("el maestro recibe el de oficina y el adminTienda el de tienda", () => {
    expect(mapaRutaDocumento(docs, "maestro")["/ordenes"]).toBe("oficina/ordenes");
    expect(mapaRutaDocumento(docs, "adminTienda")["/ordenes"]).toBe("tienda/ordenes");
  });

  it("el mensajero no tiene NINGÚN documento para /ordenes (no es su pantalla)", () => {
    expect(mapaRutaDocumento(docs, "mensajero")["/ordenes"]).toBeUndefined();
  });
});
