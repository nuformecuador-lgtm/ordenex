# Sesión activa

> Estado vivo de lo que se está trabajando **ahora**. El leader lo mantiene al día.
> Al cerrar una feature se limpia de aquí y se resume en `history.md`.
>
> **Dónde está el historial completo:** los PRs de GitHub, `progress/impl_*.md` / `review_*.md`
> por feature, y la narrativa de decisiones dentro de cada entrada de `feature_list.json`.
> La bitácora extensa que vivía en este archivo se puede recuperar con
> `git show <rev>:progress/current.md`.

> ### Reconciliado el 2026-07-28 contra `origin/dev` @ `0bcc360`
>
> Verificado PR por PR con `gh pr list` y contra el código, no supuesto. **`feature_list.json`
> declaraba 5 features `in_progress`; solo 1 lo estaba de verdad.** Reconciliadas a `done`:
> **143** (PR #177), **146** (PR #176), **148** (PR #178), **150** (PR #179) — las cuatro mergeadas
> a `dev`. Sus bitácoras se movieron a `history.md` y se podaron ~600 líneas de bloques ya cerrados
> (lote 137–140, 121, 136, 109, 107, 103–106) que seguían aquí pese a estar en `history.md`.

## ⏭️ PENDIENTES — retomar por aquí (cierre del 2026-07-28)

> Inventario COMPLETO de lo que queda abierto, **incluido lo que no depende del agente**. Cada línea
> dice quién la puede cerrar. Verificado contra `gh pr list` y `git rev-list` el 2026-07-28, no supuesto.

### 1. Lo primero que hay que hacer mañana (agente)

> **⚠️ ESTE APARTADO ESTÁ EJECUTADO — sesión del 2026-07-29.** Ver «Sesión 2026-07-29» más abajo
> para el estado real. Se conserva el texto original porque dos de sus afirmaciones resultaron
> FALSAS y conviene que quede el rastro de por qué.

**Arrancar 154 (backend) + 160 (fullstack) en paralelo.** Distinta zona, sin conflicto de archivos, y
su única dependencia —la 153— ya está mergeada. Las dos tienen spec completa y gate aprobado: **no
queda ninguna decisión humana pendiente para implementarlas**. Después 155 y 156; al final 157, 158
y 159. Orden completo y specs en la sección del lote, más abajo.

> **CORRECCIÓN 1 (2026-07-29): «no queda ninguna decisión humana pendiente» era FALSO.** Las dos
> features tenían un bloque `T0` de puerta en su `tasks.md` sin cerrar. Las tres Q bloqueantes de la
> 154 sí estaban respondidas de facto en su ficha y en este archivo, pero **nadie lo había escrito en
> el spec**; y el `ABIERTO` de la 160 estaba **intacto**. Lección: «gate aprobado» en la bitácora no
> es lo mismo que las preguntas del spec respondidas por escrito — al cerrar una fase 1, las
> respuestas se escriben EN el spec, no solo aquí.

⚠️ **154 + 155 + 156 suben a producción JUNTAS o no suben.** Por separado dejan el flujo roto en el
intermedio: ~~la 154 sola deja `generar guía` lanzando `TransicionIlegalError`~~.

> **CORRECCIÓN 2 (2026-07-29): la parte tachada quedó obsoleta con la decisión Q2.** La 154 se
> reestructuró a **SOLO ADITIVA**: no retira ninguna arista, así que **la 154 sola es inofensiva** y
> `generar guía` sigue funcionando con ella mergeada. **El tren sigue siendo obligatorio, pero por la
> 156, no por la 154**: es la 156 la que retira `#4`/`#6`/`#7c`, y sin la 155 detrás el flujo queda
> roto en el intermedio.

### 2. PRs abiertos que NO son de este lote (los cierra el humano)

| PR | Rama | Qué es | Antigüedad |
|---|---|---|---|
| **#168** | `feature/141-tabla-cargas-orden` | Tabla `carga` + `carga_id`. Reviewer APROBADO, 0 bloqueantes. **Es la feature `in_progress` más vieja del tablero.** | abierto desde el 27/07 |
| **#180** | `feature/144-filtros-ordenes` | Componente de filtros parametrizable. **Trae su propia reconciliación** del registro y una migración de índices. 64 archivos. | 28/07 |
| **#183** | `feature/log-fallos-whatsapp` | Porta a `dev` el hotfix de WhatsApp que ya está en `prod`. ⚠️ **No mergear tal cual** — ver punto 3. | 28/07 |

### 3. Infra y despliegue (humano)

- ⚠️ **`dev` y `prod` DIVERGEN EN AMBOS SENTIDOS.** Medido: `origin/dev...origin/prod` → **16 / 18**.
  `prod` tiene 18 commits del hotfix de WhatsApp que `dev` no tiene, y `dev` tiene los 16 de hoy que
  `prod` no tiene. Ya no es «`dev` va atrasado»: son dos ramas separadas y hay que reunirlas.
- **Antes de mergear el PR #183**, dos cosas que el propio PR arrastra:
  1. `lib/actions/_tmp-probar-jobs.ts` y `lib/actions/_tmp-sincronizar-plantillas.ts` — dos Server
     Actions de depuración que **hoy están en PRODUCCIÓN** y también en la rama del PR. El commit
     `f950f14` decía haberlas sacado; **no las sacó** (verificado con `git ls-tree` sobre
     `origin/prod` y sobre la rama).
  2. La migración `20260728230000_chat_mensaje_error_meta` **no tiene `down.sql`**, contra la regla
     del repo.
- **Migración `20260727120000_notificacion` (feature 146):** está en `dev`, **no aplicada a
  producción**. Con `scripts/migrate-deploy.ts` se aplica sola en el próximo deploy a `prod`;
  verificar que corrió.
- **La base LOCAL quedó al día** con las migraciones de la 146 y la 153 (`prisma migrate deploy`
  contra `localhost` el 28/07). **Producción no se tocó en ningún momento.**

### 4. Decisiones de producto sin dueño (humano)

- **Retirar la página `/qr`.** Trabajo declarado por el humano al cancelar la feature 66 («las
  lecturas de QR se hacen desde un botón»). **No está registrado como feature todavía** — candidato
  al próximo lote. Toca `app/(app)/qr/`, `lib/auth/menu-visibility.ts` y lo que dependa de
  `useQrNavigate`; verificar antes que `QrScanner`/`useQrNavigate` no queden huérfanos (el botón de
  recepción los reusa).
- **Quién entrega la búsqueda global.** Al redefinirse la 144, la búsqueda global **quedó huérfana**:
  la ficha de la **145** la da por hecha y ninguna feature la entrega. Hay que decidirlo **antes** de
  especificar la 145.
- **Revalidar la feature 149** («deshacer asignación antes de la recogida») contra el flujo v2:
  deshacer devuelve la orden a su bodega, no a `en_preparacion`.

### 5. Deuda que dejó el lote de hoy — declarada, no disfrazada

- **T6.3 de la 153 quedó en `[ ]` a propósito.** Playwright no se ejecutó porque **no hay harness de
  E2E** en el repo. En `e2e/` el cambio fue solo de comentarios; marcar la casilla habría sido fingir
  una verificación que nadie hizo.
- **Mutante superviviente:** `ESTATUS_EN_REPARTO` en `OrdenRepository` — desalinearlo pasa la suite
  completa porque su único consumidor (`findParadasEnReparto`) está siempre mockeado. Hueco
  **preexistente en `dev`**, no introducido por la 153.
- **Menores del review de la 153, sin cerrar:** la `ALLOWLIST` del guard de censo **no está asertada**
  (inflarla con archivos de producción deja el guard verde), y el spec dice 7 basenames cuando son 8.
- **`db/schema.prisma:353`** sigue diciendo «8 valores» dos líneas encima del «18» que sí se corrigió.
  El gate autorizó solo la línea 356 y el implementador no amplió por su cuenta. Correcto, pero queda.
- **Follow-ups que las specs dejaron explícitos:** la **158** no acredita la indemnización al ledger
  por tienda (feature 43), fuera de alcance a propósito; y la **159** deja `OrdenesCargaResumenPaso.tsx`
  huérfano sin borrar, porque de ese contenedor cuelga el botón de manifiesto de la 148.
- **Contrato externo roto SIN aviso dos veces en una semana** (feature 135 el 24/07 y feature 153 el
  28/07): `api-key-openapi.yaml` sigue en `info.version: 1.0.0` y no hay changelog. Fue **decisión
  explícita del humano** las dos veces, pero si algún integrador compara contra el value, ya se le
  rompió dos veces.

### 6. Deudas de arnés vivas (ya estaban antes de hoy)

Detalle en la sección «Deudas de arnés vivas». Las que más cuestan hoy:

- **Los guards que recorren el árbol usan `fs.readdir`, no `git ls-files`** → se disparan con
  documentación y con basura local. Rompieron el gate **dos veces hoy**: con los restos sin trackear
  y con los archivos de spec que citan el guard por su nombre.
- **No hay harness de E2E.** Los `e2e/*.spec.ts` usan emails placeholder y no corren en ningún gate.
  Ya dejó pasar 3 specs rotas en la feature 148 y bloquea T6.3 de todo este lote.
- Sin regla `no-console` (el OTP sigue en logs, feature 80) · `zonas-migration.test.ts` con denylist a
  mano · fakes de repositorio duplicados · `ordenes-columns.tsx` como imán de drift.

### 7. Backlog no tocado

**24 features `pending` sueltas + 15 de analítica**, ninguna empezada. Tabla auditada contra el código
en la sección «Backlog pendiente».

---

## 🗓️ Sesión 2026-07-29 — estado en vivo

> Reemplaza al apartado «PENDIENTES» de arriba en todo lo que se contradiga. Lo verificado hoy va
> con su número; lo no verificado se dice.

**Arranque:** `./init.sh` **verde** sobre `dev` @ `0ed3125` (543 archivos / 5655 tests, lint 0
errores). El `typecheck` rojo que aparece al estrenar un worktree es **cliente Prisma stale**, no
`dev`: se salda con `pnpm db:generate`. Vale la pena recordarlo antes de diagnosticar nada.

| # | Zona | Estado al momento de escribir | Rama |
|---|------|-------------------------------|------|
| 154 | backend | ✅ **reviewer APROBADO-CON-NOTAS, 0 bloqueantes** | `feature/154-catalogo-estados-v2` |
| 156 | fullstack | backend en implementación | `feature/156-guia-sin-mensajero` |
| 160 | fullstack | backend en implementación | `feature/160-columna-intentos` |

**154 — catálogo v2.** `./init.sh` verde: **547 archivos / 5735 tests**, `tests/integration/db`
67 archivos / 614 tests. Catálogo 18→20, enum de familias 22→24, `incidente` TERMINAL sin salidas,
2 migraciones con su `down.sql`, cero services/actions/repos tocados, único `.tsx` de producción
`EstatusBadge.tsx`. **El reviewer verificó los 33 R por MUTACIÓN** (28 mutaciones: 26 muertas, 2
supervivientes que eran los controles) en vez de fiarse del mapa, y confirmó que la guardia sigue
fallando **CERRADO** matando las dos formas de reabrir el hueco de la feature 140. Detalle en
`progress/impl_154.md` y `progress/review_154.md`.

**Nota de release del tren (T5.6, copiada de `impl_154.md` §7):** 154 + 155 + 156 viajan **juntas**
a `prod`. El riesgo hoy es bajo porque **la 154 es solo aditiva y por sí sola no abre ninguna
ventana de rotura**; el acoplamiento lo aportan la 155/156, que sí retiran aristas y tienen que
llegar junto al recableado de `GuiaAsignacionService`. **Efecto visible aceptado:** la Server Action
`listarOrderStatus` pasa a devolver **20** filas en vez de 18, así que los dos estados nuevos
aparecen en el desplegable de filtro **sin resultados** hasta la 155/157.

**⚠️ Deuda del tren, sin saldar: el round-trip real de migraciones contra Postgres NO EXISTE.** Ni
el implementador ni el reviewer lo hicieron; los cuatro `.sql` están leídos y asertados por regex,
nunca ejecutados. Es la misma deuda de 137/138/139. **Se salda antes de que el tren suba a `prod`.**

**⚠️ `catalogoCache` nunca se invalida** y la 154 es la primera que hace **crecer** `order_status`
en caliente → el orden migrar-antes-de-desplegar importa, y volverá a importar en la 157/158.

**Decisiones del humano cerradas hoy (además de las de cada ficha):**
- **`incidente` queda TERMINAL.** En chat se planteó un estado `indemnizada` que lo desterminara y
  **se descartó**: no existe, no se declara, no se deja preparado.
- **Feature 160 — el intento cuenta `devuelta` Y `reprogramada`**, y el criterio **gobierna también
  el escalado automático** del cron SLA y, por esa vía, `cobroRechazado`. Se le planteó la
  consecuencia (se rechaza y se cobra antes) y la reafirmó: su lectura es que el cron **ya debía**
  contar así. Matiz verificado contra el mapa que el spec no había visto: solo cuenta la
  reprogramación **del mensajero** (`#13`, vía `gestion`); la **de la tienda** (`#22`, vía
  `reprogramacion_tienda`) se excluye porque la fila `devuelta` de esa orden ya contó el intento.
- **La retroactividad se resolvió MIDIENDO, no suponiendo.** Consulta de solo lectura contra
  **producción** el 2026-07-29: **0 órdenes** saltarían el umbral con el criterio nuevo (2 en
  `devuelta`, 8 con conteo distinto sin cruzar umbral, 10 filas `reprogramada`+`gestion`, **167
  filas de historial en toda la base**). Va sin mitigación. **La consulta se re-corre justo antes
  del despliegue y lo DETIENE si da > 0** (task T24.1 del spec).
- **El dato de intentos NO es un chip: es una columna** propia tras `estatus` en las tablas, y
  **dato etiquetado «Intentos: N»** fuera de ellas. El **0 siempre se muestra**.
- **Derogados R2/R11 de la feature 148** («exactamente 11 columnas» del manifiesto). Corrección del
  humano: esos requisitos no significan un número fijo sino que **el manifiesto lleva los datos de
  su tabla**, y el conjunto **crece** cuando la orden gana un dato. Reescritos como conjunto
  ABIERTO; ni código ni tests pueden volver a afirmar «exactamente N columnas».

**🔎 Hallazgo del día — la feature 159 se mergeó SIN REGISTRO.** El **PR #193** entró a `dev` el
2026-07-29 a las 07:00 (`refactor(159): retira el flujo del mensajero sugerido`) con código,
migración `20260728120000_drop_orden_mensajero_sugerido` (con su `down.sql`) y un guard nuevo. Pero
**su ficha sigue `spec_ready`, sin `branch`, con las 29 tareas de `tasks.md` sin marcar y sin
`impl_159` ni `review_159`**. Nadie ha verificado si cubre sus R1–R22. Además entró **fuera de
orden**: su `depends_on` es la 156, que aún no existe. **Pendiente: pasarle el `reviewer` antes de
darla por `done`.**

**Límite nuevo declarado (160):** la columna de intentos es un dato derivado y **no es ordenable ni
filtrable server-side** — el `ORDER BY` usa lista blanca de columnas reales. Queda elevado a las
features 144/151, no resuelto a escondidas.

## Features en curso

**Tabla `carga` + `carga_id` en orden — feature 141 → `in_progress`, `PR #168` ABIERTO.** Backend,
`medium`, `depends_on: null`. Rama `origin/feature/141-tabla-cargas-orden`. Su **spec sí está en `dev`**
(`specs/141-tabla-cargas-orden/`, R1–R30), pero **su código y su migración NO**:
`20260727120000_carga_orden_carga_id` vive solo en la rama. Reviewer APROBADO-CON-NOTAS, 0 bloqueantes.
Es la feature `in_progress` más vieja del tablero — el PR lleva abierto desde el 2026-07-27.

**Componente de filtros parametrizable + su cableado en órdenes — feature 144 → `PR #180` ABIERTO.**
⚠️ **En `dev` la ficha figura `pending` A PROPÓSITO.** El humano **redefinió** la feature el 2026-07-28
(antes era «DataTable: búsqueda y filtros», frontend/low; ahora es un componente de filtros genérico +
su implementación en órdenes, fullstack/high) y esa redefinición, su `spec_path`, su `branch`, su
estado `in_progress` y su spec (`specs/144-filtros-ordenes/`, R1–R51) **viajan dentro del PR #180**, no
están en `dev`. Marcarla `in_progress` aquí pondría `./init.sh` en rojo por la regla 4 (toda feature en
vuelo necesita spec en disco). Se reconcilia sola al mergear el PR. El PR trae además una migración de
índices (`20260728120000_orden_indices_filtros`) y toca 64 archivos.

> **Nadie debe tomar el id 144 ni su alcance viejo sin leer el PR #180.** La ficha de `dev` lleva la
> advertencia escrita en su `description`.

## ⚠️ `dev` está 18 commits DETRÁS de `prod`

`git rev-list --left-right --count origin/dev...origin/prod` → `0  18`. Los arreglos del **log de
fallos de WhatsApp** (fin de los reintentos infinitos) se mergearon **directo a `prod`** en los PRs
**#182, #184 y #185**, y el PR que los porta a `dev` (**#183**, misma rama
`feature/log-fallos-whatsapp`, MERGEABLE) **sigue abierto**.

