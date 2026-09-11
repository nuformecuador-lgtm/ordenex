# Feature 410 — Diseño técnico del canal de push

> Requisitos en `requirements.md`. Desglose en `tasks.md`.
> Ficha `fullstack`, `depends_on: 409`. **Gate: `./init.sh` COMPLETO** (ver §14).

---

## 1. La idea en una frase

El aviso ya existe: es una fila de `notificacion`. Esta ficha **no crea avisos**, crea un
**transporte** que lleva esa misma fila al teléfono cuando la app está cerrada. Todo el diseño se
apoya en esa frase: un solo hecho, un solo registro, dos superficies (campana y push).

```
productor de negocio
   └─ notificar<X>Real            (lib/notificaciones/notificadores.ts, best-effort, FUERA de tx)
        └─ emitir<X>() ─ emitirFilas() ─ repo.crear()      ← lo que ya existe
                                            │
                                   ┌────────┴─────────┐
                        NotificacionRepository   NotificacionRepositoryConPush   ← NUEVO (decorador)
                                                         │  si el par (evento, destinatario) es elegible
                                                         │  y gana el cupo del día (INSERT único)
                                                         ▼
                                                  jobs(tipo = push_web)          ← NUEVO valor de enum
                                                         │  cron procesar-jobs (cada minuto)
                                                         ▼
                                                  PushWebService
                                                    ├─ resuelve destinatarios  (mismo predicado)
                                                    ├─ lee push_suscripcion
                                                    └─ IPushSender.enviar(...)  ← web-push + VAPID
                                                                 │
                                                          servicio de push
                                                                 ▼
                                                     public/sw.js  push / notificationclick
```

---

## 2. Frontera con la 409: qué consumo y qué necesito de ella

La 409 decide **qué** se avisa y **cómo se lee**. Esta ficha consume tres cosas suyas y **no
redefine ninguna**:

| Necesito de la 409 | Para qué | Si no llega |
| --- | --- | --- |
| **`titulo`** de un aviso | Título del push (la línea en negrita del diseño). | El evento no se pusha (fallo cerrado, §9). |
| **`cuerpo` / contexto** | Segunda línea del push. | Ídem. |
| **`destino`** — la ruta del atajo | A dónde navega el `notificationclick` (R39/R40). | Ídem. |
| **conteo de pendientes por (usuario, evento)** — *deseable, no bloqueante* | Que el push de un aviso por unidad pueda decir **cuántos** hay (R52, mitad numerada). | El push habla en **singular** y **no afirma cantidad** (R52, mitad por defecto). No se pospone la ficha por esto. |

**Requisito de forma, y es lo único que le pido a la 409 como contrato:** que esas tres piezas se
resuelvan con una **función pura, invocable desde el servidor**, a partir de la fila del aviso —algo
con la forma `presentacionDe(fila) → { titulo, cuerpo, destino } | null`— y **no** solo dentro del
mapeador a DTO de la Server Action del listado. El push se compone en el drenador de la cola, donde
no hay sesión, ni DTO, ni React.

**Por qué no la compone esta ficha.** Porque sería un segundo juego de literales para el mismo hecho,
y este repositorio ya tiene escrita la regla (146 §4.6: *«si una cadena de notificación aparece fuera
de este archivo, es un bug»*) y la lección de lo que cuesta romperla. Además, comparar el texto del
push contra la función que lo compone sería una aserción contra su propia fuente: siempre verde.

**Lo que esta ficha NO consume de la 409:** su noción de «accionable». La elegibilidad de push es una
lista **propia y cerrada** (§3), decidida con el humano, y es más estrecha que «accionable»: hay
avisos accionables que no merecen interrumpir un teléfono.

---

## 3. El catálogo de elegibilidad (R1, R2, R4)

Fuente: `design-notificaciones/Push.dc.html`, aprobado por el humano — *«Solo la merece lo que tiene
plazo o dinero, y siempre agregada»*.

La clave es **(evento, perfil de destinatario)**, no solo el evento: `cierre_dia_vencido` produce una
fila `alert` para el mensajero y tres `warning` para bodega; solo la primera se pusha.

| Evento | Destinatario elegible | Quién lo recibe | Origen |
| --- | --- | --- | --- |
| *(409)* novedades sin gestionar | rol `adminTienda` (acotado a su tienda) | tienda | tabla aprobada |
| *(409)* devoluciones represadas | roles `admin`, `adminSatelite` | admin y bodega satélite | tabla aprobada |
| `cierre_dia_por_aprobar` | roles `admin`, `adminSatelite` | admin y bodega satélite | tabla aprobada |
| `mensajero_bloqueado_por_cierres` | **usuario** (el mensajero) | mensajero | tabla aprobada |
| `cierre_dia_vencido` | **usuario** (el mensajero) | mensajero | D2, 2026-09-10 |
| `dia_reparto_corregido` | **usuario** (el mensajero) | mensajero | tabla aprobada |
| `geocodificacion_caida` | rol `maestro` **y solo él** | maestro | tabla aprobada + D4 |
| `webhook_suscripcion_pausada` | rol `maestro` | maestro | tabla aprobada |

