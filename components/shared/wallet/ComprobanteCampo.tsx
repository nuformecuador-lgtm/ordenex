"use client";

import { useRef } from "react";

import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import { WALLET_COMPROBANTE_MIME } from "@/lib/config/wallet-comprobante";
import { problemaDeComprobante } from "@/lib/utils/comprobante";

import { COMPROBANTE_CAMPO_TEXTO } from "./registrar-movimiento-labels";

// FICHA 458-C (T C.3, design §4.1, R74–R76) — el campo del comprobante, OPCIONAL en todo concepto
// (H1). El tipo y el tamaño se avisan ANTES de enviar con `problemaDeComprobante`, la MISMA pieza pura
// que usan el borde y el servicio (459): así el aviso de la pantalla y el rechazo del servidor no
// pueden decir cosas distintas. Un archivo que no pasa se descarta del estado (no viaja) y el motivo
// queda bajo el campo; el servidor sigue siendo quien decide (R75/R76).

export interface ComprobanteCampoProps {
  id: string;
  /** El archivo elegido (válido) o `null`. */
  archivo: File | null;
  onCambiar: (archivo: File | null) => void;
  /** El error bajo el campo: el del cliente o el que devolvió el servidor. */
  error?: string;
  onError: (mensaje: string | undefined) => void;
  label?: string;
}

export function ComprobanteCampo({
  id,
  archivo,
  onCambiar,
  error,
  onError,
  label = COMPROBANTE_CAMPO_TEXTO.label,
}: ComprobanteCampoProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function elegir(elegido: File | null) {
    if (elegido === null) {
      onCambiar(null);
      onError(undefined);
      return;
    }
    const problema = problemaDeComprobante(elegido);
    if (problema !== null) {
      // R75: se explica bajo el campo y el archivo NO viaja.
      onCambiar(null);
      onError(problema);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onCambiar(elegido);
    onError(undefined);
  }

  return (
    <FormField id={id} label={label} hint={COMPROBANTE_CAMPO_TEXTO.hint} error={error}>
      {(control) => (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            {...control}
            ref={inputRef}
            type="file"
            accept={WALLET_COMPROBANTE_MIME.join(",")}
            onChange={(e) => elegir(e.target.files?.[0] ?? null)}
          />
          {archivo === null ? null : (
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                elegir(null);
              }}
            >
              {COMPROBANTE_CAMPO_TEXTO.quitar}
            </button>
          )}
        </div>
      )}
    </FormField>
  );
}
