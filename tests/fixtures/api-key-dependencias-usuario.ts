// FICHA 373 (R17, design §3) — EL CENSO DE TODA RELACION DECLARADA HACIA `Usuario`, CLASIFICADA.
//
// POR QUE EXISTE, y por que se mantiene A MANO. El borrado de una API key borra tambien la fila de
// `usuario` de su cuenta dedicada. Toda FK del esquema que apunte a `usuario` es, por tanto, una
// posible sorpresa: o la para Postgres (`Restrict`/`NoAction`) y el borrado revienta, o NO la para
// (`Cascade`/`SetNull`) y algo desaparece o se desconecta EN SILENCIO. Las de esa segunda columna
// son las peligrosas, y por eso van marcadas.
//
// Este archivo vive en el lado de los TESTS a proposito. Es la lista escrita por una persona,
// contra la que la guardia compara el esquema REAL. Derivarla del esquema la dejaria siempre verde
// —«asercion contra su propia fuente», leccion ya escrita en este repo— y no detectaria nada.
//
// LA CLAVE es `Modelo.campo` tal y como aparece en `db/schema.prisma`. Una relacion nueva que no
// figure aqui pone la guardia ROJA: es la respuesta concreta a «¿y si el borrado falla por una FK
// que no previste?». No se confia en que alguien se acuerde.

/**
 * Las TRES categorias de R17, y ni una mas: cada relacion cae en EXACTAMENTE una.
 *
 * - `bloquea`            — impide el borrado. O directamente (la comprueba el guard, §4.1) o por la
 *                          via de la orden: la fila solo puede existir si existio una orden de esa
 *                          cuenta, y las ordenes NUNCA desaparecen de la tabla (soft delete).
 * - `se_borra_con_ella`  — desaparece —la fila o su vinculo— dentro de la MISMA transaccion del
 *                          borrado, a proposito y con el motivo escrito.
 * - `no_alcanzable`      — una cuenta dedicada (rol `apiKey`) no puede llegar a producir esta fila.
 *                          EXIGE motivo escrito.
 */
export const CATEGORIAS_FK_USUARIO = ["bloquea", "se_borra_con_ella", "no_alcanzable"] as const;

export type CategoriaFkUsuario = (typeof CATEGORIAS_FK_USUARIO)[number];

export interface ClasificacionFk {
  categoria: CategoriaFkUsuario;
  /** POR QUE. Obligatorio en las tres categorias: una clasificacion sin motivo no se puede revisar. */
  motivo: string;
}

/** Motivos que se repiten palabra por palabra; se nombran una vez para que no diverjan. */
const SOLO_MENSAJERO = "exige rol `mensajero`: una cuenta dedicada nunca reparte.";
const SOLO_OPERADOR =
  "exige un operador HUMANO con sesion (maestro/admin/adminSatelite). La cuenta dedicada no entra " +
  "por el formulario de login: su contrasena es aleatoria y no se le revela a nadie.";
const VIA_ORDEN =
  "solo puede existir si existio una orden de esa cuenta, y una orden nunca desaparece de la tabla " +
  "(soft delete): la bloquea la comprobacion #1 del guard, y ademas su FK lo pararia.";

