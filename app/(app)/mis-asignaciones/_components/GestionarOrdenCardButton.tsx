"use client";

import { useState } from "react";
import { Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Rama ux (pedido humano): llevar una orden al panel de detalle deja de ser un TOQUE en
// cualquier parte de la card —se disparaba sin querer al manipular la lista— y pasa por un
// control explícito al pie, en la misma línea que "Gestionar más tarde" y en el extremo
// opuesto.
//
// Y no confirma solo: gestionar una orden fuera del orden sugerido puede cambiar la ruta de
// reparto, así que el mensajero lo acepta a mano en un modal (aceptar/cancelar) antes de que
// pase nada. Cancelar no toca nada.

const TITULO = "¿Gestionar esta orden?";
const AVISO =
  "Si gestionas esta orden fuera del orden sugerido, tu ruta de reparto puede cambiar.";
const ACEPTAR = "Aceptar";
const CANCELAR = "Cancelar";

export interface GestionarOrdenCardButtonProps {
  /** Nº de remisión; solo para el nombre accesible del control y del modal. */
  numRemision: string;
  /** Confirmación del mensajero: lleva esta orden al panel de detalle. */
  onConfirmar: () => void;
  /**
   * Mensajero bloqueado (cierre pendiente), gestión activa en otra orden, o —desde la feature
   * 261 (R12)— orden reservada para un día de reparto posterior. Quién lo decide y por qué vive
   * en el llamador (`RepartoModule.renderCardEnReparto`); aquí sólo se apaga el control.
   *
   * ⚠️ Apagar el botón dice QUE no se puede, no POR QUÉ. El motivo va SIEMPRE en palabras al
   * lado —el aviso de bloqueo total arriba, o la línea de la card en el caso de la reserva—:
   * un control gris sin explicación es un misterio, y es la regla que el repo ya sigue.
   */
  disabled?: boolean;
}

export function GestionarOrdenCardButton({
  numRemision,
  onConfirmar,
  disabled = false,
}: Readonly<GestionarOrdenCardButtonProps>) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        aria-label={`Gestionar la orden ${numRemision}`}
        onClick={() => setAbierto(true)}
      >
        <Truck aria-hidden="true" />
        Gestionar
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{TITULO}</DialogTitle>
            <DialogDescription>{AVISO}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAbierto(false)}
            >
              {CANCELAR}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setAbierto(false);
                onConfirmar();
              }}
            >
              {ACEPTAR}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
