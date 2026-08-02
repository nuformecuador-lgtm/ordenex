# Sesión activa

> Estado vivo de lo que se está trabajando **ahora**. El leader lo mantiene al día.
> Al cerrar una feature se limpia de aquí y se resume en `history.md`.
>
> **Dónde está el historial completo:** los PRs de GitHub, `progress/impl_*.md` / `review_*.md`
> por feature, y la narrativa de decisiones dentro de cada entrada de `feature_list.json`.
> La bitácora extensa que vivía en este archivo se puede recuperar con
> `git show <rev>:progress/current.md`.

## 🏁 CIERRE DE JORNADA 2026-08-02 — **EMPIEZA A LEER POR AQUÍ**

**Registro con CERO features `in_progress`.** Se desplegó producción, se saneó el backlog de PRs, se
cerró la **feature 170 entera** (fases 1 y 2) y se dejó la **172 en `spec_ready` con su puerta
CERRADA**.

### 🚀 LO PRIMERO AL RETOMAR: implementar la 172

**No hay puerta pendiente. El spec está aprobado y se puede escribir código directamente.**

`specs/172-liquidacion/` — **85 R en EARS, 9 tandas**, rama `feature/172-liquidacion`, PR **#259**.
Todas las decisiones están DENTRO de los archivos, no solo en esta bitácora.

**Empezar por la TANDA A, y con cuidado:** trae la migración con el **CHECK de `categoria`↔`tipo`**
heredado del review de la 171. Ese CHECK **valida las filas existentes al aplicarse** y en Vercel el
build migra antes de compilar, así que **mergear ES aplicar**. La propia task **T A.0** exige
verificar producción y preview por MCP **antes** de escribir la migración. No saltársela.

Las tres respuestas explícitas del humano que más mandan sobre el diseño:

- **P4 — la ANULACIÓN entra en la feature.** Eligió lo contrario al default: entregar un libro de
  dinero que no se puede corregir era el riesgo más caro. Se modela como **contraasiento**, nunca
  borrar ni editar; el pago sigue siendo fila inmutable y «anulado» se **deriva**. Usa categorías ya
  reservadas ⇒ **cero valores de enum nuevos** y ninguna cascada de `down.sql`.
- **P1 — el pago que excede lo debido se RECHAZA**, lo que obliga a un **candado**
  (`SELECT … FOR UPDATE` antes de leer el disponible, **uno por operación**). Su test **exige
  mutación**: si quitar el candado no lo rompe, el test no prueba nada.
- **P3 — pagan `maestro` y `admin`.** `adminSatelite` **no**, aunque sí apruebe cierres.

### 🔧 Deuda con DECISIÓN YA TOMADA — solo falta hacerla

**El humano pidió AÑADIR UN AVISO** en bodega satélite: hoy lo marcado en otra página se conserva
pero **no participa** en la acción de lote y **nada lo advierte** (Q-K7 de la 170). Algo del estilo
«tienes N órdenes marcadas en otras páginas que no entran en esta acción». Es un **chore de frontend
pequeño y ya decidido**.

### ⏳ Esperando al humano (nada bloquea)

1. **N1 (nueva, de la 172):** el par pago+anulación deja los importes **brutos inflados** —«pagado a
   la tienda» sigue contando lo anulado— **aunque el saldo queda exacto**. Netearlo exigiría 2
   valores de enum nuevos o reescribir la derivación de la 171. **Default tomado: no netear y
   declararlo en pantalla.** Si va a cambiar, mejor antes de implementarlo.
2. **N2:** sin ventana temporal para anular (default tomado).
3. **Orden alfabético** en «saldos de tiendas» y «cuentas por pagar» (170, ya en `dev`): **no es
   realmente opcional** —esos listados no tenían orden y sin uno total las páginas se solapan u
   omiten filas—. Queda informado, no a decisión.

### ✅ Entregado

