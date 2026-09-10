# 409 — Diseño técnico

> Zona: **fullstack**. Orden obligatorio: **backend → frontend**.
> Contrato visual aprobado: `design-notificaciones/{Main,Campana,PorRol}.dc.html`, con tres
> correcciones del humano del 2026-09-10 que este diseño sigue (§2.1, notas Q4/Q5/Q7).
> Las nueve preguntas abiertas están **cerradas**; sus decisiones y mediciones están incorporadas.

---

## §0 — El problema técnico en una frase

Hoy la campana es un **buzón**: lista plana, ordenada por fecha, con un contador de *no leídas* y
una X. Esta ficha la convierte en una **cola de trabajo**: el servidor clasifica cada aviso, le
resuelve un destino y una hora en palabras, y el cliente sólo pinta. Todo el criterio nuevo vive en
un **catálogo declarado y exhaustivo**, no repartido por el componente.

---

## §1 — Lo que ya existe y NO se toca

Verificado en el árbol (no sólo en el grafo) el 2026-09-10:

| Pieza | Qué hace hoy | Esta ficha |
| --- | --- | --- |
| `predicadoVisibilidad` (`lib/repositories/NotificacionRepository.ts`) | fuente única de R13–R17 de la 146 | **no se toca** (R64) |
| `notificacion_dedupe_key` | UNIQUE `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)`, `NULLS NOT DISTINCT`, `WHERE entidad_id IS NOT NULL` | **no se toca**; se respeta al elegir la entidad (§4.2) |
| `emitirFilas` + `existeNoLeidaPara` | guardia de dedupe + absorción del `P2002` | se reutiliza tal cual |
| `notificadorNoOp` y el patrón `notificar*Con` / `notificar*Real` | inyección en el composition root | se extiende con dos notificadores más |
| `usePreferenciaSonido` | preferencia de sonido de la 161 | **no se toca** |
| Server Actions `listar` / `marcarTodasLeidas` / `descartar` / `notificarCargaMasivaTerminada` | 4 acciones | firmas **sin cambios**; sólo crece el resultado de `listar` |

⚠️ **`marcarNotificacionLeida` no existe** (borrada el 2026-08-07). El grafo del MCP la sigue
devolviendo junto a `INotificacionService.marcarLeida`; en el archivo real sólo queda el comentario
del borrado. No se recablea.

**Sí cambia una pieza de la 161:** `useTonoAlIncrementar` pasa a recibir `porHacer` en vez de
`noLeidas` (decisión Q8: un solo criterio para el mismo hecho). El hook no se toca; cambia su
argumento en el componente.

---

## §2 — El catálogo: dónde vive el criterio

Módulo **nuevo y PURO** (sin Prisma, sin React, sin `next/headers`), para que lo puedan importar el
servicio, la guardia de rutas y —mañana— la 410:

```
lib/notificaciones/catalogo-avisos.ts
```

Forma:

```ts
export interface AtajoDeAviso { readonly href: string; readonly etiqueta: string }

export type AccionDeAviso =
  | { readonly clase: "informativa" }
  | { readonly clase: "accionable"; readonly atajo: AtajoDeAviso | null
      /** Sólo los AGREGADOS: compone el título con la cifra VIVA. */
    ; readonly titulo?: (n: number) => string };

export interface EntradaCatalogo {
  readonly porDefecto: AccionDeAviso;
  /** Sólo cuando un mismo evento pide cosas distintas a roles distintos. */
  readonly porRol?: Partial<Record<RolValue, AccionDeAviso>>;
}

export const CATALOGO_AVISOS: Record<NotificacionEvento, EntradaCatalogo> = { ... };

export function accionDeAviso(evento: NotificacionEvento, rol: RolValue): AccionDeAviso;
```

**Por qué `Record` y no `Partial<Record>`**: un valor nuevo del enum **no compila** hasta que
alguien decida su clase. Es el mismo mecanismo con el que la 236 obligó a declarar el estado de
cada grupo de `/novedades`, y el motivo por el que el inventario de eventos es cerrado desde la 146.

**Por qué `porRol` y no una entrada por par (evento, rol)**: 13 eventos × 6 roles son 78 celdas, de
las que 73 dirían lo mismo. Con `porDefecto` + excepción, la excepción **se lee como la decisión que
es**. Sólo hay tres: `cierre_dia_vencido`, `mensajero_bloqueado_por_cierres` y
`devoluciones_represadas`.

### 2.1 — La tabla, evento por evento

Recorrido de los **11 eventos vigentes** (`db/schema.prisma:2636`) + los 2 nuevos. La columna «puede
ejecutarlo» es la que decide, y se comprobó contra `SIDEBAR_ITEMS` (`lib/auth/menu-visibility.ts`)
y, cuando había duda, contra la **autorización del servicio** que ejecuta la acción.

