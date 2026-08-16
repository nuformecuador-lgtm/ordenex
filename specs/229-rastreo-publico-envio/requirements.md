# Feature 229 — Rastreo público del envío (el destinatario consulta sin sesión) · requirements.md

Zone: `fullstack` · complexity: `high` · sdd: `true` · depends_on: `null`

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto en `tasks.md` (el reviewer
> rechaza si falta trazabilidad). Esta feature **no crea trazabilidad: la PROYECTA hacia afuera**.
> El dato ya existe (`orden_historial_estado`, feature 49). **SIN migración, SIN ruta nueva, SIN
> tocar `middleware.ts`.**
>
> **Estado del spec: GATE HUMANO PASADO (2026-08-15). No quedan preguntas abiertas.** Las catorce
> que abrió la primera vuelta están resueltas y convertidas en requisitos; el registro de las
> decisiones, con su fecha, está en §Decisiones del gate al final de este archivo.

---

## Contexto verificado (símbolos reales medidos en el código, no supuestos)

- **`/` es pública por coincidencia EXACTA**, no por `PUBLIC_ROUTES` (`middleware.ts:62-65`): con
  cookie de sesión redirige a `/dashboard`; sin cookie sirve la landing. Una Server Action
  invocada desde un componente de `/` se postea a `/` y **pasa el guard sin sesión**. `startsWith`
  en `PUBLIC_ROUTES` volvería pública la app entera — por eso `/` no está en esa lista
  (`middleware.ts:20-25`).
- **El disparador YA EXISTE y está inerte.** `app/_landing/LandingNav.tsx:44-51` renderiza un
  `<button type="button" disabled>` con el icono `Search` y el texto «Rastrear envío», y su propio
  comentario (líneas 17-19) dice: «en el sitio abre un diálogo de consulta por guía, y esta ruta es
  solo maquetado». Esta feature **le quita el `disabled`** y le cuelga el `Dialog`.
- **La landing es Server Component y CLARA POR DISEÑO** (feature 208): `app/page.tsx:50` monta el
  subárbol con `tema-claro` y paleta fija `kraft-*` / `asfalto-*` / `navy-deep`, y su cabecera
  (líneas 24-30) declara que **no gira con el tema**. El modal es Client Component y hereda esa
  regla: tokens de marca, ningún hex ad-hoc.
- **`/paquete/[numGuia]` NO sirve.** Exige sesión y pinta la ETIQUETA (`obtenerEtiquetaPorGuia`),
  no un seguimiento. Su carácter privado es decisión **cerrada** de la feature 79, materializada en
  `middleware.ts:43` (`REDIRECT_TO_ROOT = ["/paquete"]`) y testeada en
  `tests/unit/auth/middleware.test.ts:116-131`. **Esta feature no la toca.**
- **`OrdenHistorialService.obtenerHistorial(ordenId, actor)` no tiene puerta para un anónimo.**
  Corta en la primera línea con `KNOWN_ROLES` (`OrdenHistorialService.ts:13-19,35`, R27 de la 49) y
  ramifica la visibilidad por rol en `autorizar()` (líneas 86-110). Su DTO
  (`OrdenHistorialEntradaDTO`, `lib/types/orden-historial.ts:163-170`) lleva `actorNombre`,
  `origenTipo` y `motivo`, y su resultado añade `intentos` y `umbral`
  (`OrdenHistorialService.ts:52-54`). Nada de eso puede cruzar al público.
- **Precedente de borde público en este repo:** `lib/actions/conteos-publicos.ts` (feature 198) es
  una Server Action **deliberadamente sin actor** (líneas 12-15), que **no acepta parámetros** para
  no convertirse en oráculo (líneas 19-24) y que se contiene con caché (líneas 29-32). El nuestro
  **sí** acepta parámetros de identificación → por eso hace falta un segundo factor y un límite de
  intentos que la 198 no necesitaba.
- **Precedente de acción pública CON entrada y límite de tasa:**
  `lib/actions/postulacion-mensajero.ts` — limitador por proceso instanciado a nivel de módulo
  (línea 32), clave `ip|dato` (líneas 34-36) e IP resuelta de `x-forwarded-for` / `x-real-ip`
  (líneas 38-45). El limitador es `ResetRateLimiter` (`lib/utils/reset-rate-limit.ts`), ventana
  deslizante **en memoria del proceso**, con reloj inyectable y declaradamente *best-effort*
  (líneas 1-6). **Ya existe: no hay que inventar infraestructura de rate limiting.**
