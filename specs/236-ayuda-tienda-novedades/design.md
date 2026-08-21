# Feature 236 — Diseño técnico

> Requisitos en `requirements.md` (R1-R47). **Molde de forma y de rigor:**
> `specs/238-confirmacion-fisica-cierre/design.md`. **Molde de fondo:** `specs/235/design.md`, que
> hizo hace un día el mismo viaje —subir un corte del cliente al servidor— sobre estas mismas piezas.
>
> Los textos de pantalla están **pendientes de firma (D6)**. En este documento se usan los rótulos
> recomendados; si la firma cambia alguno, se sustituye **en un solo commit**.

---

## 0. El defecto, en una línea de causa y efecto

`/novedades` lista **dos poblaciones distintas bajo una sola pestaña**, porque `novedadWhere` es un
`OR` de dos igualdades de estado y la pantalla las pinta seguidas. La consecuencia se midió en
pantalla el 2026-08-19 (`progress/recorrido_235.md` §9): la orden en ayuda aparece bajo **«En
devolución»**, bajo un subtítulo que **no es cierto de ella**, con un juego de botones decidido por
condiciones sueltas —y **sin ninguna forma de leer el motivo** que el mensajero escribió, porque el
commit `55723c83` retiró el botón «Notas» y con él el único montaje del hilo del lado tienda.

**Nada de esto es un fallo de datos.** No hay estado mal escrito, ni marca que apagar, ni dinero mal
movido. Es una pantalla que no distingue dos cosas que ya son distintas **en el servidor**. Por eso
esta ficha **no crea ningún dato**: crea el **corte** y la **superficie**.

---

## 1. Modelo de datos

### 1.1 Tablas, columnas, migraciones y RLS: **ninguna, y es una decisión**

No hay tabla nueva, ni columna nueva, ni migración, ni política RLS que escribir. Todo lo que esta
ficha necesita **ya está persistido**: el estado de la orden (`orden.estatus_id`), el hilo
(`orden_nota`, feature 227), el contador de intentos de contacto (`orden.intentos_contacto`) y el
historial de estado (`orden_historial_estado`), todas con su RLS declarada.

Se dice explícitamente porque en esta pila la tentación de persistir «para no calcular» ya costó dos
columnas retiradas (`orden.ayuda` y `orden.gestion_aprobada`). **Si esta ficha necesitara una
columna, sería señal de que el corte se está haciendo en el sitio equivocado.**

### 1.2 Índices

**Ninguno nuevo.** Los dos predicados filtran `orden` por `(tienda_id, estatus_id, deleted_at)`,
exactamente el mismo acceso que hoy hace `novedadWhere` con su `OR` — de hecho **dos consultas más
selectivas** que la de hoy, no menos. La lectura de la fecha de solicitud (D7) va sobre
`orden_historial_estado` filtrando por `orden_id IN (…)` y `origen_tipo`, que es el mismo patrón de
acceso que `findCausasDevueltaVigentes` sobre `gestion_orden`, y usa el índice
`orden_historial_actor_origen_created_idx` sólo parcialmente (no lidera por `orden_id`): con páginas
de 10 filas el coste es despreciable, y **si la medición del despliegue lo desmintiera**, el arreglo
es un índice, no un rediseño. Queda escrito para que nadie lo descubra en producción.

---

## 2. El corte en el servidor: un mapa, dos predicados, cero divergencia

### 2.1 La declaración única (R5/R6/R7)

Módulo puro nuevo, `lib/types/novedad-grupo.ts`:

```ts
/** Por qué una orden está en `/novedades`. Una pestaña por grupo. */
export type GrupoNovedad = "devolucion" | "ayuda";

export const GRUPOS_NOVEDAD = ["ayuda", "devolucion"] as const satisfies readonly GrupoNovedad[];

/**
 * EL punto único. El servidor lo usa para decidir QUÉ LISTA (§2.2) y la pantalla para decidir
 * QUÉ BOTONES OFRECE (§6). Dos consumidores, una sola verdad: no pueden describir grupos distintos.
 */
export const ESTATUS_POR_GRUPO = {
  ayuda: "ayuda_tienda",        // feature 235: solicitud viva, el paquete sigue en la moto
  devolucion: "devuelta",       // feature 239: devolución ANCLADA (confirmada en el cierre)
} as const satisfies Record<GrupoNovedad, OrderStatusValue>;

/** El sentido inverso, derivado del mapa (nunca un segundo literal). `null` = no es novedad. */
export function grupoDeEstatus(estatusValue: string): GrupoNovedad | null;
```

- El `satisfies Record<GrupoNovedad, OrderStatusValue>` es **la mitad de R7**: un grupo sin estado, o
  un estado que no exista en `ORDER_STATUS_SEED`, **rompen el typecheck aquí**, no en producción. Es
  el mismo mecanismo con el que la 235 justificó pasar de bandera a estatus.
