# Feature 229 — Rastreo público del envío · design.md

> El CÓMO técnico. **Gate humano pasado el 2026-08-15** («todo por defecto»): las catorce decisiones
> D1/D2/D3 están firmadas y registradas en `requirements.md` §Decisiones del gate (G1–G14). Aquí no
> queda nada por decidir; lo que sigue se implementa tal cual.
>
> **Dos riesgos se firmaron SABIÉNDOLOS y están escritos como tales, no diluidos: §5.bis (el
> limitador en memoria no frena a un atacante distribuido) y §5.ter (`sin_gestionar` → `en_reparto`
> oculta al cliente un fallo operativo interno).** El implementer y el reviewer deben leerlos antes
> de tocar nada.
>
> **Sin migración. Sin ruta nueva. Sin tocar `middleware.ts`.**

---

## 0. Decisiones YA TOMADAS (no se reabren en implementación)

Se escriben aquí porque, sin registro, varias se leerían como olvidos.

| # | Decisión | Quién la tomó | Consecuencia declarada |
| --- | --- | --- | --- |
| **F1** | La superficie es un **MODAL**, no una página dedicada. Disparador en la landing pública `/`. | Humano, chat 2026-08-15 («que sea un modal, no hace falta una página dedicada») | Las tres de abajo |
| **F2** | **No hay URL enlazable ni compartible** del seguimiento. No se puede mandar por WhatsApp un link al estado de un envío. | Consecuencia de F1, dicha en voz alta y aceptada | R30 |
| **F3** | **El resultado no sobrevive a un refresh.** El cliente vuelve a la landing y reingresa la guía. | Consecuencia de F1, aceptada | R30 |
| **F4** | **El QR impreso de la etiqueta NO se toca.** `PAQUETE_BASE_PATH` (`lib/utils/paquete-url.ts:11`) sigue apuntando a `/paquete/<numGuia>`, que es privada: quien escanee sin sesión seguirá cayendo en la landing por `REDIRECT_TO_ROOT` y tendrá que abrir el modal y teclear la guía a mano. | Aceptada | R35 |
| **F5** | **`/paquete` sigue privado.** Es decisión cerrada de la feature 79 (opción b), materializada en `middleware.ts:43` y testeada en `tests/unit/auth/middleware.test.ts:116-131`. | Feature 79 | R4 |
| **F6** | **Con sesión, el modal es inalcanzable** desde `/` (redirige a `/dashboard`, `middleware.ts:62-64`). Un operador que quiera «ver lo que ve el cliente» tiene que cerrar sesión o usar una ventana privada. | Consecuencia de F1 + middleware existente | R5 |
| **F7** | **Sin migración.** El dato ya está en `orden_historial_estado` (feature 49). Esta feature lo **proyecta**, no lo crea. | Ficha | R34 |
| **F8** | Las **catorce** decisiones del gate (G1–G14) están firmadas: segundo factor = últimos 4 dígitos del teléfono, orden con teléfono corto no consultable, límite 8/10 min por IP en memoria, 9 hitos con el mapeo de los 20 estatus, colapso de rachas, solo hitos ocurridos, DTO de 4 campos con día y hora. | Humano, 2026-08-15 («todo por defecto») | `requirements.md` §Decisiones del gate |

Si más adelante se quiere link compartible: **ficha aparte**, no un ensanche de esta.

---

## 1. Modelo de datos

**Ninguno nuevo.** Cero tablas, cero columnas, cero migraciones, cero cambios de RLS (R34).

Lo que se **lee** (y solo eso):

| Tabla | Columnas leídas | Para qué |
| --- | --- | --- |
| `orden` | `id`, `num_guia`, `telefono_dest`, `deleted_at` | identificar + segundo factor (D1). `id` **no sale del repositorio**: se usa como clave de la segunda lectura y se descarta |
| `orden_historial_estado` | `created_at`, `estatus_destino_id` → `order_status.value` | la línea de tiempo |
| `order_status` | `value` | traducir el destino a hito |

Índices: **ninguno nuevo**. La lectura del historial de una orden ya está soportada por
`@@index([ordenId, createdAt])` (`db/schema.prisma:1573`); la búsqueda por guía, por
`num_guia @unique` (`db/schema.prisma:483`).