- **`num_guia` es `Int? @unique` (`db/schema.prisma:483`), asignado por `nextval` de una
  secuencia** → INCREMENTAL y adivinable. `orden.telefonoDest` es `String` NOT NULL
  (`db/schema.prisma:487`). Existe `normalizarTelefonoCR` (`lib/utils/telefono-cr.ts:8`), función
  pura ya testeada.
- **El catálogo tiene 20 valores, no 19.** `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts:54-79`) y su test `tests/unit/types/order-status.test.ts:78,137`
  (`toHaveLength(20)`). La ficha de `feature_list.json` dice 19: es anterior a `recolectando`
  (feature 157, línea 78). **Este spec manda sobre la ficha** (tarea T0.2).
- **Hay estatus HUÉRFANOS vivos en el historial.** La feature 155 sacó el estado de *fulfillment*
  del seed pero su fila **sobrevive en la base si alguien la referencia**
  (`lib/types/order-status.ts:45-53`). El historial es inmutable: filas antiguas pueden apuntar a
  un `order_status.value` **fuera del catálogo vigente**. Cualquier mapeo debe sobrevivir a eso sin
  romperse y sin publicar el value crudo.
- **Dos patrones de exhaustividad, ya en el árbol.** Mapa PARCIAL + default (`BUCKET_POR_ESTATUS`,
  `lib/types/tablero-dia.ts:49-69`) y Record TOTAL (`ORDER_STATUS_LABELS: Record<OrderStatusValue,
  string>`, `app/(app)/ordenes/_components/EstatusBadge.tsx:13`). El segundo es el que rompe el
  build ante un estatus nuevo; el primero es el que sobrevive a un value huérfano. Esta feature
  **necesita los dos a la vez** (R14 + R15).
- **La línea de tiempo ya se lee con índice:** `@@index([ordenId, createdAt])` sobre
  `orden_historial_estado` (`db/schema.prisma:1573`). No hace falta índice nuevo.

---

## A) Acceso sin sesión, y lo que NO se toca

- **R1** — MIENTRAS no haya cookie de sesión, el sistema DEBE ofrecer en la landing pública `/` un
  disparador **operativo** de «Rastrear envío» que abra un diálogo modal.
  *Testeable:* renderizada la nav de la landing, el control ya no está deshabilitado y su
  activación monta el diálogo.

- **R2** — CUANDO el destinatario envíe la consulta desde el modal **sin cookie de sesión**, el
  sistema DEBE procesarla y devolver un resultado, y NO DEBE redirigir a `/login` ni exigir
  autenticación.
  *Testeable:* el borde de lectura pública, invocado sin sesión, devuelve un resultado tipado; y una
  petición a `/` sin cookie atraviesa el middleware con `next()`.

- **R3** — El sistema NO DEBE crear ninguna ruta nueva, NO DEBE modificar `PUBLIC_ROUTES`,
  `SELF_AUTH_ROUTES` ni `REDIRECT_TO_ROOT`, y NO DEBE modificar `middleware.ts`.
  *Testeable:* una guardia compara el contenido de las tres listas del middleware contra su valor
  esperado y falla si esta feature las altera; el diff de la feature no incluye `middleware.ts` ni
  `app/**/page.tsx` nuevos.

- **R4** — El sistema DEBE conservar `/paquete/[numGuia]` como ruta **privada**: sin sesión sigue
  redirigiendo a `/`, y su contenido (la etiqueta) NO DEBE hacerse público por esta feature.
  *Testeable:* los tests de middleware de la feature 79 pasan **sin modificarlos**; ningún módulo de
  esta feature importa `obtenerEtiquetaPorGuia`.

- **R5** — MIENTRAS exista cookie de sesión, el sistema DEBE seguir redirigiendo `/` a `/dashboard`;
  **consecuencia aceptada:** el modal de rastreo es inalcanzable para un usuario con sesión abierta.
  *Testeable:* con cookie, el middleware responde 307 a `/dashboard` (test existente, sin cambios);
  la consecuencia queda escrita en `progress/impl_229.md`.

## B) Identificación y no-enumeración

- **R6** — El sistema DEBE exigir **dos** datos para devolver cualquier información de un envío: el
  número de guía **y** los **últimos 4 dígitos del teléfono del destinatario** (decisión G1). NUNCA
  DEBE devolver seguimiento con la guía sola.
  *Testeable:* una consulta con guía válida y sin segundo factor produce error de validación y el
  doble del repositorio no recibe ninguna llamada.