- `grupoDeEstatus` se **deriva** del mapa (recorriéndolo), no se escribe como segundo literal. Un
  segundo literal es una segunda verdad, y este repo ya tiene escrito lo que cuesta
  (`specs/238/tasks.md` T1.1: «la lista se deriva del `Record`, no es un segundo literal»).
- **`GRUPOS_NOVEDAD` fija el orden de las pestañas** (D6: ayuda primero). Que el orden viva junto al
  mapa evita que la pantalla y la descarga los enumeren en órdenes distintos.

### 2.2 `novedadWhere` gana un parámetro y **pierde su `OR`**

Hoy (`OrdenRepository:2963`):

```ts
private novedadWhere(tiendaId: string): Prisma.OrdenWhereInput {
  return { tiendaId, deletedAt: null, OR: [
    { estatus: { value: ESTATUS_DEVUELTA } },
    { estatus: { value: ESTATUS_AYUDA } },
  ] };
}
```

Después:

```ts
private novedadWhere(tiendaId: string, grupo: GrupoNovedad): Prisma.OrdenWhereInput {
  return { tiendaId, deletedAt: null, estatus: { value: ESTATUS_POR_GRUPO[grupo] } };
}
```

**El nombre del método NO cambia, y eso es deliberado:** la guardia
`hilo-ventana-alcanzable.guardia.test.ts` localiza este predicado con
`/private\s+novedadWhere\s*\(/` y **revienta** si no lo encuentra. Renombrarlo la pondría roja por
una razón que no es la suya. (Sobre lo que **sí** hay que enseñarle a esa guardia, §2.4.)

Los dos métodos públicos se generalizan, con el grupo delante de la paginación:

| Hoy | Después |
| --- | --- |
| `countDevueltasByTienda(tiendaId)` | `countNovedadesByTienda(tiendaId, grupo)` |
| `findDevueltasByTienda(tiendaId, pagination)` | `findNovedadesByTienda(tiendaId, grupo, pagination)` |

El rename **es la señal buscada**: el typecheck señala uno a uno los call-sites (servicio y dobles de
test) y ninguno puede quedarse llamando a la versión de un solo grupo. Los nombres viejos decían
«devueltas» y llevaban un año listando dos cosas.

**R4 (count y find comparten predicado), por construcción:** los dos siguen llamando a
`this.novedadWhere(tiendaId, grupo)` con el mismo `grupo` recibido. La invariante ya está aseverada
en `tests/unit/repositories/orden-repository.novedades.test.ts` («R8/R21: count y find construyen
exactamente el mismo predicado») y **se conserva, ahora parametrizada por grupo**: el caso pasa a
iterar `GRUPOS_NOVEDAD`, así que un grupo nuevo entra a la aserción **solo**, sin que nadie se
acuerde. Esa iteración es la mejora real de esta ficha sobre la invariante que hereda.

### 2.3 R9 (ninguna orden en dos pestañas) sale gratis, y hay que decir por qué

Con `OR` de dos igualdades, una orden podía —en teoría— casar las dos ramas, y el predicado llevaba
un comentario explicando que Prisma la devolvería **una sola vez**. Con dos predicados de **igualdad
sobre el mismo campo**, la disyunción es **excluyente por el tipo de dato**: una orden tiene un
`estatus_id` y sólo uno. R9 deja de ser una propiedad que sostener y pasa a ser una consecuencia de
que el discriminante sea el estado. Es la misma clase de argumento con el que la 239 eligió partir el
estado en vez de derivarlo en la consulta.

### 2.4 Lo que hay que enseñarle a `hilo-ventana-alcanzable` — **con cuidado**

Esa guardia cruza **la ventana de escritura de cada rol** con **los estatus que su pantalla lista**, y
falla si alguna intersección queda vacía. Para el `adminTienda` lee los estatus **del texto fuente**
de `novedadWhere`, con el patrón `estatus\s*:\s*\{\s*value\s*:\s*([^,}]+?)\s*\}`, y resuelve el valor
capturado con `valorDe`, que **sólo acepta un literal o un identificador simple**.

Con el cambio de §2.2 la captura es `ESTATUS_POR_GRUPO[grupo]` — **ni literal ni identificador
simple**: `valorDe` **revienta**. La guardia se pondrá roja, y **eso es correcto**: su contrato dice
que revienta antes que adivinar. Lo que NO se puede hacer es borrarla ni relajar `valorDe` para que
trague expresiones.

**Cómo se repara, y por qué así:**

1. La fuente de los estatus de la pantalla de la tienda pasa a ser **el valor importado**
   `ESTATUS_POR_GRUPO` — igual que la guardia ya importa `VENTANA_ESCRITURA` «exportada `as const`
   precisamente para esto». Deja de haber una regex frágil donde ahora hay un `Record` tipado.
