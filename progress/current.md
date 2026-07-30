# Sesión activa

> Estado vivo de lo que se está trabajando **ahora**. El leader lo mantiene al día.
> Al cerrar una feature se limpia de aquí y se resume en `history.md`.
>
> **Dónde está el historial completo:** los PRs de GitHub, `progress/impl_*.md` / `review_*.md`
> por feature, y la narrativa de decisiones dentro de cada entrada de `feature_list.json`.
> La bitácora extensa que vivía en este archivo se puede recuperar con
> `git show <rev>:progress/current.md`.

## 🗓️ Sesión 2026-07-30 (tarde) — **EMPIEZA A LEER POR AQUÍ**

> Lo de más abajo sigue válido en su detalle técnico; esto lo corrige donde se contradiga.

### Tres correcciones al «cierre del día» de esta misma mañana

1. **✅ El pendiente #1 ya estaba saldado.** `prisma migrate status` contra `localhost:5432`:
   **95/95, «Database schema is up to date!»**. Las dos migraciones que el cierre daba por pendientes
   (`chat_mensaje_error_meta` y `orden_historial_origen_deshacer_asignacion`) ya están aplicadas.
2. **PR #207 está listo:** `MERGEABLE` / `mergeStateStatus: CLEAN`, Vercel **SUCCESS**, 10 archivos
   (+176/−177). Sólo falta el merge (humano). **Conviene mergearlo ANTES de implementar la 158:** la
   158 trae migración, y sin el #207 paga el peaje de la denylist.
3. **⚠️ PR #168 (feature 141) YA NO es mergeable:** pasó a `CONFLICTING` / `DIRTY` (43 archivos). El
   cierre lo daba por «MERGEABLE con gate verde» — cierto antes de los merges de ayer. Ahora necesita
   **rebase** además del re-review que ya se sabía pendiente. Sigue siendo la `in_progress` más vieja
   (27/07) y la única de la zona backend.

### 🚪 Puerta F1.4 de la feature 158 — **CERRADA hoy**, 10 decisiones

> Se escriben aquí Y en el spec. Es la lección de la «CORRECCIÓN 1» de más abajo: gate aprobado en la
> bitácora no es lo mismo que preguntas del spec respondidas por escrito.

