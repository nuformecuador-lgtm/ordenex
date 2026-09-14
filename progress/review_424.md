# 424 — El `admin` puede eliminar órdenes · Revisión

**Fecha:** 2026-09-14 · **Rama:** `feat/424-admin-elimina-ordenes` · **Árbol revisado:** `fcb91ce6`
(merge de `dev` sobre `95805f70`) · **Revisor:** reviewer

**Veredicto: OK — no hay bloqueantes.**

> Qué se revisó: `specs/424-admin-elimina-ordenes/{requirements,design,tasks}.md`,
> `progress/impl_424.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`,
> `CHECKPOINTS.md`, el diff completo `origin/dev...HEAD` (19 archivos) y los archivos reales del
> camino del borrado. **Dos mutaciones se reprodujeron aquí**, no se leyeron de la bitácora.
>
> ⚠️ **La reversión en sí no se revisa.** Que el `admin` vuelva a borrar —y que con ello el rastro
> deje de ser una sola persona— es pedido expreso del humano del 2026-09-14 con esa consecuencia
> sobre la mesa. Lo que sí se revisa, y es lo que aquí se mide, es **que la contrapartida que la
> sostiene esté de verdad en pie**.

---

## 1. Lo que este revisor MIDIÓ, y no leyó

### 1.1 ⭑ R20 — la derivación NO es decorativa (mutación 1, reproducida)

Es el corazón de la ficha: `puedeEliminar` en `app/(app)/ordenes/page.tsx` era una copia literal
de la regla y tenía que pasar a derivarse de la fuente única. La prueba es que tocar **solo** la
regla ponga rojo el caso de **pantalla**, sin tocar `page.tsx`.

Mutación aplicada, en un único archivo (`lib/services/alcance-borrado-orden.ts:94`):

```
-  if (actor.rol === "maestro" || actor.rol === "admin") return { alcance: "todas" };
+  if (actor.rol === "maestro") return { alcance: "todas" };
```

Resultado medido (`pnpm exec vitest run`):

```
 ❯ tests/components/OrdenesPage.test.tsx (15 tests | 1 failed) 2560ms
 FAIL  tests/components/OrdenesPage.test.tsx > OrdenesPage
       > ⭑ eliminar: el `admin` SÍ recibe la casilla y la acción «Eliminar» (ficha 424)
 ❯ tests/unit/services/alcance-borrado-orden.test.ts (8 tests | 2 failed)
 Test Files  1 failed | 1 passed (2)   ← el que pasa es api-orden-eliminacion-service (T5)
```

**Confirmado.** Ni una línea de `page.tsx` en la mutación y el caso de pantalla cae. La derivación
es el mismo punto de decisión; el defecto de la 358 (dos listas que contestan la misma pregunta)
no sigue vivo con otra cara.

Y el detalle que hace que el caso sirva: **afirma la acción «Eliminar», no solo la casilla**. El
`admin` ya tenía columna de casillas por sus acciones de lote, así que un test que mirara solo la
casilla habría quedado **verde** con la regla revertida. Está escrito en el propio caso.
Contrapeso presente: «eliminar: al `admin` NO se le ofrece sobre una fila que el servidor NO marca
eliminable» (fila con `eliminable: false`, barra presente, botón ausente) — impide que
`puedeEliminar` ignore el campo del DTO.

Y el barrido de la segunda lista da cero: el literal
`rol === RolValue.maestro || rol === RolValue.adminTienda` ya no existe en `page.tsx`.
`puedeVerEliminadas` sigue siendo el literal `rol === RolValue.maestro` (R18), como exigía T6.1.
La Server Action `lib/actions/eliminar-orden.ts` **no tiene lista de roles propia**: delega en el
service. R20 se sostiene en todo el camino, no solo en la página.

### 1.2 ⭑ T7/T8 — el rastro mide de verdad (mutación 3, reproducida)