2. Para no perder lo que la lectura del fuente protegía —que la guardia siga a **el predicado real**
   y no a un espejo—, se añade la aserción que lo ata: **el cuerpo de `novedadWhere` no contiene
   ningún literal de estatus**; su único origen es el mapa. Si alguien vuelve a escribir
   `{ estatus: { value: "devuelta" } }` a mano dentro del predicado, la guardia se pone roja.
3. Se conserva el bloque 0 («el detector no está roto») con su número: los estatus alcanzables por el
   `adminTienda` siguen siendo **2**, y ahora se puede afirmar algo **más fuerte** que la
   intersección no vacía de hoy: que el conjunto de estatus que la tienda alcanza es **exactamente**
   `VENTANA_ESCRITURA.adminTienda`. Con eso, R36 —el requisito que la 235 dejó a medias— queda
   vigilado por una guardia en vez de por la memoria de nadie.

Esa igualdad es la forma ejecutable de la enmienda de R35: *cada estado en el que un rol puede
escribir tiene una pantalla donde ejercerlo*.

---

## 3. El servicio: un grupo, **una sola proyección**

`NovedadesService` gana el grupo y **no se parte en dos**:

```ts
listar(input: { page; pageSize; grupo: GrupoNovedad }, actor): ListarNovedadesServiceResult
listarCompleto(input: { grupo: GrupoNovedad }, actor): ListarNovedadesCompletoServiceResult
```

- **Por qué no un `AyudaTiendaService` nuevo.** La proyección a `NovedadDTO` —intentos en lote,
  nombres de catálogo, decimales convertidos, orden por recencia— es la misma, y el propio servicio
  ya declara por qué vive en un solo sitio: «ÚNICA proyección del listado: la página y el archivo
  salen de aquí, para que no puedan divergir». Un servicio nuevo sería **una segunda proyección de la
  misma fila**, que es exactamente lo que ese comentario prohíbe. (El precedente de
  `RechazosSlaTiendaService` **no aplica**: aquél tiene DTO propio, con el monto money-safe como
  string; aquí el DTO es el mismo.)
- **La causa sólo se resuelve para el grupo `devolucion` (R26).** `findCausasDevueltaVigentes` sobre
  una orden en ayuda devolvería la causa de una devolución **anterior ya deshecha**: un dato cierto
  que **no describe** por qué esa orden está en la pantalla. Se emite `causa: null` para el grupo de
  ayuda y **la consulta no se hace**, que además es una lectura menos por página.
- **El orden (R17, D7)** lo decide el grupo: `devolucion` conserva el de hoy (fecha de la última
  gestión `devuelta` vigente, fallback `createdAt`); `ayuda` usa **la fecha de la solicitud viva**,
  resuelta con **una** consulta agregada por página —`findFechaSolicitudAyuda(ordenIds)` sobre
  `orden_historial_estado`, filtrando por la familia de origen de la solicitud y quedándose con la
  más reciente por orden—, con `createdAt` como fallback documentado. Mismo molde y mismo coste que
  `findCausasDevueltaVigentes`; **nunca una consulta por fila**.
- **El rol sigue siendo la primera guarda** (`adminTienda`, R11), antes de tocar el repositorio, en
  los dos métodos. No cambia.

---

## 4. El borde: dos Server Actions, no una con bandera

`lib/actions/novedades.ts`:

```ts
listarNovedadesAction({ page? })            → grupo "devolucion"   (firma intacta)
listarNovedadesCompletoAction()             → grupo "devolucion"   (firma intacta)
listarAyudaTiendaAction({ page? })          → grupo "ayuda"        (nueva)
listarAyudaTiendaCompletoAction()           → grupo "ayuda"        (nueva)
```

**Por qué el grupo NO viaja en el input.** Si el cliente eligiera el grupo, elegiría **qué estatus se
consulta**, y el borde tendría que validar ese valor contra el catálogo — un parámetro de consulta
controlado por el cliente sobre la pantalla que ya sufrió una fuga. Con cuatro acciones, el grupo es
una **constante del módulo servidor**: el cliente elige a qué función llama, no qué filtra. Es el
mismo criterio con el que `listarNovedadesCompletoSchema` es `z.object({}).strict()` —«lista blanca
de CERO claves»— para que un `tiendaId` inventado sea un error y no un parámetro ignorado.

`PAGE_SIZE = 10` se comparte; el resto (zod en el borde, `withErrorHandler`, `unauthenticated` antes
de tocar el servicio, `forbidden` desde el servicio) es copia literal de las dos que ya existen.

---

## 5. La página: tres pestañas, tres pre-fetch

