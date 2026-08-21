# T5.6 — Ver la app: el recorrido de la feature 239, anotado

> **Hecho el 2026-08-20 por el leader**, con **los tres roles** —`admin`, `mensajero` y `adminTienda`
> con su OTP— conduciendo Chromium con Playwright, y **comprobando cada propiedad contra Postgres**,
> no contra la pantalla. Es lo que se vio, no lo que se esperaba.
>
> La ficha llevaba `done` y **mergeada** con esta tarea sin hacer. El recorrido encontró un defecto
> que la suite no ve.

---

## Por qué este recorrido no era opcional

La 239 no es una feature nueva: es **el arreglo de un fallo que cobra dinero**. En `dev` se había
recortado la visibilidad de las devueltas **sin mover el reloj del SLA**, así que una orden podía
escalar a `rechazada` —y cobrarse— sin que la tienda la hubiera visto nunca. El saldo de la mitad
implementada era **peor que no haber hecho nada**.

---

## 1 · El pre-estado existe y la gestión ya NO va a `devuelta` (R2)

Marco gestiona **QA-R-0013** con «Devolver» → causa **«Cliente no localizado»** (la ventana de 24 h,
la más corta), foto y motivo.

| | |
| --- | --- |
| estatus de la orden | **`devolucion_por_confirmar`** — no `devuelta` |
| gestión | `resultado = devuelta` · `causa = not_found` · `cierre_id` **NULL** |

## 2 · La tienda NO la ve mientras está en el pre-estado (R19)

`/novedades` como **Tania**, entrando con **OTP leído del log del servidor**:

```
¿aparece QA-R-0013? NO      ¿aparece la guía 990013? NO
```

Y las tres pestañas de la 236 en su sitio: «Ayuda solicitada» · «En devolución» · «Rechazadas por
plazo vencido».

## 3 · El destinatario ve EXACTAMENTE lo mismo que en una `devuelta` (R28)

El rastreo público («Rastrear envío» de la portada, guía + últimos 4 del teléfono), comparado contra
**QA-R-0011, que ya estaba `devuelta`**:

| | hito que pinta |
| --- | --- |
| QA-R-0013 · **en el pre-estado** | **No fue posible entregarlo** |
| QA-R-0011 · **ya `devuelta`** | **No fue posible entregarlo** |

**Y después del anclaje, el mismo:** se volvió a consultar la guía 990013 ya `devuelta` y la línea de
tiempo es **idéntica, con la misma hora (17:28)**. Al destinatario **no le cambia nada** — que es
literalmente lo que R28 pide.

## 4 · 💰 EL ANCLAJE — el corazón de la ficha, medido contra Postgres

Marco solicita el cierre; el admin lo aprueba pasando por la **ventana de confirmación física de la
238** (`Paquetes confirmados: 4 de 4`). En ese instante:

```
QA-R-0008  ->  devuelta
QA-R-0009  ->  devuelta
QA-R-0013  ->  devuelta
```

Y el historial nombra la transición con **un origen propio**:

```
en_reparto                 -> devolucion_por_confirmar   | gestion              | 23:28:15
devolucion_por_confirmar   -> devuelta                   | anclaje_devolucion   | 23:41:07
```

**Las TRES anclaron en el mismo milisegundo — `23:41:07.191Z`.** Tres órdenes distintas con la misma
marca de tiempo no es una coincidencia: es **la misma transacción** que aprueba el cierre, que es lo
que R4 exige. No se dedujo del código: se leyó de la base.

**El reloj, en QA-R-0013:** gestión a las `23:28:15`, aprobación a las `23:41:07` → **772 segundos en
el pre-estado**. Antes de la 239 la ventana de SLA arrancaba en la **primera** fecha; ahora arranca
en la **segunda**. Ese tramo es exactamente el que en producción medía **mediana 8,2 h · p90 22,1 h ·
máx 48,2 h** contra una ventana de 24 h — y por el que se cobraba antes de tiempo.

## 5 · La tienda SÍ la ve tras el anclaje

`/novedades` → pestaña **«En devolución»**: aparecen las tres guías (990008, 990009, 990013) con su
causa legible **«Cliente no localizado»** y las acciones **Reprogramar** y **Rechazar** de la 240.
**No hay «Habilitar»** en esas cards — el punto 12 del pedido, visto en su sitio.

