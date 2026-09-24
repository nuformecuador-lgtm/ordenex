# Feature 455 — Un solo nombre por estado en toda la app

> Pedida y aprobada por el humano el 2026-09-23 (la autorización cubre este spec de antemano). Zona
> `fullstack`, `depends_on: 454`: se construye **sobre el catálogo que deja la 454** (20 estados, sin
> `devolucion_por_confirmar` ni `ayuda_tienda`, gestión como evento). Se implementa backend → frontend y sale
> a `prod` **junto con SF-001 y la 454, solo cuando el humano lo ordene**.
> Diseño en `design.md`, desglose en `tasks.md`.
>
> La regla del humano, literal: «todo súper alineado; que cada estado se llame igual siempre en todas
> partes». Transparencia total: el destinatario del paquete ve los mismos nombres que la app interna. El
> humano **acepta romper integraciones** («es mejor dejar todo bien ahora que aún es barato»).

## 0. El catálogo que fija esta ficha

### 0.1 Los 20 estados (código → nombre visible)

Orden = posición en `ORDER_STATUS_SEED` tras la 454. **Negrita** = cambia en esta ficha.

| # | Código anterior | Código vigente | Nombre visible |
|---|---|---|---|
| 1 | `entregada` | **`entregado`** | **Entregado** |
| 2 | `devuelta` | **`novedad`** | **Novedad** |
| 3 | `devolviendo_a_tienda` | `devolviendo_a_tienda` | Devolviendo a tienda |
| 4 | `reprogramada` | **`reprogramado`** | **Reprogramado** |
| 5 | `en_ruta_bodega_central` | `en_ruta_bodega_central` | En ruta a bodega central |
| 6 | `en_bodega_central` | `en_bodega_central` | En bodega central |
| 7 | `en_preparacion` | `en_preparacion` | En preparación |
| 8 | `por_recoger` | **`mensajero_recogiendo_en_bodega`** | **Mensajero recogiendo en la bodega** |
| 9 | `en_ruta_bodega_satelite` | `en_ruta_bodega_satelite` | En ruta a bodega satélite |
| 10 | `en_reparto` | `en_reparto` | En reparto |
| 11 | `rechazada` | **`devolucion_a_origen_por_rechazo`** | **Devolución a origen por rechazo** |
| 12 | `en_bodega_satelite` | `en_bodega_satelite` | En bodega satélite |
| 13 | `devuelta_a_tienda` | `devuelta_a_tienda` | Devuelta a tienda |
| 14 | `sin_gestionar` | **`novedad_interna`** | **Novedad interna** |
| 15 | `por_devolver` | **`por_devolver_a_bodega_central`** | **Por devolver a bodega central** |
| 16 | `devolviendo_a_bodega_central` | `devolviendo_a_bodega_central` | Devolviendo a bodega central |
| 17 | `por_devolver_a_tienda` | `por_devolver_a_tienda` | Por devolver a tienda |
| 18 | `por_recolectar_en_tienda` | `por_recolectar_en_tienda` | Por recolectar en tienda |
| 19 | `incidente` | `incidente` | Incidente |
| 20 | `recolectando` | `recolectando` | Recolectando |

Los nombres coinciden uno a uno con las 20 filas de `specs/456-tooltip-estados/textos-aprobados.md`.

### 0.2 El resultado de una gestión usa el mismo código y el mismo nombre que su estado destino

| Resultado anterior | Resultado vigente | Nombre visible |
|---|---|---|
| `entregada` | `entregado` | Entregado |
| `reprogramada` | `reprogramado` | Reprogramado |
| `devuelta` | `novedad` | Novedad |
| `rechazada` | `devolucion_a_origen_por_rechazo` | Devolución a origen por rechazo |
| `incidente` | `incidente` | Incidente |

### 0.3 Nombres visibles retirados (no pueden reaparecer como nombre de nada)

«Entregada», «Entregadas», «Devuelta», «Devueltas», «Reprogramada», «Reprogramadas», «Rechazada»,
«Rechazadas», «Por recoger», «Sin gestionar», «Por devolver» (a secas), «Asignada», «Recolectada», «Por
recolectar» (a secas), «Sin recoger», «En gestión», «En detalle», «En ayuda», «En devolución», «Devolución
por confirmar», «Ayuda solicitada a la tienda» (como estado), «Ayuda de la tienda», los nueve hitos del rastreo
(«Envío registrado», «En nuestras instalaciones», «En tránsito», «Entrega reprogramada», «No fue posible
entregarlo», «En devolución a la tienda», «Devuelto a la tienda», «En proceso») y cualquier abreviatura
«B.» de «bodega».