`app/(app)/novedades/page.tsx` añade la tercera lectura al `Promise.all` y la baja por props.
`NovedadesTabs` pasa de dos ítems a tres, **en el orden de `GRUPOS_NOVEDAD`** (D6: ayuda primero),
conservando `keepMounted` —cada panel tiene su paginación por Server Action y debe sobrevivir al
cambio de pestaña (R12)—.

**Modo de fallo de la pestaña nueva:** el mismo que la de rechazos, no el de la principal. Si la
lectura de novedades no responde `ok`, la página sigue haciendo `notFound()` (R19 de la 87). Si la de
**ayuda** no responde `ok`, cae a **vacío** y su pestaña muestra su estado vacío: es una superficie
secundaria y tumbar la pantalla entera por ella sería peor que enseñarla vacía. Se escribe aquí para
que el fallback no se lea como un olvido — y porque el estado vacío ya tiene que estar bien escrito
por R16.

**El módulo cliente** `NovedadesModule` se parametriza con el grupo (rótulos del estado vacío, del
`aria-label` de la lista, de la paginación y de la descarga), en vez de duplicarse. Lo que ya sabe
hacer —conmutador de vista, paginación, cards POS, modales— es idéntico para los dos grupos.

---

## 6. El juego de botones, decidido en UN SOLO SITIO (R18-R21)

### 6.1 El problema, medido

Hoy `NovedadAcciones` decide con **condiciones sueltas** (`OrdenRepository`… no: en el propio
componente): `esDevuelta`, `esAyuda`, `puedeHabilitar = esDevuelta || esAyuda`, y tres `...(cond ? [x]
: [])` en el arreglo. **Ese diseño ya produjo el defecto del punto 12** —«Habilitar» aparece
justamente en las cards que vienen de un cierre, al revés de lo que el pedido decía— y lo produjo
porque **nada obliga a la sexta condición**: se añade una acción y no hay ningún sitio que reclame la
decisión para el otro grupo.

### 6.2 El punto único

`app/(app)/novedades/_components/novedad-acciones-catalogo.ts`, módulo **puro** (sin React, sin DOM),
colocado junto a la pantalla que lo usa —arquitectura §«sin sobre-ingeniería»: un solo consumidor no
se promueve a `shared/`—:

```ts
export type AccionNovedad =
  | "contacto"          // Llamar + WhatsApp (ContactoButtons)
  | "reprogramar"
  | "habilitar"         // devolver la orden a la ruta (rescate de la 235)
  | "rechazar"          // maqueta hasta la 240
  | "intentoContacto"   // «+1 intento de contacto»
  | "conversacion";     // abre el hilo (esta ficha)

export const ACCIONES_POR_GRUPO = {
  ayuda: ["contacto", "habilitar", "conversacion", "intentoContacto"],
  devolucion: ["contacto", "reprogramar", "habilitar", "rechazar"],
} as const satisfies Record<GrupoNovedad, readonly AccionNovedad[]>;
```

- **`contacto` entra en la tabla aunque esté en los dos.** Si se quedara fuera «porque siempre
  está», la tabla dejaría de ser el censo de lo que la fila ofrece y volvería a haber una decisión
  fuera de ella. La tabla es **todo** el panel de acciones o no sirve.
- **`habilitar` en `devolucion` es TRADUCCIÓN LITERAL, no arreglo.** Es el punto 12, y se conserva
  **con su comentario y su dueño**: la **240** lo corrige. El beneficio inmediato es que a partir de
  aquí ese defecto es **una celda de una tabla** en vez de una condición suelta en un arreglo, y
  arreglarlo será borrar una palabra. Mismo criterio con el que la 235 tradujo `novedad.ayuda` a
  `estatusValue === "ayuda_tienda"` sin arreglar nada de paso.
- **R21 (fallo cerrado):** `NovedadAcciones` resuelve `grupoDeEstatus(novedad.estatusValue)`; si es
  `null`, no ofrece **ninguna** acción de resolución. No puede ocurrir con los predicados de §2 —el
  servidor sólo lista esos dos estados—, y precisamente por eso el caso tiene que estar escrito: el
  día que un tercer grupo entre por una vía nueva, la fila no inventará botones.
- **R20 (rompe el build):** los dos `satisfies` lo garantizan — un grupo sin juego de acciones, o una
  acción que la unión no declare, no compilan.

### 6.3 La guardia de copia única (R19)

`tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts`: censo del árbol; **ningún archivo de
`app/(app)/novedades/` fuera del catálogo y sus tests decide si una acción se ofrece comparando
`estatusValue` con un literal de estatus**. Con **autocomprobación dentro del propio archivo**: la
guardia se pone roja al plantar `estatusValue === "devuelta"` en un archivo de la pantalla.

