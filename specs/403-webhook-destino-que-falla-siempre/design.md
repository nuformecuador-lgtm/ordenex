# 403 — Design

## 0. Resumen y qué cambió respecto de la primera versión de este spec

Arreglo mínimo sobre tres puntos ya existentes: `WebhookEstadoService` (feature 99),
`webhook_suscripcion` (features 99/105/108) y `JobQueueService` (feature 90). No se crea cola
nueva, panel nuevo, tabla de auditoría nueva ni máquina de estados nueva.

**Pivote de fondo:** la primera versión de este diseño hacía `activa = false`
("desactivación automática") al cruzar 3 fallos consecutivos + 24 horas sin éxito. Con la
suscripción sirviendo ahora a un integrador real (contexto en `requirements.md`), el humano
decidió que ese mecanismo era peor que el problema: desactivar exige reactivación manual, y el
silencio de "nadie se enteró en 5 días" es exactamente lo que un `activa=false` sin nadie
mirando reproduce. **La suscripción ahora se PAUSA, nunca se desactiva**: `activa` no se toca en
ningún punto de este spec; solo cambia el ESPACIADO de sus reintentos. Todo lo que sigue está
reescrito con ese vocabulario; no hay ninguna referencia residual a "desactivar" en este
documento.

## 1. Modelo de datos

### 1.1. `webhook_suscripcion`: DOS columnas nuevas (aditivo) — no cuatro

```prisma
model WebhookSuscripcion {
  // ...columnas existentes (id, ownerUsuarioId, url, secret, activa, createdAt, updatedAt)
  fallosConsecutivos Int      @default(0) @map("fallos_consecutivos")
  sinExitoDesde       DateTime @default(now()) @map("sin_exito_desde")
}
```

- `fallosConsecutivos`: entregas fallidas seguidas sin ningún 2xx de por medio (R3).
- `sinExitoDesde`: instante de la última entrega exitosa, o del alta/última reactivación si
  nunca hubo una. Nunca es `NULL` (una suscripción recién creada ya tiene un ancla válida: su
  propia creación).

**Deliberadamente NO hay una tercera columna `pausada` (ni `pausada_desde`).** "Pausada" es un
estado 100% DERIVADO de estas dos columnas más el reloj, evaluado con una función pura
(`estaPausada`, §2) tanto para decidir el backoff de un reintento como para lo que ve la
pantalla. Se descarta la columna nueva por dos razones, no por evitar trabajo:

1. **Correctitud.** Guardar un booleano "pausada" en paralelo a los datos que lo determinan
   (`fallosConsecutivos`/`sinExitoDesde`) abre la puerta a que diverjan (p. ej. si se olvida
   limpiar el booleano en algún camino de reactivación futuro). Con un valor derivado, solo hay
   una fuente de verdad y es estructuralmente imposible que el flag "pausada" mienta respecto
   al historial de fallos.
2. **Es justo lo que la ficha pide evitar.** Una máquina de estados con transición explícita
   (activa → pausada → activa, con su propio campo y sus propias reglas de quién la escribe) es
   más aparato del que este problema necesita. Dos contadores y una función pura ya bastan.

Migración `db/migrations/20260909120000_webhook_suscripcion_circuito/` — `ALTER TABLE ... ADD
COLUMN` con default, sin backfill especial. `down.sql` hace `ALTER TABLE ... DROP COLUMN` de
las dos, en orden inverso. No toca RLS (la tabla ya está con RLS habilitada sin policies, solo
service role, migración `20260721130000_webhook_suscripcion`); estas columnas se leen/escriben
por el mismo camino que las existentes.

**Es la única migración de tabla de esta tanda**, y es más pequeña que la de la versión
anterior de este spec (2 columnas en vez de 4): ya no hace falta nada para representar una baja
automática, porque no hay baja.

### 1.2. `notificacion_evento` / `notificacion_entidad_tipo`: dos valores nuevos

