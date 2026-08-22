import type { OrdenDetalleDia } from "@/lib/types/tablero-dia";
import type { OrdenListItemDTO, OrdenTiendaRef } from "@/lib/types/orden";
import type { TarifaDTO } from "@/lib/types/tarifa";

/**
 * FEATURE 260 — LA FILA DEL DETALLE, POBLADA HASTA EL ULTIMO CAMPO RESTRINGIDO.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 *
 * Existe por una razon concreta: el recorte por alcance de R13 solo se puede demostrar sobre
 * un DTO que traiga los cinco campos restringidos CON VALOR. Un fixture que los dejara en
 * `undefined` haria verde cualquier asercion de «no viaja» sin que hubiera nada que retirar —
 * el detector vacio que este repo ya pago mas de una vez.
 *
 * Y los valores no son realistas a proposito: son CENTINELAS irrepetibles. Un `1500` podria
 * aparecer por casualidad en otro campo del payload; `9999991` no. Serializar el detalle entero
 * a JSON y buscar cada centinela es lo que caza un campo ANIDADO que nadie listo — que es
 * exactamente la forma que tendria la fuga.
 *
 * ⚠️ POR QUE LOS TRES CENTINELAS DE DINERO SON NUMEROS ENTEROS, Y NO CADENAS COMO LOS OTROS DOS
 * (FEATURE 260, F5/V1(c)). La mitad **dato** del recorte se comprueba sobre el JSON, y ahi una
 * cadena cualquiera valdria. La mitad **columna** se comprueba sobre lo RENDERIZADO, y ahi no:
 * las tres celdas de dinero pasan por `PriceLabel`, que hace `toValidNumber(value)` y pinta
 * `₡0` ante cualquier cosa que no sea un numero. Con `"FLETE-CENTINELA"` la columna del flete
 * pintaba `₡0` **tambien en alcance global**, asi que la clausula «con `global` los pinta
 * todos» habria sido verde por vacio: el detector no habria podido ponerse rojo nunca. Se pintan
 * sin decimales (feature 230) y con separador de miles, asi que quien los busque en el marcado
 * tiene que quitar el separador antes — lo hace la guardia, no el fixture.
 */

/** Los cinco valores que NO pueden sobrevivir a un recorte de alcance `zona` (R13). */
export const CENTINELAS = {
  /** `fleteConIva`: STRING de importe en el DTO, y por eso el centinela tambien lo es. */
  flete: "9999991",
  /** `comisionConIva`: idem, y distinto del anterior para poder decir CUAL sobrevivio. */
  comision: "9999992",
  email: "correo@centinela",
  telefono: "TELEFONO-CENTINELA",
  /** Numero irrepetible dentro de la tarifa: si viaja la tarifa, viaja el. */
  tarifa: 9999999,
} as const;

/** Todos los centinelas, para recorrerlos en bloque. */
export const TODOS_LOS_CENTINELAS: readonly string[] = Object.values(CENTINELAS).map(String);

/** Una tarifa completa cuyos importes son el centinela: si sale una, salen todas. */
export function tarifaConCentinela(): TarifaDTO {
  return {
    id: "tarifa-1",
    tiendaId: "tienda-1",
    status: "activo",
    valorFlete: CENTINELAS.tarifa,
    valorFleteDevuelto: CENTINELAS.tarifa,
    valorFleteGam: CENTINELAS.tarifa,
    valorFleteDevueltoGam: CENTINELAS.tarifa,
    fulfillment: CENTINELAS.tarifa,
    comisionCod: CENTINELAS.tarifa,
    ivaFlete: CENTINELAS.tarifa,
    ivaComisionCod: CENTINELAS.tarifa,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

/** La tienda de la orden, con su contacto y su tarifa: los tres campos de tienda de R13. */
export function tiendaConCentinelas(): OrdenTiendaRef {
  return {
    id: "tienda-1",
    nombre: "Tienda Uno",
    email: CENTINELAS.email,
    telefono: CENTINELAS.telefono,
    tarifa: tarifaConCentinela(),
  };
}

/**
 * Un elemento del listado de ordenes COMPLETO —todas las relaciones resueltas— con los cinco
 * campos restringidos marcados con su centinela. `montoCobrar` lleva un valor propio y
 * reconocible porque R17 exige que SOBREVIVA a los dos alcances: si tambien fuera centinela,
 * la asercion «no queda ningun centinela» exigiria borrarlo, que es lo contrario del requisito.
 */
export function ordenDeListado(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1000,
    numRemision: "REM-000",
    estatusId: "est-1",
    estatusValue: "en_reparto",
    destinatario: "Ana Solis",
    telefonoDest: "80000000",
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda Uno",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: "distrito-1",
    producto: "caja",
    peso: 1,
    notas: null,
    mensajeroAsignadoId: "mensajero-1",
    prioridad: false,
    zonaNombre: "Zona Uno",
    zonaEsGam: true,
    direccion: "Barrio X, casa 3",
    montoCobrar: 12345,
    cobraComision: true,
    fleteConIva: CENTINELAS.flete,
    comisionConIva: CENTINELAS.comision,
    fechaReprogramacion: null,
    intentosEntrega: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    relaciones: {
      estatus: { id: "est-1", value: "en_reparto" },
      tienda: tiendaConCentinelas(),
      zona: { id: "zona-1", nombre: "Zona Uno", esCentral: true },
      provincia: { id: "prov-1", nombre: "Provincia Uno" },
      canton: { id: "canton-1", nombre: "Canton Uno" },
      distrito: { id: "distrito-1", nombre: "Distrito Uno" },
      mensajeroAsignado: { id: "mensajero-1", nombre: "Ana" },
    },
    ...overrides,
  };
}

/** La misma fila, ya con los dos campos del DIA que el detalle le anexa. */
export function ordenDelDetalle(
  overrides: Partial<OrdenDetalleDia> & { id: string },
): OrdenDetalleDia {
  const { resultadoDelDia = null, asignadoAt = "2026-08-08T13:00:00.000Z", ...resto } = overrides;
  return { ...ordenDeListado(resto), resultadoDelDia, asignadoAt };
}