⚠️ **El censo se escribe en un archivo de test, nunca por `node -e`**: ahí `\b` llega como backspace
y el censo miente en verde. Es la lección literal de `specs/238/tasks.md` T1.2.

### 6.4 Lo que la card de ayuda ofrece, y lo que no

| Acción | Ayuda | Devolución | Nota |
| --- | --- | --- | --- |
| Llamar / WhatsApp | sí | sí | `ContactoButtons`, sin cambios |
| «Habilitar» (rescate) | sí | sí *(punto 12 → 240)* | con nota obligatoria (D2) |
| «+1 intento de contacto» | sí | no | como hoy |
| **«Conversación»** | **sí** | no | **lo nuevo de esta ficha** (§7) |
| «Reprogramar» | **no** | sí | presupone devolución (R23); desde ayuda es la **237** |
| «Rechazar» | **no** | sí *(maqueta)* | ídem; la cablea la **240** |

---

## 7. El hilo del lado tienda: reponer lo que ya está escrito

### 7.1 Qué se repone, exactamente

`HiloNotasNovedadModal.tsx` **existe entero y no está montado en ningún sitio**. Su propio JSDoc lo
dice: `@sin-superficie`, «volver a darle superficie es reponer una línea en el módulo». Esta ficha
repone esa línea:

- `NovedadesModule` gana el estado `ordenConHilo` (mismo patrón que `ordenAReprogramar` y
  `ordenAHabilitar`: montaje condicional con `key={orden.id}`, para que la lectura arranque fresca en
  cada apertura).
- La acción `conversacion` de la tabla (§6.2) lo abre.
- Se **reescribe el JSDoc**: `@sin-superficie` deja de ser cierto, y la nota de `NovedadAcciones` que
  dice «desde `/novedades` la tienda YA NO LEE NI RESPONDE el hilo» también. **No se deja folclore**:
  un comentario que describe un mundo que ya no existe es peor que ninguno.

**No se escribe ningún hilo nuevo.** El componente monta `components/shared/HiloNotasOrden`, que ya
trae el estado vacío («Todavía no hay notas en esta orden» + su detalle) y el aviso de solo lectura
(«Ahora mismo solo podés leer este hilo»), así que **R33 y R34 se cumplen reutilizando**, no
escribiendo copy nuevo. Los tres mensajes de fallo (R35) ya están en `TEXTOS` del modal.

### 7.2 La ventana de escritura **no se re-deriva** (R30/R31)

`puedeEscribir` llega en la respuesta de `listarNotasOrden`, calculado en el servidor con
`VENTANA_ESCRITURA` (feature 227/R19, D1). La UI **no** lo deduce del estatus. Está escrito en el
propio modal —«Esta pantalla lista exactamente las órdenes `devuelta`… pero eso lo afirma el
servidor: la UI no lo re-deriva del estatus»— y esa frase hay que **actualizarla** (ahora lista dos
grupos), no borrarla.

Con la 235 dentro, `VENTANA_ESCRITURA.adminTienda = ["devuelta", "ayuda_tienda"]`, así que el
servidor ya devuelve `puedeEscribir = true` sobre una orden en ayuda. **Esta ficha no toca la ventana
(R45).** Si alguien tuviera que tocarla para que el hilo funcione, sería señal de que la 235 quedó
mal.

### 7.3 Por qué un modal y no un desplegable en la card

Ver **D5**. En una línea: es la forma que **ya usa el lado mensajero** (`HiloNotasAyudaModal` abierto
desde la card por un botón «Conversación»), el hilo **no puede viajar en el listado paginado** (N+1,
prohibido por el contrato de `lib/types/novedad.ts`), y la card tiene **dos vistas** —mosaico de tres
columnas— donde un hilo en línea es ilegible. Las dos pantallas dicen lo mismo con el mismo gesto
(R36).

### 7.4 R29 (no leer el hilo al listar), y cómo se prueba

`NovedadDTO` **no gana ningún campo**: el hilo no viaja. La prueba no es un comentario, es una
aserción sobre la acción de listado: al listar una página, `listarNotasOrden` **no se llama ni una
vez**, y el DTO no tiene ninguna clave de notas.

---

## 8. La descarga (D3)

- La descarga de **devoluciones** conserva sus columnas y **deja de traer** las órdenes en ayuda
  (R38), sin tocar el archivo de columnas: sale gratis, porque su acción pasa a pedir el grupo
  `devolucion`.
- La de **ayuda** tiene su archivo de columnas propio, con el título «Ayuda solicitada» y **sin la
  columna de causa** (R39). Columnas: guía, remisión, destinatario, teléfono, dirección, ubicación,
  producto, monto a cobrar, **intentos de contacto**, intentos de entrega.
- El **teléfono viaja**, con el mismo razonamiento ya escrito para la otra: la pantalla lo usa (los
  botones de contacto salen de él) y el archivo se arma en el navegador de quien ya lo está viendo.