**Lo que NO se lee, y es la mitad del diseño:** `direccion`, `monto_cobrar`, `producto`, `notas`,
`destinatario`, `mensajero_asignado_id`, `tienda_id`, `zona_id`, y de la fila de historial:
`actor_usuario_id`, `origen_tipo`, `motivo`, `gestion_orden_id`. El `select` es explícito (R25) para
que la ausencia sea **verificable por una guardia**, no una promesa.

---

## 2. Capas

```
app/_landing/LandingNav.tsx                    ← disparador (deja de estar `disabled`)
  └─ app/_landing/RastreoDialog.tsx            ← Client Component: Dialog + formulario + resultado
       ↓ invoca (Server Action, se postea a `/`)
lib/actions/rastreo-publico.ts                 ← Controller: zod, IP, límite de intentos
       ↓
lib/services/RastreoPublicoService.ts          ← Service: identificación, 2º factor, proyección
       ↓
lib/repositories/RastreoPublicoRepository.ts   ← Repository: 2 queries Prisma con select explícito
       ↓
Postgres (orden, orden_historial_estado, order_status)

lib/types/rastreo-publico.ts                   ← DTO público + schemas zod + MAPA DE HITOS
lib/config/rastreo-publico.ts                  ← umbrales por entorno (límite, ventana, nº dígitos)
lib/interfaces/services/IRastreoPublicoService.ts
lib/interfaces/repositories/IRastreoPublicoRepository.ts
```

### 2.1 Por qué un **service nuevo** y no un método más en `OrdenHistorialService`

La ficha pedía decidirlo y justificarlo. **Service aparte.** Tres razones medidas, no estéticas:

1. **Su contrato exige un `Actor`.** `obtenerHistorial(ordenId, actor)` corta en la primera línea
   con `KNOWN_ROLES` (`OrdenHistorialService.ts:13-19,35`) y ramifica en `autorizar()` (líneas
   86-110) sobre `actor.rol`. Un modo anónimo obliga a un `actor` nullable o a un rol falso
   `"publico"`, y a partir de ahí **cada rama existente pasa a tener que acordarse del caso nulo**.
   Es exactamente la clase de cambio que se rompe en la siguiente feature que toque el `switch`.
2. **Su DTO ya lleva lo que no puede salir.** `OrdenHistorialEntradaDTO`
   (`lib/types/orden-historial.ts:163-170`) incluye `actorNombre`, `origenTipo` y `motivo`; el
   resultado añade `intentos` y `umbral` (`OrdenHistorialService.ts:52-54`). Un modo público
   dentro del mismo service tendría que **quitar** campos, y quitar es una operación que se olvida.
   Con un DTO propio construido desde cero, el campo peligroso **nunca existe** (R22/R23).
3. **La entrada es otra.** El público entra por `num_guia` (+ 2º factor), no por `orden.id`. El
   service interno nunca resuelve guías.

Además, R24 lo convierte en **invariante verificable**: una guardia de imports falla si un módulo de
esta feature importa `OrdenHistorialService`, `IOrdenHistorialService` o `OrdenHistorialEntradaDTO`.

> Lo que **sí** se comparte es el dato y el índice, no el código: ambos servicios leen la misma
> tabla append-only por el mismo índice. Duplicar una consulta de 6 líneas con `select` distinto es
> mucho más barato que un contrato con dos modos de visibilidad.

### 2.2 Por qué un **repositorio nuevo** y no un método en `OrdenHistorialRepository`

Mismo criterio: `findHistorialByOrden` (`IOrdenHistorialRepository.ts:89`) resuelve `actorNombre` y
`motivo`. La guardia de R25 debe poder afirmar «el `select` de este módulo no menciona ninguno de los
campos prohibidos», y eso solo es posible si el módulo es propio. Precedente exacto en el repo:
`ConteosPublicosRepository`, creado aparte para la lectura pública de la feature 198.

### 2.3 El controlador: Server Action pública