## 1. Glosario

- **Nombre visible**: el texto de la columna «Nombre visible» de §0.1 para un código.
- **Superficie visible**: todo texto que llega a una persona: pantallas de cualquier rol, rastreo público,
  mensajes de WhatsApp, notificaciones in-app y push, descargas (CSV/XLSX/PDF), mensajes de error y de
  confirmación, títulos de página y de menú, documentación de ayuda (`docs/ayuda/**`) y respuestas del
  asistente.
- **Canal de integración**: la API por API key (respuestas y parámetros), los webhooks salientes y el contrato
  publicado (OpenAPI, su espejo `.yaml`, la colección de Postman y `docs/api/CHANGELOG.md`).
- **Código anterior**: cualquiera de la columna «Código anterior» de §0.1 o §0.2 que cambia en esta ficha.
- **Estado retirado**: un `order_status.value` que ya no está en el catálogo vigente pero que filas históricas
  referencian (`devolucion_por_confirmar`, `ayuda_tienda`, `en_fulfillment`, `pendiente`).
- **Snapshot**: una columna de texto que guardó un código como evidencia de un instante
  (`historial_accion.valor_anterior/valor_nuevo`, `orden_habilitacion_api.estado_resultante`).
- **Etiqueta de grupo**: texto que nombra un conjunto de estados, una acción o un estado de la interfaz (una
  pestaña, un contador, un apartado del menú), no el estado de una orden concreta.

---

## A. Un nombre por estado

- **R1** — El sistema DEBE tener, para cada uno de los 20 estados vigentes, exactamente un código y exactamente
  un nombre visible, iguales a los de §0.1, declarados en una única fuente.
- **R2** — CUANDO una superficie visible muestre el estado de una orden, el sistema DEBE mostrar exactamente su
  nombre visible: sin plural, sin abreviar, sin mayúsculas cambiadas y sin interpolar otro dato dentro del
  nombre (tampoco la zona en «En ruta a bodega satélite»).
- **R3** — El sistema NO DEBE mostrar en ninguna superficie visible un código de estado o de resultado, ni una
  versión «humanizada» de un código (guiones bajos cambiados por espacios).
- **R4** — CUANDO una superficie visible muestre el resultado de una gestión, el sistema DEBE mostrar el nombre
  visible del estado homónimo según §0.2.
- **R5** — CUANDO una superficie visible muestre un recuento, una columna, un KPI o una pestaña que corresponde
  a un único estado o a un único resultado, el sistema DEBE rotularlo con el nombre visible exacto de ese
  estado o resultado.
- **R6** — El sistema NO DEBE usar como etiqueta de grupo un texto igual a un nombre visible vigente ni a un
  nombre retirado de §0.3.
- **R7** — CUANDO un chip, badge o celda muestre el estado de una orden concreta (portal del mensajero en
  reparto, recogida, recolección y recolectadas del día; chat del mensajero; listados de satélite; novedades
  de la tienda), el sistema DEBE mostrar el nombre visible del estado actual de esa orden y NO DEBE mostrar un
  rótulo fijo de la pantalla en su lugar.
- **R8** — MIENTRAS una tarjeta del portal del mensajero esté activa o abierta en detalle, el sistema DEBE seguir
  mostrando en el chip de estado el nombre visible del estado de la orden, y DEBE comunicar la condición de la
  interfaz con un texto distinto que no esté en §0.1 ni en §0.3.
- **R9** — El sistema DEBE escribir «bodega» completo en todo nombre y texto visible; NO DEBE usar «B.».
- **R10** — SI una superficie recibe un código que no es vigente ni retirado, ENTONCES el sistema DEBE mostrar
  «Estado no reconocido» y NO DEBE mostrar el código.
- **R11** — SI una superficie interna muestra una fila histórica que referencia un estado retirado, ENTONCES
  el sistema DEBE mostrar su nombre histórico seguido de « (estado retirado)».
- **R12** — Las familias de color, orden de pintado y cualquier otra decisión de presentación asociada a un
  estado DEBEN indexarse por código, no por el texto visible.

## B. Códigos y datos

- **R13** — El sistema DEBE usar los códigos vigentes de §0.1 y §0.2 en la base de datos, en el código y en el
  canal de integración; ningún código anterior DEBE seguir siendo aceptado como valor de dominio.