Migración separada `db/migrations/20260909130000_notificacion_evento_webhook_suscripcion/`
(el `55P04` de Postgres exige que `ALTER TYPE ... ADD VALUE` vaya en su propia migración, igual
que hicieron las fichas 253/262/271/333):

```sql
ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'webhook_suscripcion_pausada';
ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'webhook_suscripcion_pausa';
```

`down.sql` recrea-con-lista **los enums de HOY antes de esta migración** (los 9 valores
actuales de `notificacion_evento` y los 7 de `notificacion_entidad_tipo`, tal como están en
`db/schema.prisma`). Igual que documentan los downs de las fichas 253/262/271/333: no se tocan
esos downs anteriores; solo este down nuevo necesita conocer la lista completa de hoy.

`webhook_suscripcion_pausa` es un valor **sin fila real detrás** (mismo patrón que
`gasto_fijo_cobro_dia` de la ficha 333): `entidad_id` no apunta a ninguna tabla, es una clave
sintética **anclada a la RACHA de fallos, no a un instante puntual de "evento de baja"**:

```
entidadId = `${ownerUsuarioId}:${sinExitoDesde.toISOString()}`
```

Esto es el mecanismo completo de R12, sin código de detección de transición (§4): mientras
`sinExitoDesde` no cambie (la racha sigue viva), TODOS los intentos fallidos de esa racha
producen el MISMO `entidadId`, así que el índice único de `notificacion_dedupe_key` (`evento`,
`entidad_id`, `destinatario_rol`, `destinatario_usuario_id`, `NULLS NOT DISTINCT`) absorbe todas
las repeticiones tras la primera — exactamente el mismo `false` silencioso y ya probado que usa
`gasto_fijo_cobro_pendiente` cuando el cron reemite "al final de cada corrida". Cuando la racha
termina (éxito, R2) y una nueva empieza más adelante, `sinExitoDesde` cambia ⇒ nueva entidad ⇒
nueva notificación (R12, segunda frase). Ninguna de las dos propiedades depende de que el
código "recuerde" si ya notificó: son estructurales, igual que exige el precedente de la 262/333.

## 2. El circuito: una función pura, sin máquina de estados

`lib/utils/webhook-suscripcion-pausa.ts` (nuevo, helper puro — `docs/architecture.md`,
`lib/utils/`):

```ts
export interface WebhookPausaConfig {
  fallosMinimos: number;
  ventanaMs: number;
}

export function estaPausada(
  fallosConsecutivos: number,
  sinExitoDesde: Date,
  ahora: Date,
  config: WebhookPausaConfig,
): boolean {
  return (
    fallosConsecutivos >= config.fallosMinimos &&
    ahora.getTime() - sinExitoDesde.getTime() >= config.ventanaMs
  );
}
```

Una única función, usada en DOS sitios, para que "cuándo pausamos los reintentos" y "qué le
enseñamos al dueño" nunca puedan divergir:

1. **Escritura** (`WebhookEstadoService.ejecutar`, tras un fallo): decide si ESTE intento debe
   espaciarse al intervalo de pausa.
2. **Lectura** (`WebhookSuscripcionService.obtener` / `findByOwner`): decide si la pantalla debe
   mostrar el aviso de pausa, evaluado en el momento de la consulta (nunca queda "congelado":
   si pasa el tiempo suficiente sin que nadie mire, la próxima vez que se abra el modal ya lo
   dirá).

### 2.1. Dónde vive en `WebhookEstadoService.ejecutar`

```
outcome = sender.entregar(...)
si outcome.status === "ok":
    suscripciones.registrarEntregaOk(datos.tiendaId, now())     // R2: resetea y sale de pausa
    return
// outcome.status === "transitorio"
estado = suscripciones.incrementarFalloYLeer(datos.tiendaId, now())   // R3
si estado !== null:
    pausada = estaPausada(estado.fallosConsecutivos, estado.sinExitoDesde, now(), config.pausa)
    si pausada:
        await notificarPausa({ ownerUsuarioId: datos.tiendaId, sinExitoDesde: estado.sinExitoDesde })  // R9-R13, idempotente por racha (§1.2)
        retryAfterMs = config.WEBHOOK_PAUSA_INTERVALO_MS   // R4
    si no:
        retryAfterMs = outcome.retryAfterMs                 // R14: solo si venía de un 429 con Retry-After
throw new WebhookEntregaFallidaError(outcome.detalle, retryAfterMs)
```