`lib/actions/rastreo-publico.ts`, `'use server'`. **No resuelve actor y es deliberado** (R13), igual
que `lib/actions/conteos-publicos.ts:12-15`. Se postea a `/`, que el middleware deja pasar sin cookie
por coincidencia exacta (`middleware.ts:62-65`) — **por eso no hace falta tocar el middleware**.

Diferencia con la 198, y es la que justifica todo lo demás de esta feature: la 198 **no acepta
parámetros** (`conteos-publicos.ts:19-24`) precisamente para no ser un oráculo. Ésta **sí** acepta
dos, luego necesita segundo factor (D1.a) y límite de intentos (D1.b). R13 acota el daño: **esos dos
y ningún otro**; nada de filtros por zona, tienda o fecha.

Orden de operaciones (importa, y R8 lo testea):

```
1. zod sobre la entrada           → validation_error (sin tocar datos)
2. resolver IP (x-forwarded-for)  → patrón postulacion-mensajero.ts:38-45
3. límite de intentos             → demasiados_intentos (sin tocar datos)   [R9]
4. registrar el intento SIEMPRE, haya o no resultado                        [R9]
5. service.consultar(guia, factor)
6. traducir a resultado discriminado
```

**El paso 5 no puede cortar antes de comparar el segundo factor** (R8): si la guía no existe, el
service igualmente ejecuta la comparación contra un valor centinela, de modo que el trabajo y el
tiempo no distingan «no existe» de «factor errado». Sin esto, R7 se cumple en la forma y se
incumple en el reloj.

---

## 3. Contratos de entrada/salida

### 3.1 Entrada (zod, en el borde)

```ts
// lib/types/rastreo-publico.ts
export const consultaRastreoSchema = z.object({
  numGuia: z.coerce.number().int().positive(),   // entero positivo estricto
  factor:  z.string().trim().min(1),             // dígitos del 2º factor (D1.a)
});
```

Exactamente **dos** campos (R13). La guardia de R13 lee las claves del schema.

### 3.2 Salida (lista blanca cerrada, R22)

```ts
export interface HitoPublicoEntrada {
  readonly hito: HitoPublico;      // vocabulario público, nunca el value interno
  readonly fecha: string;          // ISO-8601 en la zona del negocio (D3.2)
}

export interface RastreoPublicoDTO {
  readonly numGuia: number;
  readonly hitoVigente: HitoPublico;
  readonly actualizadoEn: string;
  readonly linea: readonly HitoPublicoEntrada[];
}

export type ResultadoRastreoPublico =
  | { readonly estado: "ok"; readonly envio: RastreoPublicoDTO }
  | { readonly estado: "no_encontrado" }              // R7: los TRES casos caen aquí
  | { readonly estado: "demasiados_intentos" }        // R9
  | { readonly estado: "validation_error"; readonly campos: Record<string, string> };
```

`no_encontrado` **no lleva payload**: no hay dónde meter una diferencia entre «no existe» y «factor
errado». Ese vacío es el mecanismo de R7, no un descuido.

### 3.3 El mapa de hitos (D2 firmada, G5-G8)

Vive en `lib/types/rastreo-publico.ts` — módulo de **tipos + tabla**, sin importar
`repositories/`, `services/`, `@/lib/db` ni `next/headers`, para que el Client Component pueda usar
las etiquetas (mismo criterio que `lib/types/tablero-dia.ts:1-8`).

**Doble mecanismo de exhaustividad**, porque el repo demuestra que hacen falta los dos:

```ts
// TOTAL sobre el catálogo vigente: un estatus NUEVO no compila.
// Patrón de ORDER_STATUS_LABELS (EstatusBadge.tsx:13), no el parcial de tablero-dia.
export const HITO_POR_ESTATUS = {
  /* los 20 values de ORDER_STATUS_SEED, copiados LITERALMENTE de la tabla firmada
     en requirements.md §D2. Esa tabla es la fuente; esto es su transcripción. */
} as const satisfies Record<OrderStatusValue, HitoPublico>;

// Red de seguridad para values HUÉRFANOS (fuera del catálogo vigente).
export const HITO_POR_DEFECTO: HitoPublico = "en_proceso";

export function hitoDeEstatus(value: string): HitoPublico {
  const explicito: Partial<Record<string, HitoPublico>> = HITO_POR_ESTATUS;
  return explicito[value] ?? HITO_POR_DEFECTO;   // R17
}
```

