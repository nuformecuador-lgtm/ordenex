# Ficha 422 — Diseño

> Base: `origin/dev` @ `89060a33`. Todo lo que aquí se afirma sobre el árbol está leído del archivo,
> no del índice del grafo.

## 1. Lo que hay hoy, medido en el árbol

| Pieza | Archivo | Qué hace hoy |
| --- | --- | --- |
| Baja del dispositivo | `lib/pwa/baja-push.ts:45` | `darDeBajaDeEsteDispositivo()`: borra la fila en el servidor **y** se da de baja en el navegador. No lanza nunca (410/R20). |
| Interruptor OFF | `hooks/usePushSuscripcion.ts:207` | llama a esa función. |
| Salir | `app/_components/LogoutButton.tsx:41` | llama a **esa misma** función, antes de `logout()`. |
| Alta | `hooks/usePushSuscripcion.ts:148-200` | `activar()`: único `Notification.requestPermission()` del árbol → `subscribe` → `registrarSuscripcionPush`. |
| Arranque del hook | `hooks/usePushSuscripcion.ts:108` | lee el permiso y pregunta si hay suscripción. **No pide nada** (410/R10). |
| Identidad de la suscripción | `db/schema.prisma:3542` · migración `20260912120000_push_suscripcion` | `endpoint` **UNIQUE**: un dispositivo-navegador, una fila. |
| Preferencias de usuario | — | **No existe ningún sitio.** Verificado sobre `db/schema.prisma` (el único «preferencia» del repo es `usePreferenciaSonido`, que vive en `localStorage`). |

### 1.1 ⚠️ Un dato de la ficha que resultó falso al mirarlo de cerca

La ficha propone evaluar si la reactivación va **en el efecto de arranque del hook**
(`usePushSuscripcion.ts:108`). **Ahí no puede ir**, y no es una cuestión de gusto:

`PushOptIn` —el único consumidor del hook— se monta en `NotificationsBell.tsx:455`, **dentro** de
`<Popover.Portal>` (línea 273), y ese portal **no lleva `keepMounted`**. En
`@base-ui/react@1.6.0`, `PopoverPortal.d.ts:15` declara `keepMounted` con `@default false`: el
contenido del panel **no está montado mientras la campana está cerrada**.

Consecuencia: si la reactivación viviera en ese hook, **no ocurriría al entrar**, sino la primera vez
que la persona **abre el panel de la campana** — que es justo el gesto que esta ficha existe para no
tener que pedir. Por eso la reactivación vive en una superficie propia montada en el layout del
portal (§5).

## 2. Modelo de datos

### 2.1 La tabla

```prisma
/// FICHA 422 — LA DECISIÓN DE LA PERSONA, aparte del dispositivo.
/// 1:1 con `usuario`. Una fila por persona que ha decidido algo alguna vez; su AUSENCIA es
/// «todavía no ha decidido nada», que a efectos de comportamiento es «no» (R2).
model UsuarioPreferencia {
  id        String  @id @default(uuid())
  usuarioId String  @unique @map("usuario_id")

  /// R1/R7/R8 — «quiero que me avisen». NO dice en qué dispositivo: eso lo dice
  /// `push_suscripcion`, y el permiso del navegador lo dice el navegador.
  avisosPush Boolean @default(false) @map("avisos_push")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  usuario Usuario @relation("UsuarioPreferenciaUsuario", fields: [usuarioId], references: [id], onDelete: Cascade)

  @@map("usuario_preferencia")
}
```

Y en `Usuario`: `preferencia UsuarioPreferencia? @relation("UsuarioPreferenciaUsuario")`.

**Por qué una tabla propia 1:1 y no una columna en `usuario`.** `usuario` se lee en cada resolución
de sesión y ya carga 20 columnas y ~50 relaciones de dominio: identidad, rol, vehículo, zona, orden en
gestión. Una preferencia no es identidad ni estado operativo — es lo que la persona quiere que la
aplicación haga con ella. Metida ahí, viaja en cada lectura de usuario (incluidas las cuentas
sintéticas de las API keys, que nunca tendrán preferencias) y convierte la tabla más caliente del
esquema en el cajón de sastre donde acaba cada ajuste de interfaz. Aparte tiene un coste real y
acotado: una consulta extra, por índice único, en el layout del portal.