Es **la misma trampa registrada el 2026-07-27** con el fix del pooler: un hotfix ramificado desde
`origin/prod` que no se porta a `dev` el mismo día deja `prod` sano mientras todo lo que sale de `dev`
arrastra el bug.

**Registrado retroactivamente como feature 152 (`done`, `sdd: false`)** — no como bookkeeping vacío:
trae migración (`20260728230000_chat_mensaje_error_meta`), un desenlace nuevo (`permanente`) y una
**lista blanca de códigos reintentables** en `lib/services/whatsapp/errores-meta.ts`. Sin eso en el
registro, el próximo que toque WhatsApp la duplica. Detalle y deudas en `history.md`.

> ### ⚠️ Dos cosas que revisar ANTES de mergear el PR #183
>
> 1. **La migración `20260728230000_chat_mensaje_error_meta` no tiene `down.sql`** — contra la regla
>    del repo (`./init.sh` avisa de migraciones sin `down.sql`).
> 2. **`prod` y la rama del PR llevan dos Server Actions de depuración en producción:**
>    `lib/actions/_tmp-probar-jobs.ts` y `lib/actions/_tmp-sincronizar-plantillas.ts`. El commit
>    `f950f14` decía sacarlas de la rama, pero **siguen ahí** (verificado con `git ls-tree` sobre
>    `origin/prod` y sobre `origin/feature/log-fallos-whatsapp`). Mergear el #183 tal cual las mete
>    también en `dev`.

