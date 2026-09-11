import { describe, it, expect } from "vitest";
import { NotificacionEvento as NotificacionEventoPrisma } from "@prisma/client";
import {
  CATALOGO_AVISOS,
  EVENTOS_AGREGADOS,
  accionDeAviso,
  esAccionable,
  esEventoAgregado,
} from "@/lib/notificaciones/catalogo-avisos";
import type { NotificacionEvento } from "@/lib/types/notificacion";

// FICHA 409 (T1.4) — EL CATALOGO. Cubre R1 (exhaustividad), R2 (clasificacion y atajo POR ROL),
// R3 (toda entrada accionable declara atajo o `null` explicito) y R4 (`geocodificacion_caida` es
// el UNICO accionable sin atajo).
//
// Los destinos y las etiquetas se afirman con LITERALES ESCRITOS A MANO, nunca leyendo la propia
// entrada del catalogo: comparar un texto contra la fuente que lo genera esta siempre verde.

describe("R1 — el catalogo declara TODOS los eventos del enum, ni uno menos", () => {
  it("las claves del catalogo son exactamente los valores del enum de Prisma", () => {
    // La fuente es el ENUM DEL CLIENTE PRISMA, no la union de `lib/types`: es el unico sitio que
    // refleja lo que hay en la base. Un valor nuevo en el enum sin entrada aqui ADEMAS no compila
    // (el catalogo es un `Record<NotificacionEvento, …>`, no un `Partial`).
    const delEnum = Object.values(NotificacionEventoPrisma).sort();
    const delCatalogo = Object.keys(CATALOGO_AVISOS).sort();

    // AUTOCOMPROBACION: si la extraccion del enum se rompiera, la lista quedaria vacia y el
    // `toEqual` de abajo pasaria comparando dos listas vacias sin haber comprobado nada.
    expect(delEnum.length).toBeGreaterThanOrEqual(13);
    expect(delEnum).toContain("novedades_sin_gestionar");
    expect(delEnum).toContain("devoluciones_represadas");

    expect(delCatalogo).toEqual(delEnum);
  });

  it("cada entrada declara al menos un rol destinatario", () => {
    for (const [evento, entrada] of Object.entries(CATALOGO_AVISOS)) {
      expect(entrada.destinatarios.length, `${evento} sin destinatarios`).toBeGreaterThan(0);
    }
  });
});

describe("R2 — un mismo evento puede pedir cosas distintas a roles distintos", () => {
  it("`cierre_dia_vencido` es ACCIONABLE para el mensajero e INFORMATIVA para la bodega", () => {
    expect(accionDeAviso("cierre_dia_vencido", "mensajero")).toEqual({
      clase: "accionable",
      atajo: { href: "/cierre-dia", etiqueta: "Ver mi cierre" },
    });
    expect(accionDeAviso("cierre_dia_vencido", "adminSatelite").clase).toBe("informativa");
    expect(accionDeAviso("cierre_dia_vencido", "maestro").clase).toBe("informativa");
    expect(accionDeAviso("cierre_dia_vencido", "admin").clase).toBe("informativa");
  });

  it("`devoluciones_represadas` lleva DOS destinos distintos segun el rol", () => {
    // El adminSatelite va a donde EJECUTA: es el unico rol que `EnvioDevolucionCentralService`
    // autoriza a mover una orden en `por_devolver` (`ROL_AUTORIZADO = "adminSatelite"`).
    const satelite = accionDeAviso("devoluciones_represadas", "adminSatelite");
    expect(satelite.clase).toBe("accionable");
    expect(satelite.clase === "accionable" && satelite.atajo).toEqual({
      href: "/recepcion-satelite/en-bodega",
      etiqueta: "Enviar a central",
    });

    // Maestro y admin NO mueven las ordenes: coordinan con la bodega, y para esa llamada
    // necesitan saber cuales son y de que bodega. `/ordenes` es el insumo de su accion.
    for (const rol of ["maestro", "admin"] as const) {
      const central = accionDeAviso("devoluciones_represadas", rol);
      expect(central.clase).toBe("accionable");
      expect(central.clase === "accionable" && central.atajo).toEqual({
        href: "/ordenes",
        etiqueta: "Ver devoluciones",
      });
    }
  });

  it("`mensajero_bloqueado_por_cierres` es accionable para los dos lados, en pantallas distintas", () => {
    const mensajero = accionDeAviso("mensajero_bloqueado_por_cierres", "mensajero");
    const bodega = accionDeAviso("mensajero_bloqueado_por_cierres", "adminSatelite");

    expect(mensajero.clase === "accionable" && mensajero.atajo?.href).toBe("/cierre-dia");
    expect(bodega.clase === "accionable" && bodega.atajo?.href).toBe("/cierres-admin");
  });

  it("Q4: `dia_reparto_corregido` es ACCIONABLE para el mensajero, con atajo a su reparto", () => {
    // El mockup lo pintaba como informativo y el humano lo corrigio el 2026-09-10: tiene
    // consecuencia real y personal —si no se entera, se presenta el dia equivocado—.
    expect(accionDeAviso("dia_reparto_corregido", "mensajero")).toEqual({
      clase: "accionable",
      atajo: { href: "/mis-asignaciones", etiqueta: "Ver mi reparto" },
    });
  });
});