**Por qué columnas tipadas y no clave/valor (EAV).** Una tabla `(usuario_id, clave, valor TEXT)` es
más «lista para el futuro» sobre el papel y peor en este repo: pierde el tipo en la frontera —hay que
parsear un texto en cada lectura y decidir qué hacer con `"sí"`, `"1"` y `"true"`—, y una **clave mal
escrita no falla: devuelve «no hay preferencia»**. Es exactamente la familia de fallo que este árbol
persigue (el sistema no falla, aparenta). Con una columna, una preferencia mal nombrada no compila.
El precio —una migración por preferencia nueva— es una migración sobre una tabla estrecha que no lee
nadie más, no sobre `usuario`.

### 2.2 Migración

Carpeta: `db/migrations/20260915120000_usuario_preferencia/` (posterior a la última del árbol,
`20260914120000_notificacion_evento_reparto_manana`).

`migration.sql`:

1. `CREATE TABLE "usuario_preferencia"` con PK, `usuario_id` NOT NULL, `avisos_push BOOLEAN NOT NULL
   DEFAULT FALSE`, sellos, y FK a `usuario` **ON DELETE CASCADE** (R4: una preferencia no es
   evidencia; el criterio de `push_suscripcion`, no el de `historial_accion`).
2. `CREATE UNIQUE INDEX "usuario_preferencia_usuario_id_key"` — el 1:1, y lo que hace del upsert por
   `usuario_id` una operación atómica.
3. **Backfill** (R5):

```sql
INSERT INTO "usuario_preferencia" ("id", "usuario_id", "avisos_push", "created_at", "updated_at")
SELECT gen_random_uuid()::text, s."usuario_id", TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "usuario_id" FROM "push_suscripcion") AS s
ON CONFLICT ("usuario_id") DO NOTHING;
```

4. `ALTER TABLE "usuario_preferencia" ENABLE ROW LEVEL SECURITY;` — habilitada **sin policies**,
   patrón `push_suscripcion` / `jobs` / `notificacion`: este repo no usa Supabase Auth, así que una
   policy no tendría a quién preguntar; lo que la RLS garantiza es que a estas filas no se llega si no
   es por el servidor de la aplicación.

`down.sql`: `DROP TABLE IF EXISTS "usuario_preferencia";` — arrastra su índice, su FK y su RLS.
**Aquí no aplica la lección de los enums**: esta migración **no crea ningún tipo**, así que no hay
`DROP TYPE` ni ninguna lista que recrear, y **no se toca ningún `down.sql` anterior** (son fotos de
su rama). Lo que se pierde al revertir, dicho en voz alta: **la preferencia de todo el mundo**,
incluido el backfill. Nadie deja de recibir push por eso —las suscripciones siguen intactas— pero el
siguiente cierre de sesión vuelve a olvidar la decisión, que es el estado de hoy.

### 2.3 Por qué el backfill dice SÍ, y no «que lo vuelvan a activar»

Una fila en `push_suscripcion` **solo puede existir porque alguien tocó el interruptor y concedió el
permiso**: no hay ningún otro camino en el árbol que la cree. Es decir, esas personas ya hicieron el
gesto que esta ficha llama «preferencia»; lo único que faltaba era el sitio donde anotarlo. Dejarlas
en `false` sería estrenar la función olvidando la única decisión explícita que hay registrada, y el
primer cierre de sesión las apagaría — que es el fallo que esta ficha viene a arreglar. El riesgo del
sentido contrario está acotado y se mide antes de aplicar (§2.4): son las personas que hoy están
recibiendo avisos y quieren seguir recibiéndolos; si alguna no quiere, el interruptor lo apaga y
borra la preferencia.

Esto deja una invariante útil y fácil de decir: **registrar una suscripción es, por definición, decir
que sí** (R3). El backfill es esa misma regla aplicada a la historia.

### 2.4 Medir antes y después (contra producción, en solo lectura)