No hay ninguna llamada que "active" o "desactive" nada: `activa` no aparece en este flujo (R5).
El único efecto observable de cruzar el umbral es el valor de `retryAfterMs` adjunto al error —
reutilizando el MISMO mecanismo genérico que ya hacía falta para R14 (§5): `JobQueueService` no
necesita saber qué es "pausar", solo sabe "este error trae una sugerencia de espera".

`incrementarFalloYLeer` NO cuenta `WebhookSecretKeyError` (clave de cifrado ausente) ni un
payload inválido: son errores de configuración PROPIA que nunca intentan la petición HTTP, y
contarlos penalizaría con reintentos espaciados un destino sano por un problema nuestro (R3,
última frase) — sin cambios respecto a la versión anterior de este spec.

### 2.2. Contrato de `IWebhookSuscripcionRepository` (dos métodos nuevos, no tres)

```ts
registrarEntregaOk(ownerUsuarioId: string, ahora: Date): Promise<void>;
incrementarFalloYLeer(ownerUsuarioId: string, ahora: Date):
  Promise<{ fallosConsecutivos: number; sinExitoDesde: Date } | null>;
```

Puramente Prisma (`update` con `increment`, atómico a nivel de fila), sin decisión de negocio
(`docs/architecture.md`, Repository). **Ya no existe** el `desactivarAutomaticamente` de la
versión anterior: no hace falta ningún método que escriba un estado de pausa, porque no hay
estado que escribir más allá de los dos contadores.

`upsertByOwner` y `actualizarUrlByOwner` (los dos caminos de alta/edición, ya existentes) se
extienden para resetear las dos columnas nuevas en CADA llamada (R7) — no solo cuando el
destino estaba realmente roto: es la palanca manual de "reintentar ya", y resetear un contador
ya en cero es un no-op inofensivo.

### 2.3. Configuración (`lib/config/webhook.ts`)

```ts
WEBHOOK_PAUSA_FALLOS_MINIMOS: number;  // env, default 3
WEBHOOK_PAUSA_VENTANA_MS: number;      // env WEBHOOK_PAUSA_VENTANA_MINUTOS, default 30 (min) → ms
WEBHOOK_PAUSA_INTERVALO_MS: number;    // env, default 3_600_000 (1 h)
```

Mismo patrón que el resto del archivo: nunca lanza, ausente/inválido cae al default (R8).

## 3. Los tres números: 3 fallos, 30 minutos, 1 hora

Los tres se revisaron a la baja/al alza respecto de la versión anterior (3 fallos / **24
horas** para desactivar) precisamente porque el coste de un falso positivo cambió de
naturaleza: antes, tropezar el umbral significaba desconectar a alguien hasta que un humano lo
notara (posiblemente días); ahora significa, como mucho, que sus reintentos se espacian una
hora y se recuperan solos en el primer éxito. Eso permite —y justifica— actuar mucho antes.

**Ventana = 30 minutos, anclada a un daño ya medido, no a una intuición nueva.** La ficha 402
(frontera explícita con esta) documenta que estos mismos reintentos dejaron sin turno a la
geocodificación durante **media hora exacta**, con la credencial de Google ya arreglada, y eso
bloqueó 42 órdenes. Poner la ventana en 30 minutos significa que el espaciado entra en juego
como muy tarde en el mismo margen de tiempo en el que ya se midió que este job compite por el
lote con los demás tipos — no después de que el daño colateral haya vuelto a ocurrir. Es el
mismo número que ya tiene una consecuencia MEDIDA en este sistema, no uno inventado para la
ocasión.