**No elegibles, y está escrito para que la ausencia sea decisión y no olvido:**
`orden_rechazada` (un aviso por orden), `carga_masiva_terminada` (quien la lanzó está mirando la
pantalla), `postulacion_mensajero_pendiente`, `postulacion_recurso_pendiente`,
`gasto_fijo_cobro_pendiente` (cola de trabajo normal, sin plazo que venza esa noche), las copias a
bodega de `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres`, y la copia a `maestro` de
`cierre_dia_por_aprobar`.

### 3.1 ⚠️ `geocodificacion_caida` va al `maestro` y NO al `admin`, y no es una omisión

El aviso de la 401 crea **dos** filas, una por rol, con el mismo texto. Aquí **solo se pushea la del
`maestro`**; la del `admin` se queda en la campana, exactamente como hoy. A primera vista parece que
falta media línea de código, así que queda escrito por qué no falta:

**La regla que gobierna toda esta ficha es que se interrumpe a quien PUEDE RESOLVERLO.** Lo que ese
aviso pide es revisar la credencial y la facturación de la cuenta del proveedor de mapas, y eso lo
hace el maestro. La 401 incluyó al `admin` en la campana con un argumento distinto y también válido
—«el admin no toca la facturación, pero **escala**, y para escalar necesita enterarse»—, y **ese
aviso no se toca**: el `admin` lo sigue viendo al abrir la app. Lo que no se hace es sacarle el
teléfono del bolsillo por algo que no puede arreglar. Decisión del humano del 2026-09-10 (D4).

### 3.2 ⚠️ Lo que el lienzo promete y esta ficha NO cubre

`design-notificaciones/Push.dc.html` y la tabla que lo acompaña le prometen al mensajero cuatro
avisos. **Dos de ellos no tienen productor en el código**, y esta ficha **no los crea**: es el canal,
no el catálogo (decisión del humano del 2026-09-10, D1). Escrito aquí para que nadie los dé por
hechos leyendo el lienzo:

| Prometido | Qué hay de verdad, medido en `db/schema.prisma` y en `lib/notificaciones/emitir.ts` | Estado |
| --- | --- | --- |
| «su cierre fue rechazado» | **No existe** evento de rechazo de cierre. Si el rechazo además lo deja bloqueado, se avisa vía `mensajero_bloqueado_por_cierres` —uno de sus tres productores es justamente el rechazo—. **Un rechazo que NO bloquea no produce hoy ningún aviso, ni en la campana.** | **SIN CUBRIR** · ficha aparte |
| «su reparto de mañana» | **No existe** nada: ni evento en el enum, ni emisor, ni cron, ni productor. | **SIN CUBRIR** · ficha aparte |
| «quedó bloqueado» | `mensajero_bloqueado_por_cierres` | cubierto |
| «le cambiaron el día de reparto» | `dia_reparto_corregido` | cubierto |

Cuando esos dos eventos existan, entrarán al canal **con una línea**: R2 obliga a que el enum no
compile hasta que alguien decida su elegibilidad, así que no pueden colarse ni quedarse fuera en
silencio.

**Forma en código (R2), y es lo que impide el olvido silencioso:**

```ts
// lib/notificaciones/push-elegibles.ts
export const PUSH_ELEGIBLE = { ... } satisfies Record<NotificacionEvento, PerfilPush>;
```

Un `Record` sobre el enum con `satisfies`: cuando la 409 añada sus dos valores, **el typecheck se
pone rojo** hasta que alguien decida. No hay `default`, no hay `?? "no"`. Un catálogo con valor por
defecto es exactamente el fallo mudo que esta familia de errores produce en este repositorio.

---

## 4. Modelo de datos

### 4.1 `push_suscripcion` — la suscripción, que es de un DISPOSITIVO

```prisma
model PushSuscripcion {
  id         String   @id @default(uuid())
  usuarioId  String   @map("usuario_id")
  endpoint   String   @unique                      // IDENTIDAD de la suscripción
  p256dh     String
  auth       String
  etiqueta   String?                               // "Chrome en Android", puesta por el cliente
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at")
  ultimoEnvioOkAt DateTime? @map("ultimo_envio_ok_at")

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId])
  @@map("push_suscripcion")
}
```

- **`endpoint` UNIQUE es la decisión central (R16-R18).** La suscripción pertenece al
  navegador-dispositivo, no a la persona. Registrar es un **upsert por `endpoint`** que sobreescribe
  `usuario_id`: si Ana cierra sesión y Beto entra en el mismo teléfono, el mismo `endpoint` pasa a
  Beto y Ana deja de recibir ahí — sin código que «detecte el cambio de dueño».
- **`ON DELETE CASCADE` (R22):** borrar el usuario se lleva sus suscripciones. Es el mismo criterio
  que `notificacion.destinatario_usuario_id`.
- **RLS habilitada SIN policies (R47),** patrón `jobs` / `api_key` / `notificacion`: solo el service
  role la toca. Guarda una credencial de entrega; el cliente no tiene nada que hacer aquí.
- **No se guarda el user-agent crudo.** `etiqueta` es un texto corto que compone el cliente para que
  la persona reconozca el dispositivo. No es PII y no se registra en logs (R23).

### 4.2 `push_envio_dia` — el cupo diario, y por qué es una tabla