Antes de aplicar:

```sql
SELECT COUNT(*) AS suscripciones, COUNT(DISTINCT usuario_id) AS personas FROM push_suscripcion;

SELECT u.email, s.etiqueta, s.created_at
FROM push_suscripcion s JOIN usuario u ON u.id = s.usuario_id
ORDER BY s.created_at;
```

La ficha dice que ahí vive al menos «Firefox en Windows». El número exacto **se escribe en el informe
antes de desplegar**; un backfill sin su número medido no se despliega.

Después de aplicar:

```sql
SELECT COUNT(*) AS filas,
       COUNT(*) FILTER (WHERE avisos_push) AS puestas,
       COUNT(*) FILTER (WHERE updated_at = created_at) AS intactas
FROM usuario_preferencia;
```

`filas = puestas = intactas = personas` demuestra que el backfill hizo exactamente lo que dijo y que
nada más tocó esas filas.

## 3. ⚠️ La costura: separar la intención sin separar el trabajo

### 3.1 La forma

`lib/pwa/baja-push.ts` sigue siendo **el único sitio** donde se da de baja este dispositivo. Lo que
cambia es que ahora **hay que decir por qué**:

```ts
/**
 * POR QUÉ SE DA DE BAJA ESTE DISPOSITIVO. No es metadato: es lo único que distingue
 * «dijo que no» de «solo se fue», y de eso depende si la preferencia sobrevive.
 */
export type MotivoDeLaBaja =
  /** La persona apagó el interruptor. DIJO QUE NO: la preferencia se borra. */
  | "la-persona-apago-el-interruptor"
  /** La persona cerró sesión. NO dijo que no: la preferencia se conserva. */
  | "cierre-de-sesion";

export interface ResultadoBajaPush {
  estado: "sin-suscripcion" | "dada-de-baja" | "fallo-parcial";
  preferencia: "borrada" | "conservada" | "fallo-al-borrar";
}

export async function darDeBajaDeEsteDispositivo(
  motivo: MotivoDeLaBaja,
): Promise<ResultadoBajaPush>;
```

Dentro, en este orden:

1. **La intención, primero y siempre.** Un `switch (motivo)` exhaustivo (con `const _: never = motivo`
   en el `default`) decide: `"la-persona-apago-el-interruptor"` → `olvidarPreferenciaDeAvisos()`;
   `"cierre-de-sesion"` → no se toca nada. Va **antes** del corte por «no hay suscripción» a
   propósito (R11): apagar el interruptor en un dispositivo cuya suscripción se evaporó entre el
   render y el clic tiene que borrar la preferencia igual, o la persona diría que no y la app la
   volvería a suscribir mañana.
2. **El trabajo del dispositivo, idéntico para los dos motivos**: el código de hoy, línea por línea —
   servidor primero, navegador después, y el segundo va aunque el primero falle.
3. Ningún fallo se propaga (R12): cada mitad registra el suyo y el resultado lo cuenta.

### 3.2 Por qué esta forma y no otra — lo que impide que una superficie nueva se olvide

- **El motivo es un parámetro obligatorio.** Con `strict: true`, una tercera superficie que llame a
  `darDeBajaDeEsteDispositivo()` **no compila**. No hay valor por defecto, y eso es la mitad del
  diseño: el descuido que R19 temía —llamar y olvidarse de la mitad— aquí es un error de tipos.
- **El `switch` es exhaustivo.** Añadir un tercer motivo sin decidir qué significa para la
  preferencia **tampoco compila** (`never`). La decisión vive en **un solo sitio**.
- **Una guardia censa las llamadas** (§9): cada `darDeBajaDeEsteDispositivo(` de `app/`,
  `components/`, `hooks/` y `lib/` tiene que estar en una lista blanca **con su motivo y su cuenta
  exacta**. El tipo obliga a declarar *un* motivo; la guardia obliga a que alguien escriba *por qué
  ése*. Cuenta apariciones y no archivos, por la lección medida dos veces en este repo (una guardia
  que decide «este archivo sí/no» se queda verde cuando borras una de varias apariciones).

