import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";

// Feature 146 (A1, design §3.1) — FRONTERA CONTRACTUAL entre backend y frontend:
// tipos de dominio, DTO de la campana, schemas de borde (zod) y resultados tipados
// de las 5 Server Actions. Congelado en A1/B10: `components/shared/NotificationsBell.tsx`
// consume `NotificacionDTO` (via el alias publico `NotificationItem`, R50) y no debe
// necesitar ningun otro tipo del backend.

/** Tipo de PRESENTACION (icono de la campana). Espejo del enum `notificacion_tipo`. */
export type NotificationType = "alert" | "box" | "warning";

/** Evento de dominio que origino la notificacion. Inventario CERRADO de D1. */
export type NotificacionEvento =
  | "orden_rechazada"
  | "carga_masiva_terminada"
  | "postulacion_mensajero_pendiente"
  | "cierre_dia_por_aprobar"
  // Feature 253 (D6): alguien ofrecio un vehiculo o una bodega desde la landing publica.
  | "postulacion_recurso_pendiente"
  // Feature 262 (D7, P2 cerrada SI el 2026-08-22): a una orden asignada le corrigieron el dia de
  // reparto. Unico destinatario: el MENSAJERO asignado (R46/R51). Los admins no se avisan — son
  // quienes corrigen.
  | "dia_reparto_corregido"
  // FEATURE 271 (§9.2, Q4 resuelta el 2026-08-23) — los DOS avisos del bloqueo por cierres.
  //
  // `cierre_dia_vencido`: el corte creo un cierre `vencido`. Destinatarios: el MENSAJERO dueño
  // (primera notificacion de cierre que le llega, nunca la habia tenido) y su bodega responsable.
  | "cierre_dia_vencido"
  // `mensajero_bloqueado_por_cierres`: el mensajero quedo BLOQUEADO — por acumular (`N >= 2`) o
  // porque le rechazaron un cierre. Mismo evento para las dos causas porque piden la MISMA accion
  // («resuelve el mas antiguo»); son dos eventos y no uno frente a `cierre_dia_vencido` porque ahi
  // la pelota esta en tejados opuestos, y el evento es lo que la campana usa para agrupar.
  | "mensajero_bloqueado_por_cierres"
  // FICHA 333 (R29/R30/R31/R35/R36) — quedan cobros de gasto fijo esperando decisión. Lo emite
  // el cron de gastos fijos AL FINAL de su corrida, una vez por día CR, mientras quede al menos
  // un cobro `pendiente` —también los días en que no se generó ninguno nuevo—. Destinatario: el
  // rol `maestro` y nadie más, porque el `admin` VE la cola pero no puede decidirla (R24) y un
  // recordatorio diario que no se puede atender es ruido. El texto lleva SOLO el número (R35).
  | "gasto_fijo_cobro_pendiente"
  // FICHA 403 (R9/R12) — una suscripción de webhook lleva fallando en RACHA y sus reintentos se
  // espaciaron automáticamente para no saturar la cola. Lo emite el drenador
  // (`WebhookEstadoService`) en cada fallo mientras la suscripción esté pausada; que salga UN solo
  // aviso por racha lo da la ENTIDAD (`webhook_suscripcion_pausa`, anclada a `sinExitoDesde`), no
  // una rama de código. Destinatario: el rol `maestro` y nadie más — es quien opera
  // Configuración > API (`lib/actions/webhooks.ts`), y el `admin` no puede actuar sobre ella.
  //
  // ⚠️ EL TEXTO NUNCA DICE «desactivada», «dada de baja» ni «cancelada» (R9, última frase): la
  // suscripción SIGUE ACTIVA, sigue reintentando y se recupera sola al primer 2xx. `activa` no se
  // toca en ningún punto de esta ficha.
  | "webhook_suscripcion_pausada"
  // FICHA 401 (R7/R9/R10) — el servicio de mapas está rechazando nuestras peticiones por un
  // problema de configuración de NUESTRA cuenta, y nadie se entera. El 2026-09-08 eso duró 19 h
  // 55 min sin una sola alerta, y lo detectó un humano porque no podía asignar órdenes.
  // Destinatarios: `maestro` Y `admin` (decisión del humano del 2026-09-09) — el maestro puede
  // arreglarlo pero puede no estar delante; el admin no arregla la facturación, pero ESCALA, y
  // para escalar necesita enterarse. Se emite desde la rama de configuración del job, no desde el
  // drenador, y como mucho una vez por jornada CR y por rol.
  | "geocodificacion_caida"
  // FICHA 409 (R35/R41/R42) — una tienda tiene NOVEDADES SIN GESTIONAR. Es el primero de los dos
  // avisos AGREGADOS del arbol: UNA sola notificacion con el NUMERO dentro del texto, jamas una
  // por orden (R36), emitida por el cron `avisos-diarios` a las 07:00 CR y repetida UNA VEZ POR
  // DIA CALENDARIO DE COSTA RICA mientras quede al menos una novedad (R41). Destinatario: el rol
  // `adminTienda` ACOTADO a su tienda.
  //
  // ⚠️ SU ENTIDAD ES `${tiendaId}:${diaCR}`, Y EL ALCANCE VA DENTRO A PROPOSITO: ver el comentario
  // de `novedades_sin_gestionar_dia` mas abajo, donde se explica que sin el solo avisaria la
  // PRIMERA tienda de la corrida y todas las demas quedarian mudas, sin error y sin log.
  //
  // El texto NO PUEDE PROMETER «5 dias» A SECAS (R39/R40): el plazo depende de la causa (5 dias
  // para `wrong_*`, 24 h para `not_found`) y desde la 276 una novedad en el tope de intentos
  // escala en la corrida siguiente sin esperar su ventana. Si el lote mezcla causas, el texto
  // habla SIN plazo.
  | "novedades_sin_gestionar"
  // FICHA 409 (R45/R47/R51) — hay ordenes en `por_devolver` REPRESADAS en bodega por encima del
  // umbral. Segundo aviso AGREGADO: UNA notificacion por AMBITO (la zona del satelite, o el
  // ambito global de la administracion central) y por rol destinatario, una vez por dia CR.
  //
  // ⚠️ EL ESTADO VIGILADO ES `por_devolver` Y ESTA MEDIDO (produccion, 2026-09-10): `por_devolver`
  // = 27 ordenes, media 2,4 d, maximo 8,2 d, SIETE por encima de 3 d. `devolviendo_a_tienda` = 247
  // ordenes, media 1,0 d, maximo 1,3 d y NINGUNA por encima de 3 d: ese estado FLUYE y R46 PROHIBE
  // vigilarlo — avisar sobre el seria ruido puro sobre el cubo mas grande, que es exactamente lo
  // que esta ficha existe para no volver a hacer.
  | "devoluciones_represadas";