- **El tope de filas lo evalúa el servidor** con el conteo, antes de leer ninguna fila (R40): sin
  cambios respecto de hoy, es el mismo `listarCompleto`.
- **El cuerpo de las notas NO se descarga.** Ni columna, ni concatenación. Sería sacar de la app
  texto libre escrito por dos personas sobre un cliente, y nadie lo pidió.

---

## 9. Contratos I/O

**Rutas nuevas: ninguna** (ni endpoint, ni página; la pestaña vive en `/novedades`).
**Migraciones: ninguna.** **Integraciones externas: ninguna.**

```ts
// lib/types/novedad-grupo.ts   (NUEVO, puro)
export type GrupoNovedad = "devolucion" | "ayuda";
export const GRUPOS_NOVEDAD: readonly GrupoNovedad[];                 // también fija el orden de pestañas
export const ESTATUS_POR_GRUPO: Record<GrupoNovedad, OrderStatusValue>;
export function grupoDeEstatus(estatusValue: string): GrupoNovedad | null;
```

```ts
// lib/interfaces/repositories/IOrdenRepository.ts
- countDevueltasByTienda(tiendaId: string): Promise<number>
- findDevueltasByTienda(tiendaId: string, p: { skip; take }): Promise<NovedadOrdenRow[]>
+ countNovedadesByTienda(tiendaId: string, grupo: GrupoNovedad): Promise<number>
+ findNovedadesByTienda(tiendaId: string, grupo: GrupoNovedad, p: { skip; take }): Promise<NovedadOrdenRow[]>
+ findFechaSolicitudAyuda(ordenIds: string[]): Promise<Map<string, Date>>      // D7
```

```ts
// lib/interfaces/services/INovedadesService.ts
listar(input: { page; pageSize; grupo: GrupoNovedad }, actor): …               // `grupo` OBLIGATORIO
listarCompleto(input: { grupo: GrupoNovedad }, actor): …                       // era `(actor)`
```

```ts
// lib/actions/novedades.ts
+ listarAyudaTiendaAction(input?: { page?: number }, deps?): …                 // mismo shape de resultado
+ listarAyudaTiendaCompletoAction(input?, deps?): …
```

```ts
// lib/interfaces/services/IHabilitarNovedadService.ts   ← SÓLO si se firma D8
//   el resultado distingue «se devolvió a la ruta» de «no se movió» (R25)
```

**`NovedadDTO` no cambia** (R29, §7.4). Que el contrato del DTO salga intacto de una ficha que
rediseña la pantalla es la señal de que el corte está donde tiene que estar.

**`grupo` obligatorio y no opcional con default:** un olvido de cableado tiene que romper el
**typecheck**, no listar en silencio el grupo equivocado. Mismo criterio y mismo precedente que
`CorteSinGestionarInput.ayudaEstatusId` en la 235 (§7) y que `ResolverCierreInput.confirmacionFisica`
en la 238 (T3.2).

---

## 10. Alternativas descartadas

### A · Partir la lista **en el cliente**, con lo que ya llega *(la más barata — y es el fallo, otra vez)*

Dejar `novedadWhere` con su `OR` y que `NovedadesModule` separe `items` por `estatusValue` en dos
pestañas.

**Descartada por tres razones independientes, y la primera basta.**
(i) **Es literalmente el diseño que la 235 vino a deshacer**: el apartado de ayuda del portal del
mensajero era un `useMemo` de cliente y la orden seguía siendo parada del optimizador, del mapa y del
panel de gestión — «el corte era MAQUETACIÓN» (`RepartoModule`, comentario vivo). La lección está
escrita en el repo con nombre y fecha; repetirla en la pantalla de al lado sería no haberla leído.
(ii) **La paginación miente**: el servidor pagina de 10 en 10 sobre el universo mezclado, así que una
pestaña puede quedarse vacía teniendo órdenes en la página 2 de la otra, y los totales de cada
pestaña serían incalculables sin traer todo. (iii) **La descarga tampoco se puede separar** sin
duplicar la decisión en un segundo sitio (D3).

### B · Un `AyudaTiendaService` nuevo, molde de `RechazosSlaTiendaService`

Copiar el servicio, el repositorio y el DTO para la pestaña nueva.

**Descartada: sería una segunda proyección de la misma fila.** El propio `NovedadesService` declara
que su proyección es única «para que no puedan divergir», y el DTO **es el mismo** `NovedadDTO`. El
precedente de la 102 no aplica: aquella pestaña tiene un DTO de verdad distinto —con el monto
money-safe como `string`— y un predicado sobre otra población. Lo que aquí cambia es **un estado**,
no un modelo. Coste que se evitaría: el rename de los dos métodos del repositorio; coste que se
pagaría: dos sitios donde arreglar cada cosa que la pantalla comparte (intentos, catálogos,
decimales, orden).