### 3.3 Alternativa descartada: dos funciones exportadas

`darDeBajaPorApagado()` y `darDeBajaPorCierreDeSesion()`, las dos sobre un núcleo privado compartido.
Mantiene el trabajo unido (el núcleo no se exporta) y se lee bien en el sitio de la llamada.
**Descartada** porque deja el conjunto de intenciones **abierto**: una tercera superficie añade su
propio envoltorio, escribe su propio tratamiento de la preferencia —o se olvida de escribirlo— y
**nada falla**; no hay un punto donde el compilador pueda preguntar «¿y ésta qué significa?». Con un
solo punto de entrada y una unión cerrada, ese punto existe y es el `switch`.

### 3.4 Alternativa descartada: que el motivo viaje en la Server Action de la baja

Añadir `motivo` a `eliminarSuscripcionSchema` (zod `strict()`) y que el servidor decida. Es atractivo
—una sola ida y vuelta, y la decisión del lado testeable—, pero **se rompe en R11**: esa acción
necesita el `endpoint`, y el caso «apagué el interruptor y aquí ya no había suscripción» no tiene
endpoint que mandar, así que la intención no llegaría nunca al servidor justo en el caso en que más
falta hace. La preferencia se escribe con su **propia** acción sin cuerpo (`olvidarPreferenciaDeAvisos`),
que no depende de que haya dispositivo del que darse de baja.

## 4. El alta, también en un solo sitio

`activar()` hace hoy dos cosas distintas: **pedir el permiso** (gesto, 410/R11) y **suscribir +
registrar**. La reactivación necesita la segunda sin la primera. Se extrae la segunda:

```ts
// lib/pwa/alta-push.ts — EL TRABAJO DEL ALTA, EN UN SOLO SITIO (simétrico a baja-push.ts).
export type ResultadoAlta =
  | { estado: "suscrito" }
  | { estado: "sin-permiso" }       // ⚠️ el permiso NO se pide aquí: se COMPRUEBA
  | { estado: "sin-soporte" }
  | { estado: "fallo" };

export async function suscribirYRegistrarEsteDispositivo(clavePublica: string): Promise<ResultadoAlta>;
```

Reglas de esta función, que son las que sostienen R16/R17:

- **No llama a `Notification.requestPermission()` jamás.** Su primera comprobación real es
  `Notification.permission !== "granted" → { estado: "sin-permiso" }`, y se corta ahí. La preferencia
  **no entra** en esta función: quien la consulta es el llamante, y aun con ella puesta esta función
  no pasa de aquí sin permiso concedido. Es el «no se puede saltar la comprobación» de la ficha,
  escrito como una comprobación propia y no delegada en que el navegador lance.
- Reutiliza sin cambios `claveAplicacionDesde`, `clavesDeSuscripcion` y `etiquetaDeDispositivo` de
  `lib/pwa/push-navegador.ts`, y el `unsubscribe` de rescate cuando el registro en el servidor falla
  (una suscripción viva que el servidor no conoce es un dispositivo que cree que va a recibir avisos).
- No escribe el `endpoint` ni las claves en ningún log (410/R23).

`activar()` queda como: comprobar denegado → `requestPermission()` (sigue siendo el **único** del
árbol) → `suscribirYRegistrarEsteDispositivo(clavePublica)` → pintar estado.

## 5. Dónde se dispara la reactivación

**Componente propio, montado en el layout del portal.** `components/shared/PushReactivacion.tsx`:
cliente, **renderiza `null`**, recibe la preferencia por prop.

```tsx
// app/(app)/layout.tsx — junto a <AvisoVersionNueva />, que es el precedente exacto:
//   un componente cliente que no pinta nada hasta que decide por sí mismo.
<PushReactivacion avisosRecordados={avisosRecordados} />
```

`app/(app)/layout.tsx` ya resuelve al actor (`resolveActorFromSession`) y ya construye un repositorio
(`UserRepository`), así que la preferencia se lee **en el servidor** y baja por props — el patrón de
`docs/architecture.md` para dato privado. Sin actor, `avisosRecordados = false` y el componente no se
monta (R24). El layout es además el sitio que **persiste entre navegaciones**: el intento ocurre una
vez por carga del portal (R23) y no en cada página.