/** Entidad de origen referenciada (referencia polimorfica, sin FK — design §1.2). */
export type NotificacionEntidadTipo =
  | "orden"
  | "usuario"
  | "cierre_dia"
  | "carga"
  // Feature 253 (D6): fila de `postulacion_recurso`. NO es un `usuario`: esta postulacion no
  // crea ninguna cuenta (design §14-C), asi que reusar `usuario` seria un dato falso.
  | "postulacion_recurso"
  // Feature 262 (D7): fila de `orden_dia_reparto_cambio` — LA CORRECCION, no la orden. Reusar
  // `orden` con `entidad_id = <ordenId>` (A20) haria que `notificacion_dedupe_key` admitiera UNA
  // sola fila por (evento, orden, mensajero) para siempre, y `crear` absorbe el `P2002` devolviendo
  // `false`: la SEGUNDA correccion de esa orden no avisaria nunca, en silencio. Con la correccion
  // como entidad, «dos correcciones, dos avisos» (R50) es estructural.
  | "orden_dia_reparto_cambio"
  // ⚠️ FICHA 333 (design §4.2) — LA ENTIDAD DE ESTE AVISO ES **EL DÍA CR**, NO EL COBRO, y este
  // es el valor que lo declara: `entidad_id` es la fecha `"YYYY-MM-DD"` de la corrida. Es el
  // PRIMER `entidad_tipo` del inventario que NO apunta a una fila de tabla, y por eso tiene
  // valor propio en vez de reusar uno que prometa una (reusar `carga` o `usuario` sería escribir
  // un dato falso con formato de dato, el motivo por el que la 253 no reusó `usuario`).
  //
  // POR QUÉ NO EL COBRO, que es la elección natural: `notificacion_dedupe_key` es UNIQUE sobre
  // `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT` y
  // `WHERE entidad_id IS NOT NULL`, y `NotificacionRepository.crear` ABSORBE el `P2002`
  // devolviendo `false`. Con el cobro como entidad, la clave admitiría UNA sola fila por
  // (evento, cobro, maestro) PARA SIEMPRE y el recordatorio del día 2 no saldría NUNCA, en
  // silencio absoluto: sin error, sin log y sin nada. Es EXACTAMENTE el fallo que la 262
  // documentó y evitó eligiendo como entidad el CAMBIO y no la orden.
  //
  // Con el día: días distintos ⇒ entidades distintas ⇒ el recordatorio diario sale siempre
  // (R30); misma corrida repetida el mismo día ⇒ misma entidad ⇒ un solo aviso (R31). Las dos
  // propiedades son ESTRUCTURALES, no de disciplina.
  | "gasto_fijo_cobro_dia"
  // ⚠️ FICHA 403 (design §1.2) — SEGUNDO `entidad_tipo` que NO apunta a una fila de tabla, y la
  // entidad de este aviso es **LA RACHA DE FALLOS**, no la suscripción:
  //
  //     entidadId = `${ownerUsuarioId}:${sinExitoDesde.toISOString()}`
  //
  // POR QUÉ NO LA SUSCRIPCIÓN (ni su owner), que es la elección natural: `notificacion_dedupe_key`
  // es UNIQUE sobre `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con
  // `NULLS NOT DISTINCT` y `WHERE entidad_id IS NOT NULL`, y `NotificacionRepository.crear`
  // ABSORBE el `P2002` devolviendo `false`. Con la suscripción como entidad, la clave admitiría
  // UNA sola fila por (evento, owner, maestro) PARA SIEMPRE: la SEGUNDA racha de ese integrador
  // —meses después, tras haberse recuperado— no avisaría NUNCA, sin error, sin log y sin nada. Es
  // el mismo fallo que la 262 documentó con `orden` y que la 333 evitó eligiendo el día.
  //
  // Con la racha, las dos mitades de R12 son ESTRUCTURALES y no de disciplina:
  //   · misma racha ⇒ `sinExitoDesde` no cambia ⇒ misma entidad ⇒ UN solo aviso, por muchos
  //     intentos fallidos que haya (R12, 1ª frase);
  //   · racha nueva tras una recuperación ⇒ `sinExitoDesde` distinto ⇒ entidad distinta ⇒ aviso
  //     independiente (R12, 2ª frase).
  // No hay ningún código que detecte la transición «no pausada → pausada» (design §4).
  | "webhook_suscripcion_pausa"
  // ⚠️ FICHA 401 (design §3.3) — LA ENTIDAD DE ESTE AVISO ES **LA JORNADA CR**: `entidad_id` es la
  // fecha `"YYYY-MM-DD"` del día en que se detectó la caída. TERCER valor del inventario que no
  // apunta a una fila de tabla, y por el mismo motivo que los de la 333 y la 403: no hay ninguna
  // fila que represente «el corte» —esta ficha no crea tabla ni columna (R31)— y reusar un valor
  // que promete una (`orden`, `usuario`) sería escribir un dato falso con formato de dato.
  //
  // Y no es `entidad_id = NULL`: con `null`, `emitirFilas` se salta su guardia previa y el índice
  // único es PARCIAL, así que saldría un aviso POR EVALUACIÓN. El drenador corre cada minuto: el
  // corte medido de 19 h habría dejado ~2.280 filas en vez de 4.
  | "geocodificacion_caida_dia"
  // ⚠️ FICHA 409 (design §4.2) — CUARTO `entidad_tipo` que NO apunta a una fila de tabla, y la
  // entidad de este aviso es **LA TIENDA Y EL DIA CR JUNTOS**:
  //
  //     entidadId = `${tiendaId}:${diaCR}`
  //
  // POR QUE EL DIA, y por que ADEMAS la tienda. `notificacion_dedupe_key` es UNIQUE sobre
  // `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)` con `NULLS NOT DISTINCT` y
  // `WHERE entidad_id IS NOT NULL`, **el ALCANCE (`tienda_id`, `zona_id`) NO ENTRA en esa clave**
  // —esta escrito en `NotificacionRepository.columnasDestinatario`— y `crear` ABSORBE el `P2002`
  // devolviendo `false`.
  //
  // Con `entidad_id = diaCR` a secas y destinatario `{rol: adminTienda, tiendaId: T}`, la clave
  // seria ('novedades_sin_gestionar', '2026-09-11', 'adminTienda', NULL) **PARA TODAS LAS
  // TIENDAS**: la PRIMERA tienda de la corrida se llevaria su aviso y **TODAS LAS DEMAS quedarian
  // silenciadas, sin error, sin log y sin nada**. Es el mismo fallo que la 262 documento con
  // `orden` y que la 403 evito con la racha, y este repo YA LO COMETIO DOS VECES.
  //
  // Con la tienda dentro, las dos propiedades son ESTRUCTURALES y no de disciplina:
  //   · dias distintos ⇒ entidades distintas ⇒ el recordatorio diario sale siempre (R41);
  //   · tiendas distintas el mismo dia ⇒ entidades distintas ⇒ CADA UNA recibe el suyo (R42).
  | "novedades_sin_gestionar_dia"
  // ⚠️ FICHA 409 (design §4.2) — QUINTO `entidad_tipo` que no apunta a una fila de tabla: la
  // entidad es **EL AMBITO Y EL DIA CR**:
  //
  //     entidadId = `${ambito}:${diaCR}`,  con ambito ∈ { "global" } ∪ { zonaId }
  //
  // Mismo argumento que el de arriba, aplicado a las ZONAS: sin el ambito dentro, las zonas se
  // pisarian entre si y solo la primera del recorrido recibiria su aviso. La FORMA es uniforme a
  // proposito —`${ambito}:${dia}`, con el literal `"global"` para el ambito central—: dos formas
  // distintas para el mismo evento invitarian a confundirlas al leer una fila, y `"global"` nunca
  // puede colisionar con un uuid de zona.
  | "devoluciones_represadas_dia";

