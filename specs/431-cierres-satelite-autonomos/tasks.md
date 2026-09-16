# Ficha 431 — desglose

Convenciones: `[P]` = puede ir en paralelo con las otras `[P]` de su fase. Cada tarea lleva su
criterio de **Hecho**. Las fases se hacen **en orden**; dentro de una fase, las dependencias están
escritas.

> **Antes de empezar:** leer `progress/design_sf001_p1_cierres_satelite.md`, `requirements.md` y
> `design.md` de esta carpeta. **Q1 (los 32 históricos) tiene que estar contestada por el humano antes
> de T5**: es lo único que bloquea la migración.
>
> **Esta ficha lleva migración → el gate rápido se niega.** El veredicto sale de `./init.sh` completo
> **con `.env`**, y se miran los `skipped`.

---

## Fase 0 — medir antes de tocar

### [ ] T0 — La foto de producción, en solo lectura
Contra producción y **sin escribir**, medir y dejar los números en `progress/impl_431.md`:
1. `SELECT estado, count(*), sum(total_general) FROM cierre_bodega GROUP BY estado;`
2. lo mismo por `zona_id` (cuántas satélites y cuánto cada una);
3. `SELECT count(*) FROM cierre_bodega WHERE estado='solicitado';` (el diseño previo midió **0**);
4. `SELECT max(updated_at), max(resuelto_at) FROM cierre_bodega;` — la referencia con la que T25
   probará que el backfill no tocó nada más.
**Hecho:** los cuatro números escritos con su fecha, y **el saldo que la pantalla enseñará el primer
día bajo cada respuesta a Q1** dicho en una línea (con Q1 = «sí», debe ser `0.00`).
**Depende de:** nada. **Bloquea:** T5, T25.

---

## Fase 1 — base de datos y catálogo

### [ ] T1 — Migración A: los dos valores del enum
`db/migrations/20260916120000_historial_accion_conciliacion_bodega/` con `migration.sql`
(`ALTER TYPE … ADD VALUE IF NOT EXISTS` ×2) y `down.sql` que **recrea** `historial_accion_tipo` con la
lista previa y recastea `historial_accion.accion` (patrón de
`20260907120100_historial_accion_nodo_geografico_renombrado/down.sql`).
**Hecho:** `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte sobre una base limpia; el
`down.sql` lleva escritas **las dos advertencias** de `design.md §1.4` (precondición ruidosa; la lista
es una foto de esta rama). **Ningún `down.sql` anterior se toca.**

### [ ] T2 `[P]` — El catálogo de acciones
`lib/types/historial-accion.ts`: los dos tipos nuevos en la lista, en `CATEGORIA_POR_ACCION`
(`mueve_dinero`) y en `ACCION_LABELS`, con el motivo de la categoría escrito al lado como hacen los 13
precedentes.
**Hecho:** typecheck verde (los dos `satisfies`/`_AsegurarExhaustivo` cierran en las dos direcciones)
y el conteo del comentario de cabecera actualizado. **Depende de:** T1 (el cliente Prisma tiene que
conocer los valores).

### [ ] T3 `[P]` — La guardia del censo de historial
`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: dos entradas nuevas
(`marcarConciliado`, `revertirConciliacion`, forma `abre_tx`, mutación `/tx\.cierreBodega\.updateMany\(/`),
con el comentario de por qué son **dos métodos y no uno** (la guardia mide por método).
**Hecho:** la guardia **falla** ahora (los métodos aún no existen) y pasa al terminar T7. Se deja roja
a propósito solo dentro de la fase; no se commitea roja.

### [ ] T4 — `db/schema.prisma`
Las cuatro columnas en `CierreBodega` con sus `@map`, la relación `conciliadoPorUsuario` en `Usuario`,
y los dos índices nuevos. Comentario al lado de cada columna con su significado y su nulabilidad.
**Hecho:** `pnpm exec prisma validate` y `prisma generate` verdes; el `schema` no introduce ningún
cambio que la migración no haga (sin drift).