- **R7** — El sistema DEBE responder **de forma IDÉNTICA** en los cuatro casos: (a) la guía no
  existe, (b) la guía existe pero el segundo factor no coincide, (c) la orden está borrada
  lógicamente (`deleted_at` no nulo), (d) el teléfono del destinatario tiene **menos de 4 dígitos** y
  la orden es por tanto **no consultable** (decisión G2). Misma forma de resultado, mismo motivo,
  mismo texto en pantalla. NO DEBE filtrar la existencia de la guía por ningún canal observable del
  resultado.
  *Testeable:* los cuatro escenarios producen resultados **estructuralmente iguales** (comparación
  profunda del objeto devuelto) y el mismo texto renderizado.

- **R8** — El sistema DEBE efectuar **exactamente el mismo trabajo observable** en los cuatro casos
  de R7: no DEBE cortar antes ni emitir menos consultas cuando la guía no existe, de modo que el
  tiempo de respuesta no distinga los casos.
  *Testeable:* con dobles instrumentados, el número de llamadas a datos es el mismo en los cuatro
  casos y ninguna rama retorna antes de completar la comparación del segundo factor.

- **R9** — CUANDO se superen **8 intentos en 10 minutos desde una misma IP** (decisión G3/G4: la
  clave del limitador es **solo la IP**, nunca `ip+guía`), el sistema DEBE rechazar la consulta con
  un motivo propio de «demasiados intentos» y NO DEBE consultar datos, y ese rechazo NO DEBE revelar
  si alguna de las guías intentadas existía.
  *Testeable:* superado el límite, el resultado es el motivo de límite, el doble del repositorio no
  recibe llamadas, y la secuencia de rechazos es la misma con guías existentes y con inexistentes;
  una guardia comprueba que la clave del limitador no incorpora la guía.

- **R10** — El límite de intentos DEBE ser **configurable por variable de entorno** (máximo y
  ventana), con valores por defecto en código, y NO DEBE quedar hardcodeado en el módulo que lo
  aplica.
  *Testeable:* con la variable puesta a un valor distinto, el límite efectivo cambia; sin variable,
  se usa el defecto.

- **R11** — El sistema DEBE normalizar a dígitos el segundo factor **y** el teléfono almacenado
  **antes** de compararlos, de modo que la presentación que el destinatario escriba (separadores,
  espacios, prefijo internacional) no cambie el resultado.
  *Testeable:* las variantes con y sin separadores del mismo dato producen el mismo resultado.

- **R12** — El sistema NO DEBE registrar en logs, mensajes de error ni telemetría el número de
  guía, el segundo factor ni ningún dato del destinatario, y NO DEBE contener `catch` vacíos en los
  módulos de esta feature.
  *Testeable:* guardia sobre los módulos de la feature: sin `console.*` con la entrada, sin
  `catch {}`; los textos de rechazo son literales fijos sin interpolación de la entrada.

- **R13** — El borde público NO DEBE resolver actor ni comprobar rol, y NO DEBE aceptar **ningún**
  parámetro más allá de los dos de identificación (nada de filtros por zona, tienda, mensajero,
  fecha ni paginación): un borde sin sesión con filtros es un oráculo del negocio (precedente
  documentado en `lib/actions/conteos-publicos.ts:19-24`).
  *Testeable:* guardia sobre la firma de la Server Action: su schema zod tiene exactamente los dos
  campos de identificación y el módulo no importa `resolveActorFromSession`.

## C) Qué se muestra: hitos públicos, no estatus internos

- **R14** — CUANDO la consulta identifique correctamente un envío, el sistema DEBE devolver el
  **hito público vigente** MÁS la **línea de tiempo** de hitos **ya ocurridos**, en orden cronológico
  ascendente, cada uno con su fecha. El sistema NO DEBE anunciar hitos **futuros** ni pasos
  pendientes (decisión G10: el flujo puede desviarse a devolución y prometerlo sería mentir).
  *Testeable:* con un historial conocido de N transiciones, el resultado trae la secuencia esperada
  de hitos con sus fechas, el hito vigente coincide con el último de la línea, y la línea no
  contiene ninguna entrada posterior a la última transición registrada.

- **R15** — El sistema NO DEBE emitir hacia el público ningún `order_status.value` interno: todo
  estado DEBE viajar traducido a un hito del vocabulario público.
  *Testeable:* guardia que recorre el resultado de la lectura pública para un historial que
  atraviesa los 20 estatus del catálogo y falla si aparece cualquier value de `ORDER_STATUS_SEED`.