Era la tanda bloqueante. Se aplicó la mutación en `lib/repositories/registrar-accion.ts:136` —el
rol congelado pasa a `actorRol: null`— y se corrieron los dos archivos contra el Postgres local:

```
 ❯ tests/integration/db/orden-eliminada-actor-admin.test.ts (5 tests | 3 failed) 485ms
 ❯ tests/integration/db/historial-accion-lectura.test.ts    (18 tests | 1 failed) 749ms
 AssertionError: expected null to be 'admin'   ← en los 4 casos
 Test Files  2 failed (2)
```

**Confirmado: no pasan por construcción.** Y se revisaron una por una las tres formas conocidas de
test falso en este repo:

| Modo de fallo | Veredicto | Evidencia |
| --- | --- | --- |
| **Aserción contra su propia fuente** | **no aplica** | la fila se lee de la tabla `historial_accion` con Prisma; el `admin` lo siembra el test y el nombre compuesto lo arma el código de producción (`resolverActorCongelado`), no el test. En T4 la referencia es `ELIMINABLES_ESPERADOS`, **escrita a mano en `tests/fixtures/`**, fuera de `lib/` — comprobado leyendo el fixture |
| **El `return` temprano que reporta `passed`** | **no aplica** | `beforeAll` **lanza** si `fksDeOrden` devuelve `null`, en los dos archivos. Los `if (r.status !== "ok") return` que hay son estrechamiento de tipo **después** de un `expect(...).toBe("ok")` que ya habría fallado |
| **Dobles que no ven el SQL** | **no aplica** | `OrdenRepository.softDelete` real, `queryRaw` real, `HistorialAccionRepository`/`HistorialAccionService` reales sobre la transacción. La escritura la hace el borrado de una orden de verdad, no un insert a mano |

Anti-vacuidad presente y explícita: un caso propio afirma que el actor sembrado **tiene rol `admin`
de verdad**, leído por la relación desde la base; el caso de la promoción afirma que el rol **vivo**
sí cambió antes de exigir que el congelado no; y T8 afirma `eliminadas === 1` antes de consultar,
más un control positivo (el `maestro` ve `total: 1`) que impide que los dos `forbidden` del `admin`
estén verdes sobre un registro vacío.

**Y no se saltaron en el gate.** `progress/gate_424.log`:

```
 ✓ tests/integration/db/historial-accion-lectura.test.ts     (18 tests) 1166ms
 ✓ tests/integration/db/orden-eliminada-actor-admin.test.ts   (5 tests)  566ms
 ✓ tests/integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts (5 tests) 686ms
 ✓ tests/integration/db/eliminar-orden-api-frontera-tienda.test.ts      (1 test)  514ms
```

Los 26 `skipped` de la corrida son de `ranking-snapshot-migration` (preexistente, ajeno).

### 1.3 El árbol quedó limpio

Las dos mutaciones se revirtieron con `git checkout --` y se verificó: `git status --porcelain
--untracked-files=no` sin salida y `git diff HEAD` vacío.

---

## 2. Checklist de `CHECKPOINTS.md`, punto por punto