### [ ] T5 — Migración B: columnas, backfill, `CHECK`, índices
`db/migrations/20260916120100_cierre_bodega_conciliacion/` con el orden exacto de `design.md §1.4`:
columnas + FK → **backfill** → los dos `CHECK` → `DROP INDEX cierre_bodega_zona_solicitado_uq` →
los dos índices nuevos. `down.sql` inverso, **recreando el índice único**, con la advertencia de que
falla si alguna zona tiene dos `solicitado`.
**Hecho:** aplica sobre una base con datos; el `CHECK` se añade **después** del backfill y por tanto lo
valida; `prisma migrate status` limpio. **Depende de:** T0, T4 y la respuesta a **Q1**.

### [ ] T6 — Integración: los dos `CHECK` existen y muerden
`tests/integration/db/cierre-bodega-conciliacion.int.test.ts` (nuevo): (a) `aprobado` sin marca →
error; (b) marca sin `aprobado` → error; (c) `monto_recibido` negativo → error; (d) el camino viejo
`resolverCierreBodega(nuevoEstado:'aprobado')` → **error de la base** (R15/§1.2).
**Hecho:** los cuatro casos rojos contra Postgres real y **ninguno** con `if (!x) return;` — el test se
mata primero con una mutación que quite un `CHECK` y se comprueba que el caso falla.

---

## Fase 2 — la escritura de la marca

### [ ] T7 — `marcarConciliado` y `revertirConciliacion`
En `lib/repositories/CierresBodegaAdminRepository.ts` + `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts`,
según `design.md §4.1`: `$transaction` propia, guarda por estado en el `WHERE`, `appendAccion(tx, …)`
**dentro** del callback, espejo de `resuelto_at`/`resuelto_por`, y el `monto` de la reversión = el
monto que se borra.
**Hecho:** T3 pasa a verde; unitarios de repositorio con el doble de Prisma que afirman el `where`
exacto de las dos guardas y los tres desenlaces (`updated`/`conflict`/`fuera_de_alcance`).

### [ ] T8 — Servicio, borde y acciones
`lib/services/ConciliacionSatelitesService.ts` + su interfaz + `lib/actions/conciliacion-satelites.ts`,
con `esAccesoTotal` **antes** de tocar el repo y zod `.strict()` reutilizando `montoPositivoSchema`.
**Hecho:** unitarios con dobles: `forbidden` sin llamar al repo, `validation_error` sin llamar al repo
(monto ausente / negativo / con tres decimales), y un caso que afirma que **la única llamada al repo**
es la escritura esperada (patrón `expect(llamadas).toEqual([...])` de
`cierres-bodega-admin-service.test.ts`).

---

## Fase 3 — el saldo derivado

### [ ] T9 — `SaldosSatelitesRepository` (solo lecturas)
`lib/repositories/SaldosSatelitesRepository.ts` + interfaz: las dos `groupBy` de `design.md §2.2`, la
resta con `Prisma.Decimal`, `toFixed(2)`, el desglose paginado por zona y el conjunto completo para la
descarga.
**Hecho:** unitarios del mapeo y **integración contra Postgres** (`tests/integration/db/saldo-satelites.int.test.ts`)
con las cuatro poblaciones: sin marcar, marcada completa, marcada por menos (R18) y rechazada
(excluida). El test se mata antes con una mutación del `where` (`estado: {not:'rechazado'}` → sin
filtro) y debe ponerse rojo.

### [ ] T10 `[P]` — DTOs y antigüedad
`lib/types/conciliacion-satelites.ts` con `SaldoSateliteDTO` y `ConsolidacionSateliteDTO` de
`design.md §6.2`; `diasDeLaMasAntigua` derivado en el servidor con `lib/utils/fecha-cr`.
**Hecho:** ningún campo de dinero es `number`; test de la derivación de días en el borde del cambio de
día de Costa Rica.

---

## Fase 4 — el bloqueo se levanta

### [ ] T11 — Enumerar la red que fija el bloqueo **antes** de tocarla
Listar en `progress/impl_431.md` los archivos de test que hoy **afirman** `bloqueada: true` por
`porCierreBodega` (conocidos: `tests/unit/repositories/orden-repository.bloqueo.test.ts` y
`tests/unit/services/cierre-bloqueo-superficies.test.ts`; el diseño previo nombra además el caso
«R18 (ii)»). De los 21 archivos que mencionan `porCierreBodega`, separar los que **afirman el bloqueo**
de los que solo lo mencionan.
**Hecho:** la lista escrita. **Regla:** si durante la implementación cambia un archivo que no está en
esa lista, se tocó lo que no era.