**Por qué los dos a la vez, y no solo uno:**

- Solo `Record` total → el build se protege del estatus nuevo (R16), pero `hitoDeEstatus` recibe un
  `string` **crudo de la base** y una fila huérfana (el caso real de la feature 155,
  `lib/types/order-status.ts:45-53`) devolvería `undefined` y publicaría un hueco o reventaría.
- Solo mapa parcial + default (patrón `tablero-dia.ts`) → un estatus nuevo **no rompe el build**:
  cae silenciosamente en el default y el cliente ve «en proceso» para siempre sin que nadie se
  entere. Eso es justo lo que la ficha prohíbe.

`hitoDeEstatus` acepta `string` (no `OrderStatusValue`) **a propósito**, por la misma razón que
`bucketDeEstatus` (`lib/types/tablero-dia.ts:66`): el value llega crudo de `order_status.value`.

### 3.4 Colapso de rachas (R18)

**Firmado (G9): se colapsa.** Función pura sobre la lista ya mapeada: recorre en orden ascendente y
descarta la entrada cuyo hito es igual al de la anterior, conservando la fecha de la **primera**.
Vive en el service (es lógica de proyección) y es testeable sin DB. La línea solo contiene hitos
**ya ocurridos** (G10): no se sintetiza ninguna entrada futura.

---

## 4. La UI

### 4.1 Disparador

`app/_landing/LandingNav.tsx:44-51` ya tiene el botón, **inerte y con el `disabled` puesto**, con el
icono `Search` y el texto «Rastrear envío». Su comentario (líneas 17-19) declara que en el sitio real
abre un diálogo de consulta por guía. Esta feature:

- le quita `disabled`,
- lo envuelve en `<DialogTrigger>` (`components/ui/dialog.tsx:18`),
- **corrige el comentario**, que hoy dice que el seguimiento real vive en `/paquete/[numGuia]` — algo
  que deja de ser cierto para el destinatario.

`LandingNav` es hoy un Server Component; el diálogo es Client. Se resuelve montando
`<RastreoDialog>` (Client) **dentro** de la nav: es el patrón que ya usa la landing para sus islas
(`app/_landing/cifras-publicas.tsx`), y evita convertir la nav entera en cliente.

### 4.2 El diálogo

`app/_landing/RastreoDialog.tsx`, `"use client"`. **Vive junto a la página que lo usa, no en
`components/shared/`**: se usa en un solo sitio y no tiene lógica reutilizable
(`docs/architecture.md` §«sin sobre-ingeniería»). Se promoverá el día que una segunda superficie lo
necesite, no antes.

- Compuesto con `Dialog / DialogTrigger / DialogContent / DialogHeader / DialogTitle /
  DialogDescription` (`components/ui/dialog.tsx:118`). **No se crea ninguna primitiva nueva.**
- Dos estados dentro del **mismo** diálogo: formulario → resultado (R26). Ni navegación, ni segundo
  modal.
- Estado local `React.useState` + `useTransition` para la carga (R27). Sin SWR: no es una lectura
  cacheable ni repetible, es una consulta puntual con entrada de usuario.
- **Paleta:** tokens de la landing (`brand`, `navy-deep`, `asfalto-*`, `kraft-*`), sin `dark:` y sin
  hex ad-hoc (R29). El diálogo se abre desde un subárbol `tema-claro` (`app/page.tsx:50`) pero se
  **portalea** fuera de él (Radix `DialogPortal`, línea 26) → **hay que poner `tema-claro`
  explícitamente en `DialogContent`**, o el `.dark` de `<html>` (feature 211) lo alcanza. Esto es un
  riesgo real y concreto de esta feature; T3.2 lo testea.
- Cierre: limpia formulario y resultado (R30). Nada de `searchParams`, `localStorage` ni `router`.

### 4.3 Lo que la UI NO hace

No re-deriva ninguna regla del servidor: recibe hitos ya mapeados y fechas ya formateadas, y solo
elige la etiqueta y el icono. La UI **no conoce** ningún `order_status.value`.

---

## 5. Seguridad: el borde es tan alcanzable como una ruta

