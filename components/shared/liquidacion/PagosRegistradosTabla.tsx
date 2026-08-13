"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { filasLocales } from "@/components/shared/descarga-resultado";
import type { AnularPagoResult, PagoRegistradoDTO } from "@/lib/types/liquidacion";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";

import { AnularPagoDialog, type PagoAnuladoOk } from "./AnularPagoDialog";
import {
  COLUMNAS_DESCARGA_PAGOS_REGISTRADOS,
  filaDescargaPagoRegistrado,
} from "./pagos-registrados-descarga-columnas";
import {
  ANULAR_PAGO_TEXTO,
  METODO_LIQUIDACION_LABEL,
  PAGOS_REGISTRADOS_COLUMNAS,
  PAGOS_REGISTRADOS_COLUMNA_ACCIONES,
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
// actor, el instante y el motivo.
//
// EL CONTROL DE ANULAR (T F.5, R4/R81/R82) es OPT-IN por dos props independientes:
//   - `puedeAnular` (default `false`, FALLA CERRADO): sin él no existe ni la columna. Quien lo
//     resuelve es el servidor —`esAccesoTotal`, el MISMO predicado con el que el servicio
//     responde `forbidden`—, nunca este componente: el rol no existe en el cliente.
//   - `onAnular`: quien monta es quien conoce la Server Action y quien sabe qué refrescar
//     después. Esta tabla no importa ninguna acción.
// Y en la fila, una tercera condición: **solo los pagos VIGENTES ofrecen el control** (R82). Un
// pago anulado no se anula otra vez; su celda queda vacía y la de al lado ya dice «Anulado».
//
// Ocultar el botón NO es control de acceso: es la mitad visible. La otra mitad —que la acción
// responda `forbidden` a quien no puede— vive en el servicio y se prueba aparte.

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
      {/* Feature 210: era `destructive` (3.29:1, por debajo de AA). `danger` es la misma señal
          con el par -soft/-strong correcto: 5.30:1 en claro, 5.20:1 en oscuro. */}
      <Badge variant="danger">{PAGO_ESTADO_LABEL.anulado}</Badge>
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
  /**
   * T F.5 (R4/R81) — `true` solo si el actor puede anular. **Opcional con default `false`:
   * falla cerrado.** Un montaje que se olvide de decidirlo no ofrece anular a nadie, en vez de
   * ofrecérselo a todos. Lo resuelve el servidor con `esAccesoTotal`.
   */
  puedeAnular?: boolean;
  /**
   * Ejecuta la anulación de un pago. La aporta quien monta —que es quien conoce la Server
   * Action— y sin ella no hay control, aunque `puedeAnular` sea `true`.
   */
  onAnular?: (pago: PagoRegistradoDTO, motivo: string) => Promise<AnularPagoResult>;
  /** Tras una anulación efectiva: quien monta refresca lo suyo y pinta el `restante`. */
  onAnulado?: (resultado: PagoAnuladoOk) => void | Promise<void>;
}

export function PagosRegistradosTabla({
  pagos,
  beneficiario,
  isLoading = false,
  error = null,
  puedeAnular = false,
  onAnular,
  onAnulado,
}: PagosRegistradosTablaProps) {
  const titulo = PAGOS_REGISTRADOS_TEXTO.tabla(beneficiario);

  // El pago cuyo diálogo de anulación está abierto; `null` = ninguno. El diálogo se MONTA con
  // él y se desmonta al cerrarse, así que cada anulación empieza con el motivo en blanco:
  // arrastrar el motivo de otro pago sería guardar una explicación que nadie escribió para él.
  const [pagoAAnular, setPagoAAnular] = useState<PagoRegistradoDTO | null>(null);

  // `const` (y no una expresión suelta en el JSX) para que TypeScript conserve el estrechado
  // dentro del callback que lo llama: sin permiso, aquí no hay función que invocar.
  const anular = puedeAnular ? onAnular : undefined;
  const ofreceAnular = anular !== undefined;

  const columnas: Column<PagoRegistradoDTO>[] = ofreceAnular
    ? [
        ...COLUMNS,
        {
          id: "acciones",
          value: PAGOS_REGISTRADOS_COLUMNA_ACCIONES,
          // R82: un pago ya anulado NO ofrece el control. No se anula una anulación.
          render: (p) =>
            p.anulacion ? null : (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                aria-label={PAGOS_REGISTRADOS_TEXTO.anularPago(money(p.monto), p.fechaPago)}
                onClick={() => setPagoAAnular(p)}
              >
                {ANULAR_PAGO_TEXTO.abrir}
              </Button>
            ),
        },
      ]
    : COLUMNS;

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columnas}
        data={pagos}
        rowKey="id"
        ariaLabel={titulo}
        isLoading={isLoading}
        error={error}
        emptyMessage={PAGOS_REGISTRADOS_TEXTO.vacio}
        /* Familia B: el conjunto ya está en el cliente y es el mismo que se pinta. La descarga
           NO cambia con el permiso: un archivo no lleva botones, así que sus columnas siguen
           siendo las mismas para todo el mundo. */
        descarga={{
          titulo,
          columnas: COLUMNAS_DESCARGA_PAGOS_REGISTRADOS,
          obtenerFilas: () => filasLocales(pagos, filaDescargaPagoRegistrado),
        }}
      />

      {anular !== undefined && pagoAAnular !== null ? (
        <AnularPagoDialog
          open
          onOpenChange={(abierto) => {
            if (!abierto) setPagoAAnular(null);
          }}
          pago={pagoAAnular}
          beneficiario={beneficiario}
          onAnular={(motivo) => anular(pagoAAnular, motivo)}
          onAnulado={onAnulado}
        />
      ) : null}
    </div>
  );
}