| punto | veredicto | evidencia |
| --- | --- | --- |
| `requirements.md` con EARS numerados | OK | R1–R20, más «Decisiones cerradas por el humano» D1–D4 |
| `design.md` con alternativa descartada y su porqué | OK | ocho (A1–A8), cada una con su motivo |
| `tasks.md` con TODAS las tasks `[x]` | **NO** | **el archivo no tiene ni una casilla.** Hallazgo **m2** (contabilidad, no sustancia) |
| Cada `R<n>` mapea a un test concreto | **OK** | mapa de §3, verificado uno por uno contra los archivos |
| `progress/impl_<feature>.md` con el mapa `R<n> → test` | OK | `progress/impl_424.md` §2; se comprobó que los nombres de caso existen de verdad |
| `pnpm run typecheck` sin errores | OK | `gate_424.log`: «✓ typecheck paso» |
| `pnpm run lint` sin errores | OK | 184 warnings, 0 errores — baseline del repo, no de esta ficha |
| `pnpm test` pasa | OK | `gate_424.log`: 1960 archivos pasados de 1960; 28538 tests pasados, 26 saltados; `INIT_EXIT=0` |
| E2E para flujo crítico | **inaplicable** | no hay arnés Playwright en el repo. El riesgo queda cubierto por T7/T8 **contra Postgres real** y por la matriz de 22 estados × 3 roles de `eliminar-criterio-unico` |
| RLS en tablas nuevas | **N/A** | **cero migraciones**: el diff no toca `db/`, `lib/types/` ni configuración de build. Verificado en `git diff --stat origin/dev...HEAD`. `historial_accion` ya tenía RLS sin policies (solo service role) y no cambia |
| Migraciones con `down.sql` | **N/A** | no hay migración. El enum `rol_value` ya contenía `admin`, así que tampoco aparece el problema de los `down.sql` que recrean-con-lista |
| Ningún secreto hardcodeado | OK | barrido del diff por `any`, `process.env`, password, secret y token: solo `passwordHash: "x"` en dos fixtures dentro de transacciones revertidas |
| Webhooks validan firma / idempotentes | **N/A** | la ficha no toca webhooks |
| Controller sin queries ni lógica | OK | `lib/actions/eliminar-orden.ts` sin cambios y sin lista de roles propia |
| Service sin HTTP | OK | `alcance-borrado-orden.ts` es puro: su único import es **de tipo** (`import type { Actor }`). Sin Prisma, sin `next/`, sin entorno |
| Repository solo queries | OK | `lib/repositories/**` **no aparece en el diff** |
| Interfaces en `lib/interfaces/` | OK | sin cambios de contrato |
| Páginas protegidas validan en servidor | OK | `resolveActorFromSession()` y `notFound()` para mensajero/adminSatelite; las Server Actions revalidan |
| Componentes `private/` por props | OK | `OrdenesListado` recibe `puedeEliminar` por prop y **no cambia ni una línea de código** (solo comentarios) |
| Mutaciones por Server Actions | OK | sin ruta API nueva (D1: el canal por API key **no** se abre) |
| Sin hardcode de país/moneda/cuenta | OK | nada de eso en el diff |
| `./init.sh` en verde | OK | `INIT_EXIT=0` escrito **dentro** del log |
| `progress/review_<feature>.md` con veredicto OK | OK | este archivo |
| Entrada en `progress/history.md` | **NO** | hallazgo **m3** (cierre del leader) |

---

## 3. Trazabilidad `R<n> → test`, verificada

Cada línea se comprobó abriendo el archivo y leyendo el caso; no se copió del informe del
implementador.