```prisma
model PushEnvioDia {
  id             String             @id @default(uuid())
  usuarioId      String             @map("usuario_id")
  evento         NotificacionEvento
  diaCr          String             @map("dia_cr")   // "YYYY-MM-DD", jornada CR
  notificacionId String?            @map("notificacion_id")  // trazabilidad, sin FK
  createdAt      DateTime           @default(now()) @map("created_at")

  usuario Usuario @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@unique([usuarioId, evento, diaCr], map: "push_envio_dia_cupo")
  @@map("push_envio_dia")
}
```

**El cupo se toma INSERTANDO, no consultando (R6, R7).** Quien consigue insertar la fila
`(usuario, evento, jornada)` es quien manda el push; un `P2002` significa «ya salió hoy» y es un
no-op. Esto hace la regla **estructural**: dos productores concurrentes no pueden colarse por la
rendija entre el `SELECT` y el `INSERT`. Es el mismo razonamiento con el que la 333, la 401 y la 403
eligieron su `entidad_id`, aplicado aquí a otra tabla porque el cupo del **canal** no es el mismo que
la deduplicación del **aviso**: `cierre_dia_por_aprobar` crea legítimamente cinco avisos distintos en
un día (cinco cierres, cinco entidades) y debe pushear **uno**.

**Por qué una tabla y no `jobs.dedupe_key`:** un `dedupe_key` protege mientras la fila del job exista,
y los jobs se completan y se purgan. Un cupo diario que caduca cuando alguien limpie la cola no es un
cupo. Volumen medido a ojo con la plantilla actual: ≤ 39 usuarios × 8 eventos = **312 filas/día en el
peor caso absoluto**, realistas ~20. No necesita purga; si algún día la necesita, es un `DELETE`
por antigüedad y no cambia nada del diseño.

### 4.3 `job_tipo` += `push_web`

Migración **aparte y sola**: Postgres no permite usar un valor de enum en la misma transacción que lo
añadió (55P04) y Prisma corre cada `migration.sql` en una transacción. Criterio idéntico a las nueve
hermanas ya existentes (`20260827100000_job_tipo_whatsapp_bienvenida` y anteriores).

Su `down.sql` **recrea el tipo con la lista de los 9 valores previos** —incluido
`whatsapp_bienvenida`— porque Postgres no tiene `DROP VALUE`, y borra antes las filas de `jobs` de
ese tipo. Y no se toca ningún `down.sql` anterior: son fotos históricas de su rama.

### 4.4 Migraciones

| Carpeta | Qué hace | `down.sql` |
| --- | --- | --- |
| `<ts>_push_suscripcion` | `push_suscripcion` + `push_envio_dia` + índices + `ENABLE ROW LEVEL SECURITY` en ambas | `DROP TABLE` de las dos |
| `<ts+1>_job_tipo_push_web` | `ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'push_web'` | `DELETE FROM jobs WHERE tipo='push_web'` + recreación del enum con los 9 valores previos |

---

## 5. Capas y piezas nuevas

| Archivo | Capa | Qué hace |
| --- | --- | --- |
| `lib/interfaces/external/IPushSender.ts` | external | `enviar(suscripcion, payload) → PushOutcome`. **Nunca lanza por un desenlace HTTP.** |
| `lib/push/web-push-sender.ts` | external (impl) | Traduce `web-push` a `PushOutcome`. Único archivo que conoce la librería. |
| `lib/interfaces/repositories/IPushSuscripcionRepository.ts` | repo | contrato |
| `lib/repositories/PushSuscripcionRepository.ts` | repo | upsert, borrar por endpoint, borrar por id, listar por usuarios, tomar cupo del día |
| `lib/services/PushWebService.ts` | service | política: resolver destinatarios, comprobar leído/descartado, iterar suscripciones, aplicar la tabla de desenlaces |
| `lib/notificaciones/push-elegibles.ts` | dominio | el catálogo del §3 |
| `lib/notificaciones/notificacion-repo-con-push.ts` | dominio | el **decorador** del §6 |
| `lib/config/push.ts` | config | VAPID + `pushConfigurado()` |
| `lib/actions/push.ts` | acción | `registrarSuscripcionPush`, `eliminarSuscripcionPush`, `obtenerClavePublicaPush` |
| `hooks/usePushSuscripcion.ts` | cliente | estado del permiso y de la suscripción de **este** dispositivo |
| `components/shared/PushOptIn.tsx` | cliente | el control de R11-R15 |

`PushOutcome`, calcado de `IWebhookSender` de la 99 —vocabulario de **dominio**, no HTTP, para que la
política sea testeable sin red:

```ts
export type PushOutcome =
  | { status: "ok" }
  | { status: "caducada" }                      // 404 / 410 → borrar, NUNCA reintentar (R33)
  | { status: "transitorio"; detalle: string }  // red, timeout, 5xx, 429 (R34)
  | { status: "rechazada"; detalle: string };   // 4xx no recuperable (payload/claves): no reintentar
```

`detalle` **nunca** contiene el `endpoint` ni las claves (R23).

---

## 6. El punto de cableado: UN solo sitio, y por qué un decorador

Este repositorio ya pagó la factura de esta familia de fallos: **2 de 7 notificadores muertos con la
suite en verde**, porque cada productor tenía que acordarse de inyectar el suyo. Con once eventos y
ocho elegibles, repetir ese patrón es garantizar que alguno se olvide.

Por eso el push **no se cablea productor a productor**. Se cablea **una vez**, decorando el
repositorio de notificaciones:

```ts
// lib/notificaciones/notificadores.ts  (única línea que cambia del cableado existente)
function repoReal(): INotificacionRepository {
  return conPushWeb(new NotificacionRepository(getPrismaClient()));
}
```

`conPushWeb` devuelve un `INotificacionRepository` que delega todo y, **después de un `crear` que de
verdad insertó**, evalúa elegibilidad, toma el cupo del día e encola el trabajo. Consecuencias:

- Los diez `notificar<X>Real` pasan por `repoReal()`: **todos** quedan cableados de una vez.
- El productor **transaccional** (`emisorNotificacionReal`, el del rechazo) construye su repositorio
  con el `tx` y **no** queda decorado — lo cual es correcto: `orden_rechazada` no es elegible, y
  emitir push dentro de una transacción de negocio violaría R27.
- La deduplicación del aviso sigue mandando: si `emitirFilas` no crea la fila (ya hay una no leída),
  no hay push. El push nunca «resucita» un aviso deduplicado.

### 6.1 `crear` pasa a devolver el id

Hoy `INotificacionRepository.crear` devuelve `boolean`. El decorador necesita el **id** de la fila
creada para que el trabajo de la cola pueda releerla en el momento del envío (R8) y para su
`dedupe_key` (R35). Cambia a `Promise<string | null>` — `null` sigue significando «no se creó».

- `emitirFilas` adapta su condición (`!== null`): es el **único** consumidor de producción.
- Los dobles de test que devuelven `true`/`false` **rompen el typecheck**, que es exactamente lo que
  se quiere: el cambio es visible, no silencioso.
- Alternativa descartada: releer la fila con un `findFirst` desde el decorador. Es una consulta extra
  por aviso y, peor, reconstruye una identidad que el `INSERT` ya tenía en la mano — el tipo de
  código que acaba devolviendo la fila equivocada el día que haya dos parecidas.

---

## 7. La cola: un trabajo por aviso, no uno por suscripción

`dedupeKey = "push:" + notificacionId` → `JobRepository.enqueue` ya hace
`ON CONFLICT (dedupe_key) DO NOTHING` y devuelve `null`: R35 sale gratis.

**Payload:** `{ notificacionId }` y nada más. Ni el texto, ni el destino, ni el destinatario: se
resuelven al ejecutar, contra la fila real. Así un push que se entrega un minuto después no puede
llevar un texto obsoleto, y R8 (ya leído → no se envía) es comprobable.

**`maxIntentos = 3`** (frente al default de 5). Un push que no entró en tres intentos ya llegó tarde
para algo que tenía plazo; insistir solo gasta cupo de la cola.

**Por qué la cola y no un envío en línea.** El drenador ya da reintentos, backoff, visibilidad y
dead-letter, y —esto es lo que decide— mantiene la latencia de un tercero **fuera** de la operación de
negocio (R27). Un `cierre_dia_por_aprobar` se emite dentro de la Server Action con la que el mensajero
envía su cierre: colgarle ahí veinte peticiones HTTP a servicios de push es hacerle esperar por algo
que no es suyo.

**El riesgo que esto trae, y cómo se acota.** El drenador reclama **10 jobs por corrida**
(`JOBS_BATCH_SIZE`, `lib/config/jobs.ts`) y sirve a nueve tipos: un tipo que produzca muchos jobs
desplaza a los demás — la inanición ya medida en este repositorio. Aquí se acota por construcción:

1. **un job por aviso elegible creado**, no por suscripción ni por destinatario;
2. **un aviso elegible por (usuario, evento, jornada)** — el cupo del §4.2 se toma **antes** de
   encolar, así que el trabajo ni siquiera se crea si el cupo ya está gastado;
3. **todo desenlace termina el trabajo** (R36): entregado, caducada, aviso ya leído, sin
   configuración. Ninguno se queda dando vueltas.

Con eso el techo diario es del orden de decenas de jobs, frente a los **2-269 jobs/día** que ya mueve
solo la geocodificación.

---

## 8. Resolver a quién: el mismo predicado, y verificado contra Postgres

`predicadoVisibilidad(actor)` (en `NotificacionRepository`) es la fuente única de R13-R17 de la 146.
El push necesita el **camino inverso**: dado un aviso, qué usuarios lo verían.

```sql
-- usuarios destinatarios de una fila de notificacion
SELECT u.id FROM usuario u JOIN rol r ON r.id = u.rol_id
WHERE u.estado = 'activo'                                  -- R21
  AND (
        $destinatario_usuario_id = u.id
     OR (r.value = $destinatario_rol
         AND ($tienda_id IS NULL OR $tienda_id = u.id)
         AND ($zona_id   IS NULL OR $zona_id   = u.zona_id))
  )
```

Es el espejo exacto del predicado. **Y por eso no se prueba con dobles**: un doble no ve el SQL —este
repositorio lo midió cuatro veces— así que la equivalencia se verifica en
`tests/integration/db/` contra Postgres real, sembrando filas y comparando **conjunto contra
conjunto** con lo que `listarParaUsuario` devuelve a cada usuario. Una mutación del `WHERE` (quitar
la rama de zona, cambiar `IS NULL` por `= ''`) tiene que poner ese test rojo.

---

## 9. Composición del push y fallo cerrado

```jsonc
// lo que viaja cifrado hasta el navegador
{ "titulo": "...", "cuerpo": "...", "destino": "/ruta", "evento": "cierre_dia_vencido" }
```