**Piso de evidencia = 3 fallos consecutivos (sin cambios respecto a la v1).** Sin este piso, una
suscripción con tráfico muy esporádico (un pedido, un fallo aislado, y luego silencio real
durante más de 30 minutos porque no llega ningún otro pedido) entraría en pausa la próxima vez
que llegara un nuevo intento, por el solo transcurso del reloj sobre UN dato. Con el piso en 3,
hace falta más de un caso antes de que el reloj pueda actuar.

**Intervalo de pausa = 1 hora, reutilizando el mismo tope que ya gobierna cualquier backoff de
la cola (`JOBS_BACKOFF_CAP_MS`, default también 1 hora).** No es un número nuevo inventado para
esta ficha: es el límite que YA se considera aceptable como peor caso de espera para CUALQUIER
tipo de job en este sistema. Reutilizarlo, en vez de definir un tope propio más laxo o más
estricto, evita que un destino pausado espere más que el peor caso ya tolerado hoy en cualquier
otro sitio de la cola. Es, a la vez:
- **Suficientemente espaciado.** Hoy, sin este mecanismo, un job que falla sin parar agota sus 5
  intentos (`MAX_INTENTOS_WEBHOOK`) en apenas ~15 minutos (backoff 1+2+4+8 min) y muere. Con el
  intervalo de pausa, esos mismos 5 intentos se reparten en hasta ~5 horas: la MISMA suscripción
  deja de poder ocupar varios huecos del lote de 10/minuto en una ventana corta y concentrada,
  que es precisamente el mecanismo que saturó a la geocodificación en la 402.
- **Suficientemente frecuente.** Con órdenes nuevas llegando con normalidad (el caso del
  integrador real que motivó este pivote), el destino recupera entregas dentro de, como mucho,
  una hora tras arreglarse — no requiere que un humano note nada ni que pase un día entero.

**Qué pasa con un destino que alterna éxitos y fallos (el caso ya medido del 8-sep: 10 buenas
entre 706 muertas).** Cada éxito real, aunque sea aislado, resetea `sinExitoDesde` y saca de la
pausa de inmediato (R2): un destino así entra y sale de pausa varias veces, pero NUNCA se queda
"atascado" fuera de servicio, porque no hay un estado del que solo un humano pueda sacarlo. Es
exactamente la propiedad que la versión de "desactivar" no tenía sin un mecanismo especial: aquí
sale sola por construcción.

**Qué NO garantiza (límite conocido, aceptado por escrito).** Un destino genuinamente
intermitente, con éxitos reales cada pocos minutos mezclados con fallos, puede no acumular
nunca 30 minutos seguidos sin éxito y por tanto nunca pausar, aunque su tasa de fallo agregada
sea alta. Es un caso distinto de "falla siempre" y se deja fuera a propósito: pausar existe para
una racha sostenida, no para una tasa de error alta con éxitos intercalados.

## 4. Detección de "recién entró en pausa": no existe tal código

A diferencia de la v1 (que necesitaba distinguir el instante exacto de la desactivación para
notificar una sola vez), esta versión NO necesita detectar la transición "no pausada → pausada"
en el código de `WebhookEstadoService`. Basta con **intentar notificar en cada fallo mientras
`estaPausada()` sea verdadero** (§2.1): el `entidadId` anclado a `sinExitoDesde` (§1.2) hace que
la primera fila se inserte y todas las siguientes de la MISMA racha choquen con el índice único
y se descarten en silencio — comportamiento ya existente y ya probado de
`NotificacionRepository.crear` (`ficha 146: devuelve false sin lanzar`). Esto es más simple y
más robusto que reconstruir "el estado justo antes de este fallo" a partir de aritmética sobre
el contador (que, se comprobó al diseñar esto, NO reconstruye correctamente el caso en que el
conteo ya superaba el umbral desde hace rato y es el tiempo el que acaba de cumplirse): con el
ancla por racha, el orden de llegada de los dos umbrales deja de importar.