| R | Test que lo fija | Verificado |
| --- | --- | --- |
| R1 | `eliminar-orden-service.test.ts` › *⭑ (a) borra una orden eliminable de CUALQUIER tienda, con `ownerId: null`* | OK — afirma el **argumento** (`softDelete` llamado con `ownerId: null` y el `actorUsuarioId`), no solo el `status`. Es lo que separa «todas» de la alternativa A4 (permiso que no permite nada) |
| R2 | mismo archivo › *(b) lote mixto → `conflict` y NO borra ninguna*, *(c) el motivo POR ORDEN* | OK — (c) lleva un `toEqual` **literal** con los cuatro motivos **y además** compara contra la respuesta del `maestro`. La comparación no sustituye a la lista: si lo hiciera sería aserción contra su propia fuente |
| R3 | `alcance-borrado-orden.test.ts` › *adminTienda/apiKey → propias* + `integration/db/eliminar-orden-pantalla-frontera-tienda.test.ts` | OK |
| R4 | `eliminar-orden-pantalla-frontera-tienda.test.ts` › *⭑ R2: la tienda A pide borrar la orden de la B — cero filas afectadas* | OK — ataque directo al repositorio, contra Postgres. Verde en el gate |
| R5 | `eliminar-orden-service.test.ts` › *%s recibe forbidden y NO se toca la base* | OK — la tabla **no queda vacía**: `adminSatelite` y `mensajero` siguen dentro como testigos vivos |
| R6 | `alcance-borrado-orden.test.ts` › *la lista es de INCLUSION…* | OK — recorre `Object.values(RolValue)`, el enum real de Prisma, no una lista a mano |
| R7 | `OrdenesPage.test.tsx` › *⭑ eliminar: el `admin` SÍ recibe…* + el contrapeso con `eliminable: false` | OK — **reproducido en rojo por mí** (§1.1) |
| R8 | `eliminar-criterio-unico.test.ts` › *%s (admin): la UI ofrece exactamente lo que el servidor autoriza…* (22 estados) | OK — **tres patas**: coincidencia UI↔servidor, referencia contra `ELIMINABLES_ESPERADOS` (fixture escrito a mano) y la mitad de los intentos. La segunda es la que impide que «los dos dicen false» pase por verde |
| R9 | `api-orden-eliminacion-service.test.ts` › *R3: el owner que llega al repositorio es SIEMPRE `actor.usuarioId`* + `integration/db/eliminar-orden-api-frontera-tienda.test.ts` | OK |
| R10 | `api-orden-eliminacion-service.test.ts` › *⭑ un actor con alcance «todas» (`admin`) → `not_found`, y NO se toca la base* | OK — `not.toHaveBeenCalled()` en **los dos** métodos del repo, y el control con `maestro` deja claro que el rechazo es por ALCANCE y no por nombre de rol. **Verificado por mí que se queda VERDE bajo la mutación 1** (§1.1): la afirmación es indiferente al rol del `admin`, que es lo que la hace útil |
| R11 | `orden-eliminada-actor-admin.test.ts` › *⭑ R11/R12: dos órdenes borradas por un `admin` dejan DOS filas…* | OK — **reproducido en rojo por mí** (§1.2) |
| R12 | mismo caso + *R12: el rol congelado sigue siendo `admin` aunque después se le cambie el rol VIVO* | OK — **reproducido en rojo por mí**; el caso lleva su control (el rol vivo sí cambió) |
| R13 | `orden-eliminada-actor-admin.test.ts` › *⭑ R13: las dos filas comparten UN `lote_id`…* | OK — dos actos, un lote cada uno, distintos |
| R14 | mismo archivo › *⭑ R14: una orden YA borrada dentro del mismo lote NO deja fila* | OK — mata la mutación «construir las entradas con los ids PEDIDOS» |
| R15 | `historial-accion-lectura.test.ts` › *424/T8* › *⭑ R15: filtrando por «orden eliminada» y por ese actor…* | OK — **por el camino real** (`HistorialAccionService.listar`), con caso negativo por otro actor. **Reproducido en rojo por mí** |
| R16 | `lectura-borde-y-servicio.test.ts` (la tabla `DENEGADOS` incluye `admin`, con el repositorio no llamado) + `historial-accion-lectura.test.ts` › *R16: … `forbidden` por el camino real* | OK — este último lleva **control positivo** en el mismo caso |
| R17 | `recuperar-orden-service.test.ts` › *admin recibe forbidden y NO se toca la base* | OK — el `admin` **se queda** en esa tabla, ahora como decisión escrita (D1) |
| R18 | `orden-service-filtros.test.ts` › *filtro ELIMINADAS* › *admin → forbidden* + `puedeVerEliminadas` intacto | OK |
| R19 | `orden-eliminada-actor-admin.test.ts` › caso R11/R12 | OK — las filas de `orden` siguen existiendo con `deletedAt` puesto y cero transiciones nuevas en `ordenHistorialEstado` |
| R20 | `page.tsx` sin segunda lista + **mutación 1** | **OK — medido por mí** (§1.1) |