export const CLASIFICACION_FK_USUARIO: Record<string, ClasificacionFk> = {
  // ── Las CUATRO que el guard comprueba una a una (design §4.1) ────────────────────────────────
  "Orden.tienda": {
    categoria: "bloquea",
    motivo:
      "R8. La cuenta dedicada es la duena de sus ordenes cuando la key no tiene tienda destino. " +
      "El `EXISTS` NO filtra `deleted_at`: una orden borrada conserva su fila y su FK.",
  },
  "Tarifa.tienda": {
    categoria: "bloquea",
    motivo:
      "R10. ⚠️ Su FK es CASCADE: Postgres NO la pararia, borraria las tarifas en silencio y SIN " +
      "fila de auditoria. Aqui el guard es la UNICA defensa. Decision del humano (2026-09-04): " +
      "una tarifa es configuracion de dinero y no desaparece dentro de «eliminar una API key».",
  },
  "WalletTiendaMovimiento.tienda": {
    categoria: "bloquea",
    motivo: "R9. Un movimiento del libro de tienda a su nombre es dinero registrado.",
  },
  "LiquidacionPago.tienda": {
    categoria: "bloquea",
    motivo: "R9. Un pago de liquidacion a su nombre es dinero registrado.",
  },

  // ── Las que bloquean POR LA VIA DE LA ORDEN (red de FK, R16) ─────────────────────────────────
  "Carga.usuario": { categoria: "bloquea", motivo: `Un lote de carga masiva por API: ${VIA_ORDEN}` },
  "OrdenHabilitacionApi.actor": {
    categoria: "bloquea",
    motivo: `Solo hay habilitacion si hubo orden que habilitar: ${VIA_ORDEN}`,
  },
  "OrdenHistorialEstado.actor": {
    categoria: "bloquea",
    motivo:
      "⚠️ Su FK es SET NULL: no bloquea por si sola. Solo existe si la cuenta actuo sobre una " +
      `orden propia (\`cancelarViaApi\`), y esa orden si bloquea. ${VIA_ORDEN}`,
  },
  "HistorialAccion.actor": {
    categoria: "bloquea",
    motivo:
      "Solo existe si la cuenta borro una orden propia por API (`softDeleteViaApi`). " +
      `${VIA_ORDEN} ⚠️ Ojo: la fila de auditoria de ESTA ficha lleva de actor al MAESTRO, no a la ` +
      "cuenta dedicada, asi que no se auto-bloquea.",
  },
  "CierreDetail.tienda": {
    categoria: "bloquea",
    motivo:
      `Deriva de ordenes suyas ya liquidadas. ${VIA_ORDEN} NO se comprueba en el guard a proposito: ` +
      "`cierre_detail` no declara indice por `tienda_id`, asi que un `EXISTS` sin coincidencias " +
      "recorreria entera una tabla que crece con cada cierre, en cada pintado del listado.",
  },
  "AnalyticsDaily.tienda": { categoria: "bloquea", motivo: `Deriva de ordenes suyas. ${VIA_ORDEN}` },
  "RechazoTiendaCobro.tienda": {
    categoria: "bloquea",
    motivo: `Deriva de ordenes suyas rechazadas. ${VIA_ORDEN}`,
  },
  "Notificacion.tienda": {
    categoria: "bloquea",
    motivo:
      "⚠️ Su FK es CASCADE: no bloquea por si sola. Deriva de ordenes suyas, y esas si bloquean. " +
      `${VIA_ORDEN}`,
  },
  "Notificacion.destinatarioUsuario": {
    categoria: "bloquea",
    motivo:
      "⚠️ Su FK es CASCADE: no bloquea por si sola. Misma via que `Notificacion.tienda`: las " +
      `notificaciones de esa cuenta derivan de sus ordenes. ${VIA_ORDEN}`,
  },

  // ── Las que se van CON la cuenta dedicada, dentro de la misma transaccion ────────────────────
  "ApiKey.usuario": {
    categoria: "se_borra_con_ella",
    motivo: "R2-a. Es la relacion 1:1 con la propia key: se borra la key y despues su cuenta.",
  },
  "WebhookSuscripcion.owner": {
    categoria: "se_borra_con_ella",
    motivo:
      "R2-c. 0..1 por owner. El `deleteMany` va ACOTADO a `ownerUsuarioId` = la cuenta dedicada: " +
      "si la key tiene tienda destino, la suscripcion de LA TIENDA no casa y sobrevive (R5).",
  },
  "LoginAttempt.usuario": {
    categoria: "se_borra_con_ella",
    motivo:
      "Se borra EL VINCULO, no la fila: la FK es SET NULL y `login_attempt` conserva `email_usado`, " +
      "`ip` y `risk_reason`, que es lo que la hace util. Decision 6 del humano (2026-09-04): los " +
      "intentos de login contra el email sintetico NO cuentan como rastro que proteger. Se dice en " +
      "voz alta en vez de esconderlo, porque es la unica relacion ALCANZABLE que no bloquea.",
  },

  // ── Las que una cuenta dedicada no puede producir ────────────────────────────────────────────
  "PlantillaMensaje.creador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "ChatConversacion.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "MensajeroDocumento.usuario": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "TrustedDevice.usuario": {
    categoria: "no_alcanzable",
    motivo:
      "La cuenta dedicada NUNCA autentica por el formulario: su contrasena se genera al azar y no " +
      "se revela. Entra por `key_hash`, que es otro camino y no toca esta tabla.",
  },
  "EmailOtpChallenge.usuario": {
    categoria: "no_alcanzable",
    motivo: "Mismo motivo que `TrustedDevice.usuario`: la cuenta no pasa por el login con OTP.",
  },
  "Orden.mensajeroAsignado": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "OrdenMensajeroMeta.usuario": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "OrdenNota.autor": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "GestionOrden.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "GestionOrden.anuladaPorUsuario": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "GestionOrden.pagosEditadosPorUsuario": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "OrdenIncidente.reportadoPorUsuario": {
    categoria: "no_alcanzable",
    motivo: `Lo reporta un mensajero o un operador: ${SOLO_OPERADOR}`,
  },
  "OrdenIncidente.resueltoPorUsuario": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "CierreDia.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "CierreDia.resueltoPorUsuario": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "CierreBodega.solicitadoPorUsuario": {
    categoria: "no_alcanzable",
    motivo: `Lo solicita un mensajero o un adminSatelite: ${SOLO_OPERADOR}`,
  },
  "CierreBodega.resueltoPorUsuario": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "WalletMovimiento.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "WalletTiendaMovimiento.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "PagoMensajeroMovimiento.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "PagoMensajeroMovimiento.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "LiquidacionPago.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "LiquidacionPago.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "LiquidacionAnulacion.anulador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "LiquidacionReparto.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "LiquidacionReparto.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "GastoFijoCobro.decisor": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "RechazoTiendaCobro.decisor": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "ApiKey.createdBy": {
    categoria: "no_alcanzable",
    motivo: "Solo un `maestro` genera API keys; una cuenta dedicada no genera nada.",
  },
  "ApiKey.tiendaDestino": {
    categoria: "no_alcanzable",
    motivo:
      "`ApiKeyService.generar` exige que la tienda destino sea `adminTienda` y este activa: " +
      "apuntar una key a otra cuenta `apiKey` encadenaria credenciales y esta prohibido.",
  },
  "RutaOptimizada.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "NotificacionLectura.usuario": {
    categoria: "no_alcanzable",
    motivo: `Marcar una notificacion como leida es un acto de pantalla: ${SOLO_OPERADOR}`,
  },
  "AnalyticsDaily.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "RankingSnapshotFila.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "PostulacionRecurso.atendidaPor": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "OrdenDiaRepartoCambio.actor": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "GestionFechaReprogramacionCambio.actor": {
    categoria: "no_alcanzable",
    motivo: `Corregir la fecha de una reprogramacion es solo de maestro/admin: ${SOLO_OPERADOR}`,
  },
};