- **Q-A = LOS DOS reportan.** Textual del humano: «los dos ya que los dos manipulan paquetes».
  Mensajero al gestionar desde `en_reparto` (arista #44, ya declarada por la 154) **+ admin desde
  bodega y tránsitos internos**: `en_bodega_central`, `en_bodega_satelite`, `en_ruta_bodega_central`,
  `en_ruta_bodega_satelite`, `por_recoger`. **Son 5 aristas nuevas** al mapa de la guardia central.
  ⚠️ **Es alcance nuevo:** la spec estaba escrita de punta a punta (R1-R36) para el mensajero solo. El
  humano eligió **ampliar la 158 ahora** en vez de partirla en dos features.
- **Q-B (alcance) = causa tipada + evidencia OBLIGATORIA SIEMPRE**, en las tres causas. Enum cerrado
  de 3 valores, sin «Otro»; `motivo` en texto libre obligatorio siempre. **Se le planteó la objeción**
  (en `perdido`/`robado` no hay paquete que fotografiar y bloquea al mensajero en la calle) y eligió
  esta opción de todas formas. Queda **declarado como consecuencia aceptada**, no disimulado.
- **Q-B (idioma) = ESPAÑOL** (`danado`, `perdido`, `robado`). Rompe **a propósito** la coherencia con
  `causa_devolucion`, que está en INGLÉS (`not_found`, `wrong_number`, `wrong_address`) por decisión
  consciente del humano en la feature 73, a favor de la coherencia con `gestion_resultado` y
  `order_status`. **Que nadie lo «arregle» después.**
- **Q-C = columna nueva `gestion_orden.indemnizacion`.** `cierre_detail` descartado **por evidencia**:
  es snapshot inmutable escrito al *solicitar* el cierre, y el monto se captura al *aprobar*.
- **Q-D = SÍ se puede deshacer**, en ventana controlada. Textual: «como es una app usada por seres
  humanos y nosotros solemos cometer errores, lo ideal es que cada acción se pueda deshacer,
  obviamente dentro de un ambiente controlado». ⚠️ **Revierte parcialmente la decisión de la 154 ya
  mergeada** (`incidente: []`, `order-status-transiciones.ts:206`, «a diferencia de `entregada` NO
  conserva ninguna salida — decisión del humano del 2026-07-29»). Compatible con dejarlo terminal:
  `ESTADOS_TERMINALES` **exime de tener salida pero no la prohíbe** (`:236-237`) y `entregada` es el
  precedente exacto.
  - **Problema técnico duro que abre:** hoy el destino del deshacer está **hardcodeado a `en_reparto`**
    (`CierreDiaService.ts:65,388`) y **repone la asignación al autor de la gestión** (`:399`). Con
    orígenes múltiples eso es incorrecto dos veces: un incidente reportado por un admin sobre un
    paquete en `en_bodega_central`, al deshacerse, mandaría la orden a `en_reparto` **asignada al
    admin**. El destino tiene que ser **el estado de origen**.
  - Red de seguridad: `ESTADOS_ESPERADOS` es un `Record<GestionResultado, …>` exhaustivo → añadir
    `incidente` al enum **rompe el build** hasta declararlo.
- **Q-E = fuera de alcance**, con follow-up explícito: «crédito de indemnización en el ledger por
  tienda» (feature 43). **Falta registrar la ficha** — tarea del leader.
- **Q-F = no se reescriben los `down.sql` previos.** `20260713140000_wallet_egreso_gasto_fijo_variable/down.sql`
  es punto-en-el-tiempo y su test asserta exactamente 12 valores. Sí se corre `tests/integration/db`
  completo en la fase backend.
- **Q-G = el append escribe `origen_tipo = incidente`** + se alinea el `via` de la arista #44. La 154
  dejó esa familia «declarada SIN PRODUCTOR hasta la 158» (`orden-historial.ts:35`).
- **NUEVA — aprobación del camino del admin.** Textual: «la idea es que sea aprobado, y para esto
  podemos usar los cierres ya existentes, verás que tenemos ya dos tablas en cierres, podemos usar el
  mismo modelo». Se reusa el **PATRÓN, no la tabla**: `CierreEstado` (`solicitado → aprobado/rechazado`),
  cola «Pendientes de decisión» + «Histórico» (`CierresAdminModule.tsx:270,291`), motivo obligatorio
  sólo al rechazar. Es la **tercera** aplicación: la feature 40 ya fue la segunda y se declara «espejo
  de CierresAdminService (38)».
  - **`cierre_bodega` NO puede alojarlos** — verificado: agrupa `CierreDia[]`, es por `zonaId` y sólo
    satélite, sin detalle por orden (`schema.prisma:732-758`).
  - **El egreso a la wallet se dispara AL APROBAR.** Requisito explícito del humano: **quien reporta
    no aprueba**. Consecuencia: la feature queda con **dos puntos de entrada al egreso** (mensajero vía
    cierre del día, admin vía aprobación del incidente) y la idempotencia de la wallet tiene que
    cubrir los dos para que una orden no se pague dos veces.

### 🚪 Puerta F1.4-bis de la 158 — spec ampliada y **4 decisiones más**

Spec ampliada a **64 R** (28 nuevos `R37-R64`; **7 reescritos en su sitio** con su nota: `R6` por Q-A,
`R9`/`R10` por Q-B, `R13`/`R14`/`R15` por Q-D, y `R29`, que pasa de «un solo emisor de dinero» a
**«exactamente dos, uno por camino, y ningún tercero»** con guard estructural).

**🔎 Hallazgo que mató el diseño barato — verificado, no supuesto.** El incidente del admin **no puede
ser una fila de `gestion_orden`**: `CorteDiarioRepository.findMensajerosConActividadSinCierre` (`:38-44`)
hace `where: { cierreId: null, anuladaAt: null }` con `distinct: ["mensajeroId"]` **sin filtrar rol ni
resultado** → le habría creado al admin un `cierre_dia` **vencido y bloqueante que no puede resolver**,
porque `CierreDiaService` está acotado al rol `mensajero`. De ahí sale **tabla propia `orden_incidente`**
+ su espejo de evidencias.

**El destino del deshacer NO necesita columna nueva.** Dos cosas verificadas: (1) para el camino del
mensajero el hardcode a `en_reparto` **no es un bug** — una gestión sólo nace desde `en_reparto` y su
autor es siempre mensajero; (2) para el admin el lector ya existe y está mergeado:
`findOrigenesReversion` de la **149** (`OrdenHistorialRepository:212-230`) lee el `estatus_origen_id`
de la fila de historial más reciente. `estado_origen_id` queda como plan B declarado.

**§14 del design lista 10 tests de OTRAS features que esta feature rompe garantizado**, con archivo,
línea y qué deben afirmar — incluidos los que hoy asertan `TRANSICIONES.incidente === []`. Consecuencia
directa de Q-D, declarada por adelantado en vez de descubrirse en el gate.

**Decisiones del humano del 2026-07-30 (segunda ronda):**
- **Q-H = modal por orden en el módulo de órdenes**, desde la acción de fila. Precedentes exactos:
  `RecuperarABodegaModal` (100) y `DeshacerAsignacionModal` (149) — las dos acciones administrativas por
  orden CON MOTIVO que ya viven ahí. **No puede ser acción de lote:** pide causa, motivo y fotos por orden.
- **Q-I = página propia `/incidentes`**, espejo de `cierres-admin`. Precedente: `cierres-bodega-admin` ya
  es página propia para el espejo de la 38. Coste: entrada nueva en `menu-visibility.ts` con rol.
- **Q-E → ficha 161 REGISTRADA** con el OK del humano: «credito de indemnizacion en el ledger por
  tienda», `pending` / backend / medium / `depends_on: 158`.
- **Q-J y Q-K se toman por la recomendación** (no objetadas, con su consecuencia declarada): **Q-J** el
  aviso al mensajero cuya orden pasa a `incidente` queda **fuera de alcance con follow-up escrito** — hoy
  la orden desaparece de «Mis asignaciones» sin aviso, y es el tipo de hueco que se descubre con una
  llamada del mensajero; **Q-K** **no se toca `mensajero_asignado_id`** al reportar desde `por_recoger`,
  así la reversión es trivialmente correcta y la asignación colgando es inocua (`findMisAsignaciones`
  filtra por estados e `incidente` no está entre ellos).

**⏸️ Q-L SIGUE ABIERTA — es la única que bloquea el arranque.** ¿Un PR o dos? El diseño **recomienda
dos** (§15.2) y demuestra que la línea no deja **nada funcional roto** en el intermedio: ninguna arista
ni familia sin productor (las 10 del admin no se declaran hasta que llega su productor — la lección de
la 154 aplicada al revés), ciclo económico completo en el primero, y el único efecto visible es que el
admin no puede reportar desde bodega, **que es el estado de hoy**. La pregunta se hizo primero con la
palabra «entrega» y **se malentendió**: en este dominio «entrega» es lo que hace un mensajero con un
paquete. Reformulada como «un PR o dos PRs».

### ✅ PR 1 de la 158 ENTREGADO — **PR #208**, camino del mensajero (R1-R36)

`https://github.com/nuformecuador-lgtm/ordenex/pull/208` · rama `feature/158-incidente-indemnizacion`
· 21 commits · `./init.sh` **617 archivos / 6973 tests / 0 fallos** (baseline de partida 599/6634 →
**+339 tests**) · `tests/integration/db` 72/715 · `next build` exit 0.

**Reviewer: OK — 0 bloqueantes, 10 menores** (`progress/review_158.md`). **36/36 R verificados hasta
un test concreto y NO VACUO**, sin fiarse del mapa de las bitácoras; **17 mutaciones propias del
reviewer, las 17 discriminan, 0 supervivientes**. El reviewer además **cerró la limitación que se le
declaró** en vez de aceptarla: insertó una fila real de la categoría nueva y comprobó que el DOWN
aborta en el `ALTER COLUMN` — el `USING` cast que no se había podido ejercer con la tabla vacía.

**m5 y m6 saldados antes de abrir el PR**, por decisión del humano:
- **m5 (el monto sin tope frente al `DECIMAL(12,2)`)**: el tope se puso **en el borde de la 158**, NO
  en `montoPositivoSchema` — el defecto es preexistente (feature 45 lo tiene igual) y tocar el schema
  compartido cambiaría otras features sin su puerta. La frontera **se midió contra Postgres**, no se
  dedujo: `9999999999.99` cabe, `10000000000.00` desborda. En cliente se comparó **por texto**, porque
  11 dígitos no caben exactos en un `number` de JS.
- **m6 (media compensación vacua en el censo)**: **reforzado, no retirado**. Las dos mutaciones que
  ahora lo matan (degradar el `case` a comentario, degradar la guardia de evidencias) **antes dejaban
  el test verde**.

**⚠️ `R29` queda a medias en el PR 1 A PROPÓSITO**: pide «exactamente DOS» emisores de
`egreso_indemnizacion` y allí hay uno. El guard lo fija con un assert que obliga a que pase a 2 en el
PR 2. **El PR 2 lo cumplió** (ver abajo).

**⚠️ La dispensa de E2E del PR 1 es explícita y NO EXTENSIBLE al PR 2.** La deuda de fondo —que no
haya harness de E2E en el repo— sigue viva y sin dueño.

### 🔨 PR 2 de la 158 — camino del admin (R37-R64), EN CURSO

Rama `feature/158b-incidente-admin`, apilada sobre el #208 (su migración es aditiva sobre la del PR 1).

**Fase 1B (backend) COMPLETA**: 14/14 tasks · `./init.sh` **624 archivos / 7228 tests / 0 fallos** ·
`tests/integration/db` **73/742** · 97 migraciones sin drift · **18 mutaciones, 18 discriminan**.
**`R29` queda en DOS emisores** — el caso del PR 1 se **invirtió, no se borró**, y cada emisor declara
su `origen_tipo` en su código. Fase 2B (frontend) en implementación.

**Dos mutaciones revelaron guardias que sólo medían FORMA** (el shape del `where`, 1 rojo cada una):
el `estado: "aprobado"` del feed y el `estado: "solicitado"` de `resolver`. Con dobles que honran el
`where`, ahora ponen 3 rojos cada una, **dos sobre el dinero**.

### 🔎 Dos hallazgos operativos del PR 2 que NO son de la feature

1. **⚠️ EL ORDEN DE LOS DOS `down.sql` IMPORTA, y el spec no lo decía.** Revertir la migración del PR 1
   con la del admin aplicada **ABORTA**: `orden_incidente.causa` depende de `gestion_causa_incidente`.
   En orden inverso las dos corren completas. **Quien revierta en producción tiene que ir del más
   nuevo al más viejo**, que es lo natural pero nadie lo había verificado.
2. **🐛 `scripts/db-rollback.ts` elige la migración por NOMBRE, no por la última APLICADA.** Verificado:
   `readdirSync` + `sort` por nombre + coger la última (`:9-18`); **nunca consulta
   `_prisma_migrations`**, sólo borra el registro por nombre después. **Correrlo dos veces revierte la
   misma migración dos veces**, y una carpeta con timestamp fuera de orden le hace elegir la
   equivocada. Hoy los nombres coinciden con el orden real, así que no ha mordido.
   > **Es la TERCERA vez que una herramienta de este repo lee el sistema de archivos en vez de la
   > fuente de verdad**: los guards con `fs.readdir` en vez de `git ls-files`, la denylist de
   > migraciones que se mantenía a mano (ya arreglada en el #207 pinneando el baseline), y ahora esto.
   > El patrón tiene nombre y conviene usarlo al revisar: **si un script decide algo mirando el árbol
   > de archivos, la fuente de verdad casi siempre está en otro sitio.**

**Q-J ya no es teórica:** un admin puede reportar un incidente sobre una orden `por_recoger` **ya
asignada**, y esa orden desaparece de «Mis asignaciones» del mensajero **sin aviso**. Sigue siendo
follow-up declarado, no lo cierra el PR 2.

**Estado del registro:** ficha **158 `in_progress`** con las 14 decisiones en su `status_note`; ficha
**161** registrada (follow-up de Q-E). Regla 1 respetada: backend 1 (la 141), fullstack 1 (la 158).

---

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
| ~~**#183**~~ | ~~`feature/log-fallos-whatsapp`~~ | **CERRADO SIN MERGEAR** el 2026-07-29. Lo REEMPLAZA el **PR #205** (`fix/portar-hotfix-whatsapp`), que sí porta el hotfix y salda las dos deudas del punto 3. | cerrado 29/07 |

### 3. Infra y despliegue (humano)

- ⚠️ **`dev` y `prod` DIVERGEN EN AMBOS SENTIDOS.** Medido: `origin/dev...origin/prod` → **16 / 18**.
  `prod` tiene 18 commits del hotfix de WhatsApp que `dev` no tiene, y `dev` tiene los 16 de hoy que
  `prod` no tiene. Ya no es «`dev` va atrasado»: son dos ramas separadas y hay que reunirlas.
- ✅ **SALDADO en el PR #205** (2026-07-29). Lo que sigue era la lista de lo que el #183 arrastraba;
  se conserva porque explica por qué ese PR no se podía mergear tal cual, y las dos cosas **ya están
  hechas** en el #205: las Server Actions `_tmp-*` retiradas tras verificar que nadie las importa, y
  el `down.sql` escrito **y ejecutado** en round-trip contra Postgres, no revisado por lectura.
- **Lo que el PR #183 arrastraba** (histórico):
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

> ## 🏁 Cierre de la MAÑANA del 2026-07-30
>
> *(Ya no es el punto de entrada: lo es la «Sesión 2026-07-30 (tarde)» del principio del archivo, que
> corrige tres cosas de aquí. Este bloque sigue válido en todo lo demás.)*
>
> Lo de abajo (el «Cierre de la sesión del 2026-07-29») sigue siendo válido en su detalle técnico;
> esto lo actualiza en lo que cambió al mergear.
>
> ### 🎉 `dev` y `prod` dejaron de divergir en la dirección peligrosa: **136 / 0**
>
> El **PR #205** portó el hotfix de WhatsApp y `dev` ya contiene TODO lo que tiene `prod`. Era el
> problema que llevaba tres días sangrando en silencio: el #183 se había **cerrado sin mergear**, así
> que `dev` arrastraba el bug de reintentos infinitos y no quedaba PR que lo arreglara. De paso se
> retiraron las dos Server Actions `_tmp-*` (que **estaban en producción**) y la migración
> `20260728230000_chat_mensaje_error_meta` ganó el `down.sql` que le faltaba, **ejecutado** en
> round-trip, no revisado por lectura.
>
> ### Mergeado hoy
>
> **#202** (149 · deshacer asignación) · **#203** (155) · **#204** (cierre 159) · **#205** (hotfix
> WhatsApp) · **#206** (decisiones de la 155 + registro).
>
> El lote 153–160 queda: **153, 154, 155, 156, 159, 160 → `done`**. Solo faltan **157 y 158**.
>
> ### ⏭️ Lo que queda, en orden
>
> 1. **`prisma migrate deploy` en LOCAL** — quedan 2 migraciones sin aplicar:
>    `20260728230000_chat_mensaje_error_meta` y `20260729140000_orden_historial_origen_deshacer_asignacion`.
> 2. **PR #207** (este) — reconcilia la 159 a `done` + mata la denylist de migraciones.
> 3. **PR #168** (141) — MERGEABLE y con gate verde (603 archivos / 6754 tests), pero ⚠️ **NECESITA
>    RE-REVIEW**: su veredicto es del 2026-07-27 y la base cambió **222 commits** desde entonces,
>    incluida la reescritura de `BulkOrdenService` / `OrdenRepository` / el borde de la API key, que
>    son los módulos que toca. Ahora además convive con la 149 en `OrdenRepository`. Lo que SÍ está
>    verificado: `lote` y `deshacerAsignacionLote` **no se pisan** (transacciones distintas, y el
>    `SET` de la 149 no toca `carga_id` ni `download_url`), con la consecuencia correcta — una orden
>    revertida **conserva su lote**.
> 4. **Desplegar `dev → prod`**: 136 commits, incluye el tren 154+155+156. **Antes**, la task
>    **T24.1 de la 160**: re-correr la consulta de retroactividad y **DETENER el deploy si da > 0**.
>
> ### Al retomar el lote: la 157 está DESBLOQUEADA pero su puerta NO está cerrada
>
> Su `depends_on` (155) ya está en `dev`, y hereda del review de la 155 los **R41/R42/R43** del
> manifiesto por la vía sesión (Bloque E de su `requirements.md`). Pero arrastra **6 preguntas
> abiertas** sin responder. **Cerrar la puerta F1.4 ANTES de implementar** — es la lección que este
> mismo archivo dejó escrita: «gate aprobado en la bitácora no es lo mismo que las preguntas del spec
> respondidas por escrito». La **158** no tiene dependencias bloqueadas.
>
> ### Hallazgo del día que conviene no olvidar
>
> **La denylist del invariante de orden de migraciones se AUTO-REFORZABA.** Rompió **cinco veces** en
> un día. Cada migración nueva no solo sumaba una entrada a la lista de `zonas` —que llegó a **quince
> entradas y ~100 líneas**— sino **un meta-test en su propio archivo exigiendo esa entrada**; había
> **cinco** de esos. El coste real de apendar una migración era editar los tests de otras features en
> dos sitios. Arreglado en el #207 pinneando el baseline a su hecho histórico, verificado por
> mutación. **Lección general: un test que se mantiene con una lista a mano no protege un invariante,
> lo convierte en peaje.**

> ### ✅ Cierre de la sesión del 2026-07-29 — retomar por aquí
>
> **Dos PRs abiertos, los dos con gate verde sobre `dev` ya integrado:**
>
> | PR | Rama | Qué es | Veredicto |
> |---|---|---|---|
> | **#203** | `feature/155-creacion-bifurcada` | Creación bifurcada por bodega + retiro de `en_fulfillment`. 582 archivos / 6386 tests | **APROBADO-CON-NOTAS**, 0 bloqueantes, 9 menores, **69 mutaciones** (62 muertas, 7 supervivientes, todas huecos de cobertura) |
> | **#204** | `fix/159-cierre` | Cierre de la 159: cobertura recuperada, R10 reconciliado, registro desatascado. 584 archivos / 6343 tests | **APROBADO-CON-NOTAS**, 21/22 R, 23 mutaciones |
>
> **🎉 La deuda del round-trip de migraciones QUEDA SALDADA para el tren.** Era la que decía
> *«el round-trip real contra Postgres NO EXISTE (…) se salda antes de que el tren suba a `prod`»*.
> La migración de la 155 —la única del tren que **mueve datos**— se ejecutó de verdad contra
> `localhost:5432` sobre una base con **47 órdenes reales** en el estado retirado:
> `migrate deploy` → `db:rollback` → `migrate deploy`, con el **mismo checksum** de `orden` menos
> `estatus_id` a la ida y a la vuelta, y verificado **por mutación**. Números, mutaciones y las
> cuatro limitaciones declaradas en `progress/roundtrip_155_migracion.md`. **Ya no es un estreno en
> producción.** Las migraciones de la 154 son aditivas y no mueven datos.
>
> **✅ LAS TRES DECISIONES HUMANAS QUEDARON RESUELTAS** el 2026-07-29 (constan en
> `progress/review_155.md` §8, que es la fuente):
> 1. **Dispensa del E2E — CONCEDIDA y explícita.** `CHECKPOINTS.md` lo exige para «ingesta de
>    órdenes» y «webhooks»; leído literal, la casilla no se marca y el veredicto sería RECHAZADO. Se
>    dispensa porque **no existe ni un E2E de ingesta en todo el repo**, la 155 no altera la
>    **mecánica** de la ingesta sino su **resultado**, y el borde HTTP sí tiene integración real.
>    ⚠️ **El precedente NO es extensible** a cualquier feature que toque ingesta, y **la deuda de
>    fondo —que no haya harness de E2E— sigue viva y sin dueño**: es lo que hace este checkpoint
>    inaplicable en la práctica.
> 2. **Aviso a integradores — NO NECESARIO.** Se cierra sin traspaso a nadie.
> 3. **El manifiesto de la rama (b) por la vía sesión — PASA A LA 157**, escrito como **R41/R42/R43**
>    en el Bloque E de `specs/157-recoleccion-tienda-qr/requirements.md`. La causa no fue la 155 sino
>    `b2181e7` de la **159**, que dejó `OrdenesCargaResumenPaso.tsx` huérfano.
>
> **Registro reconciliado** (verificado con `gh pr view`, no por la ficha): **151 → `done`**
> (PR #201), **160 → `done`** (PR #197 — la rama de la 155 ya lo había corregido, pero esa corrección
> nunca llegó a `dev`) y **155 → `done`** (PR #203). Sin esto `./init.sh` quedaba **rojo** por la
> regla 1: la zona fullstack llegó a tener 3 `in_progress`.
>
> **Lo siguiente del lote:** **157** (ya DESBLOQUEADA: su `depends_on` 155 está mergeado) y **158**.
> Las dos `spec_ready`, pero ⚠️ **ninguna tiene su puerta F1.4 cerrada**: la 157 arrastra **6
> preguntas abiertas** sin responder en su `requirements.md`. Cerrar la puerta ANTES de implementar,
> que es la lección de la CORRECCIÓN 1 de más arriba.
>
> ### ⚠️ Hallazgos de esta sesión que NO son del lote y siguen abiertos
>
> - **El hotfix de WhatsApp NO estaba en `dev` y no quedaba PR que lo portara → RESUELTO en el
>   PR #205** (`fix/portar-hotfix-whatsapp`, abierto el 2026-07-29). Reúne las dos ramas
>   (`git merge origin/prod`, **sin conflictos**), retira las dos Server Actions `_tmp-*` tras
>   verificar que nadie las importa, y le escribe a `20260728230000_chat_mensaje_error_meta` el
>   `down.sql` que le faltaba, **verificado por ejecución** (round-trip UP → DOWN → DOWN → UP en una
>   transacción revertida, con las 3 columnas y el índice parcial apareciendo y desapareciendo).
>   Revisado además que el volcado de la petición a la Graph API **no filtra secretos**: redacta por
>   defecto y el modo crudo es opt-in por `WHATSAPP_DEBUG_LOG`, que llega vacía. El diagnóstico
>   original queda escrito abajo. El **#183 se CERRÓ SIN
>   MERGEAR** (2026-07-29 13:03). Verificado por archivos: `lib/services/whatsapp/errores-meta.ts` y
>   `chat-logger.ts` existen en `prod` y **no** en `dev`. `dev` arrastra el bug de reintentos
>   infinitos, y las dos Server Actions `_tmp-probar-jobs.ts` / `_tmp-sincronizar-plantillas.ts`
>   **siguen en producción**. El texto de la sección «`dev` vs `prod`» de más abajo daba el #183 por
>   abierto y mergeable: **era falso en las tres partes**.
> - **La denylist a mano de las migraciones costó trabajo TRES veces en un día** (159, 149 y el propio
>   assert de la 159). El arreglo existe y está aplicado como precedente en
>   `tests/integration/db/drop-mensajero-sugerido-migration.test.ts`: **pinnear el baseline** en vez
>   de mantener la lista, porque el invariante es histórico y las migraciones posteriores son
>   irrelevantes por definición. Extenderlo al resto (`zonas`, `notificacion`,
>   `orden-indices-filtros`, `order-status-en-reparto`) es un **chore propio**, no se colgó del PR de
>   ninguna feature.
> - **Las decisiones D1–D9 de las puertas de la 160 viven SOLO en su `status_note`** de
>   `feature_list.json`; `progress/` documenta D3 y D6, no el resto. Iba a recortar esa nota por
>   longitud y se conservó al comprobarlo. Moverlas a `progress/impl_160_*.md` es trabajo pendiente:
>   hasta entonces, **no recortar esa nota**.

**Arranque:** `./init.sh` **verde** sobre `dev` @ `0ed3125` (543 archivos / 5655 tests, lint 0
errores). El `typecheck` rojo que aparece al estrenar un worktree es **cliente Prisma stale**, no
`dev`: se salda con `pnpm db:generate`. Vale la pena recordarlo antes de diagnosticar nada.

| # | Zona | Estado al momento de escribir | Rama |
|---|------|-------------------------------|------|
| 154 | backend | ✅ **reviewer APROBADO-CON-NOTAS, 0 bloqueantes** | `feature/154-catalogo-estados-v2` |
| 156 | fullstack | ✅ **reviewer APROBADO-CON-NOTAS, 0 bloqueantes; los 2 menores SALDADOS** | `feature/156-guia-sin-mensajero` |
| 160 | fullstack | backend hecho; frontend en implementación | `feature/160-columna-intentos` |

**156 — generar guía sin asignar mensajero.** `./init.sh` verde: **547 archivos / 5751 tests / 0
fallos**. Retira `#4`, `#6` y `#7c`; **`#5` sobrevive** (destino único de generar guía); 45→42
aristas. `GenerarGuiaModal` pasa a confirmación de lote y envía `{ ordenIds }`. Sin migración, cero
`ordenes-columns.tsx`. `AsignacionSateliteService.ts` y `OrdenRepository.ts` **byte-idénticos**.

- **El reviewer no se fió del mapa: verificó R1–R30 con 7 mutaciones propias**, todas rojas donde
  debían. Los tests de la 154 puestos para romper aquí **se movieron e invirtieron**, ninguno
  borrado. Cerró además el hueco de límites cliente/servidor corriendo `next build` (exit 0).
- **La trampa del choke point se confirmó:** 7 tests rompieron en `orden-repository.guia.test.ts` y
  `orden-historial-atomicidad.test.ts`, los dos archivos cuyos dobles de `tx` ejecutan la guardia
  REAL. Contradice `tasks.md` T A.3.6 y `design.md` §7, que daban por hecho que no rompería nada.
- **Menor 1 saldado:** el `validation_error` de `guia-decision-error-messages.ts` decía «revisa la
  selección de mensajero», instrucción imposible desde que la 156 quitó esa selección. Quedó en
  **«Datos inválidos.»**, el literal que ya usan los tres mappers vecinos. Se descartó «revisa la
  información enviada» porque el caso realmente alcanzable es un **seed de catálogo incompleto**: no
  es culpa del usuario y pedirle que revise lo que envió seguiría siendo falso.
  `asignacion-satelite-error-messages.ts` **no se tocó**: ahí sí hay selección de mensajero.
- **Menor 2 saldado, pero NO como decía el review:** su arreglo (que el `findMany` devolviera solo
  `o1`) pone el caso **rojo**, no verde — el origen del segundo cae a `null` y la guardia de la 140
  lo rechaza antes de escribir. Ese rechazo se convirtió en un caso nuevo que sí discrimina,
  verificado por mutación.
- `tasks.md` **24/27**. Sin marcar con su razón: **T A.3.6** (criterio literal imposible de
  cumplir), **T C.2** (nadie verificó contra Postgres real: no hay `.env` ni base) y **T C.3**.

⚠️ **`en_fulfillment` sigue ofreciendo «Generar guía» hacia un `conflict` garantizado hasta que
llegue la 155.** El reviewer lo dice con todas las letras: **el tren 154+155+156 es condición de
correctitud, no una preferencia.**

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

## ⚠️ `dev` y `prod` DIVERGEN 87 / 18 (medido el 2026-07-29)

> **Actualizado el 2026-07-29:** `git rev-list --left-right --count origin/dev...origin/prod` →
> **`87  18`**. El 28/07 era `16  18`; el titular viejo («`dev` está 18 commits DETRÁS») ya no
> describe la situación: **`dev` va 87 commits POR DELANTE** y sigue sin recibir los 18 del hotfix.
> **El PR #205 reúne las dos ramas** (`git merge origin/prod` sin conflictos): al mergearlo, los 18
> commits del hotfix entran en `dev` y esa mitad de la divergencia desaparece. Queda la otra: los 87
> que `dev` tiene y `prod` no, que se cierran con el despliegue `dev → prod` del tren 154+155+156.
> **Ese despliegue sigue siendo tarea humana.**

`git rev-list --left-right --count origin/dev...origin/prod` → `0  18` *(medición del 28/07, ver
aviso de arriba)*. Los arreglos del **log de
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

> ### ✅ Las dos cosas que había que revisar antes de portarlo — HECHAS en el PR #205
>
> Se conservan enunciadas porque son el diagnóstico que explica por qué el #183 no se podía mergear
> tal cual, y porque el patrón se va a repetir con el próximo hotfix.
>
> 1. **La migración `20260728230000_chat_mensaje_error_meta` no tenía `down.sql`** — contra la regla
>    del repo (`./init.sh` avisa de migraciones sin `down.sql`). **Escrito en el #205 y verificado
>    por EJECUCIÓN**, no por lectura: round-trip UP → DOWN → DOWN otra vez → UP contra Postgres
>    local en una transacción revertida. La pérdida de datos del DOWN (el motivo de los salientes ya
>    fallidos, que es dato de diagnóstico) queda declarada en su cabecera.
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
- **Migraciones sin round-trip real:** los `down.sql` de las features **141 y 146** siguen revisados
  solo **por lectura**. ✅ **Ya NO es así para todas:** el 2026-07-29 se ejecutó el round-trip real
  contra Postgres de la migración de la **155** (`progress/roundtrip_155_migracion.md`, sobre 47
  órdenes reales y verificado por mutación) y de la del chat de WhatsApp (**PR #205**). El método
  está escrito y es repetible: ensayo en transacción revertida → mutaciones para probar que el arnés
  discrimina → tramo persistido por la herramienta del repo.
- **La denylist a mano de las migraciones costó trabajo CUATRO veces el 2026-07-29** (159, el propio
  assert de la 159, 149 y el porte del hotfix). El arreglo existe y está aplicado como precedente en
  `tests/integration/db/drop-mensajero-sugerido-migration.test.ts`: **pinnear el baseline**, porque
  el invariante es histórico y las migraciones posteriores son irrelevantes por definición.
  Extenderlo a `zonas`, `notificacion`, `orden-indices-filtros` y `order-status-en-reparto` es un
  **chore propio** — deliberadamente NO se colgó del PR de ninguna feature ni del porte del hotfix,
  que tiene que ser fácil de revisar y de revertir.

## Tareas humanas pendientes

- **Portar el hotfix de WhatsApp a `dev`** → ✅ **listo para mergear: PR #205**. El #183 se cerró sin
  mergear y el trabajo se rehízo: las dos `lib/actions/_tmp-*.ts` fuera, el `down.sql` escrito y
  ejecutado en round-trip, y `./init.sh` verde (583 archivos / 6403 tests). **Lo único que queda es
  darle merge.** Nota: al entrar, `dev` recibe los 18 commits de `prod` y hay que correr
  `prisma migrate deploy` en local (la migración del chat no está aplicada ahí).
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