- **R16** — El mapeo estatus interno → hito público DEBE ser **TOTAL sobre el catálogo vigente**, de
  modo que añadir un valor a `ORDER_STATUS_SEED` **rompa la compilación** en vez de producir una
  salida cruda o vacía.
  *Testeable:* guardia de tipos que verifica que el mapa es un `Record<OrderStatusValue, …>`
  completo, más un test que comprueba que los 20 values del seed tienen hito asignado; un value
  añadido de prueba no compila.

- **R17** — SI una fila del historial referencia un estatus **fuera del catálogo vigente** (fila
  huérfana, caso real de la feature 155), ENTONCES el sistema DEBE asignarle un hito neutral por
  defecto y NO DEBE fallar, omitir la fila en silencio ni publicar el value crudo.
  *Testeable:* con una fila cuyo value no está en el seed, el resultado incluye el hito neutral y
  no contiene el value crudo.

- **R18** — CUANDO dos o más transiciones consecutivas del historial correspondan al **mismo** hito
  público, el sistema DEBE colapsarlas en **una sola** entrada de la línea de tiempo, conservando la
  fecha de la **primera** ocurrencia del hito en esa racha (decisión G9).
  *Testeable:* un historial con tres transiciones internas que mapean al mismo hito produce una sola
  entrada, con la fecha de la primera.

- **R19** — Cada entrada de la línea de tiempo DEBE llevar **día y hora** (decisión G12), expresados
  en la zona horaria del negocio resuelta por configuración y **nunca hardcodeada** en el módulo.
  *Testeable:* la fecha emitida incluye la hora y corresponde al calendario del negocio para un
  instante UTC conocido; el módulo no contiene literales de zona ni de país.

- **R20** — El hito vigente devuelto DEBE derivarse del **mismo** historial que la línea de tiempo,
  de modo que no puedan divergir.
  *Testeable:* el hito vigente es siempre igual al último elemento de la línea de tiempo devuelta,
  para cualquier historial de prueba.

- **R21** — El sistema DEBE leer la línea de tiempo con **una sola** consulta a datos, apoyada en el
  índice existente `(orden_id, created_at)`; NO DEBE emitir una consulta por transición.
  *Testeable:* con un doble del repositorio, una consulta pública produce exactamente una llamada de
  lectura de historial.

## D) PII: qué NO ve el anónimo

- **R22** — El DTO público DEBE ser una **lista blanca cerrada de exactamente cuatro campos**
  (decisión G11/G13): `numGuia`, `hitoVigente`, `actualizadoEn` y `linea`, y cada entrada de `linea`
  exactamente `hito` y `fecha`. Cualquier campo no declarado es una fuga, no una mejora.
  *Testeable:* guardia estructural que compara el conjunto exacto de claves del objeto devuelto
  (incluidas las de cada entrada de la línea de tiempo) contra la lista blanca, y falla si sobra
  una.

- **R23** — El sistema NO DEBE emitir hacia el público: nombre del actor de la transición,
  `origen_tipo`, `motivo`, enlace o identificador de gestión, número de intentos de entrega,
  umbral de reintentos, identificadores internos (`orden.id`, ids de usuario, de estatus, de zona),
  dirección, monto a cobrar, producto, notas, teléfono del destinatario ni nombre de la tienda o
  del mensajero.
  *Testeable:* guardia sobre el resultado serializado de una orden poblada con todos esos datos: no
  aparece ninguno de esos valores ni ninguna de esas claves.

- **R24** — El borde público NO DEBE reutilizar `OrdenHistorialService.obtenerHistorial` ni su DTO
  `OrdenHistorialEntradaDTO`: la ramificación por rol y los campos sensibles de ese contrato no
  admiten un modo anónimo.
  *Testeable:* guardia de imports: ningún módulo de esta feature importa `OrdenHistorialService`,
  `IOrdenHistorialService` ni `OrdenHistorialEntradaDTO`.

- **R25** — La consulta a datos de la lectura pública DEBE seleccionar **explícitamente** los
  campos que necesita; NO DEBE traer la fila completa de la orden ni del historial para proyectarla
  después.
  *Testeable:* guardia sobre el módulo del repositorio: su `select` enumera campos y no incluye
  ninguno de los prohibidos por R23.

## E) El modal (forma ya decidida por el humano)