### C · Que el **grupo viaje en el input** de una sola Server Action

`listarNovedadesAction({ page, grupo })`, validando `grupo` con zod.

**Descartada: pone en manos del cliente qué estatus se consulta.** Aunque zod acote el enum, el borde
pasa a tener un parámetro de filtrado controlado desde fuera sobre la pantalla que ya sufrió una fuga
de visibilidad. El repo tiene la convención escrita en el sitio exacto: el listado completo declara
`z.object({}).strict()` para que una clave inventada sea un error «y no un parámetro ignorado en
silencio». Con cuatro acciones, el grupo es una constante del servidor.

### D · Que el **servidor mande el juego de botones** en el DTO

`NovedadDTO.accionesPermitidas: AccionNovedad[]`, decidido en el servicio.

**Descartada, y merece explicación porque es tentadora.** (i) **El botón no es el permiso**: cada
acción tiene ya su guarda real en el servidor (`ReprogramacionTiendaService` rechaza con `conflict`
toda orden que no esté `devuelta`; el rescate tiene su guarda de estado; el hilo, su ventana). Mandar
la lista no cierra nada que no esté cerrado, y **haría creer que sí**. (ii) Acopla el contrato del
DTO al **vocabulario de rótulos** de una pantalla, que es lo que más se mueve. (iii) La 237 y la 240
tendrían que tocar el servicio para cambiar un botón. La tabla de §6.2 da el punto único **sin** nada
de eso.

### E · Retirar «Habilitar» de las cards de devolución **aquí** (arreglar el punto 12 de paso)

**Descartada: es la ficha 240, y está asignado por la puerta humana del 2026-08-19.** El propio
código lo dice en `NovedadAcciones:120-123`. Adelantarlo aquí mezclaría una ficha de **superficie**
con una de **conducta**, y dejaría a la 240 sin su mitad visible. Lo que esta ficha sí hace es
**mover el defecto a una celda de una tabla**, para que corregirlo sea borrar una palabra.

### F · Feature flag para desplegar por mitades

**Descartada: no hay punto intermedio seguro ni hace falta.** Si el predicado se parte sin la pestaña
nueva, las órdenes en ayuda **desaparecen de `/novedades`** con el árbol verde —invisibles para la
tienda, que es peor que hoy—. Y si sale la pestaña sin el corte, lista lo mismo que la otra. **Todo
va en un solo PR**, con el orden de commits del §12. Mismo razonamiento que §10-D de la 235.

---

## 11. Rojos esperados, y rojos que son REGRESIÓN

### Rojos POR DISEÑO (se actualizan con nota fechada, nunca se borran)

| Suite | Qué se pone rojo | Cómo se repara |
| --- | --- | --- |
| `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` | `valorDe` **revienta** con `ESTATUS_POR_GRUPO[grupo]`; y el bloque 0 fija «2 estatus» leídos del fuente | §2.4: importar el mapa + atar el predicado a él + **subir** la propiedad a igualdad exacta con `VENTANA_ESCRITURA.adminTienda` |
| `tests/unit/repositories/orden-repository.novedades.test.ts` | `NOVEDAD_WHERE` con su `OR`, los `where.OR[0]`/`[1]`, «count y find comparten where» | El `where` pasa a ser una igualdad por grupo; **la invariante se conserva y se refuerza**: itera `GRUPOS_NOVEDAD` |
| `tests/unit/services/NovedadesService.test.ts` | firma de `listar`/`listarCompleto` y los dobles del repo | Grupo obligatorio; caso nuevo: para `ayuda` **no** se pide la causa |
| `tests/components/NovedadesModule.test.tsx` | `badgeNovedad` con sus ramas de ayuda; «sobre una orden que NO está devuelta no se ofrecen las acciones de devolución»; «sin ayuda pedida… tampoco Habilitar»; los cuatro casos de intento de contacto | Se **reubican**: lo del grupo de ayuda va al test de la pestaña nueva. ⚠️ **No se borran**: un test que vive dentro de lo que se mueve se lleva por delante la red de otra feature |
| `tests/components/NovedadesPage.test.tsx` | la página pasa un tercer bloque de props | Se añade el pre-fetch y su caso de fallback a vacío |
| `tests/components/descarga/NovedadesDescarga.test.tsx` · `tests/unit/descarga/novedades-descarga-columnas.test.ts` | la descarga se parte en dos | Un archivo de columnas por grupo, cada uno con su test |
| `tests/unit/actions/…` de novedades | dos acciones nuevas | Casos espejo de las que ya hay |

### Rojos que son REGRESIÓN (si aparecen, el cambio aterrizó mal — se arregla el CÓDIGO, no el test)