- `titulo`, `cuerpo` y `destino` salen **enteros** de la presentación de la 409 (§2). Esta ficha no
  concatena, no recorta y no formatea.
- **El texto nunca promete un número que no ha contado (R52).** Si la 409 entrega el conteo de
  pendientes por (usuario, evento), la presentación ya viene con la cifra dentro y el push la lleva.
  Si no lo entrega, el push sale con el texto en **singular** del aviso que lo originó y **sin
  cantidad**. Un push que dice «tenés 1 cierre» cuando hay tres es peor que uno que no cuenta: el
  primero se lee como un dato y es falso; el segundo se lee como un aviso y es cierto. Esta ficha
  **no** cuenta por su cuenta: contar es del catálogo.
- `evento` solo alimenta la etiqueta (`tag`) del §10.
- **Si la presentación no resuelve** (evento sin presentación, aviso borrado, destino vacío) **no se
  envía nada** y el trabajo termina con su motivo registrado. Nunca un push con texto de relleno: un
  aviso mudo se nota; un aviso que miente, no (R38 solo cubre el caso simétrico, el del
  **navegador** que recibe algo ilegible).
- **Nada más viaja** (R48). El texto de origen ya cumple la regla de la 146: nunca dirección,
  teléfono ni monto.

---

## 10. El service worker

Se añaden **dos manejadores** dentro de la rama de producción de `public/sw.js` (el `else`), nunca en
la rama de desarrollo/rescate, que se autodestruye (R42).

```js
self.addEventListener("push", (event) => { event.waitUntil(mostrar(event)); });
self.addEventListener("notificationclick", (event) => { event.waitUntil(abrir(event)); });
```

- **`push`:** intenta `event.data.json()`; si falla o faltan campos, usa `TITULO_RESERVA` /
  `CUERPO_RESERVA` y destino `"/"` (R38). Siempre `showNotification`: un push que no muestra nada
  hace que el navegador muestre su propio «este sitio se actualizó en segundo plano».
- **`tag: "ordenex:" + evento`** con `renotify: false` (R41): el segundo push del mismo tipo
  reemplaza, no apila.
- **`data: { destino }`**, `icon: "/icons/icon-192.png"`.
- **`badge: "/icons/badge-72.png"` (D8).** El `badge` es el icono pequeño que Android pinta en la
  barra de estado y **solo usa el canal alfa**: un PNG a color se ve como una mancha blanca. El
  criterio sale del propio lienzo, no se inventa nada: es **el mismo glifo de paquete** que
  `Push.dc.html` usa en las tres tarjetas —el icono `package` de `lucide`, que ya es dependencia del
  proyecto— renderizado en **blanco sobre transparente a 72×72**. No es un diseño nuevo, es el que ya
  está aprobado en otro tamaño. Si el asset no llega a producirse, se **omite** `badge` y Android cae
  en el icono del navegador: feo, pero nunca una mancha.
- **`notificationclick`:** `notification.close()`, luego
  `clients.matchAll({ type: "window", includeUncontrolled: true })`; si hay una ventana del mismo
  origen → `focus()` **y** `navigate(destino)`; si no hay ninguna → `openWindow(destino)` (R39/R40).
  Es la diferencia entre volver a lo que tenías y encontrarte una tercera pestaña de la misma app.
- **Ventana visible → un solo sonido (R43):** si `matchAll` encuentra un cliente con
  `visibilityState === "visible"`, el service worker le hace `postMessage` con
  `MENSAJE_PUSH_RECIBIDO`; la app revalida su campana **y suprime su tono propio** para ese
  incremento. Se sigue mostrando la notificación del sistema (el navegador lo exige), pero el tono de
  `useTonoAlIncrementar` no se suma encima.
- **Los literales del mensaje se duplican a mano** en `lib/pwa/actualizacion.ts` y `public/sw.js` —el
  service worker no puede importar del bundle— y **una guardia comprueba que no divergen**, igual que
  ya se hace con `ordenex:relevo-ahora` y `ordenex:pagina-lista`.

---

## 11. El permiso: cuándo se pide y por qué ahí

**Nunca al cargar (R10).** Un «no» del navegador es difícil de revertir: en la práctica hay que
entrar a los ajustes del sitio, y la mayoría de la gente no lo hace. Pedirlo en el primer segundo,
sin contexto y sin que nadie haya echado de menos nada, es la forma más eficiente de perder el canal
**para siempre** en la mitad de la plantilla. Además, en iOS `requestPermission` **exige** un gesto
del usuario, así que al cargar ni siquiera funcionaría.

**El flujo (R11-R15):**

1. El control `PushOptIn` vive **dentro del panel de notificaciones** (el de la 409) y en el perfil de
   la persona. Ahí llega alguien que ya está mirando sus avisos: el contexto es el correcto.
2. El control se ofrece **solo** si el navegador soporta service worker + `PushManager` +
   `Notification` **y** `pushConfigurado()` es cierto (R13).
3. Muestra el estado de **este dispositivo** (R14): «Avisarme en este dispositivo» / «Activado en este
   dispositivo» / «Bloqueado por el navegador».
4. Al activarlo: primero la explicación propia (qué se va a avisar y que es uno al día), y solo tras
   el clic → `Notification.requestPermission()` → `pushManager.subscribe({ userVisibleOnly: true,
   applicationServerKey })` → Server Action de registro.
