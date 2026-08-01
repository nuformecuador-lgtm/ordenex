/**
 * Feature 170 (T D.3) — etiqueta legible del estado de una plantilla de gasto fijo.
 *
 * PROMOVIDA sin editar ni un texto desde `GastosFijosPlantillasPanel.tsx`, donde estaba
 * inline dentro del `Badge` (`p.activa ? "Activa" : "Inactiva"`). El módulo de export
 * necesita la etiqueta y no puede arrastrar React, así que el texto vive aquí y lo leen los
 * dos: el panel y el archivo. Misma operación que `usuario-estado-label` (tanda B).
 *
 * El estado es un booleano, no un enum: por eso es una función y no un `Record`.
 */
export function estadoPlantillaGastoFijo(activa: boolean): string {
  return activa ? "Activa" : "Inactiva";
}
