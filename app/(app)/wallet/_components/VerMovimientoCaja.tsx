"use client";

import { useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { METODO_LIQUIDACION_LABEL } from "@/components/shared/liquidacion/liquidacion-labels";
import { OrigenMovimiento } from "@/components/shared/wallet/OrigenMovimiento";
import { DetalleMovimientoPanel, type DetalleMovimiento } from "@/components/shared/wallet/DetalleMovimientoPanel";
import { COBRO_RECHAZO_TEXTO, PANEL_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { autoriaDelLibroCajaAction } from "@/lib/actions/libro-caja-autoria";
import type { AutoriaDeFilaDTO, ComoDTO } from "@/lib/types/libro-caja-autoria";
import type { DocumentoCajaDTO, WalletMovimientoDTO } from "@/lib/types/wallet";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

import { CATEGORIA_LABEL, DOCUMENTO_CAJA_NOMBRE, ORIGEN_LABEL, money } from "./wallet-labels";

// FICHA 458-C (T C.5, design §5.2; R58, R63–R67, R71, R79, R100) — el «Ver» de una fila del libro de
// la caja ACTUAL. Sustituye a la columna de acciones de antes: «Reversar» (y su `Modal`) y
// `DocumentoCajaAcciones` se retiran, y lo que hacían vive en el panel compartido
// (`DetalleMovimientoPanel`): anular (uniforme, por `anularMovimientoAction`), ver y adjuntar el
// comprobante, «Cómo quedó».
//
// Vive FUERA de `WalletLedger.tsx` a propósito, como vivía `DocumentoCajaAcciones`: el libro es
// presentación y no importa Server Actions; esta pieza lee la autoría AL ABRIR (una fila, una
// lectura) y el panel lee «Cómo quedó» al abrir.
//
// Todo lo que decide el estado lo trae la fila del SERVIDOR (`documento`, R71): anulado, anulable,
// comprobante. Ninguna otra fila de la página se mira (guardia R98).

/** Los documentos cuyo comprobante es LATERAL (se puede adjuntar después, R79). */
const ADMITE_ADJUNTAR: ReadonlySet<DocumentoCajaDTO["tipo"]> = new Set([
  "egreso_caja",
  "ajuste_caja",
  "cobro_tienda",
  "indemnizacion",
]);

async function leerAutoria(movimientoId: string): Promise<AutoriaDeFilaDTO> {
  const r = await autoriaDelLibroCajaAction({ movimientoIds: [movimientoId] });
  if (r.status !== "ok") throw new Error(r.status);
  const fila = r.filas.find((f) => f.movimientoId === movimientoId);
  if (fila === undefined) throw new Error("sin_autoria");
  return fila;
}

/** M1 (R58): el «cómo» del servidor, en palabras; `null` = la fila no lo registra («—»). */
function textoComo(como: ComoDTO | null): string | null {
  if (como === null) return null;
  return PANEL_TEXTO.comoTexto(como.metodo === null ? null : METODO_LIQUIDACION_LABEL[como.metodo], como.referencia);
}

/**
 * La fila del libro → lo que el panel necesita. Pura: no mira ninguna otra fila.
 *
 * `autoria` (la lectura de ESA fila al abrir): `undefined` = cargando, `null` = no se pudo leer. De ella
 * salen el «cómo» y quién anuló, cuándo y por qué (M1 de la revisión, R58); el «anulado» sigue siendo
 * el `documento` que trae la fila del servidor (R71).
 */
export function detalleDeFilaCaja(m: WalletMovimientoDTO, autoria?: AutoriaDeFilaDTO | null): DetalleMovimiento {
  const concepto = CATEGORIA_LABEL[m.categoria];
  const documento = m.documento;
  const anulacion = autoria?.anulacion ?? null;
  return {
    destino: { libro: "caja", movimientoId: m.id },
    concepto,
    fecha: fechaDiaMovimientoCR(m.fechaMovimiento),
    monto: m.monto,
    direccion: m.tipo === "ingreso" ? "entra" : "sale",
    motivo: m.descripcion,
    origen: <OrigenMovimiento fila={m} rotulos={ORIGEN_LABEL} />,
    como: autoria === undefined ? PANEL_TEXTO.cargando : autoria === null ? null : textoComo(autoria.como ?? null),
    // B3 (revisión 458-C): sin documento el servidor no dijo nada del estado → el panel no afirma «Vigente».
    estado:
      documento === null
        ? null
        : {
            anulado: documento.anulado,
            motivoNoRegistrado: documento.motivoNoRegistrado,
            detalle: documento.anulado && anulacion !== null ? anulacion : null,
          },
    anulable: documento !== null && !documento.anulado,
    nombreParaAnular:
      documento === null
        ? `«${concepto}»`
        : documento.tipo === "egreso_caja"
          ? `«${concepto}»`
          : DOCUMENTO_CAJA_NOMBRE[documento.tipo],
    tieneComprobante: documento?.tieneComprobante ?? false,
    admiteAdjuntar: documento !== null && ADMITE_ADJUNTAR.has(documento.tipo),
    nota:
      documento?.tipo === "rechazo_tienda_cobro"
        ? documento.anulado
          ? COBRO_RECHAZO_TEXTO.anulado
          : COBRO_RECHAZO_TEXTO.vigente
        : null,
  };
}

export interface VerMovimientoCajaProps {
  movimiento: WalletMovimientoDTO;
  /** Tras anular o adjuntar: el módulo relee libro, tarjetas, composición y desglose (R60). */
  onCambio?: () => void;
}

export function VerMovimientoCaja({ movimiento, onCambio }: VerMovimientoCajaProps) {
  const [abierto, setAbierto] = useState(false);
  const { data, error } = useSWR(
    abierto ? (["wallet:autoria-caja", movimiento.id] as const) : null,
    () => leerAutoria(movimiento.id),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );
  const detalle = detalleDeFilaCaja(movimiento, error !== undefined ? null : data);
  const nombreVer = movimiento.documento?.anulado ? PANEL_TEXTO.verNombreAnulado : PANEL_TEXTO.verNombre;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={nombreVer(detalle.concepto, detalle.fecha, money(movimiento.monto))}
        onClick={() => setAbierto(true)}
      >
        {PANEL_TEXTO.ver}
      </Button>
      {abierto ? (
        <DetalleMovimientoPanel
          abierto={abierto}
          onAbiertoChange={setAbierto}
          movimiento={detalle}
          autoria={error !== undefined ? null : data}
          onCambio={onCambio}
        />
      ) : null}
    </>
  );
}