- **Las guardias de dinero** (`ordenes-columnas-money-safe`, `dinero-sin-centimos`) y **las de
  criterio de intento** (`intentos-entrega-criterio-unico`, `criterio-intento-entrega`): esta ficha
  **no toca dinero ni intentos** (R41/R46).
- **`order-status-transiciones` y la guardia de transiciones exhaustivas**: esta ficha **no añade
  ningún estado ni ninguna arista** (R42). Un rojo ahí significa que alguien metió aquí trabajo de la
  237.
- **`tests/unit/guards/orden-nota-frontera.guardia.test.ts`**: `HiloNotasNovedadModal.tsx` **ya está
  en su lista firmada**, así que **volver a montarlo no puede ponerla roja**. Si lo hace, el montaje
  aterrizó fuera de la frontera del hilo.
- **Todo lo del portal del mensajero** (`RepartoAyuda.test.tsx`, `mis-asignaciones-*`,
  `solicitud-ayuda-service`, `rescate-ayuda`): esta ficha **no lo toca** (R44). Cualquier rojo ahí es
  contaminación.
- **`DevolucionSlaService` y sus suites, y los feeds de dinero de `resolverCierre`**: esta ficha no
  cambia el reloj ni el anclaje (R43).

---

## 12. Despliegue

**Un solo PR** (§10-F). Orden de los commits dentro del PR, y el porqué:

1. `lib/types/novedad-grupo.ts` — **inerte**: un módulo puro sin consumidores.
2. Repositorio + servicio + acciones (el corte del servidor). A partir de aquí, si se parara, las
   órdenes en ayuda **no las lista nadie**: por eso no se para aquí.
3. La página, las pestañas y el módulo parametrizado.
4. La tabla de acciones, la card y el hilo.
5. Las descargas.
6. Textos y estados vacíos.

**Antes de desplegar** (no antes de mergear): la re-medición de T0.1. Si el día del despliegue hay
órdenes ya en `ayuda_tienda`, esta ficha pasa de prospectiva a correctiva y hay solicitudes reales
esperando lectura desde el primer minuto.

---

## 13. Riesgos

1. **La reparación de `hilo-ventana-alcanzable` se hace mal** (§2.4). Es el riesgo número uno: la
   guardia se pondrá roja por una razón legítima, y el atajo es relajar `valorDe` o borrar el bloque.
   Mitigación: la reparación está escrita paso a paso, **sube** la propiedad en vez de bajarla, y la
   tanda pide autocomprobación (romper el predicado a mano y verla ponerse roja).
2. **El rename de los dos métodos del repositorio toca muchos dobles de test.** Es ruido, no riesgo
   de producción — pero es la tanda más fácil de subestimar. Se hace de una vez, guiado por el
   typecheck.
3. **La pestaña nueva nace vacía y la de entrada también** (medición): el primer efecto visible del
   despliegue puede ser «`/novedades` está vacía». Mitigación: R16, y el aviso en T0.
4. **La 237 y la 240 escriben sobre esta misma tabla y esta misma card.** No se trabajan en paralelo
   (ver `tasks.md` §Paralelismo).
5. **Si se firma D8**, se toca `HabilitarNovedadResult`, que la 240 también va a tocar. Decidirlo
   **antes** de que las dos fichas escriban.
6. **El pre-vuelo caduca:** comparar el SHA medido contra `origin/dev` **justo antes** de abrir el PR;
   otra sesión puede haber empujado.

---

## 14. Documentación que esta feature deja al día

- `specs/235-ayuda-tienda-estatus/requirements.md` §«RECONCILIACIÓN DE R35» → pasa a **CERRADA con
  fecha**: su dueño era esta ficha, y R27/R36 son su forma ejecutable.
- `progress/auditoria_ayuda_tienda.md` §4 → anotar con fecha los puntos que caen aquí: «la pestaña
  nueva» (de los 9 «no están») y «la nota se escribe y nadie la lee» (de los 5 parciales).
- `progress/design_pila_ayuda_tienda.md` §F2 → marcar el aterrizaje con fecha, PR y las respuestas a
  D1-D8, igual que se hizo con §F4.
- El JSDoc `@sin-superficie` de `HiloNotasNovedadModal.tsx:45-53` y la nota de `NovedadAcciones:47-59`
  («desde `/novedades` la tienda YA NO LEE NI RESPONDE el hilo») → **dejan de ser ciertos**: se
  reescriben, no se dejan como folclore.
- El comentario de `HiloNotasNovedadModal` que dice «esta pantalla lista exactamente las órdenes
  `devuelta`» → ahora lista dos grupos; se actualiza **conservando** su afirmación central (la ventana
  la decide el servidor).
- La **ficha 228** queda declarada **superada** (el leader la estampa en `feature_list.json`).