**Orden de las comprobaciones, de lo más barato y restrictivo a lo más caro** (importa: para la
inmensa mayoría el coste de red es **cero**):

1. `avisosRecordados === true` — ya está en props, no cuesta nada (R18).
2. `haySoportePush()` — local.
3. `Notification.permission === "granted"` — local, **lectura**, no petición (R16/R17).
4. `getRegistration()?.pushManager.getSubscription()` — local.
   - **Hay suscripción** → `registrarSuscripcionPush(...)` para reafirmarla (R21). Es el arreglo del
     cierre de sesión a medias: el servidor borró la fila y el `unsubscribe` del navegador falló, así
     que el interruptor diría «Activado» y no llegaría nada. El upsert por `endpoint` (410/R17) lo
     cura sin crear una segunda fila.
   - **No hay** → paso 5.
5. `obtenerClavePublicaPush()` — **la primera ida al servidor de todo el camino**; si no hay canal
   (`null`), se termina sin ruido (410/R13).
6. `suscribirYRegistrarEsteDispositivo(clavePublica)` (§4).

Un `useRef` guarda que ya se intentó: ni el modo estricto de React en desarrollo ni un re-render
disparan un segundo intento (R23).

**Nada de esto es visible** (R19): no hay toast, no hay texto, no hay `showNotification`. El
componente devuelve `null` siempre. Si el panel de la campana está abierto en ese momento, el
interruptor se pondrá en «Activado» **la próxima vez que se monte** —su hook lee el estado al
montar—, que es exactamente lo que la decisión humana (2) pedía: el interruptor ya muestra el estado y
no hace falta anunciarlo.

## 6. Contratos de entrada/salida

### 6.1 Server Actions (`lib/actions/push.ts`, `'use server'`)

Las tres de la 410 se conservan. Cambios:

| Acción | Entrada | Salida | Cambio |
| --- | --- | --- | --- |
| `registrarSuscripcionPush` | `{ endpoint, p256dh, auth, etiqueta? }` (zod `strict()`, sin `usuarioId`: 410/R50) | `{status:"ok"} \| ActionError` | **además** pone la preferencia del actor en `true` (R3). Idempotente. |
| `eliminarSuscripcionPush` | `{ endpoint }` | igual | sin cambios |
| `obtenerClavePublicaPush` | — | igual | sin cambios |
| `olvidarPreferenciaDeAvisos` | **sin cuerpo** | `{status:"ok"} \| ActionError` | **nueva** (R7). El actor sale de la sesión; no hay nada que validar en el borde porque no hay borde. |

Lectura de la preferencia: **no hay acción de lectura**. La lee el layout con el repositorio, en el
servidor. Una acción de lectura sería una ida y vuelta más por carga para un dato que el servidor ya
tiene en la mano cuando pinta el portal.

### 6.2 Repositorio

```ts
// lib/interfaces/repositories/IUsuarioPreferenciaRepository.ts
export interface IUsuarioPreferenciaRepository {
  /** R2: sin fila, `false`. No crea nada al leer. */
  avisosPushDe(usuarioId: string): Promise<boolean>;
  /** R3/R7: upsert por `usuario_id`. Una sola sentencia, sin leer antes. */
  fijarAvisosPush(usuarioId: string, quiere: boolean): Promise<void>;
}
```

`fijarAvisosPush` es un `upsert` sobre el único `usuario_id` — **no** un `findFirst` + `create`: dos
pestañas activando a la vez chocarían en la rendija entre lectura y escritura, y la exclusión la tiene
que dar el índice único, igual que el cupo diario de la 410.

**Nota de capas.** Esto salta el `Service` de `docs/architecture.md` y va de acción a repositorio,
igual que `lib/actions/push.ts` hace hoy con `PushSuscripcionRepository`. No hay regla de negocio que
aislar —«pon un booleano de la sesión»— y crear un servicio de una línea para cumplir el diagrama
añadiría un archivo sin aportar una decisión. Si mañana la preferencia tiene reglas (horarios,
canales), ese es el momento del servicio.

