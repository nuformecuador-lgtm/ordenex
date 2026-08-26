"use client";

import { useEffect } from "react";

import { declararTrabajo } from "@/lib/pwa/trabajo-en-curso";

/**
 * Feature 284 — declara que ESTA pantalla tiene trabajo sin guardar.
 *
 * Mientras `activo` sea `true`, el aviso de versión nueva **no se pinta**: una recarga se
 * llevaría lo que el usuario tiene a medias. Al desmontar se retira solo — si el componente se
 * fue, su trabajo también (o se guardó, o se descartó, pero ya no está en pantalla).
 *
 * La clave identifica la superficie y debe ser **estable** dentro de ella. Si hay varias
 * instancias vivas a la vez, la clave debe distinguirlas (por ejemplo con el id de la orden),
 * o la primera en desmontarse retiraría la declaración de la otra.
 *
 * @example
 * useDeclararTrabajo(`gestion:${orden.id}`, hayDatosSinGuardar);
 */
export function useDeclararTrabajo(clave: string, activo: boolean): void {
  useEffect(() => {
    declararTrabajo(clave, activo);
    return () => declararTrabajo(clave, false);
  }, [clave, activo]);
}
