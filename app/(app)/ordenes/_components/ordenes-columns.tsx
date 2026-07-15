import type { Column } from "@/components/shared/DataTable";
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
 * Flete + IVA de la orden. Espeja `derivarIngresoOrden` (lib/utils/ingreso-ordenex.ts):
 * flete = esCentral ? valorFleteGam : valorFlete; total = flete + IVA del flete, donde
 * IVA = flete · ivaFlete% (ivaFlete es porcentaje 0..100). Sin tarifa activa → 0 (misma
 * degradación segura que el backend, R9).
 */
function calcularFleteConIva(row: OrdenListItemDTO): number {
  const tarifa = row.relaciones?.tienda?.tarifa;
  if (!tarifa) return 0;
  const esCentral = row.relaciones?.zona?.esCentral;
  const flete = toValidNumber(esCentral ? tarifa.valorFleteGam : tarifa.valorFlete);
  return flete * (1 + toValidNumber(tarifa.ivaFlete) / 100);
}

/**
 * Comisión COD + su IVA. Espeja `derivarIngresoOrden`: base = `montoCobrar` (valor de
 * cobro COD de la orden); comisión = base · comisionCod%; total = comisión + su IVA
 * (comisión · ivaComisionCod%). Si la orden NO cobra comisión (`cobraComision === false`)
 * o no hay tarifa → 0, igual que el backend, que en ese caso NO emite el concepto.
 */
function calcularComisionConIva(row: OrdenListItemDTO): number {
  const tarifa = row.relaciones?.tienda?.tarifa;
  if (!tarifa || row.cobraComision === false) return 0;
  const comision = toValidNumber(row.montoCobrar) * (toValidNumber(tarifa.comisionCod) / 100);
  return comision * (1 + toValidNumber(tarifa.ivaComisionCod) / 100);
}

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
    render: (row) => (row.numGuia === null ? "Pendiente" : row.numGuia),
  },
  { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
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
  { id: "destinatario", value: "Destinatario" },
  { id: "producto", value: "Producto", render: "producto" },
  {
    id: "direccion",
    value: "Dirección",
    // Escalar opcional de la orden (carga masiva); ausente → SIN_DATO.
    render: (row) => row.direccion ?? SIN_DATO,
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
    // Flete GAM o estándar según la zona, RECARGADO con el % de IVA de flete de la
    // tarifa. PriceLabel formatea a ₡ y resuelve el caso sin tarifa (→ ₡0).
    render: (row) => <PriceLabel value={calcularFleteConIva(row)} />,
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
    // Comisión COD sobre el valor de cobro + su IVA (ver calcularComisionConIva).
    render: (row) => <PriceLabel value={calcularComisionConIva(row)} />,
  },
  {
    id: "mensajero",
    value: "Mensajero",
    // Nombre del mensajero asignado (o el sugerido si aún no hay asignado); no el id.
    render: (row) =>
      row.relaciones?.mensajeroAsignado?.nombre ??
      row.relaciones?.mensajeroSugerido?.nombre ??
      SIN_DATO,
  },
  {
    id: "fechaCreacion",
    value: "Fecha de creación",
    render: (row) => formatFechaCreacion(row.createdAt),
  },
  {
    id: "tiempo",
    value: "Tiempo",
    // Tiempo transcurrido desde la creación (días+h, o h+min si < 1 día).
    render: (row) => tiempoTranscurrido(row.createdAt),
  },
];

/** Columna de mensajero SUGERIDO (carga masiva); no el asignado. */
const mensajeroSugeridoColumn: Column<OrdenListItemDTO> = {
  id: "mensajeroSugerido",
  value: "Mensajero sugerido",
  render: (row) => row.relaciones?.mensajeroSugerido?.nombre ?? SIN_DATO,
};

/**
 * Variante de columnas para estados PREVIOS a la asignación (`en_fulfillment`,
 * `en_preparacion`): reemplaza la columna "Mensajero" (asignado/sugerido) por
 * "Mensajero sugerido", ya que en esos estados aún no se asignó mensajero (la
 * asignación ocurre en "Generar guía"). Deriva de `ordenesColumns` para no duplicar.
 */
export const ordenesColumnsMensajeroSugerido: Column<OrdenListItemDTO>[] =
  ordenesColumns.map((col) =>
    col.id === "mensajero" ? mensajeroSugeridoColumn : col,
  );