## 7. Carreras, fallos y estados raros

| Caso | Qué pasa | Por qué |
| --- | --- | --- |
| Dos pestañas reactivan a la vez (R22) | Una sola fila | `push_suscripcion.endpoint` es **UNIQUE** y el registro es un upsert por endpoint (410/R17). Además, el mismo navegador devuelve **la misma** suscripción para el mismo registro y la misma clave, así que las dos pestañas llegan con el mismo `endpoint`. |
| Dos pestañas ponen la preferencia a la vez | Una sola fila | upsert por `usuario_id` (UNIQUE). |
| Apagar en una pestaña mientras otra reactiva | Gana quien escriba después en la base; el dispositivo queda sin suscripción si el apagado fue el último en dar la baja. No se inventa ningún bloqueo. | Es el comportamiento de hoy para el dispositivo; la preferencia no cambia el orden de nada. |
| Sin red al reactivar | `{estado:"fallo"}`, se registra, el interruptor sigue «sin activar», preferencia intacta (R20) | Una promesa de avisos que no llegan es peor que no prometerlos. |
| Service worker no activo | Igual: `getRegistration()` devuelve `undefined` y se termina. **No se espera a `ready`** | `navigator.serviceWorker.ready` no resuelve nunca si no hay registro activo —y en desarrollo el SW se des-registra solo (`app/layout.tsx:74`)—, así que esperar ahí dejaría una promesa colgada para siempre. |
| Suscripción incompleta del navegador | `unsubscribe()` y `{estado:"fallo"}` | Lo que ya hace `activar()` hoy. |
| Computadora compartida, permiso concedido por otra persona | **Se suscribe** (decisión humana 1) y la fila pasa a ser de quien tiene la sesión (410/R18) | Está dentro, lo quiere, y al salir se borra (R13). |
| Preferencia puesta y permiso denegado | No pasa **nada** (R17) | La reactivación solo aprovecha un permiso ya concedido; el permiso es por dispositivo y sin él no hay canal. |

**La protección de 410/R19 sigue intacta, y aquí está el argumento completo**: mientras no haya
sesión en ese dispositivo, (a) no se monta nada que pueda reactivar —el componente vive en el layout
autenticado—, y (b) las Server Actions exigen actor de sesión (410/R50), así que un registro sin
sesión es `UnauthenticatedError`. La reactivación no debilita R19: **la condiciona a tener sesión
otra vez**, que es exactamente lo que R19 protege.

## 8. El texto del control

`components/shared/PushOptIn.tsx` conserva `TEXTOS.ayuda` y le añade **una** frase (R25/R26):

> Te avisamos en este teléfono o computadora cuando algo tenga una fecha límite o dinero de por
> medio, aunque tengas la aplicación cerrada. Como mucho un aviso al día de cada tipo. **Si cerrás
> sesión dejamos de avisarte aquí, y volvemos a hacerlo cuando entres de nuevo en este dispositivo.**

Lo que la frase hace: cierra el hueco que el humano reportó —el texto explicaba cuándo te avisa y
callaba lo del cierre de sesión— **sin** pedirle a nadie que entienda qué es una suscripción. Y lo
que promete es verdad **exactamente** en el caso en que la reactivación funciona: mismo dispositivo,
permiso ya concedido. Redacción pendiente de visto bueno (P3).

## 9. Guardias nuevas (`tests/unit/guards/`, corren siempre)

**G1 · `push-intencion-de-baja.guardia.test.ts`** — el censo de §3.2. Recorre `app/`, `components/`,
`hooks/` y `lib/`; por cada archivo cuenta `darDeBajaDeEsteDispositivo(` y compara con una lista
blanca de dos entradas (`app/_components/LogoutButton.tsx` → 1 llamada, motivo `"cierre-de-sesion"`;
`hooks/usePushSuscripcion.ts` → 1 llamada, motivo `"la-persona-apago-el-interruptor"`), **cada una con
su motivo escrito y afirmado sobre el texto de la llamada**. Con autocomprobación (el detector cuenta
y distingue un comentario de una llamada) y con inyección de un intruso en el recorrido, no en el
árbol. Mismo molde que `push-cableado-unico.guardia.test.ts`.