- **R14** — CUANDO se aplique la migración, el sistema DEBE renombrar los 7 valores del catálogo de estados
  conservando el `id` de cada fila, de modo que toda orden, fila de historial, vínculo de cierre, fila de
  analítica y vista de filtro guardada siga apuntando al mismo estado.
- **R15** — CUANDO se aplique la migración, el sistema DEBE renombrar los 4 valores del resultado de gestión sin
  cambiar el número de filas de gestión ni de eventos de orden, ni el resultado de ninguna de ellas salvo su
  nombre de código.
- **R16** — CUANDO la migración se aplique dos veces sobre la misma base, la segunda pasada NO DEBE cambiar
  nada ni fallar.
- **R17** — CUANDO se aplique el `down.sql` de la migración, el sistema DEBE restaurar los códigos anteriores
  sobre las mismas filas e ids, sin borrar ni recrear ningún tipo enumerado y sin perder ningún valor añadido
  después.
- **R18** — CUANDO se aplique la migración, el sistema DEBE borrar del catálogo `en_fulfillment` y `pendiente`
  solo si ninguna fila de ninguna tabla los referencia; SI alguna los referencia, ENTONCES DEBE conservarlos y
  NO DEBE ofrecerlos en ningún filtro ni selector.
- **R19** — La migración NO DEBE encolar webhooks, notificaciones ni jobs, ni escribir historial de órdenes.
- **R20** — SI el sembrado del catálogo encuentra en la base un código anterior, ENTONCES DEBE fallar con un
  mensaje que nombre el código y NO DEBE insertar ninguna fila.
- **R21** — CUANDO se aplique una vista de filtro guardada antes de la migración, el sistema DEBE devolver
  exactamente las mismas órdenes que devolvía antes de la migración.
- **R22** — CUANDO una URL interna traiga en un parámetro un código anterior, el sistema DEBE aplicar el código
  vigente equivalente.
- **R23** — CUANDO una superficie muestre un snapshot que contiene un código anterior, el sistema DEBE mostrar
  el nombre visible del estado vigente equivalente sin reescribir la fila.

## C. API por API key y webhooks

- **R24** — CUANDO una respuesta de la API por API key incluya un código de estado o de resultado en un campo
  `X`, el sistema DEBE incluir en la misma respuesta el campo `XNombre` con su nombre visible (`estado` →
  `estadoNombre`, `estadoResultante` → `estadoResultanteNombre`, `resultado` → `resultadoNombre`), y `null` en
  `XNombre` cuando `X` sea `null`.
- **R25** — CUANDO se entregue un webhook que incluya un código de estado o de resultado en un campo `X`, el
  sistema DEBE incluir el campo `XNombre` con su nombre visible, inmediatamente después de `X` en el cuerpo
  firmado.
- **R26** — SI una petición por API key filtra por un código anterior, ENTONCES el sistema DEBE responder `422`
  con un mensaje que nombre el código vigente que lo sustituye, y NO DEBE responder `200` con una página vacía.
- **R27** — CUANDO la API por API key responda a una carga, el sistema DEBE devolver el estado de cada fila creada
  en el campo `estado`, acompañado de `estadoNombre`, en lugar del campo `estatus`.
- **R28** — CUANDO se entregue después del despliegue un webhook encolado antes, el sistema DEBE enviar el código
  vigente y su nombre, con el mismo `eventoId` que habría tenido antes del despliegue.
- **R29** — El contrato publicado DEBE enumerar exactamente los 20 códigos vigentes como valores posibles del
  estado de una orden y los 5 del resultado, derivados del catálogo, y DEBE declarar cada campo `XNombre`.
- **R30** — `docs/api/CHANGELOG.md` DEBE tener, antes de la release, una entrada fechada marcada como ruptura con
  la tabla de códigos anterior → vigente, los campos nuevos, el campo renombrado de la carga, el `422` por
  código anterior y el aviso de fecha de despliegue; y la documentación de integradores
  (`docs/ayuda/oficina/configuracion-api.md`, `docs/api/manual-metricas-por-mensajero.md`) NO DEBE nombrar un
  código anterior.

## D. Rastreo público, WhatsApp y notificaciones

- **R31** — CUANDO el destinatario consulte el rastreo público, el sistema DEBE mostrar cada tramo de la línea
  de tiempo con el nombre visible del estado, fusionando en una sola entrada los tramos consecutivos del
  mismo estado.