Que sea un modal no relaja nada. Una Server Action es un **endpoint POST** con un id estable; un
script puede llamarla en bucle sin abrir jamás la landing. Todo el razonamiento de D1 aplica igual.

Defensa en tres capas, por orden de eficacia:

1. **Segundo factor** — últimos 4 dígitos del teléfono del destinatario (G1). Sube el coste por guía
   de 1 petición a ~5.000.
2. **Límite de intentos** — **8 en 10 minutos, clave `rastreo:<ip>`** (G3/G4). Es la defensa **real**
   contra el barrido; el segundo factor solo la hace viable. Con `ResetRateLimiter`
   (`lib/utils/reset-rate-limit.ts`). La clave **no incluye la guía**: si la incluyera, el atacante
   estrenaría cubo en cada intento y el límite no frenaría nada.
3. **Respuesta indistinguible** (R7 + R8) — sin ella, un atacante enumera *existencia* de guías
   aunque nunca acierte el factor, que es la mitad del daño (saber cuántos envíos hay y en qué
   rango de guías).

## 5.bis ⚠ RIESGO ACEPTADO — el limitador es en memoria por proceso

**Firmado por el humano el 2026-08-15 sabiéndolo. No es un hallazgo pendiente ni una «limitación
conocida» genérica: es una decisión con nombre.**

`ResetRateLimiter` guarda la ventana deslizante en un `Map` **dentro del proceso**
(`lib/utils/reset-rate-limit.ts:22-43`), y su propia cabecera se declara *best-effort por instancia*
(líneas 1-6). En un despliegue serverless (Vercel) eso significa, literalmente:

- **cada instancia tiene su propio contador**, así que N instancias multiplican por N el techo real;
- **cada despliegue resetea todos los contadores** a cero;
- un atacante que reparta las peticiones entre IPs distintas **no toca el límite en ningún momento**.

Dicho sin adornos: **acota al torpe, no al decidido.** Frena al curioso que lanza un `for` desde su
portátil; **no frena a un atacante distribuido**.

**Si algún día se quiere frenar de verdad, es FICHA APARTE — un límite persistido y compartido entre
instancias — y NO un ensanche de ésta.** Esta feature no puede resolverlo sin migración, y la
migración está excluida por F7.

## 5.ter ⚠ RIESGO ACEPTADO — `sin_gestionar` → `en_reparto` oculta un fallo operativo

**Firmado por el humano el 2026-08-15 (G8) sabiéndolo.**

`sin_gestionar` es el estado en el que el corte diario deja una orden que se quedó en `en_reparto` al
pasar de día (feature 109, `lib/types/order-status.ts:68`): **nadie la gestionó**. El mapeo público
la muestra como **«En reparto»**.

Consecuencia, dicha en voz alta: **si la orden se quedó sin gestionar, el cliente ve «En reparto» y
no se entera.** No hay señal de que su envío se quedó parado; la línea de tiempo no lo distingue de
un reparto que va bien.

Es lo normal en cualquier rastreo público —ningún transportista publica sus fallos operativos— y por
eso se acepta. Pero es una **decisión deliberada**, no un efecto colateral del mapeo: quien revise
esta feature debe saber que el hueco es intencional y no «arreglarlo» exponiendo el estado interno,
que sería incumplir R15.

---

## 6. Alternativas descartadas

### 6.1 Página dedicada `/rastreo` (o `/rastreo/[guia]`) — **descartada por decisión humana**

Era la opción técnicamente superior: URL enlazable, compartible por WhatsApp, superviviente al
refresh, y el QR de la etiqueta podría haber apuntado ahí (cerrando F4). **El humano decidió modal**
(«que sea un modal, no hace falta una página dedicada», 2026-08-15). Se registra aquí con sus
ventajas intactas **para que la próxima ficha no tenga que redescubrirlas**, no para reabrir la
decisión: F1–F4 son firmes.

### 6.2 Abrir `/paquete/[numGuia]` al público — descartada