### [ ] T12 — La línea (D4) y el ancla que impide el mentiroso mudo
`OrdenRepository.existeBodegaSateliteBloqueada`: `bloqueada: false` con el comentario de
`design.md §3.1`; `porCierreBodega` sigue viajando y ahora también su **número**
(`consolidacionesSinConciliar`) en `BodegaBloqueoResult`.
**Hecho:** los tests de T11 actualizados uno a uno; **un test nuevo** que afirma que **ninguna**
combinación de causas produce hoy `bloqueada: true` (R4); `AsignacionSateliteService.asignar` no
devuelve `bodega_bloqueada` en ningún caso de su suite.

### [ ] T13 `[P]` — El aviso que queda (R2)
`app/(app)/recepcion-satelite/_components/asignacion-satelite-bloqueo.ts`: se retira
`BODEGA_BLOQUEADA_POR_CIERRE_BODEGA` de la superficie del satélite y entra el aviso que **cuenta y no
frena**, en el molde de `bodegaCierresAbiertosTitulo`.
**Hecho:** test de componente: con `porCierreBodega: true` la pantalla enseña el aviso **y el botón de
asignar sigue habilitado**; el texto viejo («pendiente de aprobación») no aparece en ninguna
superficie.

---

## Fase 5 — la satélite consolida sin esperar

### [ ] T14 — El todo-o-nada de `crearCierreBodega`
`CierreBodegaRepository.crearCierreBodega`: `if (linkeados.count !== cierreDiaIds.length) throw` dentro
de la `$transaction` (design §1.3), con el motivo escrito (los totales snapshot se calcularon sobre el
conjunto entero).
**Hecho:** integración con dos consolidaciones concurrentes: una gana, la otra **no deja fila**; y el
servicio traduce a `conflict` con `MSG_VACIO`.

### [ ] T15 — Retirar el gate de «ya hay una solicitada»
`CierreBodegaService.solicitarCierreBodega`: fuera `existeCierreBodegaSolicitado` y el `catch` de
`P2002` que traducía el índice; el gate de **nivel 1** (`contarCierresDiaSolicitados > 0`,
`MSG_PENDIENTES`) **se queda** y gana un test que lo ancla (R5). Retirar el método del repositorio y de
su interfaz.
**Hecho:** test que afirma R6 (con una consolidación sin conciliar **y** cola consolidable, se puede
consolidar otra vez) y test que afirma R5 (con un cierre de mensajero sin resolver, no). Los tests del
método retirado se revisan **uno a uno**: los que cubrían otra cosa se conservan.

---

## Fase 6 — vocabulario en lo que ya existe

### [ ] T16 — Los rótulos y su valor escrito a mano
`app/(app)/cierres-admin/_components/cierre-labels.ts`: las cinco constantes de `design.md §7`.
**Hecho:** entran en el bloque «el VALOR de los rótulos» de la guardia con su literal **a mano**.
**Depende de:** respuesta a **Q5** (el humano decide el vocabulario).

### [ ] T17 — Las siete superficies de `/cierres-admin`
Cuatro cambian solo de vocabulario; las tres restantes (`CierresBodegaAdminModule`,
`ConsolidacionBodegaModule`, `cierres-bodega-descarga-columnas`) además: retiran la acción de
rechazar y el estado «Rechazado» (R16), y muestran monto recibido y falta por recibir.
**Hecho:** ninguna superficie monta el botón de aprobar/rechazar; los listados y la descarga usan el
vocabulario nuevo; los tests de esas pantallas actualizados.

### [ ] T18 — La guardia de vocabulario, ampliada
Según `design.md §7`: detector `APROBACION` con **canario y contraprueba**, `ROTULOS_NUEVOS`
ampliado, y los cinco literales anclados a mano.
**Hecho:** la guardia falla si se devuelve «Esperando aprobación» a cualquiera de las seis superficies,
y falla también si el extractor deja de leer (autocomprobación).

### [ ] T19 `[P]` — Lo que ve la satélite (R26)
La pestaña de cierres de bodega del `adminSatelite` enseña estado de conciliación, monto recibido y
falta por recibir, **sin** acciones.
**Hecho:** test de componente con rol `adminSatelite`: ve las columnas, no ve ningún botón de marcar ni
revertir; el `WHERE` sigue acotado a su zona.

