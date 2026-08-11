"use client";

import type { Column } from "@/components/shared/DataTable";
import { columnaIntentos } from "@/components/shared/intentos-entrega";
import { PriceLabel } from "@/components/shared/PriceLabel";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { toValidNumber } from "@/lib/utils/number";

// Placeholder para relaciones opcionales no resueltas (espeja `ordenes-columns.tsx`).
const SIN_DATO = "—";

/**
 * Estado legible "En bodega satélite de <zona>" (feature 33/R9): deriva del
 * `estatusValue` (etiqueta de `estatusLabel`) y del nombre de zona de la orden,
 * con caída al nombre de zona del actor. Espeja la lógica del módulo padre.
 */
function estadoLegible(orden: RecepcionSateliteDTO, zonaNombre: string | null): string {
  const base = estatusLabel(orden.estatusValue);
  const zona = orden.zonaNombre || zonaNombre;
  return zona ? `${base} de ${zona}` : base;
}

/**
 * Columnas de datos de la sección "Recibidas" del adminSatelite (órdenes
 * `en_bodega_satelite`). Espejan el estilo de `ordenes-columns.tsx` pero sobre
 * `RecepcionSateliteDTO`, que NO trae tarifa (sin flete/comisión/fulfillment).
 * La columna "Seleccionar" NO vive aquí: la compone el módulo padre (fuente de
 * verdad de la selección), igual que `OrdenesModule` prepende su checkbox.
 */
export function recibidasColumns(
  zonaNombre: string | null,
): Column<RecepcionSateliteDTO>[] {
  return [
    {
      id: "numGuia",
      value: "Nº Guía",
      // La guía se asigna en "Generar guía"; sin guía → "Pendiente". El valor va
      // resaltado, igual que en `ordenes-columns`: mismo dato, misma jerarquía visual.
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
      render: (row) => estadoLegible(row, zonaNombre),
    },
    // Feature 160 (R17/R25): misma columna compartida y misma posicion relativa que
    // en `ordenes-columns` (justo tras `estatus`). Se inserta AQUI, en las columnas
    // de datos, para que el modulo padre siga prependiendo su checkbox y
    // `conBadgePrioridad` siga decorando `numGuia` como primera columna de datos.
    columnaIntentos<RecepcionSateliteDTO>(),
    { id: "destinatario", value: "Destinatario", render: "destinatario" },
    { id: "producto", value: "Producto", render: "producto", minWidth: "300px" },
    {
      id: "direccion",
      value: "Dirección",
      render: (row) => row.direccion ?? SIN_DATO,
      minWidth: "200px",
    },
    { id: "tienda", value: "Tienda", render: "tiendaNombre" },
    {
      id: "zona",
      value: "Zona",
      render: (row) => row.zonaNombre || SIN_DATO,
    },
    {
      id: "provincia",
      value: "Provincia",
      render: (row) => row.provinciaNombre || SIN_DATO,
    },
    {
      id: "canton",
      value: "Cantón",
      render: (row) => row.cantonNombre || SIN_DATO,
    },
    {
      id: "distrito",
      value: "Distrito",
      render: (row) => row.distritoNombre ?? SIN_DATO,
    },
    {
      id: "montoCobrar",
      value: "Monto a cobrar",
      render: (row) => <PriceLabel value={toValidNumber(row.montoCobrar)} />,
    },
  ];
}
