"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  type Column,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import { reversarEgresoAdministrativoAction } from "@/lib/actions/wallet-egresos";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

import { COLUMNAS_DESCARGA_WALLET_CAJA } from "./wallet-ledger-descarga-columnas";
import {
  CATEGORIA_LABEL,
  ORIGEN_LABEL,
  TIPO_LABEL,
  esEgresoAdministrativo,
  money,
} from "./wallet-labels";

// Feature 42 (T12, R18/R21) — libro de movimientos (tabla, más reciente primero: el
// backend ya lo devuelve ordenado). Datos por props desde el módulo. Money-safe: la
// columna monto renderiza el STRING tal cual con `money`, sin parseFloat/Number.
//
// Feature 45 (T11, R13/R14/R22c/R32) — se añade la acción "Reversar" por fila SOLO sobre
// egresos administrativos (`origen_tipo=gasto` ∧ `tipo=egreso`, incluye los generados por
// el cron). La reversa se confirma con un `Modal` y dispara la Server Action
// `reversarEgresoAdministrativoAction`; el backend crea el `ingreso_ajuste` compensatorio
// (append-only, idempotente) — la UI solo dispara y refresca. No hay editar/borrar (R14).

/** Badge de color por tipo: ingreso (verde/entra) vs egreso (rojo/sale). */
function TipoBadge({ tipo }: { tipo: WalletMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "ingreso" ? "default" : "destructive"}>
      {TIPO_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripción si la hay. */
function origenTexto(m: WalletMovimientoDTO): string {
  const base = ORIGEN_LABEL[m.origenTipo];
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

/** Nombre visible del libro: hoja, base del nombre de archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Libro de movimientos";

export interface WalletLedgerProps {
  movimientos: WalletMovimientoDTO[];
  isLoading?: boolean;
  /** Callback tras reversar con éxito (para que el módulo recargue libro + balance + desglose). */
  onReversado?: () => void;
  /**
   * Feature 170 (T C.4, design §5) — obtiene las filas del libro COMPLETO para la descarga.
   *
   * Es un CALLBACK, no unos filtros: esta tabla pinta la página que le llega por props y no
   * conoce (ni debe conocer) los filtros vigentes; quien los conoce es `WalletModule`, que
   * cierra sobre ellos al invocar la Server Action del modo completo. Bajar el callback es
   * exactamente lo que manda el design §5 —«nunca los filtros a la tabla»— y deja este
   * componente sin fetchear nada.
   *
   * Ausente ⇒ la tabla no monta el control y se comporta igual que antes (R39).
   */
  obtenerFilasDescarga?: () => Promise<DescargaFilasResult>;
}

export function WalletLedger({
  movimientos,
  isLoading = false,
  onReversado,
  obtenerFilasDescarga,
}: WalletLedgerProps) {
  const router = useRouter();
  const toast = useToast();

  // Egreso administrativo elegido para reversar (abre el modal de confirmación).
  const [objetivo, setObjetivo] = useState<WalletMovimientoDTO | null>(null);

  async function confirmarReversa() {
    if (!objetivo) return;
    const result = await reversarEgresoAdministrativoAction({ movimientoId: objetivo.id });

    if (result.status === "ok") {
      toast.success("Egreso reversado. Se registró el ajuste compensatorio.");
      setObjetivo(null);
      onReversado?.();
      router.refresh();
      return;
    }
    if (result.status === "already_reversed") {
      toast.info("Este egreso ya tenía su reversa.");
      setObjetivo(null);
      onReversado?.();
      return;
    }
    if (result.status === "not_found") {
      toast.error("El egreso ya no existe o no es reversable.");
      setObjetivo(null);
      return;
    }
    if (result.status === "validation_error") {
      toast.error("No se pudo reversar el egreso.");
      return;
    }
    if (result.status === "forbidden") {
      toast.error("No tenés permiso para reversar egresos.");
      return;
    }
    // unauthenticated
    toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
  }

  const columns = useMemo<Column<WalletMovimientoDTO>[]>(
    () => [
      { id: "fecha", value: "Fecha", render: (m) => m.fechaMovimiento.slice(0, 10) },
      { id: "tipo", value: "Tipo", render: (m) => <TipoBadge tipo={m.tipo} /> },
      { id: "categoria", value: "Categoría", render: (m) => CATEGORIA_LABEL[m.categoria] },
      {
        id: "monto",
        value: "Monto",
        // Money-safe (R21/R25): STRING tal cual, sin parseFloat/Number.
        render: (m) => money(m.monto),
      },
      { id: "origen", value: "Origen", render: (m) => origenTexto(m) },
      {
        id: "acciones",
        value: "Acciones",
        // R22c/R32: la reversa se ofrece SOLO en egresos administrativos (incluye los del cron).
        render: (m) =>
          esEgresoAdministrativo(m) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setObjetivo(m)}
            >
              Reversar
            </Button>
          ) : null,
      },
    ],
    [],
  );

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columns}
        data={movimientos}
        rowKey="id"
        ariaLabel={TITULO_DESCARGA}
        isLoading={isLoading}
        emptyMessage="No hay movimientos que coincidan con los filtros."
        // Feature 170 (T C.4, R1/R9/R13): el control aparece solo si el módulo bajó el
        // callback; las columnas del archivo las declara ESTA tabla, que es la que sabe
        // qué enseña. Money-safe: el monto viaja como el STRING del servidor, sin `money`
        // (el símbolo de colón convertiría una celda numérica en texto).
        descarga={
          obtenerFilasDescarga
            ? {
                titulo: TITULO_DESCARGA,
                columnas: COLUMNAS_DESCARGA_WALLET_CAJA,
                obtenerFilas: obtenerFilasDescarga,
              }
            : undefined
        }
      />

      <Modal
        open={objetivo !== null}
        onOpenChange={(next) => {
          if (!next) setObjetivo(null);
        }}
        title="Reversar egreso"
        description={
          objetivo
            ? `Se creará un ajuste compensatorio por ${money(objetivo.monto)}. El egreso original queda intacto.`
            : undefined
        }
        confirmLabel="Reversar"
        confirmVariant="destructive"
        onConfirm={confirmarReversa}
        closeOnConfirm={false}
      />
    </div>
  );
}
