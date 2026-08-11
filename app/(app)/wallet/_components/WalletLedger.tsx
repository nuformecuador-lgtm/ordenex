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
import { cn } from "@/lib/utils";

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

/**
 * Badge de color por tipo: ingreso (entra) vs egreso (sale).
 *
 * Feature 200 (tanda 3): pasa de `default`/`destructive` a las variantes SEMÁNTICAS de la
 * primitiva (`success`/`danger`), el mismo arreglo que la tanda 2 hizo en el badge de signo
 * de la cabecera. `default` es el naranja de MARCA —acción primaria/selección, según
 * `DESIGN.md`—, y usarlo para «Ingreso» hacía que la fila más común de la tabla compitiera en
 * color con los botones. Los textos siguen saliendo de `TIPO_LABEL`, intactos.
 */
function TipoBadge({ tipo }: { tipo: WalletMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "ingreso" ? "success" : "danger"}>
      {TIPO_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripción si la hay. */
function origenTexto(m: WalletMovimientoDTO): string {
  const base = ORIGEN_LABEL[m.origenTipo];
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

/**
 * Importe de una fila. El STRING se pinta TAL CUAL con `money(...)`: money-safe (R21/R25),
 * sin `Number`/`parseFloat`/`toFixed`, y SIN anteponerle signo — el `+`/`-` sería un dato
 * inventado por la pantalla, y quien dice la dirección del movimiento es la columna «Tipo».
 * Lo único que añade el color es LEGIBILIDAD: verde entra, rojo sale, en el tono `-strong`
 * que es el que `DESIGN.md` exige para texto (contraste ≥ 4.5:1 sobre la tarjeta).
 * `tabular-nums` mantiene las cifras en rejilla de una fila a otra.
 */
function MontoCelda({ movimiento }: { movimiento: WalletMovimientoDTO }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        movimiento.tipo === "ingreso" ? "text-success-strong" : "text-danger-strong",
      )}
    >
      {money(movimiento.monto)}
    </span>
  );
}

/** Nombre visible del libro: hoja, base del nombre de archivo y nombre del control (R12/R13). */
const TITULO_DESCARGA = "Libro de movimientos";

export interface WalletLedgerProps {
  movimientos: WalletMovimientoDTO[];
  isLoading?: boolean;
  /** Callback tras reversar con éxito (para que el módulo recargue libro + cifras + desglose). */
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

  // Feature 200 (tanda 3) — LOS `minWidth` Y LA ALINEACIÓN DEL DINERO.
  //
  // Cada columna declara su ancho MÍNIMO para que, cuando la pantalla no dé, aparezca el
  // scroll horizontal de la tabla ANTES de que las celdas se estrujen (la descripción libre
  // del origen es la que primero se partía en cuatro líneas).
  //
  // EL ORDEN NO SE PERMUTÓ, Y NO ES UN OLVIDO. El rediseño pedía llevar el origen junto a la
  // fecha y el dinero al final (fecha · origen · categoría · tipo · monto · acciones), que es
  // como se lee cualquier extracto. Está BLOQUEADO por una aserción que fija la secuencia
  // exacta de los encabezados visibles:
  //
  //     tests/components/descarga/WalletDescarga.test.tsx:566
  //     («R62: el listado los pinta como a los demás, sin cambiar las columnas»)
  //
  // Esa aserción es de la feature 173 y lo que quiere afirmar es otra cosa —que las dos
  // categorías nuevas no AÑADEN ni QUITAN columnas—; el orden se le coló dentro por usar
  // `toEqual` sobre el array. Permutar aquí la pone roja, y esta tanda tiene prohibido tocar
  // tests. Queda como la única decisión abierta de la feature: mover esas seis líneas del
  // test es un cambio de aserción DELIBERADO y necesita aprobación, no un arreglo de paso.
  //
  // Lo que sí llega sin tocar el orden: el dinero alineado a la DERECHA, en `tabular-nums` y
  // con su color semántico, que es de donde venía la mayor parte de la ganancia de lectura.
  const columns = useMemo<Column<WalletMovimientoDTO>[]>(
    () => [
      {
        id: "fecha",
        value: "Fecha",
        minWidth: "7rem",
        render: (m) => m.fechaMovimiento.slice(0, 10),
      },
      {
        id: "tipo",
        value: "Tipo",
        minWidth: "6rem",
        render: (m) => <TipoBadge tipo={m.tipo} />,
      },
      {
        id: "categoria",
        value: "Categoría",
        minWidth: "11rem",
        render: (m) => CATEGORIA_LABEL[m.categoria],
      },
      {
        id: "monto",
        value: "Monto",
        minWidth: "9rem",
        // Money-safe (R21/R25): STRING tal cual, sin parseFloat/Number.
        align: "right",
        render: (m) => <MontoCelda movimiento={m} />,
      },
      {
        id: "origen",
        value: "Origen",
        // La más ancha: lleva el origen Y la descripción libre del movimiento.
        minWidth: "18rem",
        render: (m) => origenTexto(m),
      },
      {
        id: "acciones",
        value: "Acciones",
        minWidth: "7rem",
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