---

## Fase 7 — la pantalla nueva

### [ ] T20 — Puerta de `/design` (D8)
Llevar a `/design` **qué** tiene que hacer la pantalla (R23/R24/R25/R21/R22) y volver con el diseño.
**Hecho:** diseño aprobado. **Bloquea:** T21.

### [ ] T21 — `/wallet/satelites`
Página Server Component con `esAccesoTotal` → `notFound()`, tabla de saldos, desglose por bodega y las
dos acciones. Datos sensibles **por props**, ya serializados.
**Hecho:** test al estilo `tests/integration/wallet-tiendas-pago.test.tsx`: `adminSatelite` →
`NEXT_NOT_FOUND`; el permiso de marcar se pasa con `esAccesoTotal(actor.rol)` y **no** con `true`
literal.

### [ ] T22 `[P]` — La identidad del dinero en pantalla
Añadir el par `total general − monto recibido = falta por recibir` a
`tests/components/DineroIdentidadesEnPantalla.test.tsx`, **parseando lo que se pinta**, no comparando
contra el `Decimal` de origen.
**Hecho:** la identidad cierra sobre las cadenas; una mutación que reste en el cliente la rompe.

### [ ] T23 `[P]` — Menú y censo de tablas
Ítem «Satélites» bajo Wallet en `lib/auth/menu-visibility.ts`; las dos tablas nuevas en
`tests/unit/descarga/censo-tablas.ts` como `con_descarga`, con su motivo.
**Hecho:** `cobertura-tablas.guardia` verde con los totales actualizados; el ítem solo lo ven
`maestro`/`admin`.

---

## Fase 8 — verificación y cierre

### [ ] T24 — Las cinco mutaciones obligatorias
Cada una se ejecuta y **se pega la salida del test que la mata** (no el veredicto de un arnés):
1. `bloqueada: false` → `bloqueada: porCierreBodega` ⇒ rojo en T12.
2. Quitar el `CHECK` de coherencia ⇒ rojo en T6.
3. `estado: {not:'rechazado'}` fuera del `where` del saldo ⇒ rojo en T9.
4. `appendAccion(tx, …)` → `appendAccion(this.prisma, …)` ⇒ rojo **solo** en la guardia del censo
   (y eso confirma por qué la guardia existe).
5. `count !== length` → `count === 0` en `crearCierreBodega` ⇒ rojo en T14.
**Hecho:** las cinco con su salida y el archivo que se puso rojo.

### [ ] T25 — Gate completo y medición del backfill
`./init.sh` completo con `.env`, `INIT_EXIT` escrito **dentro** del log, y revisión de los `skipped`.
Después de aplicar la migración en un entorno con datos: comparar `updated_at` contra T0 (debe estar
**intacto**) y contar las filas backfilleadas.
**Hecho:** gate verde; el número de filas backfilleadas coincide con el conteo de `aprobado` de T0; el
saldo total del día 1 es el que T0 anticipó.

### [ ] T26 — Ver la aplicación
Con sesión real: (a) satélite con consolidación sin conciliar **asigna una orden**; (b) satélite
**consolida por segunda vez** sin que nadie marque; (c) central marca recibido por menos y el saldo
enseña la diferencia; (d) central revierte y el saldo vuelve.
**Hecho:** los cuatro pasos descritos con lo que se vio, no con lo que debería pasar.

### [ ] T27 — Informe y commit
`progress/impl_431.md` con el mapa `R<n>` → test (los 30), la lista de T11, los números de T0/T25 y los
límites que quedaron vivos. **Se commitea**: un informe sin commitear no existe.
**Hecho:** commiteado en la rama de la ficha y verificado en el blob, no solo en el árbol.

---

## Fase 9 — después del despliegue (no lo hace el implementer)

### [ ] T28 — Medir el primer día real
A las 24–48 h: cuántas consolidaciones se crearon sin conciliar, cuál es la antigüedad máxima y si
alguna satélite acumuló más de una. Es el número que decide si Q6 (umbral) deja de ser una pregunta.

### [ ] T29 — Revisar Q4
Con la rama ya en producción y sin incidencias, decidir si se retira el código muerto de
aprobar/rechazar y el desenlace `bodega_bloqueada`.