## 5. El aviso: reutiliza el mecanismo de la 146, con texto que dice lo que pasa

Mismo patrón que `gasto_fijo_cobro_pendiente` (ficha 333) y `mensajero_bloqueado_por_cierres`
(ficha 271):

- `lib/notificaciones/emitir.ts`: `emitirWebhookSuscripcionPausada(repo, ctx, tx?)` — UNA fila
  `tipo: "warning"` (no `alert`: la suscripción sigue viva y se está recuperando sola; no es la
  misma severidad que "algo se rompió y hay que intervenir"), `evento:
  "webhook_suscripcion_pausada"`, `entidadTipo: "webhook_suscripcion_pausa"`,
  `entidadId: "${ctx.ownerUsuarioId}:${ctx.sinExitoDesde.toISOString()}"`,
  `destinatario: { tipo: "rol", rol: "maestro" }` (mismo rol que ya opera esta pantalla en
  `lib/actions/webhooks.ts`; `admin` la ve pero no puede actuar sobre ella, mismo argumento que
  excluyó a `admin` en la 333). Descripción, SIN URL ni secreto (R13) y SIN la palabra
  "desactiv" en ninguna forma (R9, última frase): *"Un webhook lleva fallando desde
  `<sinExitoDesde>` y sus reintentos se espaciaron automáticamente para no saturar la cola de
  trabajo. Se reanudarán solos en cuanto vuelva a responder. Revisa Configuración > API."*. Sin
  anexo: no hay más dato que enseñar sin arriesgar R13, y con una sola suscripción hoy en
  producción no hace falta nombrar cuál (si en el futuro hubiera varias, nombrarla es una
  extensión de una línea, no un cambio de mecanismo).
- `lib/notificaciones/notificadores.ts`: `notificarWebhookSuscripcionPausadaCon(repo, logger)` /
  `...Real`, el mismo patrón `Con`/`Real` + `emitirBestEffort` que los ocho notificadores ya
  existentes. **Best-effort y fuera de cualquier transacción**, mismo motivo que
  `notificarGastoFijoCobroPendienteCon`: lo llama el cron de jobs, que debe seguir procesando el
  resto del lote aunque el aviso falle — LA CORRIDA MANDA, EL AVISO ES CORTESÍA (R11).
- Composition root: `lib/services/jobs/webhook-estado-handler.ts` (`buildWebhookEstadoService`)
  inyecta `notificarWebhookSuscripcionPausadaReal` como 7º parámetro (default `notificadorNoOp`,
  igual que el resto de servicios de este archivo).

### 5.1. Qué le deja listo a la ficha 401 (frontera explícita)

La 401 necesita el MISMO tipo de aviso —"algo falla sistemáticamente en la cola"— pero sobre
una entidad distinta (no hay una fila "suscripción" para el geocodificador: es un proveedor
único, global). Lo que esta ficha deja reutilizable:

1. El **patrón** `notificar<X>Con`/`notificar<X>Real` + `emitirBestEffort` de
   `lib/notificaciones/notificadores.ts`.
2. La convención de **`entidadId` anclado a la RACHA, no a un instante puntual** (§1.2/§4): es
   lo que le permite a la 401 emitir "sigue caído" sin duplicar avisos en cada job fallido Y sin
   necesitar código de detección de transición. Es una mejora sobre el patrón de la propia 333
   (que ancla al día, un proxy más burdo de la racha).
3. El **criterio de diseño de los umbrales** (§3: preferir un eje de tiempo anclado a un daño ya
   medido, con un piso de evidencia contra el dato aislado) como plantilla de razonamiento — la
   401 debe MEDIR sus propios números contra el histórico de `geocodificacion`, no heredar 3
   fallos/30 min/1 h a ciegas.

Lo que NO comparten: el estado del circuito (`fallosConsecutivos`/`sinExitoDesde`) vive en
`webhook_suscripcion`, una tabla que no existe para el geocodificador.

## 6. El 429 dice "me estás saturando": `Retry-After`