- **R32** — La respuesta del rastreo público NO DEBE contener códigos de estado, actor, motivo libre ni datos
  personales; DEBE contener solo nombres visibles, fechas y la marca de pendiente de la 454.
- **R33** — MIENTRAS una orden tenga una gestión pendiente de confirmar (454), el sistema DEBE mostrar la señal
  «<nombre del resultado> · pendiente de confirmación» con el mismo texto en todas las superficies y roles.
- **R34** — SI el rastreo público encuentra una fila que referencia un estado retirado, ENTONCES DEBE mostrar el
  nombre visible del estado vigente equivalente (`design.md` §1.1, `ESTADO_RETIRADO`) y fusionarlo como un
  tramo de ese estado.
- **R35** — CUANDO se resuelva la variable de WhatsApp `{{estatus}}`, el sistema DEBE producir el nombre visible
  del estado actual de la orden.
- **R36** — CUANDO se emita una notificación in-app o push que nombre un estado o un resultado, su texto DEBE
  contener el nombre visible exacto.

## E. Documentación, asistente y SF-001

- **R37** — Los documentos de `docs/ayuda/**` DEBEN nombrar cada estado con su nombre visible exacto y NO DEBEN
  contener ningún nombre retirado de §0.3 como nombre de estado.
- **R38** — CUANDO el asistente (436) construya su contexto para cualquier rol, ese contexto NO DEBE contener
  ningún nombre retirado de §0.3 ni ningún código anterior.
- **R39** — Las pantallas de SF-001 (fichas 429-436: satélite, cierres y consolidación de bodega, SINPE,
  ayuda y asistente) DEBEN cumplir R2-R12 igual que el resto.

## F. Guardias que rompen el build

- **R40** — SI un archivo de `app/`, `lib/`, `components/`, `hooks/`, `scripts/`, `tests/` o `e2e/` contiene un
  código anterior como literal de cadena, como clave de objeto o dentro de SQL, fuera de la lista de
  excepciones justificadas, ENTONCES la suite DEBE fallar nombrando el archivo.
- **R41** — SI un archivo de código o de `docs/ayuda/**` contiene un nombre retirado de §0.3 como texto visible,
  ENTONCES la suite DEBE fallar nombrando el archivo.
- **R42** — SI un módulo distinto de la fuente única declara una correspondencia de código de estado a texto
  visible o humaniza un código, ENTONCES la suite DEBE fallar nombrando el archivo.
- **R43** — La suite DEBE fallar si los nombres de la fuente única no coinciden literalmente con la tabla de
  §0.1, si dos estados comparten nombre, o si no coinciden con las filas de
  `specs/456-tooltip-estados/textos-aprobados.md`.
- **R44** — Cada guardia de R40-R43 DEBE ponerse roja ante una mutación que introduce el defecto que vigila
  (probado en su propio archivo).

## G. No-regresión

- **R45** — Para un mismo conjunto de datos, los filtros por estado de `/ordenes` y de la bodega satélite DEBEN
  devolver las mismas órdenes antes y después de la ficha.
- **R46** — Para un mismo conjunto de datos, las consultas con SQL crudo que filtran por estado o resultado
  (cron de devoluciones, tablero del día, analítica, avisos diarios, corte nocturno, conteos, ranking, ciclo
  de vida) DEBEN devolver los mismos resultados antes y después de la ficha.
- **R47** — Para un mismo conjunto de gestiones, la aprobación de un cierre DEBE emitir exactamente los mismos
  movimientos de dinero y los mismos totales que antes de la ficha.
- **R48** — El grafo de transiciones DEBE tener las mismas aristas que antes, leídas con la correspondencia de
  códigos de §0.1.
- **R49** — El conteo de intentos de entrega y la decisión del tope DEBEN dar los mismos valores que antes.
- **R50** — El sistema DEBE emitir webhooks exactamente para las mismas órdenes, transiciones e instantes que
  antes; solo cambian el código y los campos de nombre añadidos.
- **R51** — Ningún rol DEBE ganar ni perder acceso a pantallas, acciones o datos por esta ficha, y ninguna ruta
  (URL) de pantalla DEBE cambiar.
- **R52** — Los números de la analítica y del tablero DEBEN ser los mismos antes y después de la ficha; solo
  cambian sus rótulos.
- **R53** — El comportamiento definido por la 454 (R1-R65) DEBE seguir cumpliéndose con los códigos vigentes.

---

## Supuestos medidos (2026-09-23, código de `feature/454-backend` y `dev`)

