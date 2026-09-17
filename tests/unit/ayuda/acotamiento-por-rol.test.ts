import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import { leerResumenesAyuda } from "@/lib/ayuda/catalogo";
import {
  candidatosRutaDocumento,
  documentoVisiblePara,
  documentosQuePuedeLeer,
  documentosVisiblesPara,
  filtrarDocumentos,
  mapaRutaDocumento,
  puedeLeerDocumento,
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
/** ⭑ FICHA 435 — los que ese rol puede ABRIR, que desde hoy no son los mismos. */
const legibles = (rol: RolValue | null) =>
  documentosQuePuedeLeer(docs, rol)
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

// ⭑ FICHA 435 — LA OFICINA LEE LA AYUDA DE LOS OTROS PORTALES.
//
// Decisión de producto del humano (2026-09-16): quien atiende el teléfono de los 18 mensajeros
// tiene que poder abrir la misma pantalla que quien pregunta. Lo que cambia es el predicado de
// LECTURA; el `roles:` del frontmatter sigue diciendo «de quién es esta pantalla» y el «?» del
// encabezado sigue preguntándoselo a él (R23).
//
// Los literales de abajo están MEDIDOS a mano sobre el `roles:` de los 33 archivos, no
// derivados del catálogo: derivarlos los dejaría verdes pase lo que pase.

describe("R21 — maestro y admin pasan a leer el catálogo ENTERO", () => {
  it("los dos leen los 33 documentos, y el catálogo tiene 33", () => {
    // Si alguien añade un documento, este número se mueve a mano —igual que el recuento de
    // `AyudaLayout.test.tsx`— y eso es lo que se quiere: que la cuenta se decida, no que se
    // recalcule sola.
    expect(docs.length).toBe(33);
    expect(legibles("maestro")).toHaveLength(33);
    expect(legibles("admin")).toHaveLength(33);
  });

  it("⭑ y eso incluye, uno a uno, los DIEZ que antes le daban 404 al maestro", () => {
    // Los diez documentos cuyo `roles:` no nombra a `maestro`: los cuatro del mensajero que no
    // son el ranking, los tres del satélite y los tres de la tienda. Escritos a mano leyendo el
    // frontmatter. El caso afirma las DOS mitades: siguen sin ser su pantalla —el «?» no cambia—
    // y ahora sí los puede abrir.
    const antesProhibidos = [
      "mensajero/cierre-del-dia",
      "mensajero/por-recoger",
      "mensajero/recoleccion",
      "mensajero/reparto",
      "satelite/en-bodega",
      "satelite/mi-bodega",
      "satelite/por-recibir",
      "tienda/mi-wallet",
      "tienda/novedades",
      "tienda/ordenes",
    ];
    for (const slug of antesProhibidos) {
      const doc = docs.find((d) => d.slug === slug);
      expect(doc, `falta el documento ${slug}`).toBeDefined();
      expect(documentoVisiblePara(doc!, "maestro"), slug).toBe(false);
      expect(puedeLeerDocumento(doc!, "maestro"), slug).toBe(true);
      expect(puedeLeerDocumento(doc!, "admin"), slug).toBe(true);
    }
    // Y la cuenta cierra: 33 menos esos diez son los 23 que el maestro veía.
    expect(slugs("maestro")).toHaveLength(33 - antesProhibidos.length);
  });

  it("el admin suma además el histórico de acciones, que es sólo del maestro", () => {
    // Su once, y la razón de que el admin partiera de 22 y no de 23.
    const acciones = docs.find((d) => d.slug === "oficina/historico-acciones");
    expect(acciones).toBeDefined();
    expect(documentoVisiblePara(acciones!, "admin")).toBe(false);
    expect(puedeLeerDocumento(acciones!, "admin")).toBe(true);
    expect(slugs("admin")).toHaveLength(22);
  });

  it("las dos puertas duras siguen cerradas: sin sesión y `apiKey` no leen NADA", () => {
    // El ensanche es por ROL, no una amnistía. `apiKey` no está en `ROLES_AYUDA`.
    expect(legibles(null)).toEqual([]);
    expect(legibles("apiKey")).toEqual([]);
  });
});

describe("R22 — los otros tres roles NO se mueven ni un documento", () => {
  it("⭑ el mensajero lee lo mismo que veía: sus cinco, los dos públicos y el de entrar", () => {
    // La misma lista literal que R1, escrita otra vez a propósito: si el ensanche se fuera por
    // donde no debe, aquí aparecerían los 33.
    expect(legibles("mensajero")).toEqual([
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

  it("la tienda tampoco: sigue sin poder abrir la ayuda de la caja de la empresa", () => {
    expect(legibles("adminTienda")).toEqual([
      "compartido/analitica",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
      "tienda/mi-wallet",
      "tienda/novedades",
      "tienda/ordenes",
    ]);
    expect(puedeLeerDocumento({ roles: ["maestro", "admin"] }, "adminTienda")).toBe(false);
  });

  it("y el satélite se queda en sus diez", () => {
    expect(legibles("adminSatelite")).toEqual([
      "compartido/analitica",
      "oficina/cierres",
      "oficina/incidentes",
      "oficina/monitoreo",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
      "satelite/en-bodega",
      "satelite/mi-bodega",
      "satelite/por-recibir",
    ]);
  });
});

describe("R23 — el «?» del encabezado NO se ensancha: sigue llevando a la ayuda de SU pantalla", () => {
  it("⭑ el maestro tiene UN solo candidato para /ordenes, y es el de oficina", () => {
    // El riesgo central de la ficha. `mapaRutaDocumento` se queda con el primero, y el primero
    // por orden alfabético de slug es `oficina/ordenes`: si el mapa preguntara con el predicado
    // ANCHO, el caso de R3 seguiría VERDE con el maestro teniendo DOS documentos para la misma
    // ruta. Por eso se miran los candidatos, que es donde el empate se ve.
    expect(candidatosRutaDocumento(docs, "maestro").get("/ordenes")).toEqual([
      "oficina/ordenes",
    ]);
    expect(candidatosRutaDocumento(docs, "admin").get("/ordenes")).toEqual(["oficina/ordenes"]);
    expect(candidatosRutaDocumento(docs, "adminTienda").get("/ordenes")).toEqual([
      "tienda/ordenes",
    ]);
  });

  it("ninguna ruta le deja dos candidatos a ningún rol", () => {
    const choques: string[] = [];
    for (const rol of ["maestro", "admin", "mensajero", "adminTienda", "adminSatelite"] as const) {
      for (const [ruta, candidatos] of candidatosRutaDocumento(docs, rol)) {
        if (candidatos.length > 1) choques.push(`${rol} · ${ruta} -> ${candidatos.join(", ")}`);
      }
    }
    expect(choques).toEqual([]);
  });

  it("y el maestro, que ahora LEE la ayuda del reparto, sigue sin tener su «?»", () => {
    // La pantalla `/mis-asignaciones/reparto` no es suya: ese «?» no le sale, y al documento
    // llega por el índice o por la URL. Las dos cosas son ciertas a la vez, y ésa es la forma
    // exacta de la decisión del humano.
    expect(mapaRutaDocumento(docs, "maestro")["/mis-asignaciones/reparto"]).toBeUndefined();
    const reparto = docs.find((d) => d.slug === "mensajero/reparto");
    expect(reparto).toBeDefined();
    expect(puedeLeerDocumento(reparto!, "maestro")).toBe(true);
  });
});