**Ningún `R<n>` queda sin test, y ningún test del mapa resultó vacío.**

---

## 4. Los cinco puntos que se pidieron con lupa

1. **R20 y su mutación** — ✅ reproducida. Rojo en pantalla tocando solo la regla. §1.1.
2. **El rastro (T7/T8)** — ✅ mide de verdad. Mutación 3 reproducida; las tres formas de test falso
   descartadas una por una. §1.2. **La contrapartida que sostiene la reversión está en pie.**
3. **El test que se INVIERTE** — ✅ con su motivo escrito (fecha, autor y por qué la casilla sola no
   bastaba). Y el `toEqual` de `alcance-borrado-orden.test.ts` **se actualizó, no se relajó**: sigue
   siendo un `toEqual` sobre la clasificación **completa** del catálogo, con los tres arrays y su
   orden — nada de `objectContaining`, `toMatchObject` ni `arrayContaining`, y ningún rol
   desaparecido (los 6 siguen clasificados). Lo confirma la salida de la mutación 1, que lo delató
   con un diff de arrays.
4. **El canal por API sigue cerrado** — ✅ fijado por T5, con `not.toHaveBeenCalled()` en los dos
   métodos del repositorio y un control con `maestro`. Y verificado que **no** se pone rojo con la
   mutación 1.
5. **Lo que protege a las tiendas entre sí** — ✅ **intacto**. `lib/repositories/OrdenRepository.ts`
   **no aparece en el diff**; el `ownerId` sigue bajando al `where` de la misma sentencia (el filtro
   por `tienda_id` dentro del `UPDATE … RETURNING`, parametrizado), y
   `eliminar-orden-pantalla-frontera-tienda.test.ts` corrió verde en el gate.

---

## 5. Hallazgos

### Bloqueantes

**Ninguno.**

### Menores

- **m1 — Comentario que quedó mintiendo, y justo en el archivo que T10 no barrió.**
  `lib/repositories/OrdenRepository.ts:2338` sigue diciendo que `ownerId: null` es «sin frontera» y
  «solo lo produce el `maestro`». Desde esta ficha también lo produce el `admin`. El criterio de
  «hecho» de T10 barría `lib/services/`, `lib/actions/` y `app/(app)/ordenes/` —
  `lib/repositories/` se quedó fuera, y ahí es donde vive la línea. Es exactamente el tipo de
  afirmación viva y falsa que T10 existía para matar. **Una línea de comentario**; no cambia
  comportamiento ni test.
  (El otro hit del barrido, `EliminarOrdenService.ts:86`, es una **cita histórica** dentro del
  bloque nuevo —«Hasta hoy este bloque decía lo contrario»— y es correcta.)

- **m2 — `tasks.md` no tiene ni una casilla `[x]`.** `CHECKPOINTS.md` pide «todas las tasks marcadas
  `[x]`» y este `tasks.md` usa `**Hecho cuando:**` en prosa, sin casillas. Es **contabilidad, no
  sustancia**: T1–T12 están todas hechas y verificadas arriba. Mismo hallazgo que el M1 de
  `progress/review_426.md`, y el repo va inconsistente (la 422 tiene 17 marcadas, la 423 ninguna).
  Conviene decidir la convención de una vez, en vez de arrastrarla ficha a ficha.

- **m3 — Cierre pendiente del leader.** `feature_list.json` tiene la 424 en `status: "pending"` pese
  a estar implementada y sincronizada con `dev`, y `progress/history.md` no tiene entrada de la 424
  (último punto de «Verificación final» de `CHECKPOINTS.md`). No lo toca este revisor: escribir
  `feature_list.json` desde dentro de un agente ya revirtió cierres dos veces en este repo.