describe("R3 — toda entrada accionable declara atajo o `null` EXPLICITO", () => {
  it("recorriendo el catalogo entero, por defecto y por rol", () => {
    let accionablesVistos = 0;
    for (const [evento, entrada] of Object.entries(CATALOGO_AVISOS)) {
      const acciones = [entrada.porDefecto, ...Object.values(entrada.porRol ?? {})];
      for (const accion of acciones) {
        if (accion.clase !== "accionable") continue;
        accionablesVistos += 1;
        // `undefined` no vale: o hay atajo, o hay un `null` puesto a mano.
        expect(accion.atajo === null || typeof accion.atajo?.href === "string", evento).toBe(true);
        if (accion.atajo !== null) {
          expect(accion.atajo.href.startsWith("/"), evento).toBe(true);
          expect(accion.atajo.etiqueta.length, evento).toBeGreaterThan(0);
        }
      }
    }
    // AUTOCOMPROBACION: sin esto, un catalogo sin accionables pasaria el bucle en verde.
    expect(accionablesVistos).toBeGreaterThanOrEqual(10);
  });
});

describe("R4 — `geocodificacion_caida` es EL UNICO accionable sin atajo", () => {
  it("no lleva atajo para maestro ni para admin", () => {
    expect(accionDeAviso("geocodificacion_caida", "maestro")).toEqual({
      clase: "accionable",
      atajo: null,
    });
    expect(accionDeAviso("geocodificacion_caida", "admin")).toEqual({
      clase: "accionable",
      atajo: null,
    });
  });

  it("y es el unico de TODO el catalogo: darle un destino a cualquier otro rompe esta lista", () => {
    const sinAtajo: string[] = [];
    for (const [evento, entrada] of Object.entries(CATALOGO_AVISOS)) {
      for (const rol of entrada.destinatarios) {
        const accion = accionDeAviso(evento as NotificacionEvento, rol);
        if (accion.clase === "accionable" && accion.atajo === null) sinAtajo.push(evento);
      }
    }
    expect([...new Set(sinAtajo)]).toEqual(["geocodificacion_caida"]);
  });
});

describe("los avisos AGREGADOS son exactamente dos, y llevan compositor de titulo", () => {
  it("`esEventoAgregado` los reconoce y no reconoce a los demas", () => {
    expect(EVENTOS_AGREGADOS).toEqual(["novedades_sin_gestionar", "devoluciones_represadas"]);
    expect(esEventoAgregado("novedades_sin_gestionar")).toBe(true);
    expect(esEventoAgregado("devoluciones_represadas")).toBe(true);
    expect(esEventoAgregado("orden_rechazada")).toBe(false);
    expect(esEventoAgregado("gasto_fijo_cobro_pendiente")).toBe(false);
  });

  it("componen titulo con la cifra, en singular y en plural — literales a mano", () => {
    const novedades = accionDeAviso("novedades_sin_gestionar", "adminTienda");
    const represadasSatelite = accionDeAviso("devoluciones_represadas", "adminSatelite");
    const represadasCentral = accionDeAviso("devoluciones_represadas", "maestro");
    if (novedades.clase !== "accionable" || !novedades.titulo) throw new Error("sin compositor");
    if (represadasSatelite.clase !== "accionable" || !represadasSatelite.titulo) {
      throw new Error("sin compositor");
    }
    if (represadasCentral.clase !== "accionable" || !represadasCentral.titulo) {
      throw new Error("sin compositor");
    }

    expect(novedades.titulo(1)).toBe("1 novedad espera tu decisión");
    expect(novedades.titulo(5)).toBe("5 novedades esperan tu decisión");
    expect(represadasSatelite.titulo(1)).toBe("1 orden espera volver a su tienda");
    expect(represadasSatelite.titulo(12)).toBe("12 órdenes esperan volver a su tienda");
    // Los DOS destinos del mismo evento comparten el titulo: es el mismo hecho.
    expect(represadasCentral.titulo(12)).toBe("12 órdenes esperan volver a su tienda");
  });

  it("ningun evento NO agregado declara compositor de titulo", () => {
    for (const [evento, entrada] of Object.entries(CATALOGO_AVISOS)) {
      if (esEventoAgregado(evento as NotificacionEvento)) continue;
      const acciones = [entrada.porDefecto, ...Object.values(entrada.porRol ?? {})];
      for (const accion of acciones) {
        if (accion.clase !== "accionable") continue;
        expect(accion.titulo, `${evento} no deberia componer titulo`).toBeUndefined();
      }
    }
  });
});

describe("`esAccionable` es el atajo que usa el conteo del distintivo", () => {
  it("coincide con la clase declarada", () => {
    expect(esAccionable("orden_rechazada", "admin")).toBe(false);
    expect(esAccionable("cierre_dia_por_aprobar", "admin")).toBe(true);
    expect(esAccionable("cierre_dia_vencido", "mensajero")).toBe(true);
    expect(esAccionable("cierre_dia_vencido", "admin")).toBe(false);
  });
});