| # | Evento | Rol destinatario | Clase | Atajo | Etiqueta | Por qué |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `orden_rechazada` | maestro, admin, adminTienda, adminSatelite | **informativa** | — | — | Es **una notificación por orden**. `PorRol.dc.html` lo pone en «Nunca» para tienda («cada cambio de estado») y para admin («una notificación por orden»). En el momento del rechazo nadie decide nada. Lo que sí hay que hacer lo cubren los agregados (#12, #13) |
| 2 | `carga_masiva_terminada` | el usuario que cargó | **informativa** | — | — | `Main.dc.html` la pinta entre las informativas. Es un acuse de recibo |
| 3 | `postulacion_mensajero_pendiente` | maestro, admin | **accionable** | `/dashboard` | «Revisar postulaciones» | `PostulacionesPendientesPanel` se monta en `AdminMaestroDashboard`, que es lo que renderiza `/dashboard` — visible a maestro y admin |
| 4 | `postulacion_recurso_pendiente` | maestro, admin | **accionable** | `/dashboard` | «Revisar postulaciones» | `PostulacionRecursoPanel`, mismo tablero |
| 5 | `cierre_dia_por_aprobar` | maestro, admin, adminSatelite | **accionable** | `/cierres-admin` | «Revisar cierre» | Los tres roles ven ese ítem y es donde se aprueba |
| 6 | `dia_reparto_corregido` | mensajero | **accionable** | `/mis-asignaciones` | «Ver mi reparto» | **Q4, decisión del humano: el mockup estaba mal.** Tiene consecuencia real y personal: si no se entera, se presenta el día equivocado. `/mis-asignaciones` está en `SIDEBAR_ITEMS` para `mensajero` y redirige a `/mis-asignaciones/reparto` |
| 7 | `cierre_dia_vencido` | **mensajero** | **accionable** | `/cierre-dia` | «Ver mi cierre» | El propio texto ya dice «hasta que lo envíes». La pelota es suya |
| 7b | `cierre_dia_vencido` | maestro, admin, adminSatelite | **informativa** | — | — | La 271 lo escribió: con un `vencido` la pelota está en el tejado **del mensajero**. La bodega no puede aprobar lo que no se ha enviado |
| 8 | `mensajero_bloqueado_por_cierres` | **mensajero** | **accionable** | `/cierre-dia` | «Ver mi cierre» | El texto se compone con `avisoBloqueo(..., { conCta: true })`, que ya dice dónde ir |
| 8b | `mensajero_bloqueado_por_cierres` | maestro, admin, adminSatelite | **accionable** | `/cierres-admin` | «Revisar cierres» | La 271: «Aprueba el más antiguo para que pueda volver a trabajar». Accionable **a propósito y por decisión humana registrada** |
| 9 | `gasto_fijo_cobro_pendiente` | maestro | **accionable** | `/wallet` | «Revisar cobros» | La 333: el maestro decide la cola; el admin la ve pero no la decide, y por eso no lo recibe |
| 10 | `webhook_suscripcion_pausada` | maestro | **accionable** | `/configuracion/api` | «Ver suscripción» | El texto ya dice «Revisa Configuración > API», y `/configuracion` es maestro-only |
| 11 | `geocodificacion_caida` | maestro, admin | **accionable** | **— (ninguno)** | — | **Q5, confirmado por el humano.** El texto pide revisar la credencial y la facturación de la cuenta del proveedor: eso se hace en la consola de Google. No hay pantalla. Un botón sería una promesa falsa |
| 12 | `novedades_sin_gestionar` *(nuevo)* | adminTienda | **accionable** | `/novedades?superficie=devolucion` | «Gestionar novedades» | La pestaña se fija por URL (§7.2). Sin eso, el botón abriría «Ayuda» y el aviso hablaría de la otra pestaña |
| 13 | `devoluciones_represadas` *(nuevo)* | **adminSatelite** | **accionable** | `/recepcion-satelite/en-bodega` | «Enviar a central» | Es donde `RecepcionSateliteModule` ofrece el envío a central, y es **el único rol que el servicio autoriza a ejecutarlo** |
| 13b | `devoluciones_represadas` *(nuevo)* | maestro, admin | **accionable** | `/ordenes` | «Ver devoluciones» | No mueve las órdenes, pero **coordina con la bodega**, y para esa llamada necesita saber cuáles son y de qué bodega. La lista es el insumo de su acción. Ver §2.1bis |

### 2.1bis — El criterio del atajo, afinado: «¿le acerca esta pantalla a resolverlo?»

Este es el par que hay que leer junto, porque **es la regla que va a decidir todos los atajos
futuros** y con la versión estrecha se habría quedado sin botón algo que sí lo merece.

Al escribir el catálogo se verificó en el archivo real que
`lib/services/EnvioDevolucionCentralService.ts` declara `const ROL_AUTORIZADO = "adminSatelite"` y
corta con `forbidden` a cualquier otro: **una orden en `por_devolver` sólo la puede mover el
adminSatelite de su zona**. Con el criterio literal «¿puede ejecutar la transición?», el aviso al
maestro y al admin se habría quedado sin botón. **Ese criterio es demasiado estrecho, y la decisión
del humano del 2026-09-10 lo corrige:**

> **El criterio no es «¿puede ejecutar la transición?» sino «¿le acerca esta pantalla a
> resolverlo?»** — el sitio donde empieza su acción real. No basta con que la pantalla enseñe el
> problema: tiene que ser el **insumo** de lo que esa persona va a hacer a continuación.

Los dos casos, enfrentados:

| | `geocodificacion_caida` (maestro, admin) | `devoluciones_represadas` (maestro, admin) |
| --- | --- | --- |
| Qué hace esa persona a continuación | revisar la credencial y la facturación en la consola del proveedor | llamar a la bodega para coordinar la devolución |
| ¿Alguna pantalla es el insumo de eso? | **No.** Ver la lista de direcciones sin ubicar no acerca nada a arreglar una credencial de Google | **Sí.** `/ordenes` le dice **cuáles** son y **de qué bodega**: es lo que necesita para la llamada |
| Veredicto | **sin botón** — sería una promesa falsa | **con botón**, «Ver devoluciones» |

Con esta formulación, `geocodificacion_caida` queda como **el único** aviso accionable sin atajo del
catálogo, y esa singularidad es la señal correcta: cuando el segundo aparezca, habrá que defenderlo
con esta misma tabla.

⚠️ **Y el mismo evento acaba con DOS destinos**, que es exactamente para lo que existe `porRol`: el
adminSatelite va a donde **ejecuta** (`/recepcion-satelite/en-bodega`) y la administración central a
donde **empieza a coordinar** (`/ordenes`). Un solo destino para los dos habría mandado a uno de
ellos a una pantalla que su rol ni siquiera ve —`/ordenes` hace `notFound()` al `adminSatelite`—, y
la guardia de §2.2 lo habría cazado.

### 2.2 — La guardia que impide una promesa falsa

`tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` recorre **todas** las entradas del
catálogo y, por cada destino declarado, afirma:

1. contra `SIDEBAR_ITEMS` / `itemsVisibles`, que la ruta existe **y** que ese rol la ve;
2. que si el destino lleva un parámetro de consulta, **la página de destino lo lee** (R6).

Mata la mutación «poner `/wallet` como destino del mensajero», la mutación «declarar una ruta que ya
no existe» y la mutación «inventar `?estado=x`». Se declara como guardia (`*.guardia.test.ts`)
porque **no importa lo que vigila por el grafo**: recorre datos, y el modo rápido corre siempre las
guardias.

