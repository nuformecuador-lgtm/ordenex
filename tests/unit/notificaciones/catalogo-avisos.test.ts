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
    expect(delEnum.length).toBeGreaterThanOrEqual(15);
    expect(delEnum).toContain("novedades_sin_gestionar");
    expect(delEnum).toContain("devoluciones_represadas");
    expect(delEnum).toContain("cierre_dia_rechazado"); // ficha 412
    expect(delEnum).toContain("reparto_manana"); // ficha 413

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

  it("⭑ 412/R20/R21: `cierre_dia_rechazado` es ACCIONABLE para el mensajero, y sólo para él", () => {
    // Las tres condiciones de accionable: pide una accion (revisarlo, corregirlo y reenviarlo),
    // tiene consecuencia si no se hace (no se le liquida y sigue bloqueado) y EL puede resolverla.
    // El destino es `/cierre-dia` —donde EJECUTA la re-solicitud—, el mismo sitio al que llevan
    // `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres`: tres avisos de su cierre, un solo
    // sitio al que ir. Literales escritos a mano, no leidos del catalogo.
    expect(accionDeAviso("cierre_dia_rechazado", "mensajero")).toEqual({
      clase: "accionable",
      atajo: { href: "/cierre-dia", etiqueta: "Ver mi cierre" },
    });
  });

  it("⭑ 412/R2: `cierre_dia_rechazado` NO tiene mas destinatarios que el mensajero", () => {
    // No es decoracion: es lo que la guardia de rutas RECORRE, y ademas deja escrito que la
    // administracion NO recibe fila de este evento — sigue recibiendo la suya de
    // `mensajero_bloqueado_por_cierres` (R18). Quien rechaza es la bodega: avisarle de su propio
    // clic seria ruido puro.
    expect(CATALOGO_AVISOS.cierre_dia_rechazado.destinatarios).toEqual(["mensajero"]);
    // Y sin excepcion por rol: solo hay un destinatario, asi que `porRol` no tiene nada que decir.
    expect(CATALOGO_AVISOS.cierre_dia_rechazado.porRol).toBeUndefined();
  });

  it("⭑ 413/R25/R26: `reparto_manana` es ACCIONABLE para el mensajero, con atajo a su reparto", () => {
    // Las tres condiciones de accionable (design 8.1): pide una accion (organizarse para mañana),
    // tiene consecuencia si no se hace (llegar a la bodega sin saber que le espera, que es la
    // situacion de HOY y el motivo de la ficha) y SOLO EL puede resolverla.
    //
    // El destino es `/mis-asignaciones` —la lista de lo que va a llevar, el insumo de su
    // preparacion—, el MISMO que `dia_reparto_corregido`, el evento hermano sobre el mismo asunto.
    // Literales escritos a mano, no leidos del catalogo.
    const accion = accionDeAviso("reparto_manana", "mensajero");
    expect(accion.clase).toBe("accionable");
    expect(accion.clase === "accionable" && accion.atajo).toEqual({
      href: "/mis-asignaciones",
      etiqueta: "Ver mi reparto",
    });
    // MUTACION del design (§13.7 de la 409, aplicada aqui): apuntarlo a `/wallet` ⇒ la guardia
    // `atajo-aviso-ruta-visible.guardia.test.ts` se pone roja, porque el mensajero no ve esa ruta.
  });

  it("⭑ 413/R8: `reparto_manana` NO tiene mas destinatarios que el mensajero", () => {
    // No es decoracion: es lo que la guardia de rutas RECORRE, y deja escrito que la
    // administracion NO recibe fila de este evento — ya ve el reparto entero en `/ordenes`.
    expect(CATALOGO_AVISOS.reparto_manana.destinatarios).toEqual(["mensajero"]);
    // Y sin excepcion por rol: solo hay un destinatario, asi que `porRol` no tiene nada que decir.
    expect(CATALOGO_AVISOS.reparto_manana.porRol).toBeUndefined();
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
    expect(EVENTOS_AGREGADOS).toEqual([
      "novedades_sin_gestionar",
      "devoluciones_represadas",
      "reparto_manana", // ficha 413
    ]);
    expect(esEventoAgregado("novedades_sin_gestionar")).toBe(true);
    expect(esEventoAgregado("devoluciones_represadas")).toBe(true);
    expect(esEventoAgregado("reparto_manana")).toBe(true); // ficha 413
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

  it("⭑ 413/R27: `reparto_manana` compone su titulo con la cifra VIVA — literales a mano", () => {
    // ⚠️ ESCRITOS A MANO, nunca comparados contra `tituloRepartoManana`: un texto comparado contra
    // la funcion que lo genera esta SIEMPRE VERDE. Y aqui importa el doble, porque lo que se
    // afirma es el SINGULAR y el PLURAL: «Tenés 1 órdenes para mañana» es el texto roto que
    // ninguna suite ve y que un humano lee todos los dias.
    const accion = accionDeAviso("reparto_manana", "mensajero");
    if (accion.clase !== "accionable" || !accion.titulo) throw new Error("sin compositor");

    expect(accion.titulo(1)).toBe("Tenés 1 orden para mañana");
    expect(accion.titulo(7)).toBe("Tenés 7 órdenes para mañana");
    // Y el caso grande, que es el que motiva la ficha: saber si son 4 paquetes o 40 cambia la
    // moto, el combustible y la hora de salida.
    expect(accion.titulo(40)).toBe("Tenés 40 órdenes para mañana");
    // VOSEO, como el resto del vocabulario al mensajero de la 409.
    expect(accion.titulo(3)).toContain("Tenés");
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
