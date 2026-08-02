"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import {
  COLUMNAS_DESCARGA_PAGOS_REGISTRADOS,
  filaDescargaPagoRegistrado,
} from "./pagos-registrados-descarga-columnas";
import {
  METODO_LIQUIDACION_LABEL,
  PAGOS_REGISTRADOS_COLUMNAS,
  PAGOS_REGISTRADOS_TEXTO,
  PAGO_ESTADO_LABEL,
  money,
} from "./liquidacion-labels";

// Feature 172 (T D.2, R49/R50/R74) — la lista de COMPROBANTES de un beneficiario. Compartida
// entre `/wallet/tiendas` (Tanda D) y `/cierres-admin` (Tanda E): mismo comprobante, misma
// tabla, mismo archivo. Recibe los pagos POR PROPS —quien la monta es el dueño de su lectura
// y de cuándo refrescarla— y no consulta nada por su cuenta.
//
// La lista llega COMPLETA y sin paginar (son pocos comprobantes por beneficiario,
// `design.md §10.4`), así que la descarga es de FAMILIA B: `filasLocales` proyecta el MISMO
// array que la tabla está pintando, sin releer del servidor, conservando el tope de filas y
// su mensaje accionable.
//
// MONEY-SAFE (R14): el monto se pinta TAL CUAL con `money`. Cero `Number`, cero `parseFloat`.
//
// UN PAGO ANULADO SE MUESTRA COMPLETO Y MARCADO (R74): conserva todas sus columnas —monto,
// método, referencia, nota, fecha real, quién y cuándo— y suma la insignia «Anulado» con el
// actor, el instante y el motivo. La 172 lo ENSEÑA aquí; el control para anularlo lo añade la
// Tanda F, que es la que trae la acción.

/** Instante ISO como día calendario. La hora no aporta nada a la lectura de un comprobante. */
function dia(iso: string): string {
  return fechaDiaISO(iso);
}

/** Celda de estado: la insignia y, si el pago está anulado, quién, cuándo y por qué (R74). */
function EstadoCelda({ pago }: { pago: PagoRegistradoDTO }) {
  const { anulacion } = pago;
  if (!anulacion) {
    return <Badge variant="secondary">{PAGO_ESTADO_LABEL.vigente}</Badge>;
  }
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="destructive">{PAGO_ESTADO_LABEL.anulado}</Badge>
      <span className="text-xs text-muted-foreground">
        {PAGOS_REGISTRADOS_TEXTO.anuladoPor(
          anulacion.anuladoPorNombre,
          dia(anulacion.anuladoAt),
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {PAGOS_REGISTRADOS_TEXTO.motivo(anulacion.motivo)}
      </span>
    </div>
  );
}

/**
 * Las columnas de pantalla, en el mismo orden que las del archivo. Ninguna es el `id` del
 * pago (R56): viaja en el DTO porque la anulación lo necesita, pero no se pinta.
 */
const COLUMNS: Column<PagoRegistradoDTO>[] = [
  {
    id: "fechaPago",
    value: PAGOS_REGISTRADOS_COLUMNAS.fechaPago,
    render: (p) => dia(p.fechaPago),
  },
  {
    id: "monto",
    value: PAGOS_REGISTRADOS_COLUMNAS.monto,
    // Money-safe: el STRING del servidor, tal cual.
    render: (p) => <span className="font-medium">{money(p.monto)}</span>,
  },
  {
    id: "metodo",
    value: PAGOS_REGISTRADOS_COLUMNAS.metodo,
    render: (p) => METODO_LIQUIDACION_LABEL[p.metodo] ?? p.metodo,
  },
  {
    id: "referencia",
    value: PAGOS_REGISTRADOS_COLUMNAS.referencia,
    render: (p) => p.referencia ?? "—",
  },
  {
    id: "nota",
    value: PAGOS_REGISTRADOS_COLUMNAS.nota,
    render: (p) => p.nota ?? "—",
  },
  {
    id: "registradoPor",
    value: PAGOS_REGISTRADOS_COLUMNAS.registradoPor,
    render: (p) => p.registradoPorNombre,
  },
  {
    id: "registradoEl",
    value: PAGOS_REGISTRADOS_COLUMNAS.registradoEl,
    render: (p) => dia(p.registradoAt),
  },
  {
    id: "estado",
    value: PAGOS_REGISTRADOS_COLUMNAS.estado,
    render: (p) => <EstadoCelda pago={p} />,
  },
];

export interface PagosRegistradosTablaProps {
  /** Los comprobantes, en el orden en que los devolvió el servidor. */
  pagos: PagoRegistradoDTO[];
  /**
   * Nombre visible del beneficiario. Da nombre accesible ÚNICO a la tabla y a su control de
   * descarga: puede haber varias listas montadas a la vez (dos tiendas desplegadas) y dos
   * botones llamados «Descargar Pagos registrados» no identificarían nada.
   */
  beneficiario: string;
  isLoading?: boolean;
  /** Mensaje de error ya redactado por quien lee; `null` = sin error. */
  error?: string | null;
}

export function PagosRegistradosTabla({
  pagos,
  beneficiario,
  isLoading = false,
  error = null,
}: PagosRegistradosTablaProps) {
  const titulo = PAGOS_REGISTRADOS_TEXTO.tabla(beneficiario);

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={COLUMNS}
        data={pagos}
        rowKey="id"
        ariaLabel={titulo}
        isLoading={isLoading}
        error={error}
        emptyMessage={PAGOS_REGISTRADOS_TEXTO.vacio}
        /* Familia B: el conjunto ya está en el cliente y es el mismo que se pinta. */
        descarga={{
          titulo,
          columnas: COLUMNAS_DESCARGA_PAGOS_REGISTRADOS,
          obtenerFilas: () => filasLocales(pagos, filaDescargaPagoRegistrado),
        }}
      />
    </div>
  );
}