- **R26** — CUANDO el destinatario active el disparador, el sistema DEBE abrir un **diálogo modal**
  con el formulario de consulta, y CUANDO la consulta responda, DEBE pintar el resultado **dentro
  del mismo diálogo**, sin navegar.
  *Testeable:* activado el control, aparece el diálogo con el formulario; enviada la consulta con
  éxito, el resultado se renderiza en el mismo diálogo y la URL no cambia.

- **R27** — MIENTRAS una consulta esté en curso, el sistema DEBE mostrar un estado de carga y NO
  DEBE permitir un reenvío duplicado.
  *Testeable:* durante la promesa pendiente el control de envío está inhabilitado y la acción se
  invoca una sola vez tras dos activaciones seguidas.

- **R28** — SI la consulta es rechazada por cualquier motivo, ENTONCES el sistema DEBE mostrar un
  mensaje **único y no discriminante** y NO DEBE pintar línea de tiempo alguna. El rechazo por
  límite de intentos (R9) es el único que puede llevar un texto propio, y ese texto tampoco DEBE
  mencionar la guía consultada.
  *Testeable:* los tres casos de R7 renderizan el mismo texto; el caso de límite renderiza su texto
  propio sin la guía.

- **R29** — El modal NO DEBE girar con el tema (claro/oscuro) y NO DEBE introducir colores fuera de
  los tokens de marca ya expuestos: se compone con las primitivas existentes
  (`components/ui/dialog.tsx`) y con la paleta de la landing.
  *Testeable:* guardia sobre los archivos nuevos de UI: ningún literal hexadecimal ni `rgb(`, y
  ninguna clase con variante `dark:`.

- **R30** — CUANDO el modal se cierre, el sistema DEBE descartar el resultado; y el resultado NO
  DEBE persistirse en la URL, en el almacenamiento del navegador ni en ningún otro sitio que lo haga
  sobrevivir a una recarga. **Consecuencia aceptada y declarada:** no hay URL enlazable ni
  compartible del seguimiento.
  *Testeable:* cerrado y reabierto el diálogo, el formulario vuelve vacío y sin resultado; una
  guardia comprueba que los módulos de UI de la feature no usan `localStorage`, `sessionStorage`,
  `searchParams` ni `router.push`.

- **R31** — El diálogo DEBE ser operable con teclado y accesible: título anunciado, foco atrapado
  mientras está abierto, cierre con `Esc`, y todo campo del formulario con etiqueta asociada.
  *Testeable:* el diálogo expone un nombre accesible, `Esc` lo cierra y cada campo se localiza por
  su etiqueta.

## F) Frontera, capas y alcance

- **R32** — El sistema DEBE validar la entrada externa en el borde con un validador de esquema y
  DEBE devolver un resultado **tipado y discriminado por estado**, sin filtrar detalles internos ni
  propagar excepciones crudas.
  *Testeable:* entradas mal formadas (guía no numérica, guía negativa, campos vacíos, tipos
  erróneos) producen el resultado de validación; ninguna entrada produce un `throw`.

- **R33** — La lógica de proyección (identificación, comparación del segundo factor, mapeo de hitos,
  colapso) DEBE vivir en una capa de servicio testeable **sin HTTP y sin base de datos**, y el
  acceso a datos DEBE vivir en un repositorio sin lógica de negocio.
  *Testeable:* el servicio se construye con dobles y pasa sus tests sin Prisma ni `next/headers`;
  el repositorio no contiene ninguna decisión de negocio.

- **R34** — El sistema NO DEBE introducir ninguna migración ni cambio de esquema de base de datos.
  *Testeable:* el diff de la feature no añade nada bajo `db/migrations/` y `db/schema.prisma` queda
  idéntico; el guardia de drift de esquema pasa.

- **R35** — El sistema DEBE dejar intacto el QR impreso de la etiqueta: `PAQUETE_BASE_PATH`
  (`lib/utils/paquete-url.ts:11`) y `buildPaqueteUrl` NO se modifican. **Consecuencia aceptada y
  declarada:** quien escanee el QR sin sesión sigue cayendo en la landing por `REDIRECT_TO_ROOT`, y
  desde ahí debe abrir el modal y teclear la guía.
  *Testeable:* los tests existentes de `paquete-url` pasan sin modificarlos y ningún módulo de esta
  feature importa ese módulo; la consecuencia queda escrita en `progress/impl_229.md`.

---