## Lote 153–160 — flujo de estados v2 · **EN CURSO (1/8 mergeada)**

> ### Estado al cerrar el 2026-07-28
>
> **Fase 1 COMPLETA para las 8** (7314 líneas de spec, PR #189) con el **gate F1.4 APROBADO** y sus
> decisiones escritas en cada ficha. **153 `done`** (PR #190). Las otras 7 quedan en `spec_ready`,
> listas para implementar sin ninguna decisión pendiente.
>
> **Retomar por aquí:** **154 (backend) + 160 (fullstack) en paralelo** — distinta zona, sin
> conflicto de archivos, y ninguna depende de nada más que de la 153, ya mergeada. Después 155 y
> 156; al final 157, 158 y 159.
>
> ⚠️ **154 + 155 + 156 tienen que ir a producción en la MISMA entrega.** Por separado cada una deja
> el flujo roto en el intermedio: la 154 sola dejaría `generar guía` lanzando `TransicionIlegalError`.

Ocho features pedidas por el humano a partir de un diagrama del flujo nuevo + cuatro pedidos sueltos.
Boceto aprobado en chat antes de escribir.

**Lo que realmente cambia del catálogo:** de los 18 estados de hoy, **14 se mantienen tal cual**.
Entran `por_recolectar_en_tienda` e `incidente`, `en_ruta` se renombra a `en_reparto` y
`en_fulfillment` se retira. **El cambio de fondo no son los estados sino las aristas:** hoy
`en_preparacion`/`en_fulfillment` pueden ir directo a `por_recoger` y a `en_ruta_bodega_satelite` al
generar la guía (aristas #1–#6 del mapa de la feature 140); en el flujo v2 esas se retiran — generar
guía solo lleva a `en_bodega_central`, y **las asignaciones salen siempre de una bodega**.

| # | Feature | Zona | Cplx | Depende | Estado | Spec |
|---|---------|------|------|---------|--------|------|
| 153 | `en_ruta` → `en_reparto` (rename mecánico, 94 archivos) | backend | medium | — | ✅ **`done`** (PR #190) | R1–R21 |
| 154 | catálogo v2: `por_recolectar_en_tienda` + `incidente` + grafo nuevo | backend | high | 153 ✔ | `spec_ready` | R1–R31 |
| 155 | creación bifurcada por bodega + retiro de `en_fulfillment` | backend | high | 154 | `spec_ready` | R1–R43 |
| 156 | generar guía sin asignar mensajero | fullstack | medium | 154 | `spec_ready` | R1–R30 |
| 157 | recolección en tienda por el mensajero (QR) | fullstack | high | 155 | `spec_ready` | R1–R40 |
| 158 | estado `incidente` + indemnización desde la wallet | fullstack | high | 154 | `spec_ready` | R1–R36 |
| 159 | quitar la sugerencia de mensajeros de la carga masiva | fullstack | medium | 156 | `spec_ready` | R1–R22 |
| 160 | badge de intentos de entrega | fullstack | low | — | `spec_ready` | R1–R16 |

**Restructuración del corte, decidida al revisar las specs y ya escrita en las fichas:** la **154 es
SOLO ADITIVA**. Retirar aristas ahí haría que generar guía lanzara `TransicionIlegalError` entre su
merge y el de la 156, y dejaría `en_fulfillment` sin salidas siendo aún estado de nacimiento —
órdenes vivas atrapadas con el guard fallando cerrado. Cada retiro se muda a la feature que cambia el
servicio que lo ejecuta: `#4/#6/#7c` → **156**, `#1/#2/#3/#7b` → **155**. Y `#5`
(`en_preparacion → en_bodega_central`) **sobrevive**: es el destino único de generar guía.

**Decisiones del humano ya cerradas (valen como parte de la gate F1.4 de cada spec):** `en_fulfillment`
**se retira** (no aparece en el flujo nuevo; las órdenes que ya están en bodega nacen en
`en_preparacion`); **`en_ruta` → `en_reparto` es el ÚNICO rename** — «En ruta a bodega satélite» no
pasa a «Por recibir en satélite» pese a que el diagrama lo dibuje así, y los participios femeninos
(Entregada/Devuelta/Reprogramada/Rechazada/Sin gestionar) se conservan.

**Los tres `ABIERTO` que bloqueaban el diseño se CERRARON el 2026-07-28**, antes de especificar, para
no escribir tres specs sobre supuestos:

- **155 — «¿ya está en bodega?» sale del interruptor de fulfillment de la TIENDA**, no de la orden ni
  de la vía de carga. **Y ese flag ya existe:** `Usuario.fulfillment` (`db/schema.prisma:97`, feature
  27) con su switch ya montado en `UsuarioForm.tsx:55,70`. → **sin migración y sin UI nueva**; la
  feature se reduce a recablear a qué estado mapea (`true` → `en_preparacion` sin guía; `false` →
  guía + manifiesto en el acto y nace en `por_recolectar_en_tienda`). ⚠️ No confundir con el **otro**
  `fulfillment` del repo: el de `tarifas` (`schema.prisma:760`) es un **monto**, no este flag.
- **157 — las órdenes por recolectar SE LE ASIGNAN** al mensajero con el mecanismo que ya existe
  (`mensajero_asignado_id` + `mis-asignaciones`): sin bolsa libre y sin modelo de lote nuevo. **Pero el
  humano añadió la condición que es el corazón de la feature: «el módulo de gestión debe cambiar cuando
  es este caso».** Una recolección no es una entrega — no hay cobro, ni resultado de gestión, ni causa
  de devolución, ni evidencia: la acción es **una sola**, escanear y confirmar. Eso obliga a un panel
  propio de recolección en vez de `GestionarOrdenPanel`.
- **158 — el monto de la indemnización lo captura el admin a mano** al aprobar el cierre. Descartados
  `monto_cobrar` (una orden ya pagada lo tiene en 0 y quedaría sin indemnizar) y la columna de valor
  declarado (habría obligado a tocar la plantilla de carga masiva v2 recién hecha y el contrato público
  de la API).

**Peajes conocidos:** la 154 y la 158 tocan **enums de Postgres** (`orden_historial_origen_tipo`,
`WalletMovimientoCategoria`), así que además del `ALTER TYPE ADD VALUE` hay que **actualizar los
`down.sql` previos** que recrean el tipo — no existe `DROP VALUE` — y correr `tests/integration/db`.
La 159 toca el **contrato público de integradores** (`mensajero_sugerido_id` viaja en el payload de la
carga por API key y está documentado en `openapi-spec.ts`).

**Lo que NO se duplicó:** el pedido «que las bodegas puedan filtrar solo las órdenes asignables» ya
estaba registrado como **feature 147**. Se actualizó en vez de crear una novena: su `ABIERTO` sobre qué
estados cuentan como asignable **queda cerrado** por este flujo (`en_bodega_central` y
`en_bodega_satelite`, y solo esos), y pasa a `depends_on: 154`.

**Pendiente de revisar:** la **149** («deshacer asignación antes de la recogida») queda tocada por el
flujo v2 — deshacer devuelve la orden a su bodega, no a `en_preparacion`. Se actualiza cuando le toque,
no ahora.

## Backlog pendiente

> **Auditado contra el código de `dev` el 2026-07-28** (la auditoría previa es del 2026-07-26). Cada
> fila se verificó abriendo el archivo, no por la ficha. **24 pendientes sueltas + 15 de analítica +
> las 8 del lote 153–160** (arriba, con su propia tabla).

| # | Feature | Zona | Estado real verificado |
|---|---------|------|------------------------|
| 70 | regla de selección de tarifa vigente | backend | Sin empezar. El `TODO:` sigue vivo en `TarifaVigentePorTiendaRepository.ts:50-62` y el `WHERE` **no filtra `status`** (líneas 70 y 89 lo dicen explícito). ⚠️ Requiere gate humano: es dinero. |
| 71 | bloquear checkbox de órdenes con cierre sin resolver | fullstack | Sin empezar. `OrdenesApartado.tsx` no tiene `disabled` en el checkbox de fila (solo en los botones de acción masiva) ni existe `puedeAsignarse`/`motivoBloqueo` en el DTO. |
| 74 | explotar la causa de devolución | fullstack | **Alcance reducido: la mitad ya está.** El módulo de novedades **ya muestra** la causa (`NovedadesModule.tsx` con `CAUSA_DEVOLUCION_LABEL` y `null` → «Sin causa registrada»). Falta la causa en la línea de tiempo de `HistorialOrdenSheet.tsx` (no la menciona) y el **agregado** «devoluciones por causa». |
| 80 | proveedor de correo real + sacar el OTP de los logs | backend | Sin empezar. `console.log("Codigo OTP generado:", code)` sigue en `OtpChallengeIssuer.ts:39` y **no hay ningún proveedor de correo en `package.json`** → ningún email sale hoy en producción. |
| 85 | wallet - periodicidad de gastos fijos (frontend) | frontend | **Backend hecho** (feature 84: enum `PeriodicidadUnidad` + `periodicidadCantidad`, `lib/utils/periodicidad.ts`). El **hueco (A) del sidebar ya está cerrado** (`menu-visibility.ts` lista `/wallet` con sus 3 subitems). Falta **solo la UI de periodicidad**: `GastoFijoPlantillaDialog.tsx`, `GastosFijosPlantillasPanel.tsx` y `wallet-labels.ts` no la mencionan en ninguna línea. |
| 144 | componente de filtros parametrizable | fullstack | **En vuelo fuera de `dev`** — ver «Features en curso». Cuenta como pendiente solo en el registro de `dev`. |
| 145 | rollout de filtros a todas las tablas | fullstack | Sin empezar. ⚠️ **Revalidar tras la redefinición de la 144:** la búsqueda global salió del alcance de la 144 y **no tiene feature dueña**; el export vive en la 151. |
| 147 | filtro por bodega de las órdenes asignables | fullstack | Sin empezar, sin rama. |
| 149 | deshacer asignación antes de la recogida | fullstack | Sin empezar, sin rama. ⚠️ Debe **declarar las aristas inversas** en el mapa de la guardia central (feature 140) o `appendCambioEstado` lanza `TransicionIlegalError`. |
| 151 | export a Excel server-side del dataset filtrado | backend | Sin empezar, sin rama. `depends_on: 144`. |
| 135 + 122–134 | **analítica** (15 encadenadas) | backend/frontend | Sin empezar, confirmado: **no existe `lib/analytics/` ni `app/(app)/analitica/`**, ni migración `analytics_daily`, ni servicios. Cadena de `depends_on` coherente (135 es el catálogo; 122/123 cuelgan de él). |

**Canceladas (5):** 35 (estados en tiempo real), 60 (campana — la reemplazó la 146), 62 (orden flete),
68 (bug de tarifa por zona) y **66 (`qr - detalle`, cancelada el 2026-07-28)**.

## Deudas de arnés vivas

- **✅ RESUELTO el 2026-07-28 (esta reconciliación): el lint recorría los worktrees de agentes.**
  `pnpm lint` entraba en `.claude/worktrees/` — **25 copias completas del repo** — y un
  `no-explicit-any` de la rama `fe-116` (`agent-a3bc914c5303a4e32/lib/clients/whatsapp-cloud.ts:359`)
  ponía el lint en rojo en `dev` **sin que `dev` tuviera nada mal**. Además inflaba la corrida a ~3.500
  warnings y >7 minutos. Arreglado con `".claude/**"` en `globalIgnores` de `eslint.config.mjs` y
  `/.claude/worktrees/` en `.gitignore` (estaban **untracked pero no ignorados**: un `git add -A`
  habría commiteado los 25 árboles). Precedente: el guard `no-embalaje.test.ts` ya ignoraba `.claude`
  por esta misma razón — el lint se quedó atrás.
- **Los guards que recorren el árbol fallan por archivos SIN TRACKEAR.** Medido el 2026-07-28: `pnpm
  test` daba **2 fallos de 5681** y **ninguno era de `dev`** — los dos los provocaban restos locales sin
  commitear. (1) `no-embalaje.test.ts` caía por `specs/135-order-status-rename-nomenclatura/`, copia
  pre-renumerado de la que sí está trackeada como `specs/137-*` (la whitelist del guard apunta a la
  137). (2) `censo-order-status-rename.test.ts` caía por `scripts/seed-ordenes-qa.ts`, que usa los
  values viejos de `order_status` (`en_bodega`, `en_preparacion`…). **Los 5 restos se borraron el
  2026-07-28 con el visto bueno del humano** y la suite volvió a verde. **La deuda de fondo sigue:**
  estos guards no distinguen archivo trackeado de basura local, así que cualquier borrador en el árbol
  pone el gate en rojo y ese rojo se lee como «`dev` está roto». Arreglo natural: que recorran
  `git ls-files` en vez de `fs.readdir`.
- **Los E2E no corren en `pnpm test` ni en `./init.sh`.** Lo demostró la 148: el diferimiento de
  `onSuccess()` rompió 3 specs de Playwright y **no salió en rojo en ningún gate**; el reviewer solo vio
  1 de los 3 por lectura. Sigue sin haber harness de E2E (seed + login por rol) y los `e2e/*.spec.ts`
  usan emails placeholder. Candidato a feature propia.
- **No hay regla `no-console` en el lint** → hay `console.*` en producción. El de `OtpChallengeIssuer`
  es un **secreto en logs**; lo cubre la feature 80. Instalar `no-console` con allowlist.
- **`zonas-migration.test.ts` usa una denylist de migraciones apendida a mano** → se pone rojo con cada
  migración nueva (ya rompió ≥3 veces). Patrón frágil: un test que lista archivos del repo en vez de
  leer código.
- **Fakes de repositorio a mano y duplicados** (`IUserRepository` triplicado, `IOrdenRepository` con
  ~30 métodos listados a mano) → cada método nuevo del contrato rompe N archivos de test. La 146 pagó
  ese peaje tocando **5 suites ajenas** solo para agregar stubs. Un builder en `tests/helpers/` lo
  mataría de raíz.
- **`app/(app)/ordenes/_components/ordenes-columns.tsx` es un imán de drift** (ya lo revirtieron 2
  veces) → mirarlo con lupa en todo PR que lo toque.
- **Migraciones sin round-trip real:** los `down.sql` de las últimas features (141, 146) se revisaron
  **por lectura**, sin aplicar y revertir contra una base. Ahora que preview tiene base propia, ese
  round-trip por fin es posible.

## Tareas humanas pendientes

- **Portar el hotfix de WhatsApp a `dev`** — mergear el PR #183, **pero antes** sacar los dos
  `lib/actions/_tmp-*.ts` y escribir el `down.sql` que falta (ver el aviso de la sección `dev` vs
  `prod`). Es lo único que hoy separa a los dos.
- **La base local ya tiene la migración de la 153 aplicada** (`20260728120000_order_status_en_reparto`),
  incluida la de la 146 que estaba pendiente. Se aplicaron con `prisma migrate deploy` contra
  `localhost` el 2026-07-28 al cerrar el round-trip. **No se tocó producción.**
- **Retirar la página `/qr`** — trabajo declarado por el humano al cancelar la 66 (las lecturas de QR se
  hacen desde un botón en el punto de uso). Toca `app/(app)/qr/`, `lib/auth/menu-visibility.ts` y lo que
  dependa de `useQrNavigate`; hay que verificar primero que `QrScanner`/`useQrNavigate` no queden
  huérfanos (el botón de recepción los reusa). **Sin registrar todavía como feature** — candidata al
  próximo lote.
- **Decidir quién entrega la búsqueda global** antes de especificar la 145 (quedó huérfana al
  redefinirse la 144).
- **Proveedor de correo real** — hoy `StubEmailProvider` solo hace `console.info`; **ningún email sale**
  y el OTP se lee de los logs del servidor. Lo salda la feature 80 (`pending`).
- **Migración `20260727120000_notificacion` (feature 146)** — está en `dev` pero **no se aplicó a
  producción desde el agente**. Con el build actual (`scripts/migrate-deploy.ts`, PR #173) se aplica
  sola en el deploy a `prod`; verificar que corrió tras el próximo `dev → prod`.

> **Buckets de Storage:** `gestion-evidencias`, `mensajero-docs` y `etiquetas-guia` **existen y son
> privados** en el proyecto `ordenex-db` (los dos primeros verificados vía MCP el 2026-07-25; el
> tercero creado y cerrado en el PR #166). No queda bloqueo de infra de Storage.

> **Migraciones y entornos (registro del 2026-07-27):** el `build` ya no corre `prisma migrate deploy`
> en todos los entornos — pasa por `scripts/migrate-deploy.ts`, que **solo migra en producción**, y en
> preview únicamente con `MIGRATE_ON_PREVIEW=true`. Preview tiene **base Supabase propia**, así que
> abrir un PR ya no migra producción. Al tocar env vars en Vercel: separar por entorno, nunca una misma
> variable en Production **y** Preview a la vez.

## Notas de proceso (vigentes)

- Todos los subagentes corren con `model: opus` (decisión del humano 2026-07-09), ignorando la
  gradación por complexity.
- **Workaround del bug opus-4.8[1m]:** orquestar directo (`spec_author` → `backend_dev`/`frontend_dev`
  → `reviewer`) en vez del `implementer` monolítico, pasando `model: opus` explícito; el `implementer`
  muere en el 1er intento.
- Ramas desde `origin/dev`, PRs hacia `dev`. Cuando el árbol de trabajo arrastra WIP ajeno se usa un
  worktree aislado desde `origin/dev` para evitar el drift de sesiones paralelas.
- **Producción sale de `prod`, no de `dev`.** Los hotfixes se ramifican desde `origin/prod` y hay que
  portarlos a `dev` **el mismo día**, o `prod` se ve sano mientras todo lo demás arde (ya pasó dos veces:
  pooler el 2026-07-27, log de WhatsApp el 2026-07-28).
