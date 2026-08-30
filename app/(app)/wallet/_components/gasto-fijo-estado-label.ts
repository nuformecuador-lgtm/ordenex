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

/**
 * FICHA 333 (G4, design §8 · R4) — EL INTERRUPTOR de una plantilla, en palabras.
 *
 * Los DOS textos viven aquí por el mismo motivo que el estado: los leen la TABLA (una insignia) y
 * el DIÁLOGO (el rótulo del control). Con los literales repartidos, un día la tabla diría «Requiere
 * aprobación» y el formulario «Con autorización», y quien las viera juntas no sabría si son la
 * misma cosa.
 *
 * Es un booleano y no un enum —`requiere_aprobacion BOOLEAN`—, así que es una función y no un
 * `Record`, exactamente igual que `estadoPlantillaGastoFijo`.
 */
export const INTERRUPTOR_GASTO_FIJO = {
  /** El cron escribe el egreso en el libro por su cuenta, como antes de la ficha 333. */
  cobraSola: "Cobra sola",
  /** El cron crea un cobro PENDIENTE y el dinero no se mueve hasta que alguien lo apruebe. */
  requiereAprobacion: "Requiere aprobación",
} as const;

export function interruptorPlantillaGastoFijo(requiereAprobacion: boolean): string {
  return requiereAprobacion
    ? INTERRUPTOR_GASTO_FIJO.requiereAprobacion
    : INTERRUPTOR_GASTO_FIJO.cobraSola;
}

/**
 * La ayuda del control en el diálogo: la ÚNICA explicación de qué cambia al moverlo, así que dice
 * las dos posiciones y su consecuencia sobre el dinero. Sin siglas y sin nombrar el cron.
 */
export const AYUDA_INTERRUPTOR_GASTO_FIJO =
  "Encendido, el cobro espera tu aprobación en la wallet y no sale nada de la caja hasta que " +
  "lo apruebes. Apagado, el sistema lo cobra por su cuenta cuando toque.";