---

## §3 — El servidor decide; el cliente pinta

### 3.1 — El DTO (`lib/types/notificacion.ts`), cambio **ADITIVO**

```ts
export interface NotificacionDTO {
  // — vigentes, sin tocar —
  id: string;
  notification_type: NotificationType;
  description: string;      // se conserva: es lo que hay en la fila
  anexo?: string;           // se conserva
  read: boolean;
  createdAt: string;

  // — nuevos —
  evento: NotificacionEvento;              // la fila ya lo tiene; hoy no viajaba
  accionable: boolean;                     // resuelto por el catálogo con el rol del actor
  titulo: string;                          // qué se lee en negrita
  detalle: string | null;                  // la línea de contexto
  cuando: string;                          // instante relativo YA resuelto (§3.4)
  atajo: { href: string; etiqueta: string } | null;
}
```

Y `ListarNotificacionesServiceResult` / `ListarNotificacionesResult` ganan `porHacer: number`.

**Quién consume el DTO hoy** (medido, no supuesto): `components/shared/NotificationsBell.tsx` (vía
el alias `NotificationItem`), `hooks/useNotificaciones.ts`, `lib/services/NotificacionService.ts`,
`lib/actions/notificaciones.ts` y sus suites. **Nadie más.** Como todos los campos nuevos son
añadidos y ninguno cambia de tipo, ningún consumidor deja de compilar; `description` y `anexo` se
conservan aunque el panel ya no los pinte directamente, para no romper suites vigentes.

⚠️ **Tocar `lib/types/**` obliga a `./init.sh` completo**: el modo rápido se niega solo
(`docs/verification.md`). Igual que tocar `db/schema.prisma`. Está previsto en `tasks.md`.

### 3.2 — De dónde salen `titulo` y `detalle`

| Caso | `titulo` | `detalle` |
| --- | --- | --- |
| evento **agregado** (12, 13) | `catalogo.titulo(cifraViva)` | la `descripcion` de la fila (la línea de contexto) |
| cualquier otro | la `descripcion` de la fila | el `anexo` de la fila, o `null` |

**Por qué NO se añade una columna `titulo` a `notificacion`.** Habría obligado a reescribir el texto
de los seis emisores accionables vigentes, y dos son contrato blindado: `avisoBloqueo` se comparte
con la pantalla del mensajero (271/R43) y el de la 403 tiene un guardia que se pone rojo si el texto
vuelve a decir «desactivada». Con esta regla, los once emisores vigentes **no se tocan**: sus
descripciones ya son una frase de titular. Coste declarado: para los avisos vigentes, el contexto es
el anexo (una guía, un nombre), no una frase; es exactamente lo que hoy se pinta bajo «Anexo:», sólo
que sin la etiqueta de jerga (R20).

**Dónde viven los textos, tras esta ficha** — dos casas, cada una con un propósito, ninguna
duplicada:

- `lib/notificaciones/emitir.ts` → **lo que se PERSISTE** (`descripcion`, `anexo`). Regla de la
  146 §4.6 intacta.
- `lib/notificaciones/catalogo-avisos.ts` → **lo que sólo se PINTA** (etiqueta del botón y, en los
  dos agregados, el título compuesto con la cifra viva). No se persiste nunca y por eso no puede
  vivir en `emitir.ts`: se recalcula en cada lectura.

### 3.3 — `porHacer`: la definición que un test puede afirmar

```
porHacer = |{ n ∈ items :
      accionDeAviso(n.evento, actor.rol).clase === "accionable"
   && vigente(n) }|
```

donde `items` es **el mismo conjunto que ya devuelve el listado** (visibles por el predicado de la
146, dentro de la ventana de 30 días, no descartadas por el actor) y `vigente(n)` es `true` salvo
para los eventos agregados, donde es `cifraViva(n) > 0`.

**El estado de lectura NO entra.** Es el cambio: hoy `noLeidas` cuenta mensajes; `porHacer` cuenta
trabajo. Y el **tono** (161) pasa a leer esta misma cifra (Q8): dos criterios distintos para el
mismo hecho es como se acaba con dos verdades sobre el mismo número.

⚠️ **Dónde se prueba de verdad.** `porHacer` **no depende de ningún `where` nuevo**: se deriva en el
servicio sobre la lista ya cargada. Por eso los tests con dobles SÍ lo cubren de verdad (no hay SQL
escondido). Lo que sí es SQL —y por tanto invisible a un doble— son (a) las consultas de **cifra
viva** y (b) las de **resumen** de la emisión diaria: esas van a `tests/integration/db/` contra
Postgres real. Es la lección «probar el WHERE donde vive».

**Límite declarado:** `PAGE_SIZE` es 50, así que `porHacer` no puede superar 50. Es el mismo límite
que ya tiene `noLeidas` desde la 146/R30 y no se ensancha aquí.

### 3.4 — El instante relativo: **en el servidor**

Módulo nuevo y puro `lib/utils/tiempo-relativo.ts`:

```ts
export function tiempoRelativo(desde: Date, ahora: Date): string
```

`NotificacionService.listar` lo llama con el reloj **ya inyectable** que tiene
(`private readonly now: () => Date`) y mete el resultado en `cuando`.

**Por qué el servidor y no el cliente.** Este repo ya tiene la lección escrita en
`hooks/usePreferenciaSonido.ts`: leer una fuente externa a React durante el render rompe la
hidratación, y la salida no es un `useState` en un efecto. `Date.now()` es exactamente esa clase de
fuente. La campana **se renderiza en el servidor** (componente cliente dentro de un layout
servidor), así que un `Date.now()` en render produciría dos textos distintos para el mismo nodo.

Podría argumentarse que la lista vive en un `Popover.Portal` y sólo se monta al abrir, así que hoy
no se hidrataría. **No se acepta**: sería una propiedad accidental del componente de popover, y el
día que alguien lo cambie el fallo sería una discrepancia de hidratación silenciosa.

Consecuencias declaradas: el texto se refresca con el sondeo de 60 s (puede quedarse 60 s
congelado, aceptado); el cálculo es determinista y testeable con reloj fijo; y una guardia impide
que alguien lo vuelva a calcular en el cliente.

