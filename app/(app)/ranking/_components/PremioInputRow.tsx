"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { editarPremioAction } from "@/lib/actions/ranking";
import type { PremioRankingDTO } from "@/lib/types/ranking";

import { PREMIOS_FEEDBACK, PREMIOS_LABELS, money } from "./ranking-labels";

// Feature 76 (T9) — fila de una posición del podio en la tabla de premios. Muestra el
// ocupante ELEGIBLE de esa posición (R14; `null` = posición sin ocupante, NO se inventa,
// R15) junto a su premio. Si `esEditable` (maestro, R16) ofrece DOS inputs abiertos
// —monto (vacío = sin premio, R9) y descripción (texto libre, vacío = sin descripción,
// R25)— y un botón que llama a `editarPremioAction` (Server Action, NUNCA fetch a /api).
// El mensajero (R17) ve todo en solo-lectura, incluida la descripción. Money-safe: el
// monto se muestra TAL CUAL con `money`, sin parseFloat/Number.

export interface PremioInputRowProps {
  premio: PremioRankingDTO;
  /** Nombre del mensajero que ocupa esta posición del podio; `null` si no hay ocupante (R15). */
  ocupanteNombre: string | null;
  /** Solo el maestro edita (R16); el mensajero recibe `false` → solo-lectura (R17). */
  esEditable: boolean;
}

export function PremioInputRow({
  premio,
  ocupanteNombre,
  esEditable,
}: PremioInputRowProps) {
  const router = useRouter();
  const toast = useToast();

  const [monto, setMonto] = useState(premio.monto ?? "");
  const [descripcion, setDescripcion] = useState(premio.descripcion ?? "");
  const [guardando, setGuardando] = useState(false);

  const ocupanteLabel = ocupanteNombre ?? PREMIOS_LABELS.sinOcupante;

  async function guardar() {
    setGuardando(true);
    try {
      // El borde (zod de la action) trata "" → null en ambos campos (R9/R25). No
      // pre-parseamos el monto en cliente: money-safe, el servidor valida con Decimal.
      const result = await editarPremioAction({
        posicion: premio.posicion,
        monto: monto.trim() === "" ? null : monto.trim(),
        descripcion: descripcion.trim() === "" ? null : descripcion.trim(),
      });

      if (result.status === "ok") {
        toast.success(PREMIOS_FEEDBACK.guardado);
        router.refresh(); // R10: refleja el cambio en la siguiente lectura
        return;
      }
      if (result.status === "invalid") {
        toast.error(result.message ?? PREMIOS_FEEDBACK.invalid);
        return;
      }
      if (result.status === "forbidden") {
        toast.error(PREMIOS_FEEDBACK.forbidden);
        return;
      }
      // unauthenticated
      toast.error(PREMIOS_FEEDBACK.unauthenticated);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <tr className="border-b">
      <th scope="row" className="px-3 py-2 align-middle font-medium">
        {premio.posicion}
      </th>
      <td className="px-3 py-2 align-middle">{ocupanteLabel}</td>

      {esEditable ? (
        <>
          <td className="px-3 py-2 align-middle">
            <Input
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              disabled={guardando}
              aria-label={`${PREMIOS_LABELS.monto} — posición ${premio.posicion}`}
              placeholder={PREMIOS_LABELS.montoPlaceholder}
            />
          </td>
          <td className="px-3 py-2 align-middle">
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              disabled={guardando}
              aria-label={`${PREMIOS_LABELS.descripcionPremio} — posición ${premio.posicion}`}
              placeholder={PREMIOS_LABELS.descripcionPlaceholder}
            />
          </td>
          <td className="px-3 py-2 align-middle">
            <Button
              type="button"
              size="sm"
              disabled={guardando}
              onClick={() => void guardar()}
            >
              {guardando ? PREMIOS_LABELS.guardando : PREMIOS_LABELS.guardar}
            </Button>
          </td>
        </>
      ) : (
        <>
          {/* Solo-lectura (R17): monto (R9) y descripción (R25) sin inputs. */}
          <td className="px-3 py-2 align-middle">
            {premio.monto === null ? (
              <span className="text-muted-foreground">
                {PREMIOS_LABELS.sinMonto}
              </span>
            ) : (
              money(premio.monto)
            )}
          </td>
          <td className="px-3 py-2 align-middle">
            {premio.descripcion === null ? (
              <span className="text-muted-foreground">
                {PREMIOS_LABELS.sinDescripcion}
              </span>
            ) : (
              premio.descripcion
            )}
          </td>
        </>
      )}
    </tr>
  );
}
