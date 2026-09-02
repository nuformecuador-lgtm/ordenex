import { describe, it, expect } from "vitest";

import {
  CLAVE_ESTADO,
  construirFiltrosSatelite,
  estadosFueraDelListado,
  etiquetaEstado,
  filtroSinResultados,
  seleccionAFiltroSatelite,
  serializarFiltroSatelite,
  FILTRO_SATELITE_VACIO,
} from "@/app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros";
import {
  BUSCADOR_ESTADO,
  ETIQUETA_ESTADO,
  PLACEHOLDER_ESTADO,
  SIN_ESTADOS_COINCIDENTES,
} from "@/app/(app)/ordenes/_components/filtro-estado-def";
import { CATALOGO_FILTROS_VACIO } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import { catalogoOrderStatus } from "@/tests/fixtures/order-status-catalogo";
import type { FilterDef } from "@/components/shared/FilterComponent";
import type { OrderStatusLiteRow } from "@/lib/interfaces/repositories/IOrdenRepository";

// FICHA 355 — EL FILTRO DE ESTADO DE LA BODEGA SATÉLITE ES EL DE LA CENTRAL.
//
// Pedido humano (2026-09-02), con las dos capturas delante: «las satélite deberían poder
// filtrar por estado igual que la central, solo que con sus órdenes nada más». Divergían en
// tres cosas —la lista de opciones, las etiquetas y el texto del buscador— y este archivo ata
// las tres, más el límite que NO se puede cruzar: ofrecer más estados no puede ensanchar lo que
// un `adminSatelite` alcanza.
//
// Los dos ejes que se afirman aquí:
//
//   1. UNIFICACIÓN — las opciones salen del catálogo `order_status` y NO de una lista propia.
//      Se mide por REACCIÓN al catálogo (con tres estados ofrece tres, con ninguno ofrece
//      cero): una lista escrita a mano devolvería siempre las mismas cinco y no puede pasar
//      los dos casos a la vez.
//   2. ALCANCE — la selección INTERSECA la lista blanca de los cinco estados del listado y
//      nunca la amplía. Elegir `entregada` no devuelve entregadas y tampoco devuelve «todas»:
//      devuelve NADA, y esa nada viaja marcada (`estados: []`) para que el módulo la corte.
//
// El recorte REAL sigue estando en el servicio (`estadosDelListado`, acotado además a la zona
// del actor); lo que se prueba aquí es que la capa de presentación no puede pedirle más.

/** La declaración del filtro de estado dentro de la barra de la bodega. */
function declaracionEstado(estatus: readonly OrderStatusLiteRow[] | null): FilterDef {
  const filtros = construirFiltrosSatelite(CATALOGO_FILTROS_VACIO, { estatus });
  const estado = filtros.find((f) => f.key === CLAVE_ESTADO);
  if (estado === undefined) throw new Error("la barra no declara el filtro de estado");
  return estado;
}

function valoresOfrecidos(estatus: readonly OrderStatusLiteRow[] | null): string[] {
  return (declaracionEstado(estatus).options ?? []).map((o) => o.value);
}

/** Los estados del catálogo que este listado NO puede devolver nunca. */
const FUERA_DEL_LISTADO = ORDER_STATUS_SEED.filter(
  (value) => !(ESTADOS_BODEGA_SATELITE as readonly string[]).includes(value),
);