- Literales entrecomillados de los 7 códigos anteriores (estado y resultado comparten palabra): **1 166 en 237
  archivos** de `app/`, `lib/`, `components/`, `hooks/`, `scripts/`; **3 981 en 497 archivos** de `tests/`. En
  `docs/ayuda/**`, 23 apariciones aproximadas de nombres viejos en 9 archivos.
- `/ordenes` filtra por **id** de catálogo (`status_id`) y las vistas guardadas (453) solo están encendidas
  ahí: un renombre por `UPDATE` del catálogo no las toca. La bodega satélite filtra por **código** en la URL.
- El job `webhook_estado` guarda `estatusDestinoId` (id) y resuelve el código al entregar; su `eventoId` se
  deriva de ids e instante.
- No hay vistas, funciones, triggers ni índices parciales de la base que citen estos valores (revisado sobre
  `db/migrations/**`).
- Producción (dato del encargo, 2026-09-23): `en_fulfillment` y `pendiente` sobreviven huérfanos con 0
  órdenes. Si su historial los referencia no está medido (T0.2).

## Fuera de alcance

- Renombrar familias del historial (`escalado_devuelta_sla`, `liberacion_sin_gestionar`, …), tipos de
  notificación (`orden_rechazada`, `novedades_sin_gestionar`), tipos de job, columnas de tablas
  (`entregadas`, `tarifa_especial_devuelta`, …) e identificadores internos de TypeScript (`estatusValue`). No
  son códigos de estado ni llegan crudos a nadie (decisión y alternativa en `design.md` §9-F).
- Renombrar los códigos `en_ruta_bodega_central` / `en_ruta_bodega_satelite` (su nombre no cambia).
- Los textos de ayuda por estado (456).
- Reescribir el texto de plantillas de WhatsApp creadas por usuarios o de notificaciones ya emitidas.

## Decisiones tomadas donde el encargo dejaba margen (sin preguntas bloqueantes)

Cada una tiene su alternativa en `design.md` §9.

1. **Códigos nuevos**: nombre en minúsculas, sin tildes, sin artículos, espacios a `_`
   (`mensajero_recogiendo_en_bodega`, `devolucion_a_origen_por_rechazo`, …). Alternativa: códigos cortos.
2. **`gestion_resultado` se renombra en paralelo** (R15). Alternativa: dejarlo; descartada por el costo medido
   y porque el censo dejaría de poder prohibir las palabras viejas.
3. **Nombre en la API**: campo hermano `XNombre` en camelCase, la convención del canal. Alternativa:
   `estado_nombre` (snake), descartada por mezclar convenciones en un mismo cuerpo.
4. **Carga**: `estatus` → `estado` (R27), «un concepto, un nombre» también en el contrato. Alternativa:
   conservar `estatus`.
5. **Código anterior en la API**: `422` explicativo, sin alias (R26). Alternativa: aceptar ambos un tiempo.
6. **Rastreo**: desaparecen los hitos; se muestran los estados (R31). Los estados retirados se pliegan al
   vigente equivalente solo en el rastreo (R34), porque el público nunca los vio.
7. **Snapshots**: se traducen al leer, no se reescriben (R23), igual que `orden_habilitacion_api` declara.
8. **Formato de la señal pendiente**: «·» (aprobado por el humano en la 456), que sustituye al «—» de 454/R31.

## Abierto (no bloquea; se mide en la Fase 0 y se anota en `progress/`)

- Cuántas órdenes vivas hay hoy en producción en cada estado renombrado, y si el historial referencia
  `en_fulfillment`/`pendiente` (decide si R18 borra o conserva).
- Audiencia del cambio de contrato: suscripciones de webhook activas y keys con tráfico en 30 días.
- Si existe un manual de integradores **fuera** del repo (PDF enviado, página pública); en el repo solo se
  encontraron `docs/api/CHANGELOG.md`, `docs/ayuda/oficina/configuracion-api.md` y
  `docs/api/manual-metricas-por-mensajero.md`.
- Nombre histórico que mostraba la app para `en_fulfillment` antes de la 155 (se recupera de `git log -S`).
- Si la métrica `sin_gestionar` del catálogo de analítica se publica por la API (`publicacion-api-key.ts`).
- Si el asistente (436, en `dev`) tiene texto fijo propio además de `docs/ayuda/**`.
- Si alguna pantalla lee `historial_accion.valor_anterior/valor_nuevo` de `cierre_dia_gestion_corregida`.