/**
 * DTO que viaja al cliente (design §3.1). `read` NO es una columna de `notificacion`:
 * se DERIVA de `notificacion_lectura` del usuario que consulta (D4), por eso dos
 * usuarios del mismo rol pueden ver la misma fila con `read` distinto (R3).
 *
 * ⚠️ FICHA 409 (T5.1, R34) — GANA SEIS CAMPOS, Y TODOS SON **ADITIVOS Y OPCIONALES**. El servidor
 * los puebla SIEMPRE (`NotificacionService.listar`); son opcionales EN EL TIPO porque R34 exige
 * que un DTO construido con solo los campos vigentes siga tipando, y porque los consumidores que
 * construyen literales —las suites de la campana— no pueden dejar de compilar por este cambio.
 * Ninguno cambia el tipo de un campo existente y ninguno se retira: `description` y `anexo` se
 * CONSERVAN aunque el panel ya no los pinte directamente.
 *
 * EL REPARTO, y es la idea entera de la ficha: **el servidor decide y el cliente pinta**. La
 * campana no clasifica, no compone texto, no calcula tiempo y no conoce rutas por evento.
 */
export interface NotificacionDTO {
  id: string;
  notification_type: NotificationType;
  description: string;
  anexo?: string;
  read: boolean;
  /** ISO-8601. */
  createdAt: string;

