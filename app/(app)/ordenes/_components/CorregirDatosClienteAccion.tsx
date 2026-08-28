"use client";

import { useState } from "react";
import { PencilLine } from "lucide-react";
import { useSWRConfig } from "swr";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { corregirDatosCliente } from "@/lib/actions/corregir-datos-cliente";
import { estadoAdmiteCorreccion } from "@/lib/types/correccion-datos-cliente";

import {
  CorregirDatosClienteModal,
  type CorregirDatosClienteOrdenUI,
} from "./CorregirDatosClienteModal";

/**
 * Forma minima del disparador: la de la ventana, con el estado dentro (ya lo lleva
 * `CorregirDatosClienteOrdenUI`), que es lo que decide si la accion se ofrece. La cumple por
 * estructura `OrdenListItemDTO`.
 */
export type CorregirDatosClienteAccionOrden = CorregirDatosClienteOrdenUI;

export interface CorregirDatosClienteAccionProps {
  /** Orden de la fila. De UNA en una: los cuatro campos son propios de cada orden (design §8/F). */
  orden: CorregirDatosClienteAccionOrden;
  /**
   * ¿La superficie autoriza la accion sobre esta fila? Es el criterio de ROL, que vive en la
   * pantalla que lo conoce (`/ordenes` lo enciende solo para `maestro`/`admin`). Sin la prop, la
   * decision queda entera en manos del estado.
   */
  disponible?: boolean;
  /**
   * Que hacer tras una correccion exitosa. Por defecto revalida el listado de `/ordenes` por su
   * prefijo de key SWR (igual que `ReportarIncidenteAccion`), que es R29: los valores nuevos se
   * pintan de lo que devuelve el SERVIDOR, no de un estado local optimista.
   */
  onSuccess?: () => void;
}

/** Nombre accesible y tooltip del disparador (texto separado, i18n-ready). */
export const CORREGIR_DATOS_ACCION_LABEL = "Corregir datos";

/**
 * FICHA 312 (E2, design §9.1) — accion POR FILA «Corregir datos» del modulo de ordenes. Patron
 * autocontenido de `ReportarIncidenteAccion` (158): estado `open` propio + disparador + ventana.
 *
 * **No se renderiza NADA cuando la accion no aplica** —ni un boton deshabilitado— por el mismo
 * motivo que su hermana: una accion visible que el servidor va a rechazar es una invitacion al
 * error, y un boton apagado en un estado que nadie puede cambiar no le dice nada util a nadie.
 *
 * **FALLO CERRADO (R24).** Las dos condiciones se combinan con `&&` y NO con `??`: el estado se
 * consulta SIEMPRE, incluso cuando la superficie dice que si. `estadoAdmiteCorreccion` devuelve
 * `false` ante un `estatusValue` ausente (una fila sin estatus en el DTO, un fixture viejo), asi que
 * la ausencia de dato no habilita nada. El icono es `PencilLine`, propio de esta accion: ninguna
 * otra de la fila edita un dato.
 *
 * El servidor revalida rol, pertenencia y estado igualmente, en CADA peticion (R25): esto solo
 * evita el clic imposible.
 */
export function CorregirDatosClienteAccion({
  orden,
  disponible,
  onSuccess,
}: Readonly<CorregirDatosClienteAccionProps>) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);

  const seOfrece = (disponible ?? true) && estadoAdmiteCorreccion(orden.estatusValue);
  if (!seOfrece) return null;

  function handleSuccess() {
    setOpen(false);
    if (onSuccess) {
      onSuccess();
      return;
    }
    void mutate(
      (key) => Array.isArray(key) && key[0] === "ordenes:list",
      undefined,
      { revalidate: true },
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(true)}
              aria-label={`${CORREGIR_DATOS_ACCION_LABEL} de la orden ${orden.numRemision}`}
            >
              <PencilLine className="size-4" aria-hidden="true" />
            </Button>
          }
        />
        <TooltipContent>{CORREGIR_DATOS_ACCION_LABEL}</TooltipContent>
      </Tooltip>
      <CorregirDatosClienteModal
        open={open}
        orden={orden}
        onOpenChange={setOpen}
        // El cable de ESTA superficie. Ver `EnviarCorreccion`: la ventana es compartida y no
        // importa la accion, cada pantalla ensena la suya.
        corregir={(entrada) => corregirDatosCliente(entrada)}
        onSuccess={handleSuccess}
      />
    </>
  );
}