5. `permission === "denied"` → no se vuelve a llamar (sería un no-op) y se explica cómo revertirlo
   desde los ajustes del navegador (R12).
6. Al desactivarlo: `subscription.unsubscribe()` **y** borrado en el servidor (R15).

### 11.1 iOS: la condición, y a cuánta gente le cuesta (MEDIDO, D6)

El push web en Safari de iOS/iPadOS solo funciona si la aplicación está **añadida a la pantalla de
inicio** (disponible desde iOS 16.4); en una pestaña normal de Safari `PushManager` no existe, y el
control, por R13, ni siquiera aparece.

**Lo que eso cuesta, medido el 2026-09-10 sobre los ingresos reales:**

| | |
| --- | --- |
| Entran desde iPhone o iPad | **8 personas** |
| De ellas, usan **solo** iOS | **3 — y las tres son mensajeros** |
| Las otras 5 | Entran también desde Windows o Android → **el push les llega igual** por su otro dispositivo |

**Coste declarado: 3 de 18 mensajeros se quedan sin push mientras no instalen la app en su pantalla
de inicio.** Ese número convierte «iOS tiene condiciones» en una decisión de negocio con precio
conocido, y es lo que justifica el diseño del control:

**la instrucción de instalar aparece EXACTAMENTE donde iría el control** («Compartir → Añadir a
inicio»), no en una ayuda, no en un pie de página, no en un aviso aparte. Esas tres personas van a ir
a buscar el interruptor de avisos al mismo sitio que las otras 36; si allí no hay nada, la conclusión
razonable es que la app está rota. Si allí está la instrucción, la conclusión es que falta un paso
que ellas pueden dar. El manifiesto ya está listo para ese paso (`display: standalone`, iconos
192/512 y *maskable*).

---

## 12. Configuración (R29-R32)

`lib/config/push.ts`, espejo de `lib/config/email.ts`:

| Variable | Qué es |
| --- | --- |
| `VAPID_PUBLIC_KEY` | clave pública (base64url). Viaja al navegador, no es secreto. |
| `VAPID_PRIVATE_KEY` | **secreto.** Nunca sale del servidor. |
| `VAPID_SUBJECT` | `mailto:` de contacto que exige el estándar. Opcional con default. |

- `pushConfigurado()` mira **pública y privada**: es la condición que decide si se instancia el
  emisor real o el **no-op**. Sin ellas: el control no aparece, el decorador no encola y el handler
  del job termina sin enviar, **registrando una vez** la falta con el **nombre** de la variable
  (nunca el valor). Nada lanza, nada bloquea. Es la lección de la 400 —un fallo de configuración no
  puede parar la operación— y el mismo patrón que `ConsoleEmailSender` cuando no hay SMTP.
- **La clave pública se sirve en tiempo de ejecución** por Server Action `obtenerClavePublicaPush()`
  y **no** por `NEXT_PUBLIC_*`: una `NEXT_PUBLIC_` se hornea en el bundle en tiempo de compilación, y
  rotar la clave exigiría un despliegue. Además esto deja **una sola** fuente (R32).
- Las tres se documentan en `.env.example` (solo nombres) y se dan de alta **por entorno** en Vercel:
  producción y *preview* tienen bases distintas y una variable compartida apunta al proyecto
  equivocado en uno de los dos.
- **Generación de claves:** `web-push generate-vapid-keys` (o un script equivalente de un solo uso).
  Se documenta en `.env.example`; el script **no se commitea**.

---

## 13. Alternativas descartadas

**A1 — Inyectar un notificador de push en cada productor (patrón `notificar<X>Real` × 8).**
Es lo que el repositorio ya hace para la campana, así que era la opción «coherente». **Descartada**
porque ese mismo patrón produjo aquí **2 de 7 notificadores muertos con la suite en verde**: cada
productor tiene que acordarse, y el que se olvida no rompe nada. Con ocho eventos elegibles y más por
venir, la probabilidad de un canal a medias es alta y su síntoma es el silencio. El decorador del §6
tiene **un** punto de fallo en vez de ocho, y ese punto se puede vigilar con una guardia.

**A2 — Enviar el push en línea, dentro del notificador best-effort.**
Más simple: sin cola, sin enum nuevo, sin payload, latencia mínima. **Descartada** por dos motivos.
(a) Mete N peticiones HTTP a servicios de terceros dentro de la operación de negocio que acaba de
ocurrir —la Server Action del mensajero que envía su cierre, la corrida del cron de gastos— y R27 lo
prohíbe por una razón medida: este repositorio ya decidió encolar el mensaje de bienvenida de
WhatsApp exactamente por esto. (b) Sin cola no hay reintento ni dead-letter, así que un corte de un
minuto del servicio de push pierde el aviso para siempre y en silencio. **El precio aceptado por el
humano el 2026-09-10 (D5): hasta ~60 s de latencia**, que es la cadencia del cron y no justifica un
canal aparte.

**A3 — Un job de push por SUSCRIPCIÓN en vez de por aviso.**
Aislaría cada entrega: una suscripción muerta no afectaría a las demás y el backoff sería por
dispositivo. **Descartada** por la inanición ya medida de esta cola: el drenador reclama **10 jobs por
corrida** y sirve a nueve tipos. Un aviso a `admin` + `adminSatelite` con dos dispositivos por persona
son ~20 jobs de un golpe que desplazan a la geocodificación y a los webhooks. El aislamiento se
consigue igual dentro del handler: un `try` por suscripción, y el fallo de una no impide las demás
(R26).