**Alternativa DESCARTADA: `useSyncExternalStore` con un temporizador de un minuto en el cliente.**
Habría dado un reloj que avanza sin sondear y no rompe la hidratación (`getServerSnapshot`
devolviendo el mismo texto que el servidor). Se descarta porque **exige que servidor y cliente
compartan el formateador y el instante base para que el primer render coincida**, es decir, resuelve
el problema de la hidratación reintroduciendo el acoplamiento que lo causa, y añade un temporizador
por cada campana montada a cambio de una precisión que nadie pidió.

`createdAt` sigue viajando: sirve de `title` del elemento y evita romper suites vigentes.

---

## §4 — Los dos avisos nuevos

### 4.1 — Qué se cuenta, exactamente

| Aviso | Población | Predicado | Ancla del «lleva N días» |
| --- | --- | --- | --- |
| `novedades_sin_gestionar` | novedades de la tienda | `orden.tienda_id = T AND deleted_at IS NULL AND estatus.value = 'devuelta'` — **el mismo `novedadWhere(T, "devolucion")`** que pinta `/novedades` | la última transición de familia `anclaje_devolucion` de esa orden; si no existe (población legada), el `created_at` de su gestión `devuelta` vigente |
| `devoluciones_represadas` | órdenes atascadas en una bodega satélite | `deleted_at IS NULL AND estatus.value = 'por_devolver'` **y** antigüedad > umbral | la última transición cuyo destino es `por_devolver` |

⚠️ **EL ESTADO VIGILADO ES `por_devolver`, Y ESTÁ MEDIDO. Producción, 2026-09-10:**

| Estado | Órdenes | Días de media | Máximo | Pasan de 3 d |
| --- | --- | --- | --- | --- |
| `devolviendo_a_tienda` | **247** | 1,0 | 1,3 | **0** |
| `por_devolver` | **27** | 2,4 | **8,2** | **7** |

`devolviendo_a_tienda` **fluye**: 247 órdenes y ninguna pasa de día y medio. Avisar sobre ese estado
sería **ruido puro sobre el cubo más grande** —exactamente lo que esta ficha existe para no volver a
hacer—. El represamiento real está en `por_devolver`. **Con el umbral en 3 días, el aviso de hoy
hablaría de 7 órdenes**: un número que alguien puede atender. Con 7 días serían 2, y llegaría tarde.
Por eso `DIAS_REPRESAMIENTO = 3` y por eso **R46 prohíbe explícitamente vigilar
`devolviendo_a_tienda`**, con su propio test de no-inclusión.

`por_devolver_a_tienda` **no se vigila**: no está medido. La tarea T7.5 lo mide en solo lectura antes
de desplegar; si resultara represado, entra como un ámbito más del mismo emisor (y ése sí llevaría
atajo a `/ordenes`, porque `DevolverATiendaModal` lo ejecuta ahí).

**Por qué el mismo predicado que la pantalla, y no uno propio.** Si el aviso dijera «5» y la
pantalla enseñara 4, el aviso quedaría desacreditado el primer día. Se **reutiliza el método del
repositorio**, no se copia el `where`.

**Por qué ese ancla y no otro.** Es la decisión del humano del 2026-09-10 —«los 5 días se cuentan
desde que el paquete entra a bodega, no desde que el mensajero reporta»— y **ya es el comportamiento
vigente**: `DevolucionSlaRepository.findDevueltasSla` ancla en la transición `anclaje_devolucion`,
que es el instante en que se aprueba el cierre que trae el paquete de vuelta (239/R12), con caída a
la gestión vigente para la población legada (239/R14). El aviso lee **ese mismo ancla**, así que no
puede decir «lleva 3 días» sobre una orden a la que el cron le cuenta 5.

⚠️ **`orden.updated_at` NO sirve de ancla** y no se usa: es una fecha mutable que cualquier
escritura mueve. Lección ya pagada en este repo.

### 4.2 — La entidad de dedupe: **la decisión que evita un silencio total**

`notificacion_dedupe_key` es UNIQUE sobre `(evento, entidad_id, destinatario_rol,
destinatario_usuario_id)` — **el ALCANCE (`tienda_id`, `zona_id`) NO entra, a propósito** (está
escrito en `NotificacionRepository.columnasDestinatario`) — y `crear` **absorbe el `P2002`
devolviendo `false`**.

De ahí salen las dos entidades, y las dos son **nuevos `entidad_tipo` que no apuntan a una fila de
tabla** (serían el cuarto y el quinto del inventario, tras `gasto_fijo_cobro_dia`,
`webhook_suscripcion_pausa` y `geocodificacion_caida_dia`):

| Aviso | `entidad_tipo` | `entidad_id` | Destinatarios |
| --- | --- | --- | --- |
| novedades sin gestionar | `novedades_sin_gestionar_dia` | `` `${tiendaId}:${diaCR}` `` | `{ rol: adminTienda, tiendaId }` |
| devoluciones represadas | `devoluciones_represadas_dia` | `` `${ambito}:${diaCR}` `` con `ambito ∈ { "global" } ∪ { zonaId }` | `{ rol: maestro }` y `{ rol: admin }` con `ambito = "global"`; `{ rol: adminSatelite, zonaId }` con `ambito = zonaId` |

⚠️ **El ámbito tiene que ir DENTRO del `entidad_id`, y es el hallazgo que decide este diseño.**
Con `entidad_id = diaCR` a secas y destinatario `rol = adminTienda` acotado por `tienda_id`, la
clave única sería `('novedades_sin_gestionar', '2026-09-11', 'adminTienda', NULL)` **para todas las
tiendas**: la primera tienda de la corrida se llevaría el aviso y **todas las demás quedarían
silenciadas, sin error, sin log y sin nada**, porque el alcance no entra en la clave y `crear`
absorbe el choque. **Lo mismo, exactamente, con las zonas del adminSatelite.** Es el fallo que
documentaron la 262 (entidad = orden en vez de cambio) y la 403 (entidad = suscripción en vez de
racha). **R42 y R51, con sus mutaciones obligatorias, existen para eso.**