Habría reutilizado el QR ya impreso sin tocar nada. Pero (a) esa página pinta la **etiqueta**
(`obtenerEtiquetaPorGuia`), no un seguimiento: enseña dirección y datos de la orden a cualquiera que
adivine un entero; y (b) su carácter privado es decisión **cerrada** de la feature 79, con test
propio (`tests/unit/auth/middleware.test.ts:116-131`). Reabrirla desde esta ficha sería revertir una
decisión ajena por la puerta de atrás.

### 6.3 Ensanchar `OrdenHistorialService` con un `actor` nullable o un rol `"publico"` — descartada

Ver §2.1. Resumen: dejaría el DTO sensible como base y obligaría a **restar** campos; el olvido de
una resta es una fuga silenciosa. Es la misma razón por la que la feature 198 creó repositorio
propio en vez de parametrizar los existentes.

### 6.4 Identificar solo con `num_guia` — descartada

Es lo más cómodo para el destinatario y **lo único que la operación sabe seguro que tiene impreso**.
Y es exactamente el ataque: `num_guia` es incremental y contiguo (`db/schema.prisma:483`), así que un
bucle de enteros descarga el estado y la historia de toda la base de envíos. La alerta ya venía
escrita desde la ficha 79.

### 6.5 Token opaco por orden (columna nueva + reimpresión de etiquetas) — descartada por alcance

Es el diseño correcto en abstracto (factor fuerte, sin PII, imprimible en el QR). Exige migración,
backfill y reimpresión, y **deja fuera todo el histórico**: una orden ya impresa no tiene token.
La ficha excluye la migración. Si algún día se quiere link compartible (§6.1), token y ruta van
juntos en **la misma** ficha nueva — no por separado.

### 6.6 Rate limit durable en tabla nueva — descartada por alcance (deuda declarada en §5)

### 6.7 Reutilizar `login_attempt` como registro de intentos — descartada

Sin migración y durable (`db/schema.prisma:328-344`, con `@@index([ipAddress, createdAt])`). Pero su
`emailUsado` es `String` NOT NULL: habría que meter ahí una guía. Contamina la tabla de auditoría de
autenticación con eventos que no son logins y envenena cualquier consulta forense futura sobre
accesos. **El ahorro no compensa el destrozo semántico.**

### 6.8 Mapa parcial + default (patrón `tablero-dia.ts`) para los hitos — descartada como mecanismo único

Sobrevive a values huérfanos, pero **un estatus nuevo caería en el default en silencio**. La ficha
exige lo contrario: que rompa el build. Se adopta el `Record` total **más** el default como red
(§3.3): no es indecisión, son dos fallos distintos que exigen dos mecanismos distintos.

---

## 7. Integraciones

**Ninguna.** Ni WhatsApp, ni email, ni proveedor externo. No se notifica nada a nadie: el
destinatario **tira** del dato, el sistema no lo empuja. (Notificación proactiva al destinatario
sería otra ficha, y su discusión no pertenece a ésta.)

---

## 8. Riesgos conocidos, todos ACEPTADOS en el gate del 2026-08-15

Ninguno está pendiente de decidir. Se listan para que el implementer no los confunda con bugs y el
reviewer no los reporte como hallazgos.

1. **⚠ El limitador no frena a un atacante distribuido** — §5.bis. Ficha aparte si se quiere de
   verdad.
2. **⚠ `sin_gestionar` se muestra como «En reparto»** — §5.ter. El cliente no se entera de que su
   envío se quedó sin gestionar.
3. **Órdenes con `telefono_dest` de menos de 4 dígitos quedan SIN rastreo** (G2) y el destinatario
   no tiene forma de saber por qué: recibe el mismo «no encontrado» que una guía inexistente (R7,
   caso d). Es el precio directo de no filtrar existencia. T0.4 mide cuántas son.
4. **El destinatario no sabe que el modal existe.** El único punto de entrada es un botón en la nav
   de la landing; el QR de la etiqueta lleva a otro sitio (F4). Coste de descubribilidad **real y
   aceptado**.
5. **Guías consultables de por vida.** Una orden entregada hace dos años sigue respondiendo. El gate
   se firmó «todo por defecto» y **por defecto no hay ventana de retención**: no se implementa
   ninguna. Si se quisiera («solo los últimos 90 días»), sería un filtro de fecha en el service, sin
   migración — pero **no se asume aquí**.