  // — FICHA 409 —
  /** El evento de dominio de la fila. Ya estaba en la tabla; hasta hoy no viajaba. */
  evento?: NotificacionEvento;
  /**
   * Resuelto por el CATALOGO con el rol del actor que consulta (`accionDeAviso`), no por el
   * componente que lo pinta. Es lo que parte el panel en «Requieren tu acción» / «Para tu
   * información» (R16) y lo que cuenta el distintivo (R8).
   */
  accionable?: boolean;
  /** Lo que se lee en negrita. En los avisos AGREGADOS lleva la cifra VIVA (R57). */
  titulo?: string;
  /** La linea de contexto bajo el titulo. `null` cuando no hay ninguna. NUNCA lleva «Anexo:». */
  detalle?: string | null;
  /**
   * El instante relativo YA RESUELTO como texto («hace 2 h», «ayer»). Se calcula EN EL SERVIDOR
   * (R31) para que la campana no lea el reloj del navegador y no rompa la hidratacion (R32).
   */
  cuando?: string;
  /**
   * A donde lleva el boton de accion, y como se llama. `null` cuando el par (evento, rol) esta
   * declarado accionable pero NO hay pantalla que acerque a resolverlo (R4) — hoy solo
   * `geocodificacion_caida`.
   */
  atajo?: { href: string; etiqueta: string } | null;
}