**La forma del `entidad_id` es uniforme a propósito** (`${ambito}:${diaCR}`, con el literal
`"global"` para el ámbito central): dos formas distintas para el mismo evento invitarían a que
alguien las confundiera al leer una fila, y `"global"` nunca puede colisionar con un uuid de zona.

Y **no es `entidad_id = NULL`**: con `null`, `emitirFilas` se salta su guardia previa y el índice
único es PARCIAL (`WHERE entidad_id IS NOT NULL`), así que saldría un aviso por ejecución.

Con el día dentro: días distintos ⇒ entidades distintas ⇒ el recordatorio diario **es estructural**
(R41, R51); misma corrida repetida el mismo día ⇒ misma entidad ⇒ un solo aviso.

### 4.3 — Los textos (se persisten desde `emitir.ts`; los títulos, desde el catálogo)

```
novedades_sin_gestionar   tipo: alert    destinatario: adminTienda (acotado a su tienda)
  titulo (catálogo, con la cifra VIVA):
    n === 1 -> "1 novedad espera tu decisión"
    n  >  1 -> "N novedades esperan tu decisión"
  descripcion (fila, = el detalle) — TRES formas, y la elección es el requisito:
    (a) todas con ventana de 5 días y NINGUNA en el tope:
        "La más antigua lleva N días en bodega. A los 5 días se rechaza automáticamente."
    (b) todas con ventana de 24 h y NINGUNA en el tope:
        "La más antigua lleva N días en bodega. A las 24 horas de entrar, el sistema la reintenta
         o la rechaza sin esperar tu decisión."
    (c) plazos MEZCLADOS (causas con ventanas distintas, o alguna ya en el tope):
        "La más antigua lleva N días en bodega. Los plazos vencen en momentos distintos según la
         causa: revisalas una por una."

devoluciones_represadas   tipo: warning
  destinatarios: maestro y admin (ámbito global) · adminSatelite (ámbito = su zona)
  titulo (catálogo, con la cifra VIVA):
    n === 1 -> "1 orden espera volver a su tienda"
    n  >  1 -> "N órdenes esperan volver a su tienda"
  descripcion (fila, = el detalle):
    "La más antigua lleva N días en bodega. Coordiná la devolución."
```

⚠️ **Por qué tres formas y no una (Q9, y es lo más importante de las nueve).** El plazo del rechazo
automático **depende de la causa**: 5 días para *dirección incorrecta* / *teléfono incorrecto*, 24 h
para *no se encontró al destinatario* (`DevolucionSlaService`), y desde la 276 una novedad `wrong_*`
que ya alcanzó el tope de intentos **escala en la corrida siguiente, sin esperar sus cinco días**.
Un texto que dijera «a los 5 días» sobre un lote mezclado le prometería a la tienda **más tiempo del
que tiene**, y la tienda organiza su trabajo con ese número. La regla es la del humano: *si el lote
mezcla causas, el texto habla sin plazo*. Es la lección de la 407 —«el texto no puede mentir»— en
su forma aritmética.

**Cómo se decide la homogeneidad, sin inventar nada:** el resumen por tienda trae, por orden, su
`causaDevolucion` y si `alcanzaElTope(intentos, MIN_INTENTOS_ENTREGA)` —**el mismo módulo puro y el
mismo conteo en lote (`contarIntentosEnLote`) que ya usa `NovedadesService` para pintar
`enElTope`**—. Homogéneo := todas comparten familia de causa **y** ninguna está en el tope.

Singular y plural **explícitos**, como `textoCargaMasivaTerminada` y
`textoCobrosGastoFijoPendientes`: «Hay 1 novedades» es el texto roto que ninguna suite ve y que un
humano lee todos los días.

**Sin PII (R44/R54):** un número, unos días y una instrucción. Ni guía, ni remisión, ni dirección,
ni teléfono, ni destinatario, ni tienda, ni zona, ni monto. Regla de la 146 §4.6.

⚠️ **El «5» no se escribe dos veces.** Hoy vive como `VENTANA_WRONG_MS = 5 * DIA_MS`, constante
privada de `lib/services/DevolucionSlaService.ts`. Se extrae a `lib/config/devolucion-sla.ts`
(`DIAS_RECHAZO_AUTOMATICO: 5`, `HORAS_REINTENTO: 24`) y **el servicio del cron pasa a derivar sus
ventanas de ahí**. Así, el día que el humano mueva el plazo, el aviso no puede quedarse diciendo
otro número. Lo mide `devolucion-sla-plazo-unica-fuente.test.ts` (R39) con tres asertos, uno de
ellos de **comportamiento del cron**: mutar la configuración a 6 pone dos en rojo.

### 4.4 — El proceso diario

**Route handler nuevo**, patrón literal de `generar-gastos-fijos` (mismo `CRON_SECRET`, auth antes
de cualquier efecto, respuesta con conteos):

```
app/api/cron/avisos-diarios/route.ts        →  AvisosDiariosService.ejecutar(now)
vercel.json  +  { "path": "/api/cron/avisos-diarios", "schedule": "0 13 * * *" }
```

⚠️ **La conversión, escrita para que nadie la «corrija».** `vercel.json` va **en UTC**. Costa Rica es
**UTC−6 fijo, sin horario de verano**. Por tanto **07:00 CR = 13:00 UTC ⇒ `0 13 * * *`**. Los crons
vigentes del repo usan `0 6 * * *`, que **no es «las 6 de la mañana»: es medianoche CR**. Escribir
`0 7 * * *` aquí pondría el aviso a la **1:00 de la madrugada CR**, que es justo la hora a la que la
410 no debe empujar una notificación al teléfono de nadie.

Capas:

```
app/api/cron/avisos-diarios/route.ts          Controller: sólo HTTP + secreto
  └─ lib/services/AvisosDiariosService.ts     decide QUÉ se avisa (umbral, agrupación, homogeneidad, best-effort)
       ├─ lib/interfaces/repositories/IAvisoAgregadoRepository.ts
       │    └─ lib/repositories/AvisoAgregadoRepository.ts     SÓLO queries Prisma
       ├─ IOrdenHistorialService.contarIntentosEnLote          (reuso, para el tope de §4.3)
       └─ notificadores inyectados en el composition root del route handler
```

