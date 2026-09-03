import type { Column } from "@/components/shared/DataTable";
import { columnaIntentos } from "@/components/shared/intentos-entrega";
import { PriceLabel } from "@/components/shared/PriceLabel";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { EstatusBadge } from "./EstatusBadge";
import { toValidNumber } from "@/lib/utils/number";

// Placeholder para valores ausentes (relación opcional no resuelta).
const SIN_DATO = "—";

// Coacciona a Date defensivamente: el DTO tipa `createdAt: Date`, pero según el
// borde de serialización puede llegar como string ISO.
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Fecha de creación legible (es-EC): fecha corta + hora. */
function formatFechaCreacion(value: Date | string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return SIN_DATO;
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/**
 * Tiempo transcurrido desde la creación: si es ≥ 1 día muestra "Xd Yh"; si es
 * menor a 1 día muestra "Yh Zmin". Se calcula al renderizar (componente cliente).
 */
function tiempoTranscurrido(value: Date | string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return SIN_DATO;
  const ms = Date.now() - d.getTime();
  const totalMin = Math.max(0, Math.floor(ms / 60_000)); // guarda ante fechas futuras
  const dias = Math.floor(totalMin / 1_440);
  const horas = Math.floor((totalMin % 1_440) / 60);
  const minutos = totalMin % 60;
  return dias >= 1 ? `${dias}d ${horas}h` : `${horas}h ${minutos}min`;
}

/**
 * Feature 204 — DINERO DERIVADO: aquí ya no se calcula ninguno.
 *
 * Hasta la 204 este archivo tenía dos funciones —`calcularFleteConIva` y
 * `calcularComisionConIva`— que multiplicaban en el NAVEGADOR los `number` de la tarifa
 * (`flete * (1 + ivaFlete/100)`, `montoCobrar * comisionCod% * (1 + ivaComisionCod%)`).
 * Decían espejar `derivarIngresoOrden`, y no lo hacían. Medido contra las 66 órdenes con
 * tarifa activa de la base, 14 se veían un céntimo desviadas de lo que factura el cierre:
 *
 *   monto 14900.00 (comisión 3.50%, IVA 13%): el cierre cobra ₡589,30 y la tabla pintaba
 *   ₡589,29 — el medio exacto 589.295 no existe en binario y `toFixed(2)` bajaba.
 *   monto 16618.40: el cierre cobra ₡657,25 y la tabla pintaba ₡657,26 — el servidor
 *   redondea la comisión (581.644 → 581.64) ANTES de aplicarle el IVA y el navegador no.
 *
 * Ahora las dos cifras llegan DERIVADAS del servidor, como STRING de escala 2
 * (`OrdenListItemDTO.fleteConIva` / `.comisionConIva`, que salen de `costosListadoOrden` y
 * por tanto de la misma `derivarIngresoOrden` que factura el cierre). Este archivo las
 * pinta. No las opera, y no vuelve a nombrar `valorFlete`, `ivaFlete`, `comisionCod` ni
 * `ivaComisionCod`: si reaparecen aquí, es que alguien volvió a calcular en el navegador, y
 * eso es exactamente lo que vigila `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts`.
 *
 * Las otras dos columnas de dinero (`montoCobrar` y `fulfillment`) siguen con
 * `toValidNumber`: son PASO A PASO de un `DECIMAL(12,2)` que solo se formatea, sin ninguna
 * operación en medio, y ese viaje sí es exacto (medido: `Number(s).toFixed(2) === s` para
 * los 2.000.001 importes de 0,00 a 20.000,00 y hasta `9999999999.99`).
 */

/**
 * Columnas concretas de `/ordenes`. La tabla genérica NO conoce el dominio orden:
 * estas columnas viven junto a la página.
 *
 * Fuente de datos: el bloque `relaciones` del DTO del listado (nueva estructura
 * de respuesta), que resuelve en el mismo query los NOMBRES/VALUES legibles de
 * todas las relaciones directas (estatus, tienda, zona, provincia, cantón,
 * distrito, mensajero) y la tarifa activa de la tienda. Las celdas muestran
 * SIEMPRE el valor final legible, nunca el id crudo. Se cae a los escalares
 * `*Nombre`/`*Value` de nivel superior o a `SIN_DATO` cuando una relación opcional
 * no resolvió (defensivo).
 */
export const ordenesColumns: Column<OrdenListItemDTO>[] = [
  {
    id: "numGuia",
    value: "Nº Guía",
    // La guía se asigna en "Generar guía", no al crear la orden: sin guía → "Pendiente".
    // El valor va resaltado: es el identificador con el que se rastrea el paquete y
    // el ancla visual de la fila cuando la tabla desborda a scroll horizontal.
    render: (row) => (
      <span className="font-semibold">
        {row.numGuia === null ? "Pendiente" : row.numGuia}
      </span>
    ),
  },
  {
    id: "numRemision",
    value: "Nº Remisión",
    render: "numRemision",
    minWidth: "120px",
  },
  {
    id: "estatus",
    value: "Estado",
    render: (row) => (
      <EstatusBadge
        value={row.relaciones?.estatus?.value ?? row.estatusValue ?? SIN_DATO}
        zonaNombre={row.relaciones?.zona?.nombre ?? row.zonaNombre}
      />
    ),
  },
  // Feature 160 (D6/R17/R21): intentos de entrega como COLUMNA propia, insertada
  // INMEDIATAMENTE despues de `estatus` (design §5.2) y no al final. El conteo
  // califica al estado (`devuelta`/`reprogramada`): pegados se leen como una sola
  // idea. Ademas, con 18 columnas y scroll horizontal, una columna al final
  // quedaria permanentemente fuera del viewport. Insertar aqui deja intactos los
  // ids, encabezados y orden relativo de las preexistentes (R21).
  columnaIntentos<OrdenListItemDTO>(),
  { id: "destinatario", value: "Destinatario" },
  { id: "producto", value: "Producto", render: "producto", minWidth: "300px" },
  {
    id: "direccion",
    value: "Dirección",
    // Escalar opcional de la orden (carga masiva); ausente → SIN_DATO.
    render: (row) => row.direccion ?? SIN_DATO,
    minWidth: "200px",
  },
  {
    id: "tienda",
    value: "Tienda",
    // Nombre legible de la tienda, no el uuid `tiendaId`.
    render: (row) => row.relaciones?.tienda?.nombre ?? row.tiendaNombre,
  },
  {
    id: "zona",
    value: "Zona",
    // Nombre legible de la zona; cae al escalar `zonaNombre` (misma estrategia que
    // `tienda`) y a `SIN_DATO` cuando la relación opcional no resolvió.
    render: (row) => row.relaciones?.zona?.nombre ?? row.zonaNombre ?? SIN_DATO,
  },
  {
    id: "provincia",
    value: "Provincia",
    render: (row) => row.relaciones?.provincia?.nombre ?? SIN_DATO,
  },
  {
    id: "canton",
    value: "Cantón",
    render: (row) => row.relaciones?.canton?.nombre ?? SIN_DATO,
  },
  {
    id: "distrito",
    value: "Distrito",
    // Relación opcional: la orden puede no tener distrito.
    render: (row) => row.relaciones?.distrito?.nombre ?? SIN_DATO,
  },
  {
    id: "montoCobrar",
    value: "Monto a cobrar",
    // Valor COD a recaudar de la orden (escalar de la orden; ausente → ₡0).
    render: (row) => <PriceLabel value={toValidNumber(row.montoCobrar)} />,
  },
  {
    id: "flete",
    value: "Flete + IVA",
    // STRING ya derivado por el servidor (monto pactado del distrito especial, o flete GAM /
    // estándar según la zona, + su IVA). Sin tarifa activa el servidor manda "0.00", y un DTO
    // viejo sin el campo cae al ₡0,00 de PriceLabel: la misma degradación segura de siempre (R9).
    //
    // El marcador de al lado NO es decorativo. `especial_sin_pacto` significa que el distrito
    // está marcado como zona especial pero la tarifa que le toca no tiene monto pactado, así
    // que se cobró la tarifa NORMAL: el importe es idéntico al de una orden corriente y sin
    // esta marca el hueco de configuración sería invisible justo en la pantalla donde alguien
    // podría notarlo. `especial` (se cobró el pacto) no se señala: ahí el sistema hizo lo
    // que se le pidió.
    render: (row) => (
      <span className="inline-flex items-center gap-1.5">
        <PriceLabel value={row.fleteConIva} />
        {row.fleteOrigen === "especial_sin_pacto" ? (
          <span
            className="text-amber-600 dark:text-amber-500"
            title="Distrito marcado como zona especial, pero la tarifa no tiene tarifa especial pactada: se cobró la tarifa normal."
            aria-label="Zona especial sin tarifa especial pactada"
          >
            ⚠
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "fulfillment",
    value: "Fulfillment",
    // Monto fijo de fulfillment de la tarifa activa de la tienda (sin tarifa → ₡0).
    render: (row) => (
      <PriceLabel value={toValidNumber(row.relaciones?.tienda?.tarifa?.fulfillment)} />
    ),
  },
  {
    id: "comision",
    value: "Comisión + IVA",
    // STRING ya derivado por el servidor (comisión COD sobre el valor de cobro + su IVA).
    // Sin tarifa, o si la orden NO cobra comisión, el servidor manda "0.00".
    render: (row) => <PriceLabel value={row.comisionConIva} />,
  },
  {
    id: "mensajero",
    value: "Mensajero",
    // Nombre del mensajero asignado; no el id.
    render: (row) => row.relaciones?.mensajeroAsignado?.nombre ?? SIN_DATO,
  },
  {
    id: "fechaCreacion",
    value: "Fecha de creación",
    render: (row) => formatFechaCreacion(row.createdAt),
    minWidth: "120px",
  },
  {
    id: "tiempo",
    value: "Tiempo",
    // Tiempo transcurrido desde la creación (días+h, o h+min si < 1 día).
    render: (row) => tiempoTranscurrido(row.createdAt),
  },
];

/**
 * Columna "Reprogramada para" (ficha 367): la fecha PARA LA QUE quedó reprogramada
 * la orden, no cuándo se desbloquea. Antes se llamaba "Liberada el" y solo se
 * montaba filtrando por el único estado `reprogramada` —donde esa fecha coincide
 * con el día en que el cron de liberación (feature 46) la libera—, pero fuera de
 * esa tab (o en cuanto la orden deja ese estado) "Liberada el" ya no describe lo
 * que muestra: la columna es visible siempre y el dato es la fecha de
 * reprogramación, no un evento del cron. El valor llega del repo ya como
 * `YYYY-MM-DD` (gestión vigente); se renderiza tal cual, igual que en los cierres
 * (`cierre-detalle-shared`), sin re-formatear: reinterpretarlo como Date en el
 * cliente reintroduciría el off-by-one de zona horaria que `lib/utils/fecha-cr`
 * documenta.
 */
const liberadaColumn: Column<OrdenListItemDTO> = {
  id: "liberada",
  value: "Reprogramada para",
  render: (row) => row.fechaReprogramacion ?? SIN_DATO,
};

/**
 * Variante de columnas que añade "Reprogramada para" al final. Deriva de
 * `ordenesColumns` para no duplicar el resto.
 *
 * FICHA 367: `/ordenes` la monta SIEMPRE, no solo filtrando por `reprogramada` —el
 * dato viaja en todas las filas (`OrdenRepository.toListItemDTO`), así que ocultarla
 * fuera de esa tab dejaba la fecha invisible en cuanto el cron liberaba la orden.
 * `monitoreo/detalle-columnas.ts` y `recepcion-satelite/recibidas-columns.tsx` NO
 * usan esta variante a propósito (ver sus propios comentarios): siguen derivando de
 * `ordenesColumns`, que no cambia.
 */
export const ordenesColumnsReprogramada: Column<OrdenListItemDTO>[] = [
  ...ordenesColumns,
  liberadaColumn,
];