- **m4 — `page.tsx` pasa a ser la ÚNICA página del repo que importa de `lib/services/`.** Comprobado
  con un barrido de imports sobre todos los `page.tsx` de `app/(app)/`: devuelve **solo** este
  archivo. **No es un hallazgo en contra del diseño** —la alternativa es la segunda lista de roles
  que R20 prohíbe, y la función es genuinamente pura (su único import es de tipo)—, pero si se
  quiere conservar la forma «las páginas no importan servicios», el sitio natural de
  `resolverAlcanceBorradoOrden` es `lib/auth/`, junto a `esAccesoTotal`, que es lo que esta misma
  página ya importa para la misma clase de pregunta. Mover el archivo es mecánico (3 servicios y 1
  página) y no cambia ni una aserción. **Deuda de colocación, no de corrección.**

- **m5 — T7/T8 siguen tras un `describe.skip` silencioso.** Sin `DATABASE_URL` resoluble,
  `HAY_BASE_DE_DATOS` los apaga y el gate sale verde **sin haber medido la contrapartida**. En esta
  corrida **sí se midieron** (18 y 5 tests con aserciones, comprobado en el log y repetido por mí),
  y `tasks.md` lo avisa en su cabecera. Se deja escrito porque el modo de fallo sigue alcanzable
  para la siguiente persona que corra el gate en una máquina sin `.env`.

- **m6 — La cabecera del bloque de `page.tsx` abre con una frase hoy falsa.** Las líneas 97–100
  siguen siendo el párrafo del 2026-08-27 («ELIMINAR una orden —y RECUPERAR…— es SOLO del
  `maestro`») y solo diez líneas más abajo llegan los capítulos de la 358 y la 424 que lo corrigen.
  Es la convención del repo (añadir capítulo, no tachar) y se aplica igual en los otros archivos,
  así que **no se pide cambiarlo**; se anota porque la primera línea que lee alguien de prisa ya no
  es cierta.

- **m7 — El índice del MCP `codebase-memory` no conoce este módulo.** `search_graph` con
  `resolverAlcanceBorradoOrden` devuelve `total: 0`, y una búsqueda por patrón de nombre sobre
  `AlcanceBorrado` también `0`, pese a que el archivo existe desde la ficha 358 (2026-09-02) y lo
  importan cuatro sitios. Confirma lo que reportó el implementador en su §6.4. Aquí el índice **no
  mintió devolviendo de más**: simplemente no sabe. Esta revisión se hizo sobre el diff (`git show`)
  y leyendo los archivos reales, que es lo que la regla 7 manda antes de concluir nada. **Toca
  reindexar.**

### Lo que NO se contó como hallazgo (y por qué)

- La **reversión en sí** y su consecuencia sobre el rastro: decisión del humano del 2026-09-14, con
  el motivo del estrechamiento sobre la mesa. El debate no se reabre aquí.
- Los **184 warnings de lint**: baseline del repo, cero en los 19 archivos de esta ficha.
- Que el `admin` **no** vea ni recupere lo borrado, ni lea `/histórico/acciones`: límites aceptados,
  escritos en `requirements.md` D1/D2 y **medidos** (R16/R17/R18).
- Las **incidencias del worktree** (`node_modules`, `analytics-daily-migration`): entorno, ya
  resuelto; el gate corrió limpio en el árbol principal con 1960/1960.

---

## 6. Veredicto final

**OK.** No hay bloqueantes.

Lo que había que demostrar, se demostró midiendo y no razonando: **la derivación de R20 muerde**
(tocar solo la regla pone rojo el caso de pantalla) y **la contrapartida que sostiene la reversión
está en pie y se mide de verdad** (el rastro queda con rol `admin` congelado y el `maestro` lo
encuentra; los dos casos caen al romper el congelado). La frontera entre tiendas no se tocó, y el
canal por API key sigue cerrado por decisión escrita y fijada con un test.

Los siete hallazgos son menores. El único que pide teclado es **m1** (una línea de comentario en
`OrdenRepository.ts`); **m3** es cierre del leader y **m4** es una decisión de colocación que
conviene tomar a conciencia, no un arreglo urgente.