Sin cambios respecto de la versión anterior de este spec (el pivote de desactivar→pausar no
afecta a esta parte, salvo que ahora comparte literalmente el mismo mecanismo de "hint" con el
intervalo de pausa, ver §2.1):

- `lib/interfaces/external/IWebhookSender.ts`: `WebhookOutcome` (rama `transitorio`) gana un
  campo opcional `retryAfterMs?: number`.
- `lib/clients/webhook-sender.ts`: al recibir `status === 429`, lee `Retry-After` y la
  interpreta con una función pura `parseRetryAfterMs(header, ahora)` (RFC 7231 §7.1.3: segundos
  delta o fecha HTTP), devolviendo `null` si no es interpretable (R15). `WebhookSenderOpts` gana
  un `now?: () => Date` inyectable para que la forma "fecha HTTP" sea determinista en tests.
- `lib/services/WebhookEstadoService.ts`: `WebhookEntregaFallidaError` gana un segundo
  parámetro opcional `retryAfterMs?: number` (campo público de solo lectura).
- `lib/services/JobQueueService.ts`: `manejarFallo` sigue siendo agnóstico de tipos de job.
  Se añade una comprobación duck-typed genérica:

  ```ts
  interface JobRetryHint { retryAfterMs?: number }
  function retryAfterHintMs(err: unknown): number | undefined { ... }
  ```

  `drenar()` pasa el `err` capturado (hoy solo lo convertía a texto) también a través de este
  helper, y `manejarFallo` calcula:

  ```ts
  const backoff = Math.min(config.JOBS_BACKOFF_CAP_MS, config.JOBS_BACKOFF_BASE_MS * 2 ** (intentos-1));
  const final = hint === undefined ? backoff : Math.max(backoff, Math.min(hint, config.JOBS_BACKOFF_CAP_MS));
  ```

  — nunca más rápido que el backoff normal (R14/R4, "nunca menor"), nunca más lento que el tope
  ya existente de la cola (R17), y **es el mismo mecanismo que usa tanto un 429 real del destino
  como el intervalo de pausa del circuito**: `JobQueueService` no distingue entre ambos, ni
  necesita hacerlo.
- `MAX_INTENTOS_WEBHOOK` (=5, normativo desde la 99) no cambia: un 429 —o una racha en pausa—
  sigue contando como intento y el job sigue muriendo al quinto (R16).

## 7. UI: verlo y salir de pausa desde donde ya existe

- `lib/interfaces/repositories/IWebhookSuscripcionRepository.ts`: `WebhookSuscripcionVista` gana
  `pausada: boolean` (calculado con `estaPausada()` en el momento de la consulta) y
  `sinExitoDesde: string | null` (ISO; en la práctica nunca `null`, pero se tipa así para no
  filtrar el detalle de implementación "siempre tiene default" a capas que no lo necesitan
  saber). `findByOwner` calcula el booleano con la config vigente y lo añade al `select`
  existente.
- `lib/interfaces/services/IWebhookSuscripcionService.ts` (`WebhookSuscripcionVistaDTO`),
  `lib/types/webhook.ts` (`ObtenerWebhookActionResult`) y `lib/actions/webhooks.ts`
  (`obtenerWebhook`): passthrough de los dos campos nuevos, sin lógica nueva (R18).
- `app/(app)/configuracion/api/_components/WebhookAccionCell.tsx`: el tipo `WebhookEstado` gana
  `pausada`/`sinExitoDesde`. El bloque `role="status"` (que hoy solo distingue `activa`/`no
  hay webhook`) añade una línea ADICIONAL, independiente de esa rama, cuando
  `estado?.pausada === true`: *"Sus reintentos están espaciados desde `<sinExitoDesde>` por
  fallos de entrega sostenidos. Se reanudarán solos, o guarda la URL de nuevo para forzarlo
  ahora."* — sin tocar el texto de "activa"/"no hay webhook" ni ningún botón existente. Guardar
  la URL (el flujo de "Guardar URL"/"Registrar" ya existente, que llama a `registrarWebhook` →
  `actualizarUrlByOwner`) es la vía manual de R7/R19; con el reset de §2.2, el aviso desaparece
  al refrescar (`refrescar()` ya se llama tras cada mutación `ok`, sin cambios ahí). No se toca
  la lógica de "Dar de baja" ni "Rotar secreto": son ortogonales a la pausa (`activa` no cambia).

