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
  // FICHA 454 (2026-09-23): el actor de un hecho de orden. La cuenta de una key solo aparece aqui
  // como actor de `ayuda_habilitada_api`, que exige una orden propia con ayuda abierta.
  "OrdenEvento.actor": {
    categoria: "bloquea",
    motivo: `Solo hay hecho si hubo orden sobre la que actuar (habilitacion por API): ${VIA_ORDEN}`,
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
  // FICHA 427 — el rastro del traspaso entre mensajeros. TRES FKs a `usuario`, las tres `Restrict`
  // y las tres INALCANZABLES para una cuenta dedicada de API key:
  //   · los dos extremos exigen rol `mensajero`;
  //   · el actor exige un operador HUMANO con `esAccesoTotal` (maestro/admin), y una cuenta
  //     dedicada ni entra por el formulario ni tiene ese rol.
  // Si alguna vez una API key pudiera traspasar (no esta pedido), estas tres pasarian a `bloquea`:
  // la fila de rastro es evidencia y su `Restrict` pararia el borrado.
  "OrdenTraspasoMensajero.mensajeroAnterior": {
    categoria: "no_alcanzable",
    motivo: SOLO_MENSAJERO,
  },
  "OrdenTraspasoMensajero.mensajeroNuevo": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "OrdenTraspasoMensajero.actor": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "OrdenEvento.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO }, // ficha 454
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
  // ⭑ FICHA 431 — quien MARCO la consolidacion como recibida. Misma categoria y mismo motivo que su
  // hermana `resueltoPorUsuario`, y por la misma razon: marcar exige `esAccesoTotal` (maestro o
  // admin), y una cuenta de API key nunca tiene ese rol, asi que su `usuario` NO puede aparecer en
  // esta columna. La FK es `Restrict` a proposito —quien afirmo que el dinero llego no se borra
  // dejando la afirmacion huerfana—, pero esa restriccion no alcanza al borrado de una API key.
  "CierreBodega.conciliadoPorUsuario": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "WalletMovimiento.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "WalletTiendaMovimiento.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "PagoMensajeroMovimiento.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "PagoMensajeroMovimiento.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "LiquidacionPago.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "LiquidacionPago.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "LiquidacionAnulacion.anulador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "LiquidacionReparto.mensajero": { categoria: "no_alcanzable", motivo: SOLO_MENSAJERO },
  "LiquidacionReparto.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  // ⭑ FICHA 459 — el pago por cuenta de una tienda y el saldo inicial o aporte. La tienda de un
  // pago por cuenta la valida `PagoPorCuentaTiendaService` (R36): rol `adminTienda` y activa, asi
  // que la cuenta dedicada de una key (rol `apiKey`) no puede serlo. Las FK son `Restrict`.
  "PagoPorCuentaTienda.tienda": {
    categoria: "no_alcanzable",
    motivo:
      "R36 de la 459: el servicio exige que la tienda sea `adminTienda` y este activa; una cuenta " +
      "dedicada de API key tiene rol `apiKey` y nunca pasa esa validacion.",
  },
  "PagoPorCuentaTienda.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "PagoPorCuentaTiendaAnulacion.anulador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  // Ficha 461 (R10): quien anulo un cobro de Ordenex a una tienda. Solo el acceso total anula; la
  // cuenta dedicada de una API key no llega a esa accion.
  "CobroTiendaAnulacion.anulador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  // Ficha 461 (R69): quien anulo una correccion de caja. Solo el acceso total anula.
  "AjusteCajaAnulacion.anulador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "AporteCapital.registrador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
  "AporteCapitalAnulacion.anulador": { categoria: "no_alcanzable", motivo: SOLO_OPERADOR },
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
  // ── FICHA 410 (2026-09-10): el canal de push web ─────────────────────────────────────────────
  // Las dos son CASCADE y las dos son INALCANZABLES para una cuenta dedicada. No se clasifican
  // como `se_borra_con_ella` —que es para lo que desaparece DENTRO de la transaccion del borrado
  // de la key— porque para esta cuenta la fila no llega a existir nunca.
  "PushSuscripcion.usuario": {
    categoria: "no_alcanzable",
    motivo:
      "Suscribir un dispositivo exige un NAVEGADOR con sesion de pantalla: la Server Action fija " +
      "el dueno con `resolveActorFromSession`, y la cuenta dedicada no entra por el formulario de " +
      `login (su contrasena es aleatoria y no se revela). ${SOLO_OPERADOR}`,
  },
  "PushEnvioDia.usuario": {
    categoria: "no_alcanzable",
    motivo:
      "El cupo del dia solo se toma para un destinatario ELEGIBLE del catalogo de push, y el rol " +
      "`apiKey` no aparece en ninguna de sus ocho entradas: una cuenta dedicada no tiene telefono " +
      "al que interrumpir.",
  },
  // ── FICHA 422 (2026-09-11): la preferencia «quiero avisos», que es de la PERSONA ─────────────
  // CASCADE, y por el mismo criterio que sus dos vecinas de arriba: una preferencia no es
  // evidencia. Tampoco es `se_borra_con_ella` —esa categoria es para lo que desaparece DENTRO de
  // la transaccion del borrado de la key— porque para una cuenta dedicada la fila no llega a
  // existir nunca.
  "UsuarioPreferencia.usuario": {
    categoria: "no_alcanzable",
    motivo:
      "Solo hay DOS caminos que crean esta fila y los dos exigen un NAVEGADOR con sesion de " +
      "pantalla: `registrarSuscripcionPush` (que fija al dueno con `resolveActorFromSession`) y " +
      "`olvidarPreferenciaDeAvisos`, las dos detras del interruptor de avisos. El backfill de su " +
      "migracion copia de `push_suscripcion`, que es inalcanzable por lo mismo, asi que tampoco " +
      `puede crearla. ${SOLO_OPERADOR}`,
  },
  // ── FICHA 436 (2026-09-17): el contador del asistente de ayuda ────────────────────────────────
  // CASCADE, mismo criterio que sus tres vecinas de arriba: un CONTADOR no es evidencia. Y es
  // INALCANZABLE, pero por un motivo MAS FUERTE que el de aquellas: aqui no es que el camino sea
  // improbable, es que hay un rechazo EXPLICITO por rol, medido y con test propio.
  "AsistenteUsoDiario.usuario": {
    categoria: "no_alcanzable",
    motivo:
      "R13 de la ficha 436: `AsistenteService.responder` rechaza con `rol_no_admitido` TODO rol " +
      "que no este en `ROLES_AYUDA` —y `apiKey` no esta— ANTES de tocar el contador, asi que una " +
      "cuenta dedicada no puede abrir ni una fila de esta tabla. El test " +
      "`tests/unit/asistente/tope-diario.test.ts` lo afirma midiendo las DOS mitades: el desenlace " +
      "y que el repositorio del contador no se llamo ni una vez. Ademas el asistente vive detras " +
      `del guard de SESION: sin cookie, /api/asistente responde 401 con JSON. ${SOLO_OPERADOR}`,
  },
  // ── FICHA 453 (2026-09-21): las vistas de filtros guardadas ───────────────────────────────────
  // CASCADE, mismo criterio que sus cuatro vecinas de arriba: una vista es un ATAJO DE TRABAJO de
  // una persona, no evidencia, y se va con ella. Tampoco es `se_borra_con_ella` —esa categoria es
  // para lo que desaparece DENTRO de la transaccion del borrado de la key— porque para una cuenta
  // dedicada la fila no llega a existir nunca.
  "VistaFiltro.usuario": {
    categoria: "no_alcanzable",
    motivo:
      "Las CINCO escrituras posibles son Server Actions (`lib/actions/vistas-filtro.ts`) y las " +
      "cinco fijan al dueno con `resolveActorFromSession` antes de validar nada: no hay ruta de " +
      "API, ni webhook, ni cron que cree una vista, y el `usuarioId` NO existe en ninguna entrada " +
      "(los schemas son `.strict()`, asi que inyectarlo es `validation_error`). Guardar una vista " +
      "es ademas un gesto de PANTALLA —el control vive en la barra de filtros—, y una cuenta " +
      `dedicada no entra por el formulario de login. ${SOLO_OPERADOR}`,
  },
};