`IAvisoAgregadoRepository`:

```ts
resumenNovedadesPorTienda(): Promise<Array<{
  tiendaId: string; total: number; masAntiguaAt: Date;
  ordenes: Array<{ ordenId: string; causa: GestionCausaDevolucion | null }>;
}>>
contarNovedadesDeTienda(tiendaId: string): Promise<number>

resumenRepresadasPorZona(desde: Date): Promise<Array<{ zonaId: string; total: number; masAntiguaAt: Date }>>
resumenRepresadasGlobal(desde: Date): Promise<{ total: number; masAntiguaAt: Date | null }>
contarRepresadas(desde: Date, zonaId: string | null): Promise<number>
```

- **Best-effort por destinatario (R60):** el bucle envuelve cada emisión en `emitirBestEffort`, así
  que una tienda o una zona que falle no se lleva por delante a las demás ni tumba la corrida. Misma
  dirección de error que la 333 y la 403: *la corrida manda, el aviso es cortesía*. No es un `catch`
  vacío: el fallo queda registrado con su operación y su causa.
- **Composition root (R62):** los `notificar*Real` se pasan **como argumento** en `buildService()`
  del route handler; el `default` del servicio sigue siendo `notificadorNoOp`. Se amplía
  `tests/unit/services/notificacion-notificadores-reales.test.ts`, que afirma sobre el **uso
  efectivo** (fuente sin imports ni comentarios) — la única forma de cazar «importado pero no
  pasado», que ya dejó el aviso nocturno del corte sin emitirse jamás con la suite en verde.

---

## §5 — Cómo se apaga solo un aviso agregado

`NotificacionService` recibe **por constructor** un resolutor de vigencia:

```ts
export interface IVigenciaAvisoAgregado {
  /** Cifra VIVA del aviso agregado, acotada al ÁMBITO del actor. */
  cifra(evento: NotificacionEvento, actor: Actor): Promise<number>;
}
```

El ámbito sale **del actor**, nunca de la entrada: `adminTienda` ⇒ sus novedades
(`actor.usuarioId`); `adminSatelite` ⇒ represadas de `actor.zonaId`; `maestro`/`admin` ⇒ represadas
globales. Es lo que hace que el número del panel sea el mismo que el de su pantalla (R57).

En `listar`:

1. se lee la lista como hoy;
2. **si y sólo si** hay al menos una fila cuyo evento es agregado, se pide su cifra (a lo sumo **2
   consultas de conteo**, y **ninguna** para el actor que no tiene avisos agregados vivos);
3. cifra `0` ⇒ la fila **no sale** en `items` y no cuenta en `porHacer` (**R55**);
4. cifra `> 0` ⇒ la fila sale y su `titulo` se compone con **esa** cifra (**R57**);
5. si el resolutor lanza, se registra y la fila **sale** (**R58**): mejor un aviso de más que una
   campana en blanco.

**Qué pasa si vuelve a subir el mismo día (R56):** nada especial, y por eso funciona. La fila nunca
se borró; sólo se estaba ocultando. Vuelve a aparecer en el siguiente sondeo (≤ 60 s) y el emisor
diario no crea una segunda porque la entidad del día ya existe.

**Dependencia obligatoria, no opcional.** El resolutor **no tiene default no-op**: un default
silencioso reproduce la familia «el composition root que no inyecta» —dos notificadores muertos con
la suite verde—, y aquí el síntoma sería el peor posible: los avisos agregados no se apagarían nunca
y la campana volvería a ser ruido. Lo inyecta `buildService()` de `lib/actions/notificaciones.ts`, y
hay un test que afirma que **alguien lo pasa**.

**Coste medido y aceptado:** hasta 2 `count` extra por sondeo de 60 s **por actor que tenga un aviso
agregado vivo**. `orden` ya tiene `@@index([tiendaId])`, `@@index([estatusId])` y `@@index([zonaId])`;
con el volumen actual (27 órdenes en `por_devolver`, 247 en tránsito) el planner los sirve sin
secuencial. **No se añade índice en esta ficha**: añadir uno «por si acaso» a la tabla más caliente
del sistema es peor que medirlo. Si hiciera falta, es una migración aditiva de una línea.

### 5.1 — Alternativa DESCARTADA: derivar los avisos agregados al leer, sin fila en `notificacion`

Era tentadora: el aviso «5 novedades» se calcula en `listar` y se acabó — sin migración, sin cron,
sin dedupe, y «se apaga solo» sale gratis porque no existe cuando la cifra es cero.

**Se descarta por tres razones, en orden de peso:**

1. **La ficha 410 se queda sin nada que empujar.** Un push necesita un HECHO en un instante (una
   fila creada) al que engancharse. Con el aviso derivado no hay evento: habría que inventar un
   segundo mecanismo sólo para el push, y la 410 dice explícitamente que reutiliza el catálogo y el
   atajo de ésta.
2. **Se pierde «uno al día».** Derivado, el aviso está siempre ahí mientras haya novedades: deja de
   ser un recordatorio y vuelve a ser un adorno de pantalla, que es lo que ya hay en `/novedades`.
3. **Rompe el patrón probado.** `gasto_fijo_cobro_pendiente` (333) resolvió exactamente este
   problema con fila + entidad-por-día, y el encargo pide reusarlo, no inventar uno nuevo.

La forma elegida se queda con lo bueno de las dos: **fila** (para el push y el «uno al día») +
**vigencia al leer** (para el apagado solo).

### 5.2 — Alternativa DESCARTADA: apagar la fila con un `UPDATE` cuando la cifra llega a cero

Habría hecho falta un proceso que vigile la cifra y escriba. Se descarta porque (a) obliga a una
columna de estado en una fila que es **inmutable por diseño** desde la 146, (b) el proceso tendría
que correr con frecuencia suficiente para que «se apaga solo» se note, o sea otro cron por minuto, y
(c) un `UPDATE` que no llega deja el aviso encendido para siempre — un fallo mudo más.

---

## §6 — Modelo de datos y migración

### 6.1 — Enums (única migración de la ficha)