# Decisiones del gate (2026-08-15) — registro, no discusión

**PUERTA PASADA.** El humano firmó las catorce con la respuesta literal **«todo por defecto»**: se
aceptan tal cual las propuestas de este spec, sin excepción. Lo que sigue es el **registro** de esas
decisiones y del porqué de cada una, para que nadie las re-abra en implementación. Las alternativas
que se evaluaron se conservan reducidas a una línea: sirven para no volver a medirlas, no para
reconsiderarlas.

| # | Decisión firmada | Dónde vive |
| --- | --- | --- |
| **G1** | Segundo factor = **últimos 4 dígitos del teléfono del destinatario**. | R6, R11 |
| **G2** | Orden con teléfono de **menos de 4 dígitos → NO consultable**, con la misma respuesta que «no existe». | R7 (caso d) |
| **G3** | Límite de intentos **en memoria por proceso** (`ResetRateLimiter`), con el riesgo aceptado que declara design §5. | R9, R10 |
| **G4** | **8 intentos / 10 minutos**, clave **solo por IP** (nunca `ip+guía`). | R9, R10 |
| **G5** | Vocabulario público de **9 hitos** con los textos propuestos. | R14, R15 |
| **G6** | `recolectando` → **`registrado`**. | R16 (mapa) |
| **G7** | `incidente` → **colapsado en `no_entregado`**, sin hito propio. | R16 (mapa) |
| **G8** | `sin_gestionar` → **`en_reparto`**. **Riesgo aceptado:** oculta al cliente un fallo operativo interno (design §5.bis). | R16 (mapa) |
| **G9** | **Se colapsan** las rachas de hito repetido, conservando la fecha de la primera. | R18 |
| **G10** | **Solo hitos ocurridos**; no se anuncian pasos futuros. | R14 |
| **G11** | DTO público = **lista blanca cerrada de 4 campos**. | R22 |
| **G12** | La fecha de cada hito lleva **día y hora**, en la zona del negocio. | R19 |
| **G13** | El `numGuia` **sí** se devuelve en el resultado (confirmación visual de lo ya tecleado). | R22 |
| **G14** | **Ninguno** de los datos excluidos entra: dirección, monto a cobrar, mensajero, intentos, motivo, tienda, producto ni nombre parcial del destinatario. Es **invariante**, no un defecto revisable. | R23 |

---

## D1 — Identificación y anti-enumeración · FIRMADA

**El problema, medido.** `num_guia` es `Int? @unique` asignado por `nextval` de una secuencia
(`db/schema.prisma:483`, feature 17/R1): es **incremental y contiguo**. Pedirlo a secas convierte el
borde en un iterador de la base de clientes: `for (i = 1; i < N; i++)` devuelve el estado y la
historia de cada envío de la operación. Que la superficie sea un modal **no cambia nada**: la Server
Action es un endpoint POST alcanzable por script igual que una ruta.

### D1.a — El segundo factor: **últimos 4 dígitos del teléfono del destinatario** (G1)

`orden.telefonoDest` es `String` NOT NULL (`db/schema.prisma:487`) y ya existe normalizador puro y
testeado (`normalizarTelefonoCR`, `lib/utils/telefono-cr.ts:8`). **Sin migración.** Cuatro dígitos
son ≈10⁴ combinaciones: el atacante que ya tiene la guía necesita ~5.000 intentos de media, de modo
que **la defensa real es el límite de intentos, no la entropía** — el factor solo hace viable el
límite.

*Descartadas:* nombre del destinatario (texto libre sin normalizar: la comparación difusa lo
convierte en factor débil) y token opaco impreso (correcto en abstracto, pero exige columna nueva,
migración y reimpresión, y deja fuera todo el histórico — la ficha excluye la migración).

**Coste aceptado (G1):** el destinatario debe acordarse de con qué número lo registró la tienda; si
la tienda cargó un número equivocado, **no puede rastrear**.

**G2 — teléfono de menos de 4 dígitos = orden NO consultable**, con la misma respuesta que «no
existe» (R7, caso d). Comparar contra 2 dígitos sería un factor de 100 combinaciones, es decir
ninguno. *Consecuencia dicha en voz alta y aceptada: las órdenes con teléfono mal cargado quedan sin
rastreo público y el destinatario no tiene forma de saber por qué.* T0.4 mide cuántas son.

### D1.b — El límite de intentos: **8 / 10 min por IP, en memoria** (G3, G4)

**Lo que YA hay en el repo** (medido, para no proponer infraestructura nueva):