describe("bodega satélite · el filtro de estado sale del catálogo compartido", () => {
  it("ofrece el catálogo entero, no los cinco estados del listado", () => {
    const valores = valoresOfrecidos(catalogoOrderStatus());

    // El orden es el del catálogo (R5: determinista), que es el mismo que ve el maestro.
    expect(valores).toEqual([...ORDER_STATUS_SEED]);
    // Y por tanto ofrece MÁS que los cinco de la lista blanca: ésa es la diferencia que el
    // humano señaló entre las dos capturas.
    expect(valores.length).toBeGreaterThan(ESTADOS_BODEGA_SATELITE.length);
    for (const value of FUERA_DEL_LISTADO) expect(valores).toContain(value);
  });

  it("REACCIONA al catálogo: con tres estados ofrece tres, y sin catálogo ninguno", () => {
    // Éste es el caso que mata una lista escrita a mano. `ESTADOS_SATELITE` —los cinco pares
    // `{value, label}` que vivían en el módulo— devolvía siempre lo mismo daba igual lo que
    // se le pasara, así que no puede pasar estas dos afirmaciones a la vez.
    const tres: OrderStatusLiteRow[] = [
      { id: "os-entregada", value: "entregada" },
      { id: "os-devuelta", value: "devuelta" },
      { id: "os-rechazada", value: "rechazada" },
    ];
    expect(valoresOfrecidos(tres)).toEqual(["entregada", "devuelta", "rechazada"]);

    // Sin catálogo (primer render, o la lectura falló) el control se declara SIN opciones,
    // exactamente como hace `/ordenes` mientras el suyo viaja. No cae a una lista de reserva.
    expect(valoresOfrecidos(null)).toEqual([]);
    expect(valoresOfrecidos([])).toEqual([]);
  });

  it("descarta el value retirado del seed que sobrevive en la tabla", () => {
    // La fila huérfana de un estado retirado (feature 155) sigue en `order_status` porque el
    // historial la referencia. Ninguna orden viva puede tenerla, así que ofrecerla sería
    // ofrecer un filtro que nunca devuelve nada — y sin la razón honesta que sí tienen los
    // estados vigentes de otras pantallas.
    const conRetirado: OrderStatusLiteRow[] = [
      { id: "os-devuelta", value: "devuelta" },
      { id: "os-fulfillment", value: "en_fulfillment_bodega" },
    ];
    expect(valoresOfrecidos(conRetirado)).toEqual(["devuelta"]);
  });

  it("las etiquetas son las del catálogo, no los nombres propios de esta pantalla", () => {
    const opciones = declaracionEstado(catalogoOrderStatus()).options ?? [];
    for (const opcion of opciones) {
      expect(opcion.label).toBe(
        (ORDER_STATUS_LABELS as Record<string, string>)[opcion.value],
      );
    }

    // Y los CUATRO nombres que el humano vio distintos en las dos capturas ya no existen.
    // Se afirman uno a uno, con el literal que había, porque son la queja concreta: «el mismo
    // estado con dos nombres en dos pantallas».
    const etiquetaDe = (value: string) =>
      opciones.find((o) => o.value === value)?.label;
    expect(etiquetaDe("en_bodega_satelite")).toBe("En bodega satélite");
    expect(etiquetaDe("en_bodega_satelite")).not.toBe("Recibidas");
    expect(etiquetaDe("por_recoger")).toBe("Por recoger");
    expect(etiquetaDe("por_recoger")).not.toBe("Asignadas (por recoger)");
    expect(etiquetaDe("devolviendo_a_bodega_central")).toBe(
      "Devolviendo a bodega central",
    );
    expect(etiquetaDe("devolviendo_a_bodega_central")).not.toBe(
      "En tránsito a central",
    );
    expect(etiquetaDe("devuelta")).toBe("Devuelta");
    expect(etiquetaDe("devuelta")).not.toBe("Devueltas");
  });

  it("los textos del control son los de la central, incluido el del buscador", () => {
    const estado = declaracionEstado(catalogoOrderStatus());
    // Los literales que se leen en la captura de `/ordenes`. Se fijan aquí como texto y no
    // por referencia a la constante: la tercera diferencia que el humano señaló era
    // exactamente ésta —«Buscar…» contra «Filtrar estados…»— y una comparación contra la
    // constante que los produce estaría siempre verde.
    expect(estado.label).toBe("Estado");
    expect(estado.kind).toBe("multi");
    expect(estado.placeholder).toBe("Todos");
    expect(estado.searchPlaceholder).toBe("Filtrar estados…");
    expect(estado.emptyMessage).toBe("Ningún estado coincide");

    // Los mismos textos que exporta la declaración compartida: si alguien los cambiara en un
    // sitio y no en el otro, las dos pantallas volverían a divergir sin que nada lo dijera.
    expect(estado.label).toBe(ETIQUETA_ESTADO);
    expect(estado.placeholder).toBe(PLACEHOLDER_ESTADO);
    expect(estado.searchPlaceholder).toBe(BUSCADOR_ESTADO);
    expect(estado.emptyMessage).toBe(SIN_ESTADOS_COINCIDENTES);
  });

  it("el estado sigue yendo PRIMERO en la barra, como en `/ordenes`", () => {
    const filtros = construirFiltrosSatelite(CATALOGO_FILTROS_VACIO, {
      estatus: catalogoOrderStatus(),
    });
    expect(filtros[0]?.key).toBe(CLAVE_ESTADO);
  });

  it("`etiquetaEstado` habla el mismo idioma que el desplegable", () => {
    // La usa el resumen de la selección («3 seleccionada(s) · <estado>») y el mensaje del
    // vacío. Si divergiera del desplegable, el mismo estado volvería a tener dos nombres —
    // ahora dentro de la MISMA pantalla.
    for (const value of ORDER_STATUS_SEED) {
      expect(etiquetaEstado(value)).toBe(
        (ORDER_STATUS_LABELS as Record<string, string>)[value],
      );
    }
    // Un value que el catálogo no conoce cae a sí mismo, no a «—» ni a un vacío.
    expect(etiquetaEstado("estado_desconocido")).toBe("estado_desconocido");
  });
});

