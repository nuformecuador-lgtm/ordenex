"use client";

import { useCallback, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { useRecogerPorGuia } from "./useRecogerPorGuia";

// Recoger por número de guía (feature 96, hermano de `EscanerRecoger`): el mensajero
// teclea el num_guia y confirma con Enter (submit del form) o el botón. Comparte con el
// escáner la lógica "resolver numGuia contra porRecoger -> recoger -> toast + revalidar"
// via `useRecogerPorGuia`. A diferencia del escáner NO parsea una URL: el texto tecleado
// ES el número, se compara directo contra `numGuia`. Recoge DIRECTO al confirmar (sin
// modal), consistente con la cámara; limpia el input y revalida la lista en éxito.

export interface InputRecogerProps {
  /** Órdenes en `en_espera_aceptacion` (por recoger): resuelven numGuia -> id. */
  porRecoger: MiAsignacionDTO[];
  /** Se invoca tras una recogida exitosa (el módulo lo conecta a router.refresh()). */
  onRecogida: () => void;
}

export function InputRecoger({ porRecoger, onRecogida }: Readonly<InputRecogerProps>) {
  const { recoger, procesando } = useRecogerPorGuia(porRecoger);
  const [valor, setValor] = useState("");
  const inputId = useId();

  const confirmar = useCallback(async () => {
    const texto = valor.trim();
    // Robustez: vacío o no-entero-positivo no resuelve a ninguna guía; no llamamos la
    // action (mismo criterio de `num_guia` que la URL del paquete: dígitos base 10).
    if (!/^\d+$/.test(texto)) return;
    const ok = await recoger(Number(texto));
    if (ok) {
      setValor("");
      onRecogida();
    }
  }, [valor, recoger, onRecogida]);

  return (
    <section
      aria-label="Recoger por número de guía"
      className="flex flex-col gap-3"
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void confirmar();
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-sm font-medium">
            Número de guía
          </label>
          <Input
            id={inputId}
            inputMode="numeric"
            autoComplete="off"
            value={valor}
            disabled={procesando}
            onChange={(event) => setValor(event.target.value)}
            placeholder="Ingresa el número de guía"
          />
        </div>
        <Button type="submit" disabled={procesando || valor.trim() === ""}>
          Recoger
        </Button>
      </form>
    </section>
  );
}