```
db/migrations/20260911120000_notificacion_evento_avisos_agregados/
  migration.sql   ALTER TYPE notificacion_evento       ADD VALUE IF NOT EXISTS 'novedades_sin_gestionar';
                  ALTER TYPE notificacion_evento       ADD VALUE IF NOT EXISTS 'devoluciones_represadas';
                  ALTER TYPE notificacion_entidad_tipo ADD VALUE IF NOT EXISTS 'novedades_sin_gestionar_dia';
                  ALTER TYPE notificacion_entidad_tipo ADD VALUE IF NOT EXISTS 'devoluciones_represadas_dia';
  down.sql        recrea los DOS tipos con la lista PREVIA
```

- **Aditiva**: no crea tablas ni columnas, no toca RLS (`notificacion` conserva la de la 146), sin
  backfill.
- **Va sola y con timestamp propio**: Postgres no deja usar un valor de enum recién añadido en la
  misma transacción que lo añadió (`55P04`) y Prisma corre cada `migration.sql` en una.
- **`down.sql`** recrea `notificacion_evento` con los **11** valores vigentes y
  `notificacion_entidad_tipo` con los **9**, y sólo esos.

⚠️ **La pregunta obligatoria de este repo, hecha:** *«¿el `down.sql` de las migraciones anteriores
de estos enums recrea-con-lista o sólo dropea?»* Los **siete** downs previos
(`20260727120000_notificacion`, `…_postulacion_recurso`, `…_dia_reparto_corregido`,
`…_bloqueo_cierre`, `…_gasto_fijo_cobro`, `…_webhook_suscripcion`, `…_geocodificacion_caida`) son
**fotos de su momento y todas siguen siendo ciertas**: **NO SE TOCA NINGUNO**. Editarlos sería el
drift de «migración editada en sitio».

⚠️ **Y la mitad hermana:** la lista de ESTE `down.sql` **se reescribe contra `db/schema.prisma` de
`origin/dev` justo antes de abrir el PR**, no de memoria. Si otra ficha añade un valor a estos enums
y entra en `dev` antes que ésta, revertir con la lista vieja **borraría en silencio** el valor de la
otra. Le pasó a la 401 con la 403 y está escrito en su `down.sql`. Es la tarea T2.5, no un
recordatorio.

⚠️ **Jamás renumerar una carpeta ya aplicada**: deja una fila fantasma que `migrate status` no ve.

**Precondición ruidosa del down**, declarada: ninguna fila de `notificacion` con los valores nuevos.
Si quedara alguna, el `USING` del `ALTER COLUMN` **falla y el rollback aborta**. Es el comportamiento
correcto. **Aquí no hay ningún `DELETE` para «hacer sitio».**

### 6.2 — Lo que NO cambia en la base

Ninguna tabla nueva, ninguna columna nueva, ningún índice nuevo, ninguna política RLS nueva. Es
deliberado: toda la ficha cabe en el mecanismo de la 146.

---

## §7 — El componente y la pestaña de `/novedades`

### 7.1 — La campana

`components/shared/NotificationsBell.tsx` se reescribe. Sigue siendo el **único** consumidor del
DTO y sigue recibiendo todo resuelto: no clasifica, no compone texto, no calcula tiempo, no conoce
rutas por evento.

- **Disparador**: píldora con icono + «N por hacer» cuando `porHacer > 0`; icono apagado y sin
  píldora cuando es 0 (`Campana.dc.html`, estado «Sin nada pendiente»).
- **Panel**: `w-100` (400 px) con `max-w-[calc(100vw-2rem)]`. Cabecera igual que hoy (campana,
  «Notificaciones», «Marcar leídas», interruptor de sonido con sus nombres accesibles **intactos**).
- **Fila de filtro**: dos píldoras, «Requieren tu acción · N» y «Todas · N». Estado de cliente.
  Por defecto **«Todas»**, que es lo que pinta el contrato visual (los dos bloques a la vez).
- **Bloque accionable**: pastilla de icono semántica, título en negrita, detalle, botón de atajo (si
  lo hay) y el instante relativo con su icono de reloj; X de descartar a la derecha.
- **Bloque informativo**: punto, título, instante relativo. Sin botón.
- **Sin pie.** El «Ver todas las notificaciones» del mockup **se retira** (Q7): no existe
  `/notificaciones` y no se promete una pantalla que no hay. R29 lo afirma con un `queryByText` a
  `null` — un aserto, no un comentario.
- **Color**: **sólo tokens semánticos** (`danger`/`warning`/`info` con `-soft` para fondo y
  `-strong` para texto, según `DESIGN.md`). Los hex de los `.dc.html` son del tema claro y **no se
  copian**: la 208 ya arregló esta campana una vez porque iba con `navy` fijo y desaparecía en
  oscuro. Foco `focus-visible:ring-3 focus-visible:ring-ring/50`, como hoy.
- **Accesibilidad**: cada bloque en su propia región con su encabezado; el botón de atajo es un
  `Link` con nombre accesible propio («Gestionar novedades», no «Ver»).

`hooks/useNotificaciones.ts`: `NotificacionesData` gana `porHacer`; el degradado a vacío ante error
lo pone en 0 (misma regla que `noLeidas`, 146/R48). **`useTonoAlIncrementar` pasa a recibir
`porHacer`** (Q8), conservando el `null` mientras carga o hay error.

### 7.2 — La pestaña de `/novedades` por URL (Q6) — **medido: sale barato**

El botón «Gestionar novedades» tiene que dejar a la tienda **donde está lo que hay que gestionar**.
Hoy `/novedades` monta tres pestañas y la primera es «Ayuda» (D6 de la 236: la ayuda va primera
porque alguien espera respuesta). El aviso habla de la segunda.

**El coste, medido en el árbol, no estimado:**

- `components/shared/TabsGroup.tsx` **ya acepta `defaultValue`** (línea 33, modo no controlado).
  **0 líneas de cambio.**
- `app/(app)/novedades/_components/NovedadesTabs.tsx`: una prop opcional que se reenvía al
  `TabsGroup`. **~3 líneas.**
- `app/(app)/novedades/page.tsx`: es un Server Component; lee `searchParams`, valida con zod contra
  `GRUPOS_NOVEDAD` y pasa el valor. **~6 líneas.**