**A4 — Guardar el cupo diario en `jobs.dedupe_key` en vez de una tabla.**
Cero tablas nuevas y el índice único parcial ya existe. **Descartada** porque el `dedupe_key` solo
protege mientras la fila del job siga ahí: en cuanto la cola se purgue o se limpie un `failed`, el
cupo del día se «recarga» y el mismo tipo vuelve a sonar. Un cupo que depende de que nadie toque la
cola no es un cupo. La tabla del §4.2 es explícita, auditable y su volumen es despreciable.

**A5 — Implementar VAPID y el cifrado del payload a mano con `node:crypto`.**
Evita una dependencia y por tanto el gate completo por `package.json`. **Descartada**: firmar un JWT
ES256 y cifrar con AES128GCM + ECDH es criptografía de la que **falla en silencio** —una entrega
rechazada por el servicio de push se parece mucho a «no llegó»— y ninguna de nuestras pruebas locales
la distinguiría. Se usa `web-push`, encapsulada tras `IPushSender` para que cambiarla sea un archivo.

**A6 — Reutilizar la deduplicación del aviso (`notificacion_dedupe_key`) como cupo del canal.**
**Descartada**: son dos preguntas distintas. La del aviso es «¿ya hay una no leída para esta
entidad?»; la del canal es «¿ya sonó hoy este tipo para esta persona?». `cierre_dia_por_aprobar` crea
legítimamente cinco avisos en un día —cinco cierres, cinco entidades— y debe pushear **uno**.
Mezclarlas obligaría a estropear una de las dos.

**A7 — Componer el texto del push en esta ficha.**
**Descartada**: sería un segundo juego de literales para el mismo hecho, y compararlo en un test
contra la función que lo compone estaría siempre verde. El texto es de la 409 (§2).

---

## 14. Gate, secuenciación y archivos

**El gate es `./init.sh` COMPLETO, y no es opcional.** El diff toca `db/schema.prisma`,
`db/migrations/**`, `package.json` y `pnpm-lock.yaml`: `--rapido` **se niega solo** ante cualquiera de
ellos (`docs/verification.md`). Además, sin `DATABASE_URL` resoluble los ~147 archivos de
`tests/integration/db` se **saltan** —y ahí es donde vive la verificación del §8—, así que hay que
mirar los `skipped`, no solo el veredicto.

**Secuenciación con la 409.** Es su dependencia declarada y hay solape de archivos: la 409 toca
`components/shared/NotificationsBell.tsx`, el DTO de notificación y `lib/notificaciones/emitir.ts`.
**Esta ficha no debe empezar hasta que la 409 esté mergeada**, y necesita de ella la presentación del
§2. Dentro de la ficha: **backend → frontend**.

| Archivo | Qué le pasa | Solapa con 409 |
| --- | --- | --- |
| `db/schema.prisma` | +2 modelos, +1 valor de `job_tipo` | 409 añade 2 valores a `NotificacionEvento` — **sí** |
| `db/migrations/<ts>_push_suscripcion/**` | nuevo | no |
| `db/migrations/<ts>_job_tipo_push_web/**` | nuevo | no |
| `package.json`, `pnpm-lock.yaml` | +`web-push`, +`@types/web-push` | no |
| `.env.example` | +3 nombres | no |
| `lib/config/push.ts` | nuevo | no |
| `lib/interfaces/external/IPushSender.ts` | nuevo | no |
| `lib/interfaces/repositories/IPushSuscripcionRepository.ts` | nuevo | no |
| `lib/interfaces/repositories/INotificacionRepository.ts` | `crear` → `Promise<string \| null>` | **sí** |
| `lib/repositories/NotificacionRepository.ts` | `crear` devuelve el id | **sí** |
| `lib/repositories/PushSuscripcionRepository.ts` | nuevo | no |
| `lib/services/PushWebService.ts` | nuevo | no |
| `lib/push/web-push-sender.ts` | nuevo | no |
| `lib/notificaciones/push-elegibles.ts` | nuevo | no |
| `lib/notificaciones/notificacion-repo-con-push.ts` | nuevo | no |
| `lib/notificaciones/emitir.ts` | `emitirFilas`: `!== null` | **sí** |
| `lib/notificaciones/notificadores.ts` | `repoReal()` decorado (1 línea) | no |
| `lib/actions/push.ts` | nuevo | no |
| `lib/actions/auth.ts` / `app/_components/LogoutButton.tsx` | baja de la suscripción al salir | no |
| `app/api/cron/procesar-jobs/route.ts` | registra el handler `push_web` | no |
| `public/sw.js` | +`push`, +`notificationclick` | no |
| `public/icons/badge-72.png` | nuevo (glifo del lienzo, blanco sobre transparente) | no |
| `lib/pwa/actualizacion.ts` | + literal del mensaje al cliente | no |
| `hooks/usePushSuscripcion.ts` | nuevo | no |
| `hooks/useNotificaciones.ts` / `useTonoAlIncrementar` | escucha del mensaje del SW y supresión del tono | **posible** |
| `components/shared/PushOptIn.tsx` | nuevo | no |
| `components/shared/NotificationsBell.tsx` | monta `PushOptIn` (1 import + 1 línea) | **sí** |

