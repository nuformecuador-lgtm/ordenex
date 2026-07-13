import type { Column } from "@/components/shared/DataTable";
import { PriceLabel } from "@/components/shared/PriceLabel";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import { EstatusBadge } from "./EstatusBadge";

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
 * Columnas concretas de `/ordenes`. La tabla genérica NO conoce el dominio orden:
 * estas columnas viven junto a la página.
 *
 * Fuente de datos: el bloque `relaciones` del DTO del listado (nueva estructura
 * de respuesta), que resuelve en el mismo query los NOMBRES/VALUES legibles de
 * todas las relaciones directas (estatus, tienda, zona, provincia, cantón,
 * distrito, mensajero). Las celdas muestran SIEMPRE el valor final legible, nunca
 * el id crudo. Se cae a los escalares `*Nombre`/`*Value` de nivel superior o a
 * `SIN_DATO` cuando una relación opcional no resolvió (defensivo).
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
    value: "Estatus",
    render: (row) => (
      <EstatusBadge
        value={row.relaciones?.estatus?.value ?? row.estatusValue ?? SIN_DATO}
        zonaNombre={row.relaciones?.zona?.nombre ?? row.zonaNombre}
      />
    ),
  },
  { id: "destinatario", value: "Destinatario" },
  {
    id: "tienda",
    value: "Tienda",
    // Nombre legible de la tienda, no el uuid `tiendaId`.
    render: (row) => row.relaciones?.tienda?.nombre ?? row.tiendaNombre,
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
    id: "flete",
    value: "Flete",
    // Flete GAM o estándar según la zona de la orden; PriceLabel formatea a ₡ y
    // resuelve el caso sin tarifa (undefined → ₡0).
    render: (row) => {
      const esGam = row.relaciones?.zona?.esGam;
      const tarifa = row.relaciones?.tienda?.tarifa;
      return (
        <PriceLabel value={esGam ? tarifa?.valorFleteGam : tarifa?.valorFlete} />
      );
    },
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
