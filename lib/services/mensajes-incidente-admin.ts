// Feature 158 (camino del ADMIN) — motivos TIPADOS y compartidos del rechazo. Patron
// `lib/services/mensajes-deshacer-asignacion.ts` (149) y `mensajes-bloqueo.ts` (46): el service,
// los tests y la UI asertan/traducen sobre ESTAS constantes y no sobre literales duplicados en
// tres sitios.
//
// R48: ninguno de estos textos incluye identificadores internos (UUID de orden, de incidente o
// de usuario) ni datos del destinatario. El unico dato variable que puede aparecer es un `value`
// del catalogo de estados, que es publico y no es PII.

/**
 * R47 — ya hay un incidente VIVO (`solicitado` o `aprobado`) sobre esa orden. Lo detectan LAS
 * DOS mitades: la comprobacion previa del service (mensaje accionable) y el indice unico parcial
 * de la base (la que no se puede saltar en una carrera).
 */
export const MSG_INCIDENTE_YA_EXISTE =
  "esta orden ya tiene un incidente en curso; resuelvelo antes de reportar otro";

/**
 * R42 — la orden no admite el reporte: no existe, esta borrada, no esta en uno de los cinco
 * estados admitidos, o es de otra zona. UN SOLO mensaje para los cuatro casos A PROPOSITO
 * (R48): distinguirlos revelaria a un `adminSatelite` que una orden de otra zona existe.
 */
export const MSG_ORDEN_NO_REPORTABLE =
  "la orden no admite un incidente: revisa que exista y este en bodega o en transito interno";

/**
 * R51 — quien reporta NO aprueba. Es el doble control del dinero que pidio el humano, no una
 * cortesia de la interfaz: el servidor lo rechaza aunque el cliente ofrezca el boton.
 */
export const MSG_AUTOR_NO_RESUELVE =
  "no puedes resolver un incidente que reportaste tu; debe hacerlo otro administrador";

/** R59 — solo el AUTOR puede retractar su propio incidente. */
export const MSG_SOLO_EL_AUTOR_RETRACTA =
  "solo quien reporto el incidente puede retractarlo; otro administrador debe rechazarlo";

/**
 * R53/R59 — el incidente ya no esta `solicitado`. Cubre los dos casos que importan: reintentar
 * una resolucion ya hecha, y querer revertir uno ya APROBADO (el dinero salio; una correccion se
 * hace con un movimiento compensatorio, nunca alterando el emitido).
 */
export const MSG_INCIDENTE_YA_RESUELTO =
  "este incidente ya fue resuelto; si el dinero ya salio, la correccion es un movimiento compensatorio";

/**
 * R58 (fallo CERRADO) — no se pudo derivar el estado de origen del historial, o el derivado no
 * pertenece al conjunto cerrado de los cinco origenes declarados. NUNCA se adivina un destino:
 * el peor caso es «no se puede deshacer», que es seguro.
 */
export const MSG_SIN_ORIGEN_REVERSIBLE =
  "no se pudo determinar el estado desde el que se reporto el incidente";

/** R54: el motivo de rechazo es obligatorio (defensa del service ademas del borde). */
export const MSG_MOTIVO_RECHAZO_REQUERIDO = "El motivo de rechazo es obligatorio.";

/** R50: el monto de la indemnizacion es obligatorio y debe ser > 0 (defensa del service). */
export const MSG_MONTO_REQUERIDO = "El monto de indemnizacion es obligatorio.";

/** Guardia de seed: falta algun `value` del catalogo de estados. */
export const MSG_CATALOGO_INCOMPLETO = "catalogo de estados incompleto (seed pendiente)";