- `ResetRateLimiter` (`lib/utils/reset-rate-limit.ts:22-43`): ventana deslizante **en memoria del
  proceso**, clave libre, reloj inyectable. Su propio comentario (líneas 1-6) lo declara
  *best-effort por instancia*.
- Su uso como acción pública: `lib/actions/postulacion-mensajero.ts:32-36` (instancia a nivel de
  módulo + clave `ip|dato`), con la IP de `x-forwarded-for` / `x-real-ip` (líneas 38-45).
- Umbrales por entorno con defecto en código: `lib/config/auth.ts:37-51`.
- Tabla durable `login_attempt` con `@@index([ipAddress, createdAt])` (`db/schema.prisma:328-344`),
  pero su `emailUsado` es `String` NOT NULL: meter ahí guías consultadas sería **contaminar la
  tabla de auditoría de autenticación** con eventos que no son logins.
- Caché de contención de Next como respaldo (precedente: `lib/actions/conteos-publicos.ts:29-32`).

**Firmado:** `ResetRateLimiter` con clave `rastreo:<ip>` y umbrales en `lib/config/` por entorno.
**Cero infraestructura nueva, cero migración.** **8 intentos / 10 minutos**, por simetría con
`RESET_MAX_VERIFY_ATTEMPTS = 5 / 10 min` (`lib/config/auth.ts:48-49`), algo más laxo porque aquí el
usuario legítimo puede equivocarse de guía.

**La clave es SOLO la IP (G4), y no es un detalle:** `ip+guía` no frena la enumeración en absoluto,
porque el atacante cambia de guía en cada intento y estrenaría cubo cada vez.

*Descartadas:* tabla nueva de intentos públicos (durable y compartida entre instancias, pero exige
migración, que la ficha excluye) y reutilizar `login_attempt` (sin migración, pero su `emailUsado`
es NOT NULL y habría que meter ahí una guía: contamina la auditoría de autenticación con eventos que
no son logins).

**⚠ RIESGO ACEPTADO (G3), firmado sabiéndolo:** el limitador vive **en memoria del proceso**
(`lib/utils/reset-rate-limit.ts:1-6`). En serverless **cada instancia tiene el suyo**, y un
despliegue los resetea todos: **acota al torpe, no al decidido — no frena a un atacante
distribuido.** Frenarlo de verdad exige un límite persistido y es **ficha aparte**, no un ensanche
de ésta. Desarrollado en design §5.

---

## D2 — Qué se muestra: el mapeo estatus → hito público · FIRMADO

**Lo medido:** el catálogo tiene **20** valores (`ORDER_STATUS_SEED`, `lib/types/order-status.ts:54-79`;
`tests/unit/types/order-status.test.ts:78` afirma `toHaveLength(20)`). La ficha dice 19 porque es
anterior a `recolectando` (feature 157). Publicarlos crudos filtra la operación interna
(`en_bodega_satelite`, `sin_gestionar`, `por_devolver`…) y no le dice nada al destinatario.

**Vocabulario público FIRMADO (9 hitos, G5):**

| Hito | Texto propuesto |
| --- | --- |
| `registrado` | «Envío registrado» |
| `en_bodega` | «En nuestras instalaciones» |
| `en_transito` | «En tránsito» |
| `en_reparto` | «En reparto» |
| `entregado` | «Entregado» |
| `reprogramado` | «Entrega reprogramada» |
| `no_entregado` | «No fue posible entregarlo» |
| `devolucion_en_curso` | «En devolución a la tienda» |
| `devuelto` | «Devuelto a la tienda» |

**Mapeo FIRMADO de los 20 (G5-G8). Es la fuente única: `HITO_POR_ESTATUS` lo copia literal.**