---

## 15. Qué se prueba de verdad, y con qué

| Qué | Dónde | Por qué ahí |
| --- | --- | --- |
| Equivalencia destinatarios-push ↔ visibilidad (R24/R25) | `tests/integration/db/` (Postgres real) | es **SQL**; los dobles no lo ven |
| Cupo diario y su carrera (R6/R7) | `tests/integration/db/` | el que decide es un **índice único**, no una rama: el test lanza **dos emisiones simultáneas** (`Promise.all` sobre dos conexiones) para el mismo (usuario, evento, jornada) y afirma **exactamente un** encolado y **exactamente una** fila de cupo |
| Cascada al borrar usuario, `endpoint` único, RLS (R16-R18, R22, R47) | `tests/integration/db/` | son restricciones de la base |
| Tabla de desenlaces: `caducada` borra y no reintenta; transitorio reintenta acotado (R33/R34/R36) | unit con `IPushSender` doble | política pura, sin red |
| El catálogo es exhaustivo (R2) | typecheck + guardia | un valor nuevo debe **romper**, no caer en un default |
| `repoReal()` **pasa** el emisor real (R1, familia «composition root») | guardia + unit del camino real | no basta con que lo importe: hay que ver que alguien lo pasa |
| **Un productor NUEVO que no pase por el punto único (R51)** | guardia que recorre el árbol | la guardia enumera los `notificar<X>Real` de `notificadores.ts` y afirma que **todos** resuelven su repositorio por `repoReal()`; un décimo productor que construya `new NotificacionRepository(...)` por su cuenta la pone **roja**. Ningún grafo de imports detecta ese olvido — por eso es guardia y no test |
| `push` y `notificationclick` del service worker (R37-R42) | `tests/unit/guards/` ejecutando `public/sw.js` en un `new Function` | `public/**` no lo selecciona ningún grafo de imports; el arnés ya existe (`pwa-relevo-y-purga.guardia.test.ts`) |
| Literales del mensaje SW ↔ bundle no divergen | guardia | precedente `ordenex:relevo-ahora` |
| Permiso: nunca al cargar (R10) | unit de componente | aserción sobre `requestPermission` **no llamado** al montar |
| Un solo sonido (R43) | unit de hook | |

**Mutaciones que el implementer debe aplicar y que TIENEN que poner algo rojo** (un canal de «uno al
día» falla en silencio con demasiada facilidad):

1. Quitar la toma de cupo → el **segundo** push del día sale → test rojo.
2. Invertir el cupo (siempre ocupado) → el **primero** no sale → test rojo.
3. Cambiar `caducada` por `transitorio` → la suscripción muerta sobrevive y se reintenta → test rojo.
4. Quitar la rama de zona del predicado de destinatarios → alguien de otra zona recibe → test rojo.
5. Marcar como elegible un evento de la lista negativa → test rojo.
6. Devolver el repositorio **sin** decorar en `repoReal()` → guardia roja.
7. Quitar `client.focus()` del `notificationclick` → se abre una segunda pestaña → guardia roja.
8. Hacer que falten las claves VAPID → **nada** debe lanzar, y el control **no** debe aparecer.
9. Añadir un productor que construya su repositorio **sin** `repoReal()` → guardia de R51 roja.
10. Marcar `geocodificacion_caida` como elegible también para `admin` → test rojo (§3.1).
11. Hacer que el push afirme una cantidad sin conteo disponible → test rojo (R52).

---

## 16. Límites declarados

Ninguno es una pregunta abierta: los ocho puntos que lo eran los cerró el humano el 2026-09-10
(D1-D8 en `requirements.md`). Lo que sigue es lo que esta ficha **conscientemente no entrega**.

- **«Su cierre fue rechazado» (sin bloqueo) y «tu reparto de mañana» NO se pushean**, porque **no
  existen como evento**: no hay enum, ni emisor, ni cron, ni productor. El lienzo los promete; el
  código no los tiene. Van en fichas aparte (D1, §3.2). **Es el límite que más fácil se lee mal**: en
  el lienzo parecen entregados.
- **Latencia de hasta ~1 minuto** (cadencia del cron). Aceptada (D5).
- **`cierre_dia_por_aprobar` se pushea una vez al día y, sin conteo de la 409, en singular y sin
  cantidad** (R52 / D3). No es un agregado; es un aviso cierto que no cuenta.
- **El `admin` no recibe push de `geocodificacion_caida`**, solo campana (D4, §3.1).
- **3 de 18 mensajeros no reciben push** mientras no instalen la app en su pantalla de inicio (D6,
  §11.1).
- **No hay pantalla de «mis dispositivos»** (D7): el control es de **este** dispositivo, y la
  revocación a distancia no entra. Se sostiene sobre R19 (baja al cerrar sesión) y R33 (retirada de
  las muertas).
- **Nadie ha visto esto en un teléfono todavía.** Todo lo verificable aquí es jsdom, Postgres y el
  arnés del service worker; la entrega real depende de servicios de terceros que ninguna suite de
  este repositorio toca. La comprobación en un dispositivo real es una task explícita en `tasks.md`,
  no un supuesto.
- **Producción se vació el 2026-08-25**: un cero al medir aquí significa «aún no ha pasado», no «está
  roto».
