"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { COMPROBANTE_PANEL_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { verComprobanteAction } from "@/lib/actions/wallet-comprobante";
import type { VerComprobanteResult } from "@/lib/types/wallet-comprobante-lateral";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";

// FICHA 458-D (T D.5; R35, R77, R78, H3) — la tienda VE en `/mi-wallet` el comprobante que subió
// Ordenex, en las filas de SU libro que pueden llevarlo: el pago de Ordenex a la tienda, el pago de un
// gasto por ella, el cobro de Ordenex y su propio pago a Ordenex.
//
// Solo mirar (R35): ni adjuntar ni reemplazar. El enlace es temporal y lo genera el SERVIDOR tras
// comprobar que la fila es de la tienda de la sesión (`verComprobanteAction`, alcance de la 458-B): una
// fila ajena o inexistente responde «no encontrado», igual (R77). El destino viaja y nunca se pinta.
//
// Decisión (pendiente 4 de la 458-C): `/mi-wallet` NO usa `obtenerComprobante{Abono,PagoPorCuenta}Action`
// —la acción única ya lee también el comprobante de esos documentos— y así la tienda tiene UN camino.

/** Las filas del libro de la tienda que pueden llevar comprobante (R78). */
export const CATEGORIAS_CON_COMPROBANTE: ReadonlySet<WalletTiendaMovimientoCategoria> = new Set([
  "pago_tienda",
  "pago_por_cuenta",
  "cobro_manual",
  "abono_tienda",
]);

export interface VerComprobanteMiMovimientoProps {
  movimientoId: string;
  /** El concepto leído desde la tienda y el día: el rótulo legible (R80), nunca la ruta. */
  concepto: string;
  fecha: string;
}

export function VerComprobanteMiMovimiento({ movimientoId, concepto, fecha }: Readonly<VerComprobanteMiMovimientoProps>) {
  // El aviso va JUNTO al botón (no en un toast): la tabla de `/mi-wallet` se monta en superficies
  // sin proveedor de avisos, y un fallo al abrir el comprobante se lee donde se pidió.
  const [aviso, setAviso] = useState<string | null>(null);
  const rotulo = COMPROBANTE_PANEL_TEXTO.rotulo(concepto, fecha);

  async function ver() {
    // La pestaña se abre ANTES de esperar al servidor: tras un `await` el navegador la bloquea.
    const pestana = window.open("", "_blank");
    setAviso(null);
    let r: VerComprobanteResult;
    try {
      r = await verComprobanteAction({ destino: { libro: "tienda", movimientoId } });
    } catch {
      pestana?.close();
      setAviso(COMPROBANTE_PANEL_TEXTO.verFallo);
      return;
    }
    if (r.status === "ok") {
      if (pestana) {
        pestana.opener = null;
        pestana.location.href = r.url;
      } else {
        window.open(r.url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    pestana?.close();
    const mensaje: Record<Exclude<VerComprobanteResult["status"], "ok">, string> = {
      sin_comprobante: COMPROBANTE_PANEL_TEXTO.verSin,
      no_encontrado: COMPROBANTE_PANEL_TEXTO.verNoEncontrado,
      forbidden: COMPROBANTE_PANEL_TEXTO.verForbidden,
      unauthenticated: COMPROBANTE_PANEL_TEXTO.unauthenticated,
      validation_error: COMPROBANTE_PANEL_TEXTO.verFallo,
    };
    setAviso(mensaje[r.status]);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`${COMPROBANTE_PANEL_TEXTO.ver}: ${rotulo}`}
        onClick={() => void ver()}
      >
        {COMPROBANTE_PANEL_TEXTO.ver}
      </Button>
      {aviso === null ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {aviso}
        </p>
      )}
    </div>
  );
}