describe("bodega satélite · la selección INTERSECA la lista blanca, nunca la amplía", () => {
  it("un estado que este listado no alcanza no devuelve órdenes: devuelve NADA", () => {
    const filtro = seleccionAFiltroSatelite({ [CLAVE_ESTADO]: ["entregada"] });

    // La clave VIAJA, y viaja vacía. Es la diferencia que sostiene la ficha: si `estados`
    // desapareciera del filtro, el listado saldría COMPLETO —«todas» en vez de «ninguna»—, que
    // es convertir el desplegable en una ventana al resto de las órdenes de la zona.
    expect(Object.prototype.hasOwnProperty.call(filtro, "estados")).toBe(true);
    expect(filtro.estados).toEqual([]);
    expect(filtroSinResultados(filtro)).toBe(true);
  });

  it("NINGÚN estado de fuera del listado entra en el filtro, uno por uno", () => {
    // El catálogo entero menos los cinco: 17 estados que este listado no alcanza. Se recorren
    // todos y no uno de muestra, porque el fallo que se teme es que UNO se cuele.
    expect(FUERA_DEL_LISTADO.length).toBeGreaterThan(0);
    for (const value of FUERA_DEL_LISTADO) {
      const filtro = seleccionAFiltroSatelite({ [CLAVE_ESTADO]: [value] });
      expect(filtro.estados, `«${value}» se coló en el filtro`).toEqual([]);
      expect(filtroSinResultados(filtro)).toBe(true);
    }
  });

  it("los cinco del listado SÍ pasan, y sólo ellos", () => {
    for (const value of ESTADOS_BODEGA_SATELITE) {
      const filtro = seleccionAFiltroSatelite({ [CLAVE_ESTADO]: [value] });
      expect(filtro.estados).toEqual([value]);
      expect(filtroSinResultados(filtro)).toBe(false);
    }
  });

  it("una selección MEZCLADA se queda con la parte alcanzable", () => {
    const filtro = seleccionAFiltroSatelite({
      [CLAVE_ESTADO]: ["entregada", "devuelta", "ayuda_tienda"],
    });
    expect(filtro.estados).toEqual(["devuelta"]);
    // Hay algo que consultar: la mezcla NO corta la lectura.
    expect(filtroSinResultados(filtro)).toBe(false);
  });

  it("sin nada marcado el filtro de estado no viaja (y eso sí significa «todos»)", () => {
    const filtro = seleccionAFiltroSatelite({});
    expect(filtro.estados).toBeUndefined();
    expect(filtroSinResultados(filtro)).toBe(false);
    expect(serializarFiltroSatelite(filtro)).toBe(FILTRO_SATELITE_VACIO);
  });

  it("la selección imposible NO comparte clave de caché con «sin filtros»", () => {
    // Si las dos serializaran igual, la selección imposible reutilizaría la página que el
    // servidor pre-cargó sin filtros y el listado saldría entero: el mismo fallo por otra vía.
    const imposible = seleccionAFiltroSatelite({ [CLAVE_ESTADO]: ["entregada"] });
    expect(serializarFiltroSatelite(imposible)).not.toBe(FILTRO_SATELITE_VACIO);
  });

  it("nombra los estados inalcanzables para poder explicar el vacío", () => {
    const seleccion = { [CLAVE_ESTADO]: ["entregada", "devuelta"] };
    expect(estadosFueraDelListado(seleccion)).toEqual(["entregada"]);
    expect(estadosFueraDelListado({ [CLAVE_ESTADO]: [...ESTADOS_BODEGA_SATELITE] })).toEqual(
      [],
    );
    expect(estadosFueraDelListado({})).toEqual([]);
  });
});