// ---------------------------------------------------------------------------
// Schemas de borde (R36): toda entrada externa se valida ANTES de tocar la DB.
// ---------------------------------------------------------------------------

/** R36: identificador de notificacion no vacio (ZodError -> VALIDATION_ERROR). */
export const notificacionIdSchema = z.string().min(1);

/**
 * R36/R39: contadores de la carga masiva por UI. `creadas`/`total` enteros >= 0 con
 * `creadas <= total`; `loteId` es el uuid que el cliente genera al INICIAR la carga y
 * reusa en un reintento — es la clave de idempotencia (design §3.6).
 */
export const cargaTerminadaSchema = z
  .object({
    creadas: z.number().int().min(0),
    total: z.number().int().min(0),
    loteId: z.uuid(),
  })
  .refine((v) => v.creadas <= v.total, {
    message: "creadas no puede superar total",
    path: ["creadas"],
  });
export type CargaTerminadaInput = z.infer<typeof cargaTerminadaSchema>;

// ---------------------------------------------------------------------------
// Resultados de dominio del service (sin acoplarse a HTTP).
// ---------------------------------------------------------------------------

export type ListarNotificacionesServiceResult = {
  status: "ok";
  items: NotificacionDTO[];
  noLeidas: number;
  /**
   * FICHA 409 (R8/R9) — CUANTAS COSAS HAY POR HACER, que no es lo mismo que cuantos mensajes hay
   * sin leer, y ese es el cambio entero de la ficha.
   *
   *   porHacer = |{ n ∈ items : accionDeAviso(n.evento, actor.rol).clase === "accionable"
   *                          && vigente(n) }|
   *
   * `items` es EL MISMO conjunto que ya devuelve el listado (visibles por el predicado de la 146,
   * dentro de la ventana de 30 dias, no descartadas por el actor) y `vigente(n)` es `true` salvo
   * para los eventos AGREGADOS, donde es `cifraViva(n) > 0`.
   *
   * ⚠️ EL ESTADO DE LECTURA NO ENTRA (R9). Marcar todas como leidas NO baja esta cifra: el trabajo
   * sigue ahi. Es tambien la cifra que dispara el tono de aviso (161/Q8): dos criterios distintos
   * para el mismo hecho es como se acaba con dos verdades sobre el mismo numero.
   *
   * REQUERIDO (no opcional como los campos del DTO): nadie construye este resultado fuera del
   * servicio, asi que exigirlo no rompe a ningun consumidor y si obliga a poblarlo.
   */
  porHacer: number;
};

export type MarcarNotificacionServiceResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "forbidden" };

export type MarcarTodasServiceResult = { status: "ok"; marcadas: number };

export type NotificarCargaServiceResult = { status: "ok" };

// ---------------------------------------------------------------------------
// Resultados tipados de las Server Actions (lo que consume la campana).
// ---------------------------------------------------------------------------

export type ListarNotificacionesResult =
  // FICHA 409: `porHacer` viaja hasta la campana. Ver la nota de
  // `ListarNotificacionesServiceResult`: cuenta TRABAJO, no mensajes sin leer.
  | { status: "ok"; items: NotificacionDTO[]; noLeidas: number; porHacer: number }
  | ActionError;

export type MarcarNotificacionResult = { status: "ok" } | ActionError;

export type MarcarTodasLeidasResult = { status: "ok"; marcadas: number } | ActionError;

export type NotificarCargaMasivaResult = { status: "ok" } | ActionError;