Es el único archivo bajo `app/` que toca este spec (pregunta abierta 3 de `requirements.md`).

## 8. Alternativas descartadas

1. **Desactivar (`activa = false`) al cruzar el umbral — el diseño de la v1 de este spec.**
   Descartada explícitamente por decisión del humano tras el cambio de contexto: exige
   reactivación manual, y el riesgo medido es exactamente "nadie se entera durante días" —el
   mismo daño que esta ficha existe para evitar, aplicado ahora a alguien que sí depende del
   servicio.
2. **Umbral solo por conteo de fallos consecutivos, sin componente de tiempo.** Descartada:
   sensible al volumen/ráfagas de la propia app (una carga o cierre masivo puede generar en
   minutos el mismo número de fallos que una caída real de horas), y el histórico del incidente
   (89 a 772 jobs/día para la MISMA suscripción) muestra que el volumen diario no es estable.
3. **Columna `pausada` (boolean) persistida, escrita explícitamente al cruzar el umbral.**
   Descartada (§1.1): abre una vía de divergencia entre el flag y los datos que lo determinan,
   y añade una transición de estado que el problema no necesita — dos contadores y una función
   pura ya alcanzan.
4. **Circuit breaker genérico dentro de `JobQueueService`**, aplicado a cualquier tipo de job.
   Descartada por ser rediseño, no arreglo mínimo: acoplaría un componente compartido por 9
   tipos de job a un concepto —"suscripción reactivable desde una pantalla"— que solo existe
   para `webhook_estado`. El hook genérico de `retryAfterMs` (§6) sí vive ahí porque es
   agnóstico del tipo de job.
5. **Notificar en el instante exacto de la transición "no pausada → pausada"**, detectada por
   código (comparando estado antes/después del incremento). Descartada (§4): la aritmética
   "conteo actual menos uno" no reconstruye correctamente el caso en que el conteo ya superaba
   el umbral desde antes y es el tiempo el que acaba de cumplirse (ambos evaluados con el mismo
   "ahora" dan el mismo resultado de tiempo). El ancla por racha en el `entidadId` resuelve la
   deduplicación sin necesitar ese código.

## 9. Seguridad y privacidad

- Ningún cambio toca el cifrado del secreto ni su descifrado (`webhook-secret-cipher.ts`), ni
  la firma (`webhook-firma.ts`).
- La notificación (R13) y cualquier log nuevo citan solo la operación y el hecho ("fallos de
  entrega sostenidos"), nunca la URL ni el secreto — mismo criterio ya escrito en
  `WebhookEstadoService`/`JobQueueService` (`mensajeError` acotado a 500 chars, sin PII).
- Las columnas nuevas de `webhook_suscripcion` no guardan URL, secreto ni PII: solo un contador
  y un timestamp.

## 10. Riesgos y límites conocidos (aceptados por escrito, no "arreglados")

- Con tráfico concentrado en ráfagas idénticas (muchos jobs creados en el mismo minuto, todos
  pausados a la vez y por tanto todos reintentando exactamente 1 hora después), podría darse un
  segundo pico de competencia por el lote de 10/minuto, más pequeño que el original pero no
  nulo. No se añade jitter para evitarlo: es una mejora incremental fuera del arreglo mínimo, y
  el pico resultante es de UN solo reintento por job en vez de los 5 concentrados en 15 minutos
  de hoy.
- Un destino genuinamente intermitente (éxitos reales frecuentes entre fallos) puede no llegar
  nunca a pausar, aunque su tasa de fallo agregada sea alta (§3, límite conocido y deliberado).