**Total: ~9 líneas en dos archivos, sin tocar el estado interno de ningún módulo cliente y sin
cambiar el comportamiento por defecto** (sin parámetro, o con uno desconocido, sigue abriendo
«Ayuda», R66). No es un filtro por URL: es **fijar la pestaña**, que es el mínimo que pidió el
humano. El filtro completo de `/ordenes` y de `/novedades` queda fuera y declarado.

**Por qué la validación es una lista blanca contra `GRUPOS_NOVEDAD` y no un `as`:** un valor
arbitrario en la URL no puede hacer que `TabsGroup` active una pestaña que no existe (base-ui
desmontaría el panel y la pantalla quedaría en blanco). Un valor desconocido cae al defecto y la
página responde 200.

**El atajo del aviso queda `/novedades?superficie=devolucion`**, y la guardia de §2.2 comprueba que
la página **lee ese parámetro** — que es lo que convierte R6 de una regla en un aserto.

---

## §8 — Archivos que toca la implementación

> Declarado para poder paralelizar con la **408** (frontend, cierres) y para que la **410** (push)
> sepa qué hereda.

**Backend (van primero):**

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | +2 valores en `NotificacionEvento`, +2 en `NotificacionEntidadTipo` |
| `db/migrations/20260911120000_notificacion_evento_avisos_agregados/{migration,down}.sql` | **nuevos** |
| `lib/types/notificacion.ts` | DTO aditivo + `porHacer` + los 4 valores en los tipos espejo |
| `lib/notificaciones/catalogo-avisos.ts` | **nuevo** (puro) |
| `lib/notificaciones/emitir.ts` | +2 emisores, +4 textos, +2 contextos |
| `lib/notificaciones/notificadores.ts` | +2 firmas, +2 `*Con`, +2 `*Real`, ampliar `notificadorNoOp` |
| `lib/interfaces/repositories/IAvisoAgregadoRepository.ts` | **nuevo** |
| `lib/repositories/AvisoAgregadoRepository.ts` | **nuevo** |
| `lib/interfaces/services/IAvisosDiariosService.ts` | **nuevo** |
| `lib/services/AvisosDiariosService.ts` | **nuevo** |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | **nuevo** |
| `lib/services/VigenciaAvisoAgregadoService.ts` | **nuevo** |
| `lib/services/NotificacionService.ts` | `listar`: catálogo + vigencia + tiempo relativo + `porHacer` |
| `lib/actions/notificaciones.ts` | `buildService()` inyecta el resolutor de vigencia |
| `lib/utils/tiempo-relativo.ts` | **nuevo** (puro) |
| `lib/config/avisos-diarios.ts` | **nuevo**: `DIAS_REPRESAMIENTO = 3` con la medición al lado |
| `lib/config/devolucion-sla.ts` | **nuevo**: `DIAS_RECHAZO_AUTOMATICO`, `HORAS_REINTENTO` |
| `lib/services/DevolucionSlaService.ts` | deriva sus dos ventanas de la configuración nueva |
| `app/api/cron/avisos-diarios/route.ts` | **nuevo** |
| `vercel.json` | +1 cron (`0 13 * * *` = 07:00 CR) |

**Frontend (después):**

| Archivo | Cambio |
| --- | --- |
| `components/shared/NotificationsBell.tsx` | reescritura |
| `hooks/useNotificaciones.ts` | `porHacer` |
| `app/(app)/novedades/page.tsx` | lee `?superficie=` (~6 líneas) |
| `app/(app)/novedades/_components/NovedadesTabs.tsx` | prop `superficieInicial` (~3 líneas) |

**No se toca:** `components/shared/PageHeader.tsx`, `components/shared/TabsGroup.tsx` (ya soporta
`defaultValue`), `app/(app)/cierres-admin/**` (es la 408), `public/sw.js` ni `app/layout.tsx` (es la
410).

**Colisiones:**
- con la **408**: ninguna. Toca `cierres-admin/_components/*` y `cierre-labels.ts`.
- con la **410**: **secuencial, no paralela**. Depende de este catálogo, de estos dos eventos y del
  `atajo` del DTO.

---

## §9 — Verificación

- **`./init.sh --rapido` se va a negar**, y está bien: el diff toca `lib/types/**` y
  `db/schema.prisma`. **El gate de esta ficha es `./init.sh` completo, sin excepción**, y también
  después de mergear a `dev`.
- Los **147+ archivos de `tests/integration/db`** sólo corren con `DATABASE_URL` resoluble. En un
  worktree no la hay. **Los tests de dedupe (R41/R42/R51), los de predicado (R45/R46) y el de
  migración (R63) son el corazón de esta ficha**: si el gate los reporta como `skipped`, la ficha
  **no está verificada**. Mirar los `skipped`, no sólo el `INIT_EXIT`.
- **Mutaciones obligatorias** (un aviso diario es exactamente lo que falla en silencio):
  1. quitar el `tiendaId` del `entidad_id` → R42 rojo;
  2. quitar el ámbito del `entidad_id` de represadas → R51 rojo (las zonas se pisan);
  3. cambiar la entidad del aviso de novedades al id de la orden → R41 rojo;
  4. borrar el argumento del notificador real en el composition root → R62 rojo;
  5. hacer que `porHacer` cuente las no leídas → R8, R9 y R30 rojos;
  6. hacer que el resolutor de vigencia devuelva siempre `1` → R55 rojo;
  7. mover `DIAS_RECHAZO_AUTOMATICO` a 6 → R39 rojo por dos vías (literal y comportamiento del cron);
  8. ignorar el tope de intentos al decidir la homogeneidad → R40 rojo;
  9. añadir `devolviendo_a_tienda` al predicado de represadas → R46 rojo.
- **Los literales se afirman a mano.** Prohibido comparar un texto contra la función o la constante
  que lo genera: eso está siempre verde y ya dejó pasar un tope que la app rechazaba.
- **Nadie ha visto esto en un navegador todavía.** El límite que la 407 declaró sigue vigente: jsdom
  no mide contraste ni desbordes. Hay una tarea explícita (T7.4) de mirar el panel en los dos temas
  con un lote largo antes de dar la ficha por hecha.