| Estatus interno | Hito | Nota |
| --- | --- | --- |
| `en_preparacion` | `registrado` | |
| `por_recolectar_en_tienda` | `registrado` | aún en la tienda; nadie va todavía |
| `recolectando` | `registrado` | **G6:** el mensajero va en camino a la tienda, pero el paquete **todavía no está con nosotros**; decir «en tránsito» sería adelantar un hecho que no ha ocurrido |
| `por_recoger` | `en_bodega` | tiene guía y mensajero, aún no recogida |
| `en_bodega_central` | `en_bodega` | **colapsa** central y satélite: la geografía interna no es del cliente |
| `en_bodega_satelite` | `en_bodega` | idem |
| `en_ruta_bodega_central` | `en_transito` | |
| `en_ruta_bodega_satelite` | `en_transito` | |
| `en_reparto` | `en_reparto` | |
| `sin_gestionar` | `en_reparto` | **G8 — RIESGO ACEPTADO:** es una `en_reparto` que pasó de día sin gestionar. El cliente ve «En reparto» y **no se entera de que su envío se quedó sin atender**. Es lo normal en un rastreo, pero es una decisión deliberada, no un efecto colateral |
| `entregada` | `entregado` | terminal |
| `reprogramada` | `reprogramado` | |
| `devuelta` | `no_entregado` | visita fallida |
| `rechazada` | `no_entregado` | |
| `incidente` | `no_entregado` | **G7:** colapsado, sin hito propio. Un hito «incidencia» insinuaría daño o pérdida al cliente antes de que la tienda hable con él |
| `por_devolver` | `devolucion_en_curso` | |
| `devolviendo_a_bodega_central` | `devolucion_en_curso` | |
| `por_devolver_a_tienda` | `devolucion_en_curso` | |
| `devolviendo_a_tienda` | `devolucion_en_curso` | |
| `devuelta_a_tienda` | `devuelto` | terminal |
| *(fuera de catálogo)* | `en_proceso` | hito **neutral** para filas huérfanas (R17). No es uno de los 9: es la red de seguridad |

**G9 — se COLAPSAN las rachas de hito repetido (R18).** Con este mapeo, una orden real encadena
varias transiciones internas con el mismo hito. Se colapsan conservando la fecha de la primera.
*Coste aceptado:* se pierde el detalle de que hubo dos paradas distintas en bodega — que es
precisamente geografía interna que el cliente no necesita.

**G10 — solo hitos OCURRIDOS.** No se anuncian pasos futuros: el flujo puede desviarse a devolución
en cualquier momento y prometer un paso que no llegará es peor que no decir nada.

---

## D3 — PII: qué ve exactamente el anónimo · FIRMADA

**Lo medido:** la fila de historial trae `actorUsuarioId`, `origenTipo`, `motivo` y `gestionOrdenId`
(`db/schema.prisma:1550-1571`), y el DTO interno los expone ya resueltos —incluido `actorNombre`—
más `intentos` y `umbral` (`lib/types/orden-historial.ts:163-170`,
`OrdenHistorialService.ts:52-54`). La orden trae `direccion`, `montoCobrar`, `producto`, `notas`,
`telefonoDest`, `mensajeroAsignadoId` (`db/schema.prisma:481-501`). **Nada de eso puede heredarse
por descuido: la lista blanca es el mecanismo (R22), no la buena intención.**

**Lista blanca FIRMADA (G11/G13) — NO a todo lo demás, sin excepciones:**

```
{ numGuia, hitoVigente, actualizadoEn, linea: [{ hito, fecha }] }
```

`numGuia` se devuelve (G13) porque es el dato que el propio consultante acaba de teclear: no revela
nada nuevo y sirve de confirmación visual. `fecha` lleva **día y hora** en la zona del negocio (G12).

**G14 — los excluidos quedan EXCLUIDOS como invariante, no como defecto revisable.** El reviewer lo
trata como fuga si alguno aparece. La columna «argumento a favor» se conserva solo para que nadie
tenga que volver a razonarlo:

| Dato | Firmado | Argumento a favor que se descartó |
| --- | --- | --- |
| Dirección de entrega | **NO** | «confirma que es mi paquete». Pero quien acierta el segundo factor **ya** tiene la dirección: mostrarla solo añade superficie de fuga. |
| Monto a cobrar | **NO** | «el cliente quiere saber cuánto pagar». Es dinero: lo dice la tienda, no un modal anónimo. |
| Nombre del mensajero | **NO** | «saber quién llega». Es PII de un empleado expuesta a un anónimo. |
| Teléfono del mensajero | **NO** | canal de contacto no controlado, y no hay quién lo modere. |
| Número de intentos de entrega | **NO** | delata la operación y alimenta reclamos que el sistema no puede resolver ahí. |
| Motivo de la gestión | **NO** | texto libre escrito por operarios: puede contener cualquier cosa. |
| Nombre de la tienda | **NO** | *(el destinatario ya sabe a quién le compró)* |
| Producto | **NO** | |
| Nombre del destinatario (parcial, tipo «J\*\*\* P\*\*\*») | **NO** | «confirma que es mi paquete» — el segundo factor ya confirma. |