**G2 · `push-alta-punto-unico.guardia.test.ts`** — sobre el árbol sin comentarios:
`Notification.requestPermission(` aparece **exactamente una vez**, dentro de `activar()`
(410/R11, y ahora también R16); `pushManager.subscribe(` aparece **exactamente una vez**, dentro de
`lib/pwa/alta-push.ts` (R15/R17: no hay un segundo camino por el que suscribir saltándose la
comprobación del permiso).

## 10. Qué NO cambia

- El envío: `listarPorUsuarios` sigue siendo la única fuente de destinatarios (R6). La preferencia
  **no** se consulta en el camino del push.
- 410/R10–R14: el permiso no se pide al montar, el interruptor sigue diciendo el estado de **este**
  dispositivo, y el control sigue sin ofrecerse cuando no hay canal o el navegador no puede.
- 410/R19: salir da de baja este dispositivo, y solo este.
- `usePreferenciaSonido` y su `localStorage` se quedan como están: es otra preferencia, de otro tipo
  (per dispositivo, sin servidor), y esta ficha no la toca.

## 11. Alternativas descartadas (además de §3.3 y §3.4)

**A · Guardar la preferencia en `localStorage`, como el sonido.** Cero backend, cero migración.
Descartada: `localStorage` es **del navegador**, no de la persona. En la computadora compartida
—caso real y explícitamente contemplado por el humano— la preferencia de quien entró ayer se le
aplicaría a quien entra hoy; y en el teléfono nuevo de la misma persona no habría preferencia
ninguna. Lo que se pidió recordar es la decisión de **alguien**, y `localStorage` no sabe de quién es.

**B · No borrar la fila al cerrar sesión y marcarla «inactiva».** Resolvería la reactivación sin
preferencia: al volver, se reactiva la fila. Descartada porque es **exactamente lo que 410/R19
prohíbe**: deja viva una credencial de entrega en un dispositivo donde ya no hay sesión, y un fallo en
la comprobación de «inactiva» —un `WHERE` que se olvida en un solo sitio— manda el aviso de esa
persona a un teléfono ajeno. Se cambiaría un olvido imposible (la fila no existe) por uno posible (la
fila existe y hay que acordarse de filtrarla).

**C · Deducir la preferencia de la historia** («tuvo suscripción alguna vez»). Descartada: haría
indistinguible «se fue» de «dijo que no», que es **la** distinción que esta ficha existe para hacer.
Quien apaga el interruptor también tuvo suscripción alguna vez.

**D · Reactivar desde el servidor.** El servidor no puede: la suscripción la emite el navegador y
requiere su permiso. No hay diseño posible por ahí; se anota para que nadie lo vuelva a proponer.

## 12. Archivos

```
db/schema.prisma                                   (+modelo, +relación en Usuario)
db/migrations/20260915120000_usuario_preferencia/{migration.sql,down.sql}   NUEVO
lib/interfaces/repositories/IUsuarioPreferenciaRepository.ts                NUEVO
lib/repositories/UsuarioPreferenciaRepository.ts                            NUEVO
lib/actions/push.ts                                (registrar pone la preferencia; +olvidarPreferenciaDeAvisos)
lib/pwa/baja-push.ts                               (motivo obligatorio + switch exhaustivo)
lib/pwa/alta-push.ts                                                        NUEVO
hooks/usePushSuscripcion.ts                        (activar usa alta-push; desactivar declara su motivo)
app/_components/LogoutButton.tsx                   (declara su motivo)
components/shared/PushReactivacion.tsx                                      NUEVO
components/shared/PushOptIn.tsx                    (una frase en el texto de ayuda)
app/(app)/layout.tsx                               (lee la preferencia y monta el componente)
```

> **El gate rápido se va a negar**: el diff toca `db/schema.prisma` y `db/migrations/**`. Para esta
> ficha el gate es `./init.sh` completo, no `--rapido` (`docs/verification.md`).