## 6 · Deshacer desde el pre-estado, y su promesa es CIERTA (último paso de T5.6)

Con **QA-R-0012** en el pre-estado, desde el cierre del día del mensajero:

```
«La gestión quedará anulada (queda el registro de quién la hizo y cuándo)
 y la orden volverá a tu lista para gestionar.»
```

Comprobado en la base después: **`en_reparto`** (no `devuelta`) y la gestión **anulada**. Merece
decirse porque en la 237 esta misma pantalla prometía justo eso y **el servidor lo iba a rechazar
siempre**. Aquí la promesa se cumple.

## 7 · R26 — el pre-estado tiene etiqueta legible, no enum crudo

Listado de `/ordenes` del admin: **«Devolución por confirmar»**. Y el mensajero ve la orden bajo
«Devueltas (1)» en su cierre, con el motivo que escribió.

---

## 8 · 🔴 EL DEFECTO QUE SOLO SE VE MIRANDO

Al guardar la gestión, al mensajero le sale:

```
Orden QA-R-0013: Devuelta.
```

**Y la orden NO está devuelta: está en «Devolución por confirmar»**, que es como la nombra la propia
app dos pantallas más allá. El aviso contradice a la etiqueta que el mismo producto usa.

**No es un texto mal escrito: es la coincidencia que la 239 vino a romper, viva en un sitio al que la
ficha no llegó.**

- `MisAsignacionesService.ts:566` devuelve `{ …, estado: input.resultado }` — el campo se llama
  **`estado`** pero lleva un **`resultado`**.
- `GestionarOrdenPanel.tsx:668` lo pinta con `estatusLabel(result.estado)`, que es el mapa de
  **estados de orden**.
- Para `entregada`, `rechazada` y `reprogramada` **acierta de casualidad**, porque resultado y estado
  se llaman igual. Para `devuelta` **ya no**, y ése es justo el que la 239 separó.

Lo dice el propio comentario de la bisagra que escribió la ficha:

> «Nunca fue una regla: era una **coincidencia sostenida a mano**. La 239 rompe esa coincidencia para
> UNO de los cinco.»

El mapa se creó y se usa **para escribir en la base**, pero este retorno sigue pasando el `resultado`
crudo por una función de **estados**. Queda como **ficha 250**. Severidad baja —es un aviso— pero es
**la única superficie que todavía equipara resultado con estado**, y R26 pide clasificación explícita
en **todas** las que nombran estados.

---

## 9 · Dos veces que MI instrumento mintió, y no la app

Se anotan porque las dos habrían salido publicadas como defectos:

1. **`fecha_reparto` parecía tener un día menos.** La pantalla decía «hoy, 20 de agosto» y mi consulta
   imprimía `Wed Aug 19`. En Postgres el valor es **`2026-08-20`**: era `String(Date)` formateando en
   la zona del proceso (UTC-5) una columna `@db.Date` que Prisma devuelve a medianoche **UTC**.
2. **«Recibir paquete» parecía no hacer nada.** La acción corría, devolvía 200 y la orden no se movía.
   El aviso **sí existía** —«No se puede recibir: la orden está en "En preparación"»— en un
   `role="alert"` **fuera** del modal, y yo capturaba solo el modal.

Regla que sale de las dos: **capturar la página entera y leer el valor en su formato canónico**
(`toISOString()`, el `::text` de Postgres) antes de acusar a nadie.

---

## 10 · Estado de la base local al terminar

Base **local** (`localhost:5432`); contra producción **no se escribió nada**.

- **Se rotó la contraseña de los usuarios QA** con `scripts/seed-usuarios-qa.ts`: ahora es
  `Ordenex239Local!` para `admin.qa`, `mensajero.qa`, `tienda.qa` y `satelite.qa`. La anterior no
  estaba versionada y no permitía entrar.
- Se pusieron **coordenadas manuales** a QA-R-0012 y QA-R-0013 (`geocode_status = manual_local`):
  en local no hay geocodificador y **asignar aborta el lote entero** sin lat/lon.
- QA-R-0008, QA-R-0009 y QA-R-0013 quedan **`devuelta`** y visibles para la tienda; **QA-R-0012 queda
  en el pre-estado** (`devolucion_por_confirmar`) dentro de un cierre sin solicitar; dos cierres de
  Marco quedaron **aprobados** con su confirmación física.