| | Qué | Estado |
| --- | --- | --- |
| **release** | `dev → prod` (PR #246) | **en producción**, migración del buscador aplicada y verificada |
| **123** | rollup diario `analytics_daily` | `done` · PR #237 desatascado y mergeado |
| **170** | Excel en 25 tablas + **paginación server-side de 13 listados** | `done` · fase 2 en 6 PRs (#248, #249, #250, #253, #255, #256) |
| **chore** | 2 guards deterministas que bloqueaban `./init.sh` | PR #257 |

**Suite final: 772 archivos / 9257 tests, 0 fallos.**

### ⚠️ DECISIONES DEL HUMANO PENDIENTES — cambios VISIBLES ya desplegados en `dev`

La 170 fase 2 cambió lo que se ve en pantalla. El humano aceptó **no verificar en pantalla** a cambio
de que los PRs describieran el cambio de uso; están descritos, pero **falta su opinión**:

1. **Orden alfabético nuevo** en «saldos de tiendas» y «cuentas por pagar». Hoy esos listados **no
   tenían orden** —salía de un `groupBy` sin `orderBy`, o sea lo que le conviniera al planificador— y
   sin orden total las páginas se solapan u omiten filas. Es la desviación mínima que hace correcta
   la paginación, pero **cambia lo que el maestro ve**.
2. **Bodega satélite:** «seleccionar todo» es **por página**, los botones de lote **desaparecen** sin
   selección (antes salían en gris) y **lo marcado en otra página se conserva pero NO participa, sin
   que nada avise** (Q-K7). Es lo que más puede confundir en uso real.

### 🔎 El hallazgo que sobrevive a la feature

En **cuatro tandas seguidas** (I, J, K, L) una mutación del `WHERE` **sobrevivió a los tests de
servicio** —usan dobles y **no ven la traducción a SQL**— y solo la cazó el test de repositorio. Son
7+ mutaciones medidas una a una. La respuesta del repo son los cuatro `*-where.test.ts`, y la regla:
**probar el `WHERE` donde vive, no donde se invoca.**

> **Y una lección de proceso que costó un rojo en `dev`:** al mergear el PR #237 se verificó por el
> **estado del PR** en vez de por la suite. **El check de Vercel es un build y NO corre tests**, así
> que un guard cruzado entre la 122 y la 123 entró rojo sin que nadie lo viera. Mismo patrón que el
> incidente del PR #209.

### ⏭️ Lo siguiente

1. **172 — liquidación.** Es la que cierra el agujero de verdad: hoy **no existe forma de registrar
   un pago**. Todas las decisiones están en su ficha. **Arranca por spec y tiene PUERTA DE APROBACIÓN
   HUMANA antes de tocar código.** Condición heredada del review de la 171: **el CHECK de
   `categoria`↔`tipo` debe ir en SU migración**, porque la liquidación será el segundo escritor del ledger.
2. **173 — caja en modo tesorería.** Depende de la 172.
3. **Deuda dirigida de la 170:** una **tanda N de backend** con los 8 `listarXCompleto` que faltan
   (Q-I5+Q-K4+Q-K6), y la búsqueda de cuentas por pagar que **no ignora acentos** (Q-L4, defecto
   **preexistente** que paginar hace más visible).
4. **`dev` tiene la migración `analytics_daily` SIN aplicar en producción** (sí en preview). Ya está
   confirmado que producción soporta `NULLS NOT DISTINCT` (**Postgres 17.6**), pero la próxima
   release **deja de ser trivial**.
5. **PR #254 abierto, de otra sesión.** La mitad ya entró por el #257; lo que sigue aportando en
   exclusiva son **19 identificadores `T1.1None`** corruptos en el spec de la 122 (verificado: siguen
   en `dev`). Comentado allí; la decisión es de su autor.

> ⚠️ **Hay otra sesión viva en este repo** (PRs #251, #252, #254). Antes de tomar una rama o dar por
> tuyo un arreglo, mirar si ya lo está haciendo alguien.

### 🧪 Nota sobre el gate en esta máquina

`pnpm test` tiene un **flake móvil de contención de jsdom**: corridas distintas tumban archivos
distintos (`ControlDescargaTransversal`, `CuentasPorPagarTable`, `OrdenesModuleReuse`), **todos verdes
en aislado**. Un rojo así **no es contenido**. Reejecutar el archivo solo antes de declararlo roto.

---

## 🚀 RELEASE 2026-08-01 — `dev → prod` DESPLEGADA

**Hecho. Producción ya no está por detrás: `dev` y `prod` están al día (0 commits de diferencia).**
PR **#246** (`dev → prod`), precedido del **#245** que cerró el bookkeeping de la jornada anterior.

La release llevó 215 archivos (+30703/−2162): buscador de órdenes (**169**), descarga a Excel de las
25 tablas (**170 fase 1**), desglose del dinero por tienda (**171**) y el borrado de la vista legacy
del listado. Despliegue de producción `dpl_6yAcpx6NvF5otCBk5Xuy1Dzimh44` en **READY**.

### ✅ La migración del buscador está APLICADA en producción — verificado en la base, no deducido

`20260731160000_orden_busqueda_trgm`, `finished_at` **2026-08-01 18:56:26Z**, `applied_steps_count`
1, `rolled_back_at` NULL. **Cero migraciones rotas** en toda la tabla.

| Comprobación | Resultado |
| --- | --- |
| `pg_trgm` en el esquema `extensions` | ✅ instalada ahí, que es donde el índice la cualifica |
| Columna `orden.busqueda_texto` e índice GIN | ✅ ambos existen |
| Columna generada calculada | ✅ **69 de 69 filas** con texto no vacío |
| Búsqueda por fragmento y ruta rápida por guía | ✅ las dos devuelven la fila; un término inexistente devuelve 0 |
| Plan de ejecución | ✅ **`Bitmap Index Scan on orden_busqueda_texto_trgm_idx`** — el planificador USA el índice, no cae a seq scan |
| Errores de runtime en Vercel tras desplegar | ✅ ninguno |

> El pre-vuelo se **rehízo** antes de mergear (no se reutilizó el del día anterior): `pg_trgm` no
> estaba instalada en ningún esquema, así que el único modo de fallo que la migración declara —la
> extensión viviendo en otro esquema— no se materializó.

### ✅ Lo que quedaba tras la release, ya saldado

Los dos PRs del lote de analítica que no entraron en ella: **#241** (renombre de
`ROLES_ACCESO_ANALITICA`) mergeado, y **#237** (`analytics_daily`) desatascado y mergeado — su
conflicto con 38 commits de `dev` era **solo de bitácora**: `schema.prisma` y `feature_list.json`
automezclaron limpios. Ver el bloque de cierre de jornada, arriba.

---

## 🔵 EN VUELO — feature 124 · PR #260 abierto, esperando merge

`feature/124-analitica-job-agregacion-diaria` → `dev`. Worktree en `arc/ordenex-wt-124`.
Estado en `feature_list.json`: **`in_progress`** — pasa a `done` **cuando el PR se mergee**, no antes.

El job que puebla `analytics_daily` a las **00:30 CR** sobre el día cerrado **D−1**. Puerta T0 cerrada
por el humano con **D1=A2** (congela solo el estatus), **D2=B2** (vivas + las que cerraron ese día),
**D3+D8** (solo D−1, nada de intradía) y **D7** (las `deleted_at` se excluyen de todo).

**49 requisitos mapeados** en `progress/impl_124.md` §7, con la honestidad declarada: 36 medidos por
aserción discriminante, 8 por barrido del árbol, **4 solo por regex de texto** (R2, R21, R31, R48).
Exigir el mapa destapó tres defectos que el implementer no había reportado (R31 a medias, R20 mapeado
a un test vacuo, R24 medido por el caso de datos y no por el guardia). Los tres, corregidos.

**Colisiones con la 122 resueltas sin aflojar ningún guardia**: R42 despioja comentarios en vez de
allowlistear un archivo ajeno; R18 exime **nominalmente** al escritor sin tocar su detector ni sus
fixtures. Verificadas por mutación ejecutada.

| Medida | Resultado |
| --- | --- |
| Suite | 777 archivos / 9407 tests — **2 rojos, ambos de `dev`** |
| typecheck / lint | 0 errores / 0 errores + 27 warnings **de `dev`** → delta 0 |

Los dos rojos heredados: `no-embalaje` lo dispara `specs/122-analitica-alcance-por-rol/tasks.md:243`
(presente tal cual en `origin/dev`; determinista, **no** el flake que decía la 122), y
`wallet-tiendas-desglose` pasa **30/30 en aislado** — saturación. Por el segundo, `./init.sh` no llega
a verde, y eso **también pasa en `dev`**.

### ⚠️ Defecto ajeno confirmado y deliberadamente NO tocado

`whereRollup()` en `lib/analytics/alcance-columnas.ts` (feature **122**, ya mergeada) recorta
`analytics_daily` por **`mensajeroAsignadoId`** — esa es la columna de `orden`; en el rollup se llama
**`mensajeroId`**. El retorno está tipado `Record<string, string>`, así que **el compilador no lo ve**:
el recorte por mensajero fallaría en silencio. Confirmado contra `db/schema.prisma` y **dirigido a la
126** en su `status_note`, que es quien lo estrellaría. No se arregla desde este PR.

---

## 🏁 CIERRE DE JORNADA 2026-07-31

Todo lo trabajado ese día está **mergeado en `dev`** —y desde el 2026-08-01, **en producción**.
Cinco PRs: #239, #240, #242, #243, #244.

### ✅ Entregado hoy

| Feature | Qué | Estado |
| --- | --- | --- |
| **167** | apartado propio de recolección para el mensajero | `done` · **en producción** |
| **169** | buscador de órdenes (guía, remisión, teléfono, destinatario) | `done` · **en producción** |
| **170** | descarga a Excel — **FASE 1**: las 25 tablas | `in_progress` · **en producción** |
| **171** | desglose del dinero por tienda en la wallet | `done` · **en producción** |
| — | escáner QR unificado y plegable + fix del botón desbordado | **en producción** |
| — | saneamiento del arnés (`init.sh` volvió a verde) | **en producción** |
| — | borrado de la vista legacy del listado del maestro | **en producción** |

### ✅ ~~LO PRIMERO AL RETOMAR: desplegar `dev → prod`~~ — HECHO el 2026-08-01 (PR #246)

Producción ya tiene el buscador, el Excel, el desglose por tienda y el borrado de la vista legacy.
La migración del buscador quedó aplicada y verificada; el detalle está en el bloque de la release,
arriba. El procedimiento de recuperación sigue documentado en
`progress/impl_169-buscador-ordenes.md` §22 por si hiciera falta revertir.

> Recordatorio que costó descubrir y que sigue vigente para la próxima migración: **en Vercel el
> build migra antes de compilar, así que mergear a `prod` ES aplicar.**

### 📋 Trabajo especificado y listo para arrancar

1. **170 FASE 2** — paginar en servidor las 16 pantallas que hoy reciben su dataset entero. Spec
   aprobado, 6 tandas, riesgo por pantalla ya inventariado (2 de riesgo alto: bodega satélite y
   cuentas por pagar). El humano decidió que **basta con la suite**, sin verificación en pantalla.
2. **172 — liquidación** (la que cierra el agujero de verdad): hoy **no existe forma de registrar un
   pago**, ni a mensajeros ni a tiendas, así que los saldos solo crecen. Todas las decisiones están
   en su ficha. **Condición técnica heredada del review de la 171: el CHECK de `categoria`↔`tipo`
   debe ir en SU migración**, porque la liquidación será el segundo escritor del ledger.
3. **173 — caja en modo tesorería.** Depende de la 172.

### ⏭️ Decisiones del humano pendientes (ninguna bloquea)

- **«Rutear a bodega satélite» no tiene interfaz.** Su backend está vivo y probado; el modal se
  conservó listo para remontar. ¿Se vuelve a ofrecer en el listado vivo o se retira con su backend?
- **La ficha de la feature 71 se diagnosticó contra código muerto** (`OrdenesApartado`, ya borrado).
  La superficie viva SÍ tiene el bloqueo que la ficha pedía: **reevaluar antes de tomarla**.
- **La cabecera de `/mi-wallet`** (lo que ve la tienda) sigue en «Créditos / Débitos». Cuando la 172
  emita pagos, la tienda verá el pago **sumado dentro de "Débitos"** sin distinguirlo.

### 🧹 Higiene

Quedan **33 worktrees de agentes** en `.claude/worktrees/`. Todo su trabajo está pusheado y mergeado;
se pueden podar. En Windows algunos fallan con «Filename too long»: `rm -rf` + `git worktree prune`.

### 🔎 Deuda viva declarada (no de estas features)

- **`pending list` del GIN**: justo después de una carga masiva el planificador puede abandonar el
  índice del buscador. Medido, sin cruzar umbrales, **sin decidir**; las tres salidas tocan diseño.
- **`exceljs` trunca a 31 caracteres el nombre de la pestaña** (el del archivo sale entero).
- **Drift entre `schema.prisma` y las migraciones**: reconciliado en el chore de hoy con cero DDL,
  pero conviene no volver a generar migraciones sin mirar el SQL propuesto.


---

# Histórico de la sesión

## 🗓️ Sesión 2026-07-31 (cierre) — 169 CERRADA · wallet registrada · 170 desbloqueada — **EMPIEZA A LEER POR AQUÍ**

**Feature 169 (buscador de órdenes) → `done`, PR #239 mergeado.** El relato completo va a
`history.md`. Lo que importa para quien siga:

- **Verificación de producción HECHA por el MCP de Supabase antes de mergear** (el humano autorizó el
  acceso): `pg_trgm` **no instalada** → sin conflicto de esquema, que era lo único que podía tumbar el
  build y dejar `_prisma_migrations` bloqueando despliegues; y **69 filas** en `orden` → la columna
  generada se añade sin ventana de mantenimiento.
- **Se confirmó CUÁL es la base de producción con evidencia**, no por suposición: el proyecto
  `scfnwxqbsgkzwsdntdvd` tiene aplicada la migración del índice de la 167 (que se desplegó a prod hoy)
  y **no** tiene la del buscador (que solo está en `dev`). Todas las migraciones sanas, ninguna
  fallida ni revertida.
- **La migración del buscador NO está en producción todavía**: entra con el próximo `dev → prod`.

### 💰 Wallet: tres fichas registradas (171, 172, 173)

Con todas las decisiones del humano dentro de cada `status_note`, para que quien las especifique no
tenga que reconstruir la conversación. **Dato nuevo, medido en la base de producción:** 35 movimientos
de caja y 6 cierres con **CERO pagos registrados** — el agujero de la liquidación ya es visible en
datos reales, no es una hipótesis.

### 📊 La 170 (Excel + paginación) queda DESBLOQUEADA

Su Tanda 0 tocaba `lib/types/orden.ts` y `OrdenesModule.tsx`, los mismos archivos que la 169 estaba
modificando. Con la 169 en `dev`, la intersección desaparece y puede arrancar.

## 🗓️ Sesión 2026-07-31 (cont. 2) — Excel en todas las tablas + wallet incompleta (histórico)

Dos reportes del humano. **Los dos son ciertos, por motivos distintos de los que parecían.**

### 📊 Excel: la capacidad existe, el rollout no — feature 170 (nueva)

`DataTable` **ya integra** la descarga del dataset completo (feature 151, server-side y sin
paginación), **opt-in por la prop `descarga`**. El problema es que **solo 1 de 25 tablas la
activa** (`OrdenesModule`); las otras 24 nunca recibieron la prop. Medido, no estimado.

Estaba dentro de la **145**, que mezcla búsqueda + filtros + export y desde hoy depende de la 169.
**Decisión del humano: el export se SEPARA a la 170 y se hace YA** — no depende del buscador. La 145
se queda con búsqueda y filtros. Spec en curso, en rama propia.

### 💰 Wallet: un hueco objetivo y un cambio de modelo — feature 171 (por registrar)

**El hueco, confirmado en código:** `egreso_pago_tienda` (caja principal) y `pago_tienda` (ledger de
tienda) están declarados en los enums **desde la feature 43** y **NINGÚN código los emite** — solo
aparecen en tipos, etiquetas y el catálogo de analítica. O sea: **no existe el flujo de pagarle a la
tienda**, así que el saldo a favor de cada tienda crece indefinidamente y nunca se salda en el
sistema. Para mensajeros sí existe el equivalente (feature 44). Para tiendas quedó como follow-up
`F1.4-Q4` de la 43 y **nadie lo registró como ficha**.

**Lo que el humano describía como «falta el ingreso del dinero total de la orden» sí se registra**,
pero en el **ledger por tienda** (`cod_recaudado`, crédito a favor de la tienda), no en la caja
principal. Eso era deliberado: el COD no es ingreso de Ordenex, es dinero de la tienda que se le
debe. La caja principal modela **resultado** (flete, comisión COD, IVAs), no **tesorería**.

> **DECISIÓN DEL HUMANO (2026-07-31): la caja principal pasa a reflejar TESORERÍA COMPLETA.** El COD
> entra como ingreso de caja y sale al pagarle a la tienda, de modo que se vea el flujo entero. Al
> especificar hay que resolver lo que esto rompe: **el balance dejará de ser «lo que gané»**, así que
> «saldo de caja» y «ganancia» tienen que quedar separados y nombrados, o el número se leerá como
> utilidad y no lo será. Afecta a `derivarBalance`, a la vista de wallet y al catálogo de analítica
> (métricas financieras, features 127/135), que hoy suman categorías `ingreso_*` como resultado.

**Prioridad decidida:** el Excel primero; la wallet después.

### 💸 Segundo reporte de wallet (mismo día): no hay forma de PAGAR nada

El humano pregunta cómo salda las cuentas por pagar de mensajeros y el monto a favor de las tiendas,
y si «ya existe o hay que implementarlo». **Auditado: no existe, y no está escondido.** Cero acciones
de pago o liquidación en `lib/actions/`. El detalle:

- **`/wallet/tiendas` NO tiene desglose por tienda.** Mensajeros sí (`DesglosePagosMensajero.tsx`);
  tiendas solo tiene `SaldosTiendasTable.tsx`.
- **Liquidar la cuenta por pagar de un mensajero: no existe.** La categoría `liquidacion` del ledger
  está marcada «RESERVADO para el follow-up de saldar la cuenta por pagar» desde la **feature 44**
  (`F1.4-Qf`) y nadie la emite.
- **Pagar a una tienda: no existe.** `pago_tienda` idéntico, reservado desde la **43** (`F1.4-Q4`).

**Es el mismo agujero en los dos: el sistema sabe cuánto debe y a quién, pero no tiene cómo decir
«ya pagué».** Por eso los montos solo crecen. Los dos follow-ups quedaron en sus specs y ninguno se
convirtió en ficha, así que se perdieron.

### Decisiones del humano (2026-07-31) para la liquidación

1. **Pagos PARCIALES permitidos.** Se registra lo que se pagó de verdad y el saldo baja en esa
   cantidad.
2. **Mensajeros: el pago se pregunta AL APROBAR EL CIERRE y queda ATADO a ese cierre.** Idea del
   humano, mejor que las opciones ofrecidas: no tiene sentido aprobar un cierre que genera una deuda
   que después nadie mira. Encaja con el modelo actual, donde `pago_efectivo = min(deuda, efectivo
   recaudado)` y **la cuenta por pagar es justo el resto**.
3. **PERO aprobar y pagar son DOS PASOS.** El humano eligió primero «bloquear el cierre hasta pagar»
   y se le señaló la consecuencia en cadena: por la **feature 111**, un cierre `solicitado`/`vencido`
   sin resolver **BLOQUEA al mensajero**; un cierre no aprobado por falta de pago lo dejaría sin poder
   trabajar al día siguiente por un motivo administrativo ajeno a él. Decisión final: **el cierre se
   aprueba** (el mensajero queda libre) y la deuda queda **abierta, visible y atada al cierre**, que
   no se considera liquidado hasta registrar el pago.
4. **Tiendas: contra el saldo acumulado**, desde el desglose nuevo. No hay «cierre de tienda» al que
   atar el pago: su saldo se acumula de muchos cierres de muchos mensajeros. Se descartó crear un
   ciclo de corte por tienda (sería una feature en sí misma).
5. **Datos de cada pago:** método (efectivo/SINPE/transferencia), referencia o comprobante, nota
   libre, **fecha real del pago distinta de la de registro**, y —pedido explícito— «todo dato que dé
   trazabilidad»: actor que lo registra e instante de registro.

### Fichas a registrar cuando haya rama libre (borrador acordado, ids provisionales)

| id | Qué | Depende de |
| --- | --- | --- |
| 171 | desglose por tienda en `/wallet/tiendas` (espejo del de mensajeros) | — |
| 172 | liquidación: pagar a mensajeros (atado al cierre) y a tiendas (contra saldo) | 171 |
| 173 | caja principal en modo TESORERÍA (el COD entra y sale) | 172 |

> No se registran todavía porque el checkout principal está ocupado por el backend de la 169 y el
> otro worktree escribiendo el spec de la 170: meter estas fichas ahí mezclaría registro con ramas
> ajenas. **Todo el contenido acordado está aquí arriba**, que es lo que evita perderlo.

## 🗓️ Sesión 2026-07-31 (cont.) — feature 169: buscador de órdenes (histórico)

**Pedido del humano:** un input que encuentre una orden por cualquiera de sus datos importantes, con
aviso EXPRESO de cuidar el rendimiento («no vaya a ser que sea lenta por una mala implementación de
consultas»).

### Auditoría antes de registrar — sí estaba pedido, pero no se construyó

- **144 «DataTable: búsqueda y filtros»** figuraba `pending` con su **PR #180 MERGEADO desde el
  2026-07-29**. Lo que entró son los **filtros** (catálogo + tiempo) y los componentes compartidos;
  su migración `20260728120000_orden_indices_filtros` crea **cuatro btree de catálogo, ninguno de
  texto**. **La búsqueda de texto se quedó fuera** al redefinirse la feature. → ficha a `done`.
- **`ordenFilterSchema` es `.strict()` y no acepta ningún campo de texto**: hoy NO se puede buscar
  una orden por guía, remisión, teléfono ni destinatario en `/ordenes`.
- La única búsqueda existente es la **114** del mensajero: 100% de cliente sobre lo ya cargado.
  Inservible para una tabla paginada en servidor — solo encontraría lo que ya está en pantalla.
- **145** (rollout a todas las tablas) pasa a `depends_on: 169`: no puede adoptar una capacidad que
  todavía no existe.

### Decisiones del humano (2026-07-31)

1. **Campos: guía, remisión, teléfono y destinatario.** Los cuatro viven en la tabla `orden` → sin
   joins y con índice pequeño. Descarta dirección, producto y nombre de tienda.
2. **Se empieza por `/ordenes`**; el rollout al resto queda en la 145.
3. **Volumen:** hoy pocas órdenes, pero espera **muchas decenas de miles pronto**.

### Enfoque técnico que va al spec (y por qué)

- **`pg_trgm` + GIN sobre columna generada STORED**, NO `tsvector`. El FTS no encuentra fragmentos en
  medio de una cadena, y aquí se teclean los últimos 4 dígitos de un teléfono o un trozo de remisión.
- **Ruta rápida**: término numérico → igualdad contra `num_guia` (índice único ya existente). El caso
  más frecuente del día no paga el coste del trigram.
- **Se indexa YA, y el volumen bajo es la razón, no la excusa:** añadir una columna generada reescribe
  la tabla con lock exclusivo. Instantáneo con pocas filas; ventana de mantenimiento con medio millón.
- **Dos riesgos declarados de antemano:** el `count(*)` exacto de la paginación se paga entero en cada
  tecleo (plan B: conteo con tope), y **`unaccent()` NO es `IMMUTABLE`**, así que no puede ir tal cual
  en una columna generada — la trampa que rompe la migración a mitad.
- El término se compone **en AND con el alcance por rol**: un buscador que se lo salte es una fuga de
  datos, no un fallo de UX.

## 🗓️ Sesión 2026-07-31 — feature 167 CERRADA + chore de saneamiento (histórico)

## 🗓️ Sesión 2026-08-01 (tarde) — feature 130: RONDA 2, tres bloqueantes cerrados

**El reviewer RECHAZÓ la primera entrega y tenía razón en los tres.** Todos del mismo tipo: **tests
verdes que no medían el requisito**. Reproducidos uno a uno mutando el código antes de tocar nada,
y cerrados con la salida real pegada en `impl_130.md §4-bis`.

- **B1 (R13)** — se podía reintroducir `₡` hardcodeado y quedaban 42 verdes. **Causa raíz:** con la
  config por defecto (`es-CR`/`CRC`), `formatMonto(3500)` y un `₡` a mano dan el **mismo string byte
  a byte**; ninguna aserción sobre la salida por defecto puede separarlos.
- **B2 (R20)** — igual con `"es-CR"` incrustado. La cláusula «sin literal de idioma» no la medía
  nada, que es literalmente el punto de `CHECKPOINTS.md` sobre no hardcodear país/moneda.
- **B3 (R33-bis)** — el más grave: neutralizar el recorte del donut no rompía ningún test. No era
  cosmético: `paleta.ts` lanza para todo índice `>= 5` en **cualquier** `NODE_ENV`, así que un donut
  de 6+ categorías (`ordenes_por_estado` tiene 19) **reventaría en el navegador también en
  producción**.

**Arreglo:** guard estático de literales sobre `components/private/analytics/**` (el mismo que ya
protegía a `KpiValorAnimado`) + tests que recargan el módulo con `MONEDA_CURRENCY=USD` /
`MONEDA_LOCALE=en-US`, con lo que los strings dejan de ser idénticos; y tests nombrados de las dos
ramas de `NODE_ENV` para el donut.

> **El humano RATIFICÓ la desviación del donut (2026-08-01):** 5 segmentos y conserva los
> **PRIMEROS** (en una serie ordenada por magnitud son los que más pesan; quedarse los últimos
> mostraría las 5 categorías más pequeñas escondiendo las dominantes). **Barras y líneas NO se
> tocan:** siguen con 62 y los últimos. Escrito como **R33-bis** en `requirements.md`.

**Menores atendidos:** m5 (T8.3 estaba marcada `[x]` afirmando que existía `review_130.md`, que **no
existía** — bookkeeping autocumplido, desmarcada), la escala del `porcentaje` promovida a **R20-bis**
y a `tasks.md > T0.1` donde la lee el dueño de la 131, m1 (R28 se cumple **por un default de
recharts** que nadie fijó, con `^3.10.1`: riesgo declarado) y m2 (R25 marcado **⚠ parcial**, es
inverificable hasta que exista la 131).

**Sigue sin push y sin PR.** Commits nuevos: `07d8188b`.

---

## 🗓️ Sesión 2026-08-01 — feature 130 IMPLEMENTADA (pendiente de review) — ~~EMPIEZA A LEER POR AQUÍ~~

**Feature 130 (analítica: componentes de gráficas) → implementada en la rama
`feature/130-analitica-componentes-graficas`, en worktree aislado. SIN push y SIN PR: lo hace el
humano/leader.** Cinco commits: `e6f4201b` (recharts), `6e4f84f2` (el paquete), `557f25af`
(tests + guard), `3f60a21b` (test propio del Kpi), `a02a165b` (arreglo del compartido).

Los 41 requisitos trazados a test en `progress/impl_130.md`, con los **tres que se verifican fuera
de vitest** señalados y con su salida real pegada: R27 (bundle sobre `next build`), R36 (delta 0 de
suite) y R41 (comprobación de mutación del montaje del lienzo).

> **LO QUE NO SE TAPA, y hay que leer antes de la review:**
> - **H1 — la 130 se mergea SIN LLAMADOR.** `AnaliticaShell` (existe) ← `131` (NO existe) ← `130`.
>   No hay ni un `import` de estos componentes en producción hasta que aterrice la 131. Medido, no
>   afirmado: sin sonda, `recharts` está en **0** chunks de cliente.
> - **H2 — el mensajero SÍ entra a `/analitica`.** «Recharts no le llega al móvil» es falso. Lo
>   garantizado y medido es que no le llega en `/mis-asignaciones` ni en el resto de la app, y que
>   dentro de `/analitica` llega **diferido**: chunk propio de 388.810 bytes, fuera de los 46 chunks
>   de entrada de ruta.
> - **H3 — la moneda no configurable en cliente es PREEXISTENTE**, no la abre esta feature: cinco
>   componentes `"use client"` ya consumen `formatMonto`; `KpiValorAnimado` es el sexto. Ficha
>   propia sobre `lib/config/moneda.ts`, con seis consumidores a revisar. **No se abre desde aquí.**

> **DOS DECISIONES PARA EL DUEÑO DE LA 131**, que el spec no fijaba y que ahora son contrato:
> 1. el `porcentaje` viaja como **fracción** (0,842 = 84,2 %), no en puntos — pasa la razón cruda;
> 2. en el **donut** el techo de segmentos es **5**, no 62. Y siguen en pie sus dos deberes de T0.1:
>    agrupar en «otros» por encima de 5 series y agregar por semana/mes por encima de 62 puntos. El
>    paquete no lo hace (R34) y **lanza** en desarrollo.

> **AVISO DE ENTORNO, cuesta horas si se descubre solo.** El worktree está en una ruta de 143
> caracteres y el `package.json` del cliente Prisma queda en **266**, por encima del MAX_PATH de
> Windows. El resolvedor de módulos de Node no lo lee y **303 de 665 archivos de test fallan al
> colectar**, dejando una suite que *parece* casi verde con 4.059 tests en vez de 8.052. Se arregla
> con `pnpm install --force --config.virtual-store-dir-max-length=30`. **NO** muevas el virtual
> store fuera del proyecto: rompe la resolución de tipos (~1.800 errores falsos). Y `recharts` sólo
> se extrae entero con `--config.node-linker=hoisted`. Todo en `impl_130.md §4`.

---

## 🗓️ Sesión 2026-07-31 — feature 167 CERRADA + chore de saneamiento — **EMPIEZA A LEER POR AQUÍ**
## 🗓️ Sesión 2026-07-31 (tanda de analítica) — 122 y 130 con puerta F1.4 CERRADA — ~~EMPIEZA A LEER POR AQUÍ~~

**Pedido del humano:** «arranca la 135» → «arranca con la 130» → «arranca la 122 en paralelo».

### Estado de las tres

- **135 → `done`.** PR #218 mergeado, verificado **por archivos** contra `origin/dev` (la lección
  del #209): `lib/analytics/{types,metrics,ranges,filters}.ts` y las 3 aserciones nuevas de R22 en
  `tests/unit/analytics/filters.test.ts` están en `dev`. Delta medido contra un baseline real
  (segundo worktree sobre `origin/dev`): **cero regresiones**, +9 archivos / +180 tests.
- **122 (backend) → `in_progress`, fase 1 completa.** 41 requisitos, trazabilidad 41/41.
- **130 (frontend) → `in_progress`, fase 1 completa.** 41 requisitos, trazabilidad R1–R41.
- Ambas ramas **sincronizadas con `origin/dev`** (merge limpio) y con commit local, **sin push**.
  Ocupación tras el merge: `backend [122]` 1/2, `frontend [129, 130]` 2/2. Regla 1 respetada.

### ⚠️ Lo que hay que saber antes de tocar nada

- **La base ya NO está roja.** El chore `chore/saneamiento-deudas-arnes` (PR #232) dejó `dev` en
  `== init OK ==`: 665 archivos / 8052 tests, **0 rojos**. Se acabó el argumento de «delta 0 contra
  rojos ajenos» que arrastraba la 135: **estas dos features se miden contra CERO**. Y con eso queda
  sin excusa la **T6.1 de la 135**, que sigue sin marcar.
- **`tests/unit/analytics/frontera.guardia.test.ts` fue RETIRADO** por ese mismo chore (medía el
  diff de la rama actual; uno de sus casos llegaba a prohibir crear páginas). La 122 lo citaba en
  5 sitios, uno de ellos una task que habría pasado **en vacío pareciendo verde**. Corregido.
  `modulo-puro.guardia.test.ts` sigue vivo y censa el **directorio** `lib/analytics` (`:199-207`),
  no una lista fija, así que los módulos nuevos de la 122 quedan vigilados el día que existan.
- **Hueco declarado, NO tapado:** la parte *de rama* del viejo R33 (que el diff no cree
  migraciones, páginas ni componentes) **no la absorbe ningún guardia**. Se decidió no resucitar el
  guardia borrado —un guardia que mide el diff caduca en el siguiente merge y da verdes vacíos, que
  es justo por lo que lo retiraron— y degradar R33 a propiedad **verificada en el cierre a mano**
  por el reviewer. Está escrito así en `requirements.md`, `design.md §8` y `tasks.md T5.5`.

### 🚧 PENDIENTE HUMANO — bloquea el paso a fase 2

1. **Q3 de la 122: se le describió la consecuencia AL REVÉS.** Al elegir
   `orden.mensajero_asignado_id` se le dijo que «A sigue viendo la orden aunque ya no es suya y B no
   la ve hasta gestionarla» — eso es lo que hace la **otra** columna. Con la elegida, al reasignar
   A→B **B pasa a ver la orden entera, incluida la gestión de A, y A deja de verla**. La spec está
   escrita según la **columna** elegida (coherente con el precedente de la 159,
   `db/schema.prisma:478`) y la discrepancia queda como punto de vuelta en `requirements.md > D3` y
   `tasks.md > T0.3`. **Si la eligió por la consecuencia y no por la columna, hay que girarla.**
2. **`adminSatelite` + grano `mensajero`: nadie lo preguntó.** Se decidió que el `adminTienda` ve
   mensajeros **seudonimizados** porque no es su empleador; al `adminSatelite` la spec le asignó
   identidad **real** aplicando la misma razón al revés (sí opera a los mensajeros de su zona). Es
   una **derivación del spec_author, no una decisión humana**, y está marcada como tal.
3. **Aprobación del spec** de ambas para arrancar la fase 2.

### Hallazgos verificados que no se tapan

- **130 · H1:** esta feature **no tiene llamador en producción** hasta que aterrice la 131. El
  propio shell de la 129 lo dice. No venderlo como «ya integrado».
- **130 · H2:** el mensajero **sí** entra a `/analitica` (`ROLES_ANALITICA` lo incluye), luego
  `recharts` **sí** llega a su móvil; R26/R27 solo garantizan que llegue diferido.
- **130 · I11:** el stub de `ResizeObserver` (`tests/setup/jest-dom.ts:45-55`) tiene `observe(){}`
  **vacío**, así que `ResponsiveContainer` renderiza vacío en vez de reventar: un
  `querySelector("svg")` estaría **verde sin medir nada**. Por eso la única aserción sobre el lienzo
  exige **mutación probada** (T4.5).
- **130 · premisa falsa corregida:** se preguntó Q5 diciendo que `KpiValorAnimado` tenía test
  propio. **No lo tiene** (`tests/**/*Kpi*` → 0 archivos); su única red es indirecta vía los tests
  de sus dos consumidores. R37 crea el test que faltaba. Su copia en
  `app/(app)/mis-asignaciones/_components/` es **solo un re-export**, no un duplicado: arreglar el
  compartido cubre a los dos.
- **130 · limitación preexistente (H3):** `loadMonedaConfig` lee `process.env` con clave dinámica,
  así que en el navegador cae al default `es-CR`/`CRC`. **Ya afecta a cinco componentes
  `"use client"` en producción**; la 130 no la introduce, alinea el KPI con sus vecinos.
- **122 · un 403 de esta feature sería MUDO.** `normalizeError` devuelve temprano para cualquier
  `AppError` (`lib/errors/normalize.ts:21`) y solo loguea en la rama del error desconocido, así que
  un `ForbiddenError` bajo `withErrorHandler` no dejaría rastro. Por eso R40 exige llamada explícita
  al logger y **su test espía el logger, no el status**. (`docs/conventions.md:22` no nombra ningún
  canal; el real es `ErrorLogger`, `lib/errors/logger.ts:6-21`.)
- **Método:** un hecho de inventario **solo vale si se reproduce con `git show origin/dev:<ruta>`**.
  La primera redacción de la 130 dedujo un hallazgo falso midiendo respaldos en el scratchpad de
  otra sesión. Que tres copias coincidan entre sí no las hace actuales — solo hermanas.

## 🗓️ Sesión 2026-07-31 — feature 167 CERRADA + chore de saneamiento

**Feature 167 (apartado propio de recolección) → `done`, PR #231 MERGEADO.** Nació de un reporte de
uso —«no veo la forma de recolectar»— que resultó ser dos problemas: la base local del humano tenía 4
migraciones sin aplicar (sin `recolectando` no hay nada que recolectar) y la recolección vivía
escondida dentro de Entregas, donde el escáner desaparecía justo con la lista vacía. **El relato
completo, las decisiones y la deuda están en `progress/history.md`**; el detalle técnico, en
`impl_167-…` y `review_167-…`. Verificación final medida por el leader: `typecheck` verde,
`pnpm test` **8038/8045** (7 rojos, todos de 2 guards ajenos), `lint` sin un problema nuevo.

> **PENDIENTE HUMANO:** nadie ha visto todavía la cámara leer una etiqueta real. La lista de
> verificación en pantalla está en `impl_167-apartado-recoleccion-mensajero.md`.

### 🧹 Chore de saneamiento — rama `chore/saneamiento-deudas-arnes` (2026-07-31)

Pedido del humano: «arregla todo lo que viste». Cuatro deudas que la 167 destapó y que **no eran
suyas**. Estado:

- ✅ **Definiciones de agentes con un modelo inexistente.** Los cinco `.claude/agents/*.md` fijaban
  `model: opus-4.8` y el primer `backend_dev` de la 167 **murió al arrancar**; `spec_author` y
  `reviewer` sobrevivieron por no fijar modelo. **Se retiró la línea `model:` de los cuatro que la
  tenían**: heredar el modelo de la sesión es la única opción que no envejece. Las tablas de
  `AGENTS.md` y `leader.md` —que repetían la misma columna tres veces sin discriminar nada por
  `complexity`— se sustituyen por la regla y el porqué.
- ✅ **Registro saneado.** La **157 → `done`** (su código llevaba días en `dev` con la ficha en
  `spec_ready`; se mergeó en tres PRs: #217, #225 y #227, verificado por archivos contra
  `origin/dev`). El **id 162 duplicado** se resuelve renumerando la ficha de WhatsApp a **168**, con
  el mismo criterio que se aplicó a la 165: la de `ux` conserva el id porque ya tenía rama.
- ✅ **3 errores de lint en `OrdenesModule.tsx`** saldados. La causa no era la memoizacion sino un
  `= {}` INALCANZABLE en el destructuring de props: sin props congeladas, React Compiler descarta la
  optimizacion del componente entero. Se quita el default; sin `eslint-disable`.
- ✅ **Guard de frontera de la 135: RETIRADO.** Medía el diff de la rama actual y uno de sus casos
  prohibía crear páginas. La propiedad permanente ya la cubre `modulo-puro.guardia.test.ts`.
- ✅ **Drift de Prisma: era del `schema.prisma`, no de la base.** Las 10 sentencias son 10 defectos
  del modelo; se reconcilian con 9 líneas declarativas y **cero DDL**. Dos eran peligrosas en
  producción (una FK money-critical a `SET NULL` y un `RENAME` que dejaba mudo un `down.sql`).

> ✅ **`./init.sh` termina en `== init OK ==`: 665 archivos / 8052 tests, 0 rojos, 0 errores de lint.**
> Entregado en el **PR #232**. El último rojo era el guard `no-embalaje` acusando prosa de la 135 que
> nombra el propio guard: llevaba días rojo porque cada feature lo declaraba deuda ajena y seguía.

## 🗓️ Sesión 2026-07-30 (noche, cuarta) — feature 129: fase 1

**Pedido del humano: «comienza con la feature 129»** (analítica: ruta, shell y sidebar).

### ✅ Registro RECONCILIADO — la zona `frontend` estaba falsamente saturada

El registro declaraba **3 features `in_progress` en `frontend`** (161, 163, 164) y la regla 1 admite 2,
así que la 129 —que es `frontend`— parecía bloqueada de entrada. **No lo estaba: las tres ya están en
`dev`.** Se mergearon con el **PR #212** (`ux` → `dev`, MERGED el 2026-07-30 22:23Z); lo que faltaba era
el bookkeeping del F2.5, no el trabajo.

**Verificado POR ARCHIVOS contra `origin/dev`, no por el estado del PR** — que es la lección del #209
escrita más abajo: `hooks/useInstalarPwa.ts`, `components/shared/InstalarPwaButton.tsx`,
`components/shared/CarruselCards.tsx`, `components/shared/carrusel-rango.ts`, `components/ui/carousel.tsx`,
`hooks/useTonoAlIncrementar.ts` y `lib/audio/tono-notificacion.ts` están **todos** en `origin/dev`.

**161, 163 y 164 → `done`.** La zona `frontend` queda en **0 `in_progress`** y el aviso de arné que la
164 dejó anotado («`./init.sh` falla hasta que se cierre alguna») **queda saldado**.

> ⚠️ **`./init.sh` NO detectó la infracción de la regla 1 con las 3 abiertas.** El bloque que la valida
> está entero dentro de un `if command -v jq`, y **`jq` no está instalado en esta máquina** (solo emite
> el `warn` del paso 1). O sea: **el gate del que depende la regla 1 lleva tiempo sin ejecutarse**, y
> con él la comprobación 4 (specs presentes para features en vuelo). Cuarta aparición del patrón de
> este repo: *una herramienta que decide algo mirando lo que tiene a mano en vez de la fuente de verdad*.

### 🔴 `origin/dev` ESTÁ ROJO: 20 tests — y mi primera medición del baseline fue FALSA

**El dato que importa: `dev` tiene 20 tests rojos ahora mismo, y no los puso esta feature.** Viven en
`MisAsignacionesModule` (×16), `MisAsignacionesPage`, `MarcarLuegoToggle`, `ManifiestoFlujos` y
`EscanerRecepcion`. Reproducen en aislado (20/125), ninguno de esos archivos está modificado en la rama
de la 129 y en los cinco el grep de `analitica|menu-visibility|Sidebar|ROLES_ANALITICA` da **0**. Son
los **KPIs animados del rediseño del mensajero** que la bitácora de la rama `ux` ya declaraba como «14
rojas previas» → 18 → 20, y que **el PR #212 metió en `dev` sin que nadie los saldara**.

> ⚠️ **Consecuencia: cualquier feature que arranque desde `dev` hereda 20 rojos y no puede poner
> `./init.sh` en verde.** No es de la 129; es deuda de `dev` y necesita dueño.

**Y el error de método, que conviene que quede escrito.** Al arrancar medí `./init.sh` y leí
**«635 archivos / 7385 tests / 2 rojos»**, concluí que los 2 eran saturación de workers y di el baseline
por **verde**. Era falso. Esa corrida traía **11 `unhandled errors`** de arranque de workers de vitest y
reportó **635 archivos donde en realidad hay 649**: **catorce archivos nunca llegaron a ejecutarse**, y
entre ellos estaban los cinco que fallan. **Medí una suite degradada y la leí como sana.** Lo destapó el
implementer al reportar 20 rojos contra mis 2, y se confirmó corriendo los cinco archivos a mano.

> **LECCIÓN: en vitest, un recuento de archivos más bajo de lo normal y un bloque de `Errors` son parte
> del resultado, no ruido.** Una suite que no arranca del todo **no reporta rojo: reporta de menos.** El
> total de archivos hay que compararlo contra el esperado antes de creerse el número de fallos. Es la
> misma familia que el bug de `run_if` documentado dentro de `init.sh`: un gate que termina en verde
> porque **no llegó a mirar**, no porque estuviera bien.

### ✅ Los 20 rojos SE SALDARON — y el gate ahora corta en LINT, también por deuda de `dev`

`dev` avanzó **16 commits** durante la sesión (PRs #213-#221: la 157, dos hotfix, etiquetas en carga
masiva) y se integró en la rama de la 129 sin un solo conflicto: **`dev` no toca ni los archivos de la
129 ni `app/(app)/ranking/`**, así que el WIP ajeno sobrevivió al merge intacto.

- **Los 20 rojos desaparecieron.** Los saldó `25ab36e0` («restaura el filtro cantón/distrito y pone la
  suite entera en verde»). Re-medido tras el merge, no dado por hecho por el mensaje del commit: los 5
  archivos que fallaban + los 4 de la feature dan **9 archivos / 188 tests / 0 fallos**, y la **suite
  completa `pnpm test` da 652 archivos / 7753 tests / 0 FALLOS** — verde entera, con el WIP de ranking
  de la otra sesión dentro. (El recuento de archivos sube de 649 a 652 y es coherente: +2 de la feature,
  +1 del ranking ajeno. Comprobarlo es justamente la lección del párrafo anterior.)
- **⚠️ Pero `./init.sh` sigue sin poder ponerse verde, y otra vez no es de la 129:** corta en `lint`
  con **3 errores** en `app/(app)/ordenes/_components/OrdenesModule.tsx:340,345`
  (`Compilation Skipped: Existing memoization could not be preserved`, la regla del React Compiler).
  El archivo es **byte-idéntico a `origin/dev`** y lo introdujo `a4eb7813` («fix(ordenes): filtro sin
  estados retirados»). **Es deuda de `dev` y necesita dueño.**
- Efecto colateral: como `lint` corre **antes** que `test` en `init.sh`, mientras eso siga rojo el gate
  **nunca llega a ejecutar la suite**. Los números de tests hay que sacarlos con `pnpm test` aparte.

> **Segunda vez en la misma sesión que la 129 queda bloqueada por deuda ajena heredada de `dev`**:
> primero 20 tests, ahora 3 errores de lint. La feature en sí está limpia — sus 4 archivos dan 59/59.

### ⚠️ HAY OTRA SESIÓN VIVA EN ESTE MISMO CHECKOUT — no se cambió de rama

A mitad de sesión aparecieron cambios sin commitear que **no son de esta sesión**: un rediseño de podio
del ranking (`app/(app)/ranking/_components/RankingPodio.tsx` **untracked**, creado a las 19:59, y
`ranking-labels.ts` modificado a las 19:58 con `iniciales`, `anchoBarra` y `PODIO_LABELS`). Al abrir la
sesión `git status` estaba **limpio**, así que se escribieron **en vivo**.

**Decisión: no se creó la rama `feature/129-...` ni se movió HEAD.** Crear la rama habría arrastrado el
WIP ajeno, y cambiar de rama habría movido HEAD debajo de la otra sesión — que es exactamente el
incidente del `backend_dev` con worktree ya registrado. **La fase 1 solo escribe bajo `specs/`, así que
no necesita rama**; la creación de la rama se difiere a la fase 2. Al implementar hay que **volver a
mirar** si ese WIP sigue suelto.

### ✅ 129 ENTREGADA — **PR #224**, esperando merge humano

`https://github.com/nuformecuador-lgtm/ordenex/pull/224` · rama `feature/129-analitica-ruta-shell-sidebar`
· 7 commits · 15 archivos (+2377/−9) · **`MERGEABLE`** (`UNSTABLE` sólo mientras Vercel despliega).

**Reviewer: APROBADO-CON-NOTAS, 0 bloqueantes**, 7 menores (`progress/review_129.md`). **24/25 R
verificados hasta test no vacuo**; el 25.º («sin dependencias nuevas») se verifica por diff, que está
vacío. **20 mutaciones del reviewer, 17 discriminaron** — ninguna reutilizada de las 9 del implementer.

**Las 3 supervivientes quedaron cerradas antes del PR** (`473317e2`), y una de ellas era un defecto
real de lo entregado, no un hueco de test:

- **La nota de traspaso a la 133 inducía el bug que la feature previene.** Mandaba ampliar «DOS sitios»
  que hoy son **el mismo** (`roles: ROLES_ANALITICA`); seguirla al pie llevaba a desenganchar el ítem
  con un literal, que es exactamente lo que `R10` vigila. Reescrita: ampliar es **editar UNA constante**,
  con apartado de qué NO hacer y aviso de que `R3`, `R9` y las listas de `R17` se pondrán **rojos por
  diseño** —el rol se mueve de una lista a la otra, nunca se relaja el guard—.
- Las otras dos eran **tests que medían forma**: el icono se asertaba por unicidad de la *clave*, así
  que `chartColumn: Home` pasaba; y el encabezado se podía sustituir por un `div`+`h1` perdiendo
  `PageHeader` y `Container` sin que nada lo notara.
- **La cuarta no se tapó con un test frágil.** `"use client"` en la página **pasa los 59 tests** y sólo
  revienta en `next build`, arrastrando `pg`/Prisma al bundle del cliente. Se ejecutó el build de
  verdad: **exit 0** con `/analitica` en el manifiesto, y **exit 1** con la mutación puesta.

> ⚠️ **`init.sh` NO corre `next build`, así que la frontera RSC no la cubre ningún gate automático.**
> Y ojo con el atajo: **`pnpm build` encadena `tsx scripts/migrate-deploy.ts`**, que **aplica
> migraciones contra una base real**. Para sólo compilar, `pnpm exec next build`.

### 📝 Fase 1 de la 129 — spec escrita, puerta CERRADA

`specs/129-analitica-ruta-shell-sidebar/` (requirements EARS + design + tasks). La 129 es **solo el
andamio**: ruta, shell vacío e ítem de menú. **Cero métrica, cero gráficas, cero fetch.**

- **El `prefetch` que pide la ficha se declara FUERA DE ALCANCE con su razón**: la 129 tiene
  `depends_on: null` y las Server Actions de analítica **no existen todavía** (son la 125/126/127). Se
  deja el punto de extensión donde la 131 lo enchufará, en vez de inventar una fuente.
- **7 preguntas de puerta, T0 CERRADA y escrita EN el spec** (no solo aquí): las Q quedan marcadas
  `[x] RESUELTA` con su respuesta textual, y además viven como bloque `D1-D8` en `requirements.md`,
  propagadas a los R y al `design.md`. **Los R crecieron de 23 a 25**, y los dos nuevos salen de las
  propias decisiones: **`R10`** —el gate de la página y la visibilidad del ítem declaran el **mismo**
  conjunto de roles, con test que falla si divergen— y **`R16`**, la posición del ítem. Las respuestas:
  **Q1** el ítem es **solo `maestro`/`admin`** — la 129 **se desvía de su propia ficha a propósito**
  (dice cinco roles) porque hasta la 131 la página está vacía; **ampliar es alcance de la 133**.
  **Q2** etiqueta «Analítica». **Q3** `iconKey` nueva `chartColumn`. **Q4** pila vertical de regiones,
  no pestañas. **Q5** la región financiera la añade la 132. **Q6** (decisión del leader, no había regla
  escrita) el ítem va tras «Inicio» y antes de «Órdenes», porque comparte sus dos roles exactos.
- **Q7 — desfase de numeración confirmado, no cambio de alcance:** las fichas de la 130/131/132 citan
  «gráficas de 129» y «ruta 128» por una renumeración previa; mismo desfase en 124/125/126. Anotado en
  el `design.md` para que no confunda a quien implemente la 131. **`feature_list.json` no se tocó.**

### 🔎 Dos hallazgos de la verificación del spec

1. El mapa `iconKey -> componente lucide` vive en **`app/(app)/_components/Sidebar.tsx:138-151`** y su
   tipo es `Record<IconKey, SidebarIcon>` → añadir la clave a la union **rompe el build** hasta mapearla.
   Exhaustividad garantizada por el compilador; no hace falta un test que la vigile.
2. **`ROLES_SEED` es `Object.values(RolValue)` e incluye `apiKey`: son 6 valores, no 5.** El ítem
   «Perfil» lo usa como «cualquier rol autenticado», así que **hoy «Perfil» es visible también para
   `apiKey`** — preexistente, ajeno a la 129 y no se toca aquí, pero es una trampa para quien copie ese
   patrón creyendo que `ROLES_SEED` son los roles humanos. Queda escrito en el `design.md` §5.
3. **`ChartColumn` existe con ese nombre exacto** en el `lucide-react` instalado (`^1.23.0`,
   `lucide-react.d.ts:4138` lo declara y `:24763` lo exporta). Comprobado contra el paquete, no supuesto.

**Estado del registro:** **129 → `spec_ready`** con sus decisiones en el `status_note`. `in_progress` = **0**.

---

## 🏁 CIERRE 2026-07-30 (noche) — ~~EMPIEZA A LEER POR AQUÍ~~

> *(Ya no es el punto de entrada: lo es la «Sesión 2026-07-30 (noche, cuarta)» de arriba. Sigue válido
> en todo su detalle técnico; lo de arriba lo corrige en el estado del registro y en el baseline.)*
## 🗓️ Sesión 2026-07-30 (quater) — arranca el LOTE DE ANALÍTICA — **EMPIEZA A LEER POR AQUÍ**

> **Corrige el «CIERRE (noche)» de más abajo en un punto:** ese bloque dice «registro con CERO
> `in_progress`» y ya no es cierto — la **135 está `in_progress`** desde esta sesión. Todo lo demás
> de aquel cierre sigue en pie.

**Feature 135 → implementada y revisada.** Rama `feature/135-analitica-catalogo-kpis-rangos`,
nacida de `dev` @ `664840f3` y **sincronizada después con `dev` @ `72b75954`** (45 commits: los
PRs #208/#210/#211/#212). Spec: **36 R en EARS** (26 + 10 tras la puerta), 6 alternativas
descartadas, 12 hechos de inventario **leídos en el código**.

**Implementación:** `lib/analytics/{types,metrics,ranges,filters}.ts` + 9 suites propias.
Delta medido en árbol limpio: **617 archivos / 6973 tests → 626 / 7150**, cero regresiones.
**Reviewer APROBADO-CON-NOTAS: 35 de 36 R verificados POR MUTACIÓN** (38 mutaciones, 35 muertas,
3 supervivientes, todas el mismo punto de R22 — dos redes redundantes, sin agujero de
comportamiento). El R36 no es mutable: es la puerta ejecutable.

### ⚠️ El incidente de esta sesión, para que no se repita

**Otra sesión movió este checkout de `feature/135-…` a `ux` a mitad de la implementación**
(`git reflog`: `checkout: moving from feature/135-… to ux`, más un `reset`). El implementer se
quedó sin `specs/135-…/` en disco y perdió las casillas ya marcadas, el parche del guard y el
bookkeeping. **Hizo lo correcto: paró y no ejecutó nada destructivo.** El código sobrevivió por ser
untracked. Se recuperó montando un **worktree aparte** sobre la rama y moviendo allí los archivos,
**sin tocar el árbol compartido** ni sus ~100 archivos staged.

> **LECCIÓN: en un repo con varias sesiones vivas, la rama es un recurso compartido.** Antes de
> `checkout`, mirar si hay trabajo ajeno en vuelo; y si hay que recuperar una rama secuestrada,
> `git worktree` en vez de arrebatar el árbol de vuelta.

**El `typecheck` rojo NO era «cliente Prisma contaminado».** Ese fue el diagnóstico inicial —
plausible, y con delta 0 verificado dos veces— pero la causa real era otra: **`dev` había avanzado
45 commits** y la rama se había quedado atrás, sin el `orden_incidente` de la 158 que el cliente
generado ya conocía. Se resolvió sincronizando con `dev`, no regenerando nada.

> **Confirmado por segunda vez y por otra vía el 2026-07-30 (cierre):** `git diff origin/dev
> feature/135-… -- db/schema.prisma` sale **vacío** (los schemas son byte-idénticos) y
> `npx tsc --noEmit` da **exit 0**. **Regla que conviene fijar: antes de dar por bueno un
> «cliente Prisma contaminado», comparar los dos `db/schema.prisma`.** Si son iguales, la causa es
> otra. Se perdió tiempo dos veces con este diagnóstico.

### ✅ Cierre de la 135 — 2026-07-30, en worktree aparte (el checkout de `ux` no se movió)

**R22 cerrado por mutación.** Era el único hueco del review: 3 mutaciones vivas porque el
comportamiento estaba protegido por **dos redes redundantes** (el regex de ancho fijo y el
`.refine` del tope, que trata `NaN` como rechazo) y ningún test discriminaba una sola. Tres
aserciones nuevas, elegidas **midiendo**: `"2026-13-45"` (pasa el regex, `Date.parse` da `NaN`) y
`"+002026-07-15"` (año expandido ISO: el regex lo rechaza, `Date.parse` lo acepta). Las tres
mutaciones ahora **mueren por separado**. Suite de analítica 177 → **180 tests**.

> **Descartado sobre la marcha:** `"2026-02-30"` parecía el caso obvio de «fecha que no existe» y
> **no sirve** — V8 la desborda a marzo y `Date.parse` devuelve finito. Se vio corriéndolo.

**Delta contra `dev` MEDIDO con baseline propio**, no deducido de «esos rojos no son míos»:

| | archivos | tests | rojos |
|---|---|---|---|
| `dev` @ `72b75954` | 646 | 7627 | **22** |
| rama 135 | 655 | 7807 | **20** |

Los 20 son **subconjunto estricto** de los 22, test a test → **cero regresiones**, +9 archivos /
+180 tests.

**⚠️ `dev` ESTÁ ROJO con 20 tests, y no es de la 135.** Todos del rediseño de `ux` que entró por el
**PR #212**: filtros cantón/distrito de la 117 (`MisAsignacionesModule`) y las cards en reparto.
Es lo que mantiene `pnpm test` en rojo para cualquiera que ramifique de `dev` hoy.

**T0.3, T6.3 y T6.5 cerradas.** T6.5 avisó a **ocho** features (122, 123, 124, 125, 126, 127, 132,
133), no a las cinco que nombraba la task: `design.md §6.1` también dirige avisos a la 122 y a la
124/125. **T6.1 sigue sin marcar a propósito** — `./init.sh` no está verde y marcarla sería fingir.

**🆕 Ficha 166 registrada** (T0.3): saneamiento de la ventana de día de `RankingService`
(18:00–18:00 CR → día natural CR).

### ⚠️ DEFECTO DE REGISTRO SIN RESOLVER — el id 162 está DUPLICADO

`feature_list.json` tiene **dos features distintas con `id: 162`**: «notificación del sistema con la
app abierta (Notification API)» y «no enviar mensajes de whatsapp sobre órdenes en estado no
elegible». Es la **misma colisión** que obligó a renumerar la 161 → 165 al mergear `dev` en `ux`,
pero aquella renumeración **arregló un id de los cuatro**. Por eso la ficha nueva tomó el **166**.

**No se renumera desde la sesión:** las dos fichas están citadas por escrito fuera del registro (la
158 y este mismo archivo), así que cuál cede el id es **decisión del humano**. Mientras tanto,
cualquier búsqueda por id 162 devuelve dos cosas.

**Es la raíz del lote.** El orden lo dicta `depends_on`, no es elegible:
`135` → `122` (alcance por rol) → `127` → `128`/`132`/`134`, y `135` → `123` (rollup) → `124` →
`125` → `126` → `131` → `133`. `129` (ruta/shell) y `130` (gráficas) son frontend y no dependen de
nadie. **Ninguna de las 14 tenía spec en disco.**

**⏸️ PUERTA F1.4 ABIERTA — 10 preguntas bloqueantes** en `requirements.md > Preguntas abiertas`,
espejadas en el bloque `T0` de `tasks.md`. Las que más arrastran: **Q1** (la ficha no enumera ni una
métrica; el design propone 13 operativas + 6 financieras y cada una que entre obliga a la 126/127),
**Q6** (cuál es el «día operativo» canónico) y **Q5**/**Q9**/**Q10** (granos y atribución, que fijan
la PK del rollup de la 123).

### Tres correcciones a la ficha, verificadas en código

1. **`order_status` tiene 19 values vigentes, no 20.** La 154 apendió dos (18→20) y **la 155 retiró
   `en_fulfillment`** (20→19). Peor: su migración solo borra la fila del catálogo si nadie la
   referencia, así que en una base con historial **`en_fulfillment` sobrevive huérfana** e
   inalcanzable desde el código. Un embudo debe citar los 19 del seed, no lo que haya en la tabla.
2. **«La lógica de fecha del corte diario» que pide la ficha NO EXISTE.** `CorteDiarioService`
   no usa fecha alguna: opera sobre «mensajeros con actividad sin cierre». La lógica de día en hora
   CR vive en `lib/utils/fecha-cr.ts` y es reutilizable tal cual, sin extracción.
3. **`orden.zona_id` y `orden.tienda_id` son NOT NULL** → «órdenes sin zona/tienda» no puede
   ocurrir. Lo nullable es `mensajero_asignado_id` (y `distrito_id`) — de ahí sale Q5.

**🔎 Hallazgo que hay que resolver antes de implementar (Q6): hay dos convenciones de «día» vivas y
no coinciden.** `RankingService.ts:60-61` compara columnas `timestamp` contra `startOfDayCR` + 24 h,
o sea una ventana **18:00–18:00 hora CR**; los filtros de `/ordenes` (feature 144) usan
`inicioDelDiaCREnUtc`, o sea **00:00–24:00 CR**. Analítica no puede adoptar las dos, y elegir la
correcta hará que ranking y analítica reporten cifras distintas para «hoy» hasta que se sanee.

## 🏁 CIERRE 2026-07-30 (noche)

**Todo mergeado a `dev`. Registro con CERO `in_progress`.**

| PR | Qué | |
|---|---|---|
| **#208** | 158 · camino del mensajero (R1-R36) | ✅ mergeado |
| **#210** | 158 · camino del admin (R37-R64) | ✅ mergeado |
| **#168** | 141 · tabla `carga` + `carga_id` | ✅ mergeado, tras 3 días abierto |

**Gate final con todo conviviendo: 636 archivos / 7493 tests / 0 fallos.**

### ⚠️ LA TRAMPA DE ESTA SESIÓN, para que no se repita

**El PR #209 se mergeó contra `feature/158-incidente-indemnizacion` cuando esa rama YA se había
consumido** con el merge del #208 a `dev` tres horas antes. GitHub lo marcó **MERGED** y no avisó de
nada: el camino del admin —tabla `orden_incidente`, su migración, la página `/incidentes` y el segundo
emisor de wallet— **se quedó varado fuera de `dev`**. Se detectó verificando `origin/dev` **por
archivos** (cero coincidencias de `IncidenteAdmin`, `incidentes/` y `orden_incidente`) y se corrigió
con el **#210**.

> **LECCIÓN: en PRs apilados, si la base se mergea antes que el hijo, el hijo queda huérfano y su
> estado sigue diciendo MERGED.** Verificar SIEMPRE que el contenido llegó a `dev` **por archivos**,
> nunca por el estado del PR. De no haberse mirado, producción se habría llevado media feature 158 y
> una migración de menos.

### 🚀 Despliegue `dev → prod` — pre-vuelo COMPLETO

- **✅ `T24.1`: CERO órdenes**, re-corrida contra producción justo antes.
- **✅ El retiro de `en_fulfillment` es NO-OP en producción**: su `DELETE` es condicional y hay 8 filas
  de historial apuntando al value → la fila sobrevive inalcanzable, **sin violación de FK**.
- **🔎 Producción tiene un value `pendiente` vestigial** (0 órdenes, 0 historial). Explica el desfase
  «18 estados» de las specs frente a los 19 de la base.
- **⚠️ Cosmético tras desplegar:** el desplegable de filtro leerá `en_fulfillment` y `pendiente`, que
  no están en `ORDER_STATUS_SEED` → se muestran como **slug crudo** (fallback documentado, `R17` de la
  feature 29). No rompe.

### 📋 Decisiones que el humano delegó y quedaron aplicadas

- **`R56` DECLARADO** en la spec de la 141, antes de mergear el #168. Es el invariante que destapó la
  mutación superviviente: una orden revertida conserva `carga_id` y `download_url`. Redactado **más
  ancho que el mutante** a propósito.
- **Feature 162 REGISTRADA** — `OrdenEnvioReader.findParaEnvio` no filtra por estado, así que un
  mensajero puede seguir mandando plantillas de WhatsApp **al destinatario de un paquete robado**.
  Preexistente, agravado por Q-J + Q-K.

### 🧰 Deuda de arnés nueva, registrada y SIN tocar (no es de ninguna feature)

1. **`scripts/db-rollback.ts` elige la migración por NOMBRE de carpeta**, no por la última aplicada
   (`readdirSync` + `sort`, sin consultar `_prisma_migrations`). Correrlo dos veces revierte la misma
   migración dos veces.
2. **El orden obligatorio de los `down.sql` no lo impone ningún gate**: revertir la migración del PR 1
   de la 158 con la del admin aplicada **aborta**.
   > **Tercera y cuarta vez que una herramienta de este repo decide algo mirando el árbol de archivos
   > en vez de la fuente de verdad.** Las otras dos: los guards con `fs.readdir` en vez de
   > `git ls-files`, y la denylist de migraciones (muerta en el #207).
3. **E2E: decisión del humano el 2026-07-30 — «no más e2e, pruebas básicas nada más».** No se
   construye harness ni se escriben specs. Cuando `CHECKPOINTS.md` lo exija: declararlo **inaplicable
   con su razón** y **cubrir el riesgo concreto por otra vía**, como hizo el reviewer del PR 2
   probando la idempotencia contra el índice real de Postgres.

---

## 🗓️ Sesión 2026-07-30 (tarde)

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

### ✅ PR 2 de la 158 ENTREGADO — **PR #209** · y **PR #168 RESCATADO**

**PR #209** (`feature/158b-incidente-admin`) — ⚠️ **apilado sobre el #208, no sobre `dev`. Mergear el
#208 primero.** `./init.sh` **630 archivos / 7354 tests / 0 fallos** · `next build` exit 0 con
`/incidentes` en el manifiesto · **Reviewer OK, 0 bloqueantes**, 7 menores, **28/28 R verificados**,
**32 mutaciones, 31 discriminan**.

- **`R29` cumplido y verificado EN LAS DOS DIRECCIONES**: son exactamente dos emisores — un tercero
  pone el guard rojo **y quitar uno también**. Es igualdad, no `some()`.
- **Contra Postgres real**: el `USING` del down aborta con filas en las tres tablas; los 6 índices
  vuelven byte-idénticos; y **la idempotencia del egreso contra el índice real de la 42**, que hasta
  ahora sólo estaba simulada en memoria.
- **E2E declarado INAPLICABLE con razón verificada** (no por inercia): `./init.sh` no corre
  `test:e2e` y los 20+ specs existentes declaran *«WRITTEN but NOT EXECUTED»*. **No se dispensó
  gratis**: el reviewer cubrió por otra vía el riesgo concreto. **La deuda del harness sigue viva
  desde la 148.**
- **Alcance añadido a media fase por el humano**: el `adminSatelite` reporta desde
  `/recepcion-satelite`. El modal se **reusó, no se duplicó**. `en_ruta_bodega_satelite` queda fuera
  con razón escrita y el reviewer lo juzgó: **ningún requisito incumplido**.

**PR #168 (feature 141) RESCATADO** — de `CONFLICTING` a **`MERGEABLE`/`CLEAN`**. Un solo conflicto y
era `zonas-migration.test.ts`: la rama traía la denylist a mano de 107 líneas, `dev` el baseline
pinneado del #207. **Re-review OK, 0 bloqueantes, el veredicto del 27/07 sigue válido** y queda
**saldada su nota menor 2** (round-trip, hecho ahora con la 141 aplicada DESPUÉS de las del 28/29/30,
`DOWN` con datos vivos y RE-UP con esquema idéntico). 27 mutaciones, 26 muertas.

> **El mutante superviviente, cerrado:** añadir `carga_id = NULL, download_url = NULL` al `SET` de
> `deshacerAsignacionLote` dejaba **7110/7110 tests verdes**. El comportamiento era correcto, pero
> **nada lo protegía**. Test nuevo colocado a propósito LEJOS de los unitarios que afirman la *forma*
> del SQL. `./init.sh` 623 / 7112 / 0.

### 🚀 Pre-vuelo del despliegue `dev → prod` — HECHO el 2026-07-30

- **✅ `T24.1` PASA: CERO órdenes.** Consulta de retroactividad contra producción (solo lectura).
  Contexto comparable: órdenes en `devuelta` **2 → 0**, filas de historial **167 → 169**,
  `reprogramada`+`gestion` **10**, `reprogramada`+`reprogramacion_tienda` **0**.
- **✅ Verificado lo único que podía romper: no rompe.** La 155 retira `en_fulfillment` y producción
  tiene **8 filas de historial** apuntando a ese value. Su `DELETE` es **CONDICIONAL** y su comentario
  ya anticipaba este caso: en base con historial real es **NO-OP** y la fila del catálogo sobrevive,
  inalcanzable desde la app. **Sin violación de FK.**
- **🔎 Encontrado el desfase que las specs arrastraban:** producción tiene un value **`pendiente`** con
  **0 órdenes y 0 filas de historial** — vestigial. Por eso las specs decían «18 estados de hoy»
  mientras la base tiene 19.
- **⚠️ Consecuencia cosmética tras desplegar:** el desplegable de filtro leerá 21 filas, incluidas
  `en_fulfillment` y `pendiente`, que **no están en `ORDER_STATUS_SEED`**. El fallback está
  documentado (`R17` de la feature 29): **se muestran como slug crudo**. No rompe.

### ⏭️ Decisiones humanas pendientes al cerrar

1. **Desplegar `dev → prod`** (140 commits, tren 154+155+156). **No queda nada técnico por comprobar.**
2. **Mergear #208 → luego #209** (están apilados) y **#168**.
3. **¿Se añade el `R56` a la spec de la 141?** («al deshacer la asignación el sistema DEBE conservar
   `carga_id` y `download_url`»). Redactado más ancho que el mutante a propósito. **No se aplicó: es
   decisión humana.**
4. **⚠️ Candidata a ficha propia — `OrdenEnvioReader.findParaEnvio` NO filtra por estado**, sólo por
   `mensajeroAsignadoId`: un mensajero podría seguir mandando plantillas de WhatsApp **al destinatario
   de un paquete robado**. Patrón **preexistente** (pasa igual con `entregada`/`devuelta`), pero Q-J y
   Q-K juntas lo agravan.

### 🔨 PR 2 de la 158 — camino del admin (R37-R64) · detalle de implementación

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

## 🗓️ Sesión 2026-07-30 (ter) — feature 164: botón de instalar la PWA + screenshots

Salió de una pregunta del humano: *¿la PWA es instalable?* Respuesta comprobada archivo a
archivo: **sí en producción** (manifest, `display: standalone`, iconos 192/512 que son PNG
reales de esas dimensiones, SW con `fetch` que cae a `/offline.html`, HTTPS por Vercel, metas
de iOS). Faltaban el gesto propio y las capturas; pidió añadir ambos.

- **164 (frontend, `in_progress`)** — IMPLEMENTADA. `hooks/useInstalarPwa.ts` +
  `components/shared/InstalarPwaButton.tsx`, montado en `PageHeader`. Tres screenshots
  **reales** capturadas con Playwright contra la app corriendo (ocultando el indicador de dev
  de Next, que no puede acabar en una imagen publicada) y declaradas en el manifest.
  **27 tests propios verdes + 6 mutaciones, las 6 muertas.** Suite completa: 18 rojas, **las
  mismas que antes** → cero regresiones. Spec en `specs/164-instalar-pwa/`.
- **Guardia nueva**: `tests/unit/pwa/manifest.test.ts`. No existía NINGÚN test del manifest, y
  es un fallo silencioso de manual: si declara un archivo que no está, o dimensiones que no
  son, el navegador degrada el diálogo o deja de ofrecer la instalación **sin decir nada**.

**Hallazgo que conviene no olvidar: la instalabilidad NO se puede probar en local.** En dev el
registro des-registra los SW y limpia caches (`app/layout.tsx`), y además `sw.js` se
**autodestruye** con hostname `localhost`/`127.0.0.1` sin mirar `NODE_ENV` (`public/sw.js:7-9`)
— así que **`pnpm build && pnpm start` tampoco sirve**. Hace falta despliegue, túnel o un
hostname que no sea localhost.

**Límite del estándar, no de la implementación:** `beforeinstallprompt` es de Chromium. Safari
(iOS incluido) y Firefox no lo disparan nunca, así que ahí el botón **no aparece** y la
instalación sigue siendo manual. Guiar al mensajero de iPhone exige una ayuda aparte, **no
hecha**.

**⚠️ AVISO DE ARNÉS — decisión humana pendiente.** Con esta alta la zona `frontend` queda con
**TRES** features `in_progress` (161, 163, 164) y la regla 1 admite **dos**: `./init.sh` falla
en esa comprobación hasta que se cierre alguna. Se registró igual y se avisó, en vez de dejar
la feature sin registrar o de marcar otra como `done` sin haberla mergeado. Las tres están
implementadas y verificadas; ninguna está commiteada.

## 🗓️ Sesión 2026-07-30 (bis) — feature 163: carrusel de "En reparto" (vista mosaico)

Pedido directo del humano, en tres mensajes sucesivos: carrusel de shadcn de 3 en 3 por
breakpoints con etiqueta debajo ("orden 5 de 5" / "1-3 de 5") sobre las cards en reparto;
**solo en la vista mosaico**; y **el carrusel debe ser un componente shared**.

- **163 (frontend, `in_progress`)** — IMPLEMENTADA. Spec en `specs/163-carrusel-en-reparto/`.
  Dependencia NUEVA: `embla-carousel-react`. Piezas: `components/ui/carousel.tsx` (primitiva
  shadcn adaptada), `components/shared/CarruselCards.tsx` (compuesto genérico, D3) y
  `components/shared/carrusel-rango.ts` (la aritmética de la etiqueta, aparte para poder
  probarla sin layout). 23 tests propios verdes + **4 mutaciones, las 4 muertas**.
- **Dos desviaciones del shadcn original**, ambas forzadas y documentadas en el archivo: el
  estado de "se puede avanzar" se lee de embla con `useSyncExternalStore` porque aquí
  `react-hooks/set-state-in-effect` es **error**; y las flechas van debajo, no flotando fuera
  del contenedor (`-left-12` se sale del viewport en móvil, que es donde trabaja el mensajero).
- **`tests/setup/jest-dom.ts` gana un stub de `IntersectionObserver`**: embla lo EXIGE y sin él
  montar el carrusel LANZA. Medido: no empeora nada (en `Modal` + `MarcarLuegoToggle` pasa de
  3 fallos a 1).

**⚠️ El baseline de tests se movió DURANTE la sesión, y no por estas features.** A las 07:23
eran 14 rojas; ahora son 18. El delta se explica entero por cambios sin commitear que
entraron a las 08:02–08:04 en `AsignacionDetalle.tsx` y `GestionarOrdenPanel.tsx`: este último
ahora pinta `Parada ${orden.secuenciaRuta} de ${count}` —línea que **no existe en HEAD**— y eso
DUPLICA el texto que las cards ya mostraban, tumbando 4 tests por "Found multiple elements"
(`R28`, `R17`, `R1` de `MisAsignacionesModule` y `R19` de `MarcarLuegoToggle`). Comprobado
aislando: con la grilla en vez del carrusel y sin el stub, salen los mismos fallos. La 18.ª
(`Modal` R30) es flakiness bajo carga: aislada pasa.

**Sin verificar:** no se levantó la app. El arrastre táctil, el momentum y los cortes reales de
breakpoint (redimensionar de 1 a 2 a 3) NO los cubren los tests, porque jsdom no mide anchos.

## 🗓️ Sesión 2026-07-30 — feature 161 (tono de notificaciones) implementada

Arrancó como pregunta, no como feature: *«¿cómo agrego un tono breve para notificaciones, o
Google trae algo por defecto?»*. La respuesta define el alcance: **no hay API para invocar el
tono del sistema desde JS**; el tono nativo solo existe con la Notification API. Así que el
aviso in-app hay que generarlo.

- **161 (frontend, `in_progress`)** — IMPLEMENTADA y verificada por tests. Tono sintetizado con
  `AudioContext` (cero assets), en la **campana** y en el **chat del mensajero**. Spec completa
  en `specs/161-tono-notificacion/`, bitácora en `progress/impl_161-tono-notificacion.md`.
  R1–R24 mapeados uno a uno; 72 tests propios; **7 mutaciones, las 7 muertas**.
- **162 (frontend, `pending`)** — Notification API con la app abierta. **Registrada a pedido
  del humano, sin implementar.** Es la única vía al tono del SO. Web Push con la app cerrada
  sigue siendo otra feature, mayor.

**Requisito descubierto implementando (R24):** el diseño decía «el primer render no suena» y
estaba mal — el primer render ocurre antes de que resuelva el fetch, así que la primera carga
se leía como salto de 0 a N y sonaba al abrir un hilo con mensajes previos. **Lo cazó el test
de R23, no el diseño.** Y la mutación que quita esa guarda **sobrevivió** en su primera
versión (`null <= n` coacciona a 0); el test se reescribió para atacar lo que la guarda
protege de verdad y entonces murió.

**⚠️ `./init.sh` está ROJO, y no por esta feature.** Corta en `typecheck` por
`_TmpSincronizarPlantillasButton.tsx` y `_TmpProbarJobsButton.tsx` (untracked, WIP de otra
sesión), que importan `@/lib/actions/_tmp-sincronizar-plantillas` y `@/lib/actions/_tmp-probar-jobs`,
**módulos que no existen**. Hasta que se creen o se borren esos dos botones, el gate no puede
ponerse verde. Además la suite trae **14 rojas previas** (`MisAsignacionesModule` 13 +
`MisAsignacionesPage` 1) por los KPIs animados y los filtros cantón/distrito de la 117, ambos
en obra en esta rama `ux`. Medido retirando el enganche del chat: **mismas 14**.

**Sin verificar (no lo tapo):** la app no se levantó — los tests prueban CUÁNDO se pide el
tono, no que se oiga; falta **móvil real**, en particular iOS Safari (exige gesto y suspende el
contexto al ir a background), que es la prueba que vale.

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
| 71 | bloquear checkbox de órdenes con cierre sin resolver | fullstack | ⚠️ **Reevaluar: el diagnóstico previo apuntaba a código ya borrado.** Decía «`OrdenesApartado.tsx` no tiene `disabled` en el checkbox de fila», pero ese archivo se eliminó el 2026-07-31 con la vista legacy `OrdenesRevisionMaestro` (chore `borrar-vista-legacy-ordenes`). La superficie viva es `OrdenesListado`/`OrdenesModule`, que **sí** tiene `bloqueoSeleccion` (checkbox `disabled` + motivo en tooltip + aviso de página bloqueada). Falta comprobar qué queda por hacer contra ESA superficie —y si el `cierre` concreto de esta feature ya está cubierto por el bloqueo por zona existente— antes de darla por «sin empezar». La ficha de `feature_list.json` conserva el texto original a propósito: re-alcanzarla es decisión humana, no de este chore. |
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
