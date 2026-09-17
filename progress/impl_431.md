# Ficha 431 — bitácora de implementación (BACKEND)

**Rama:** `feat/431-cierres-satelite-autonomos` · **base:** `81b67d22` (`dev`).
**Alcance de esta pasada:** todo lo que no es pantalla. Las superficies de `/cierres-admin`,
`/recepcion-satelite` y la pantalla nueva `/wallet/satelites` (T13, T16–T23) van en una pasada de
frontend posterior.

---

## Las cinco cosas que no podían salir mal

| # | Qué exigía | Dónde vive | Qué lo ancla |
| --- | --- | --- | --- |
| 1 | **El saldo mide EFECTIVO, no `total_general`** | `SaldosSatelitesRepository.saldoDe` + el backfill de la migración B | `saldo-satelites.int.test.ts` (3 casos) y `backfill-conciliacion-retroactiva.int.test.ts`. Mutación 1: **roja**, con números distintos en los tres casos. |
| 2 | **El índice único parcial se BORRA** | `20260919120100/migration.sql` paso 4 | `consolidacion-concurrente.int.test.ts` (R6, dos y tres consolidaciones vivas) + el barrido estático, que ahora lee **solo la parte ejecutable** del SQL. Mutación 2: **roja**. |
| 3 | **El bloqueo se quita; el gate de NIVEL 1 se queda** | `OrdenRepository.existeBodegaSateliteBloqueada` (`bloqueada: false`) y `CierreBodegaService.solicitarCierreBodega` (el gate de nivel 1, intacto y comentado) | `orden-repository.bloqueo.test.ts` (barrido de 12 combinaciones + anti-vacuidad) y `cierre-bodega-service.test.ts` (el caso de nivel 1, renombrado a `R6/431-R5`). Mutaciones 3 y 4: **rojas**. |
| 4 | **Dos métodos separados y `appendAccion(tx)`** | `CierresBodegaAdminRepository.marcarConciliado` / `.revertirConciliacion` | Dos entradas propias en el censo de `historial-accion-escrituras-cubiertas.guardia`. Mutación 5 (`this.prisma`): **roja SOLO en la guardia**; los 20 tests de integración y unitarios siguieron verdes — medido, es exactamente lo que el diseño anticipaba. |
| 5 | **Los 32 históricos se dan por recibidos** | backfill de la migración B: `conciliado_at = resuelto_at`, `monto_recibido = total_efectivo`, nota visible | `backfill-conciliacion-retroactiva.int.test.ts`, que **ejecuta el SQL real extraído del disco** y mide: saldo `0.00`, `updated_at` intacto, idempotencia. |

---

## Decisiones tomadas que no estaban en el spec

1. **El backfill escribe `monto_recibido = total_efectivo`, no `total_general`.** El `design.md`
   decía `total_general` (§1.4) porque venía del saldo original. Con el saldo corregido a efectivo
   (Q2), `total_general` habría dejado el saldo del primer día en **−₡1.105.790** en vez de en
   ₡0,00: la central debiéndole dinero a sus propias bodegas. Medido en el test, no razonado.
2. **Los timestamps de las migraciones son `20260919120000` y `20260919120100`**, no los
   `20260916…` del diseño: esos nombres ya estaban ocupados (`20260916120000_orden_clave_remision`)
   y el árbol llega hasta `20260918120200`. Una migración con timestamp anterior a una ya aplicada
   deja el orden roto.
3. **`faltaPorRecibir` del DTO se deriva sobre el EFECTIVO**, no sobre `general` como decía
   `design.md §6.2`. Es el corolario de Q2: con `general` en el detalle y efectivo en la cabecera,
   la suma de la columna dejaría de cuadrar con el saldo de la bodega. El test lo ancla sumando la
   columna y comparándola con el saldo.
4. **El `SaldoSateliteDTO` gana `totalEfectivo`.** El saldo se deriva de él, así que sin ese campo
   la resta no sería auditable desde la pantalla. `totalConsolidado` (el general) se queda como
   contexto, tal como pide Q2.
5. **La paginación de los dos listados nuevos reusa `cierreBodegaConfig`**, no un dominio nuevo.
   Son listados de cierres de bodega, y un dominio nuevo habría obligado a tocar el censo de
   `paginacion-dominios`, que enumera los 13 listados del Anexo III de la feature 170 — un conjunto
   histórico cerrado al que estos dos no pertenecen.
6. **`ConsolidacionParcialError` vive en `lib/utils/consolidacion-parcial.ts`**, módulo puro, para
   que el repositorio y el servicio lo compartan sin importarse. Precedente: `CierreDetalleFaltanteError`.
7. **Las cinco Server Actions nacen con `@sin-superficie`** y su motivo: la pantalla es la fase 7.
   La anotación **caduca**: quien monte `/wallet/satelites` tiene que borrarla en el mismo commit o
   la guardia de superficie se pone roja.
8. **Dos comentarios no nombran `ConciliacionCierresAnaliticaRepository` entero.** La guardia de
   fuente de la feature 127 mete en su censo cualquier archivo `lib/**` que escriba ese nombre —lo
   busca sobre el fuente CON comentarios— y `CierresBodegaAdminRepository` consulta `gestion_orden`,
   que está fuera del universo permitido de la analítica. Se nombra `contarCierresPorEstado`, que
   sigue siendo greppable y único, con el motivo escrito al lado.

---

## Archivos

### Creados
```
db/migrations/20260919120000_historial_accion_conciliacion_bodega/{migration.sql,down.sql}
db/migrations/20260919120100_cierre_bodega_conciliacion/{migration.sql,down.sql}
lib/types/conciliacion-satelites.ts
lib/utils/consolidacion-parcial.ts
lib/interfaces/repositories/ISaldosSatelitesRepository.ts
lib/interfaces/services/IConciliacionSatelitesService.ts
lib/repositories/SaldosSatelitesRepository.ts
lib/services/ConciliacionSatelitesService.ts
lib/actions/conciliacion-satelites.ts
tests/integration/db/historial-accion-conciliacion-bodega-migration.test.ts
tests/integration/db/cierre-bodega-conciliacion.int.test.ts
tests/integration/db/backfill-conciliacion-retroactiva.int.test.ts
tests/integration/db/marca-conciliacion.int.test.ts
tests/integration/db/saldo-satelites.int.test.ts
tests/integration/db/consolidacion-concurrente.int.test.ts
tests/unit/repositories/cierres-bodega-admin-marca.test.ts
tests/unit/services/conciliacion-satelites-service.test.ts
tests/unit/actions/conciliacion-satelites-actions.test.ts
tests/unit/utils/fecha-cr-dias-naturales.test.ts
```

### Modificados
```
db/schema.prisma                                     4 columnas + relacion + 2 indices + 2 valores de enum
lib/types/historial-accion.ts                        los 2 tipos, su categoria y sus etiquetas (53 -> 55)
lib/utils/fecha-cr.ts                                + `diasNaturalesCRDesde` (R21)
lib/interfaces/repositories/IOrdenRepository.ts      `bloqueada` documentado + `consolidacionesSinConciliar`
lib/repositories/OrdenRepository.ts                  `bloqueada: false` + el numero del aviso
lib/interfaces/repositories/ICierreBodegaRepository.ts   fuera `existeCierreBodegaSolicitado`
lib/repositories/CierreBodegaRepository.ts               fuera el metodo; dentro el todo-o-nada
lib/services/CierreBodegaService.ts                      fuera el gate y el `P2002`; el de nivel 1 se queda
lib/interfaces/repositories/ICierresBodegaAdminRepository.ts  + los dos contratos de la marca
lib/repositories/CierresBodegaAdminRepository.ts              + los dos metodos de la marca
tests/fixtures/api-key-dependencias-usuario.ts       + la FK `conciliadoPorUsuario`
tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts  + 2 entradas de censo (55)
tests/unit/historial-accion/catalogo-y-choke-point.test.ts   conteos 55 / 33 de dinero
tests/integration/db/{5 archivos de censo de enum}   + los 2 valores en sus `POSTERIORES`
tests/integration/db/orden-traspaso-migration.test.ts   + las 2 migraciones en su censo de orden
tests/integration/db/cierre-bodega-resumen-pendientes.test.ts     la semilla, por el CHECK nuevo
tests/integration/db/correccion-resultado-gestion.int.test.ts     idem
tests/unit/repositories/orden-repository.bloqueo.test.ts     los 2 casos del bloqueo, invertidos
tests/unit/repositories/cierre-bodega-repository.test.ts     fuera el metodo; dentro el todo-o-nada
tests/unit/services/cierre-bodega-service.test.ts            R8 invertido a R6/R7 de la 431
tests/unit/services/asignacion-satelite-service.test.ts      el caso «R18 (ii)», renombrado
tests/unit/services/cierres-bodega-admin-service.test.ts     el doble completa el contrato
tests/unit/services/{cierre-bodega-solicitados-paginado, consolidables-paginado, consolidacion-completo}.test.ts
```

---

## T11 — la red que fijaba el bloqueo, enumerada ANTES de tocarla

De los **21 archivos** que mencionan `porCierreBodega`, solo **cuatro** afirmaban un bloqueo:

| Archivo | Afirmaba | Qué se hizo |
| --- | --- | --- |
| `tests/unit/repositories/orden-repository.bloqueo.test.ts` | 2 casos con `bloqueada: true` **derivados del repositorio real** | **Invertidos**: ahora afirman aviso sin bloqueo, + 2 casos nuevos (el número del aviso, el barrido de 12 combinaciones) + anti-vacuidad. |
| `tests/unit/services/asignacion-satelite-service.test.ts` | 3 casos con doble sintético | Se **conservan**: miden la RAMA del servicio, que D4 deja viva. El que se llamaba «R18 (ii): bloqueada por su propio CierreBodega» se **renombró** —esa causa ya no existe— con el motivo escrito. |
| `tests/unit/services/asignacion-satelite-gate-coordenadas.test.ts` | 1 caso con doble sintético (`porMensajeros`) | Sin tocar: esa combinación ya era imposible desde la feature 241 y el caso mide el orden del gate. |
| `tests/components/RecepcionSateliteModule.test.tsx` (3) y `RecepcionSatelitePage.test.tsx` (1) | pasan `bloqueoBodega` **por props** | **Sin tocar**: son de la pasada de frontend (T13). El repositorio ya no produce esa entrada, pero el componente sigue sabiendo pintarla; retirarla es parte de T13. |

Los otros 14 archivos solo **mencionan** `porCierreBodega` en un doble con `bloqueada: false`.
Ninguno cambió.

---

## Mapa `R<n>` → test

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | con consolidación pendiente, SE PUEDE asignar | `orden-repository.bloqueo.test.ts` «431/R1: consolidacion pendiente -> AVISO, NO bloqueo» |
| R2 | el aviso dice CUÁNTAS son | idem, «431/R2: con CUATRO consolidaciones, el aviso cuenta CUATRO» |
| R3 | las dos causas siguen distinguibles al borde | idem, «anti-vacuidad del barrido: el instrumento SI distingue las causas» |
| R4 | ninguna causa de cierre impide asignar | idem, barrido `it.each` de 6 × 2 = 12 combinaciones |
| R5 | con cierres de mensajero sin resolver, NO se consolida | `cierre-bodega-service.test.ts` «R6/431-R5: con cierre_dia solicitado pendiente -> conflict» |
| R6 | con una consolidación sin conciliar SÍ se consolida otra vez | `cierre-bodega-service.test.ts` «431/R6» + `consolidacion-concurrente.int.test.ts` «R6» (×2) |
| R7 | todo-o-nada de la consolidación | `consolidacion-concurrente.int.test.ts` (3 casos) + `cierre-bodega-repository.test.ts` (2 casos) |
| R8 | los cuatro datos de la marca | `marca-conciliacion.int.test.ts` «R8/R9» + `cierres-bodega-admin-marca.test.ts` «R8/R9» |
| R9 | marcar deja «Recibido» en el mismo acto | idem |
| R10 | monto ausente/negativo/3 decimales -> error, sin escribir | `conciliacion-satelites-actions.test.ts` «el monto muere en el borde» (7 casos) |
| R11 | marcar dos veces -> conflicto sin escribir | `marca-conciliacion.int.test.ts` «R11» + `cierres-bodega-admin-marca.test.ts` |
| R12 | revertir vacía los cuatro datos | `marca-conciliacion.int.test.ts` «R12» + unitario del `data` exacto |
| R13 | el rastro, con monto, en el mismo acto atómico | `marca-conciliacion.int.test.ts` «R13» (×2) + las 2 entradas del censo en la guardia |
| R14 | no se escribe en ningún libro de dinero | `marca-conciliacion.int.test.ts` «R14» (cuenta los 3 libros antes/después) |
| R15 | el estado incoherente es imposible por cualquier camino | `cierre-bodega-conciliacion.int.test.ts` casos (a)(b)(c)(d) |
| R16 | rechazar se retira de pantalla pero queda en la base | `cierre-bodega-conciliacion.int.test.ts` «(d bis)». La mitad de PANTALLA es T17 (frontend). |
| R17 | el saldo = Σ(efectivo − recibido) sobre no rechazadas | `saldo-satelites.int.test.ts` «las CUATRO poblaciones» + «el SINPE NO cuenta» |
| R18 | la diferencia parcial sigue contando | idem, y «recibido de MAS -> saldo negativo» |
| R19 | el saldo no se guarda | `saldo-satelites.int.test.ts` «R19: no hay escritura en este repositorio» (barrido estático) |
| R20 | todo importe llega cuadrado del servidor | `saldo-satelites.int.test.ts` (barrido money-safe + contraprueba) y `conciliacion-satelites-service.test.ts` «R20» |
| R21 | cuántas y cuántos días la más antigua | `saldo-satelites.int.test.ts` «R21: la más vieja SIN CONCILIAR» + `fecha-cr-dias-naturales.test.ts` (7 casos) |
| R22 | la composición del total por consolidación | `saldo-satelites.int.test.ts` «R22/R24» |
| R23 | vista de saldos para acceso total | `conciliacion-satelites-service.test.ts` (rol) + `conciliacion-satelites-actions.test.ts`. **La PANTALLA es T21 (frontend).** |
| R24 | desglose por bodega | `saldo-satelites.int.test.ts` «R22/R24» + «`soloSinConciliar` recorta» |
| R25 | marcar/revertir desde esa vista | `conciliacion-satelites-service.test.ts` «maestro y admin SI pueden». **El botón es T21.** |
| R26 | el adminSatelite ve y no toca | `conciliacion-satelites-service.test.ts` «adminSatelite NO marca NI SIQUIERA LAS SUYAS». **La pestaña es T19 (frontend).** |
| R27 | sin acceso total, nada | `conciliacion-satelites-service.test.ts` barrido de 3 roles × 6 operaciones, con el repo sin tocar |
| R28 | el vocabulario aprobado en todas las superficies | **PENDIENTE — T16/T18, pasada de frontend.** El backend ya expone `conciliado` derivado para que la presentación no compare campos. |
| R29 | descarga del conjunto completo | `conciliacion-satelites-service.test.ts` «limite_excedido viaja SIN filas» + las 2 acciones `…CompletoAction`. **El botón es T23.** |
| R30 | el backfill de los históricos | `backfill-conciliacion-retroactiva.int.test.ts` (8 casos, ejecutando el SQL real) |

**Los tres requisitos sin cerrar en esta pasada son R28, y las mitades de pantalla de R23/R25/R26/R29.**
Todos son de UI y están declarados arriba.

---

## T0 / T25 — los números

**T0 (producción, medido por el leader el 2026-09-15 y transcrito aquí):**

| | Importe | % |
| --- | --- | --- |
| `total_general` | ₡ 4.196.897 | 100 % |
| `total_efectivo` | ₡ 3.091.107 | 73,7 % |
| `total_simpe` | ₡ 1.105.790 | 26,3 % |
| `total_transferencia` | ₡ 0 | 0 % |

32 consolidaciones, **todas `aprobado`**, 5 satélites, **0 `solicitado`**.
**No se midió contra producción desde esta sesión:** el MCP de Supabase no está en el conjunto de
herramientas de este agente. Los números son los que el leader entregó.

**Base local (medida aquí, 2026-09-16, ANTES de migrar):** `cierre_bodega` **vacía** (0 filas,
`max(updated_at)` y `max(resuelto_at)` a `NULL`). El backfill afectó por tanto **0 filas en local**,
y por eso R30 se mide ejecutando el SQL real sobre filas sembradas en un esquema desechable —donde
sí se puede construir el «antes», porque en `public` el `CHECK` ya lo prohíbe—.

**El saldo del día 1, medido con las proporciones reales de producción:** `0.00`.
Con `monto_recibido = total_general` habría sido `-1105790.00`.

---

## Migraciones: up y down, ejecutados

- **`20260919120000_historial_accion_conciliacion_bodega`** — `ADD VALUE IF NOT EXISTS` ×2. Su
  `down.sql` recrea el tipo con los **53 previos** (lista **medida** contra la base local el
  2026-09-16, no copiada) y recastea `historial_accion.accion`. Lleva escritas las dos advertencias
  obligatorias: la precondición ruidosa y que la lista es una foto de esta rama.
  **Verificado ejecutándolo**: el bloque (b) de su test levanta el estado previo corriendo las
  migraciones REALES anteriores en un esquema desechable, aplica el up, aplica el down y compara
  **valor a valor y en orden**; el bloque (c) comprueba que con filas de esos dos tipos el rollback
  **aborta** y no las borra.
- **`20260919120100_cierre_bodega_conciliacion`** — columnas + FK → backfill → 2 `CHECK` →
  `DROP INDEX` + 2 índices. **Su `down.sql` se corrió de verdad contra la base local**
  (`pnpm run db:rollback`) y revirtió limpio; después `prisma migrate deploy` la volvió a aplicar y
  `prisma migrate diff` dice **«No difference detected»** (sin drift con `db/schema.prisma`).

**Límite del `db:rollback`, medido:** el script revierte siempre la carpeta **última por orden
lexicográfico**, así que no hay forma de llegar a la migración del enum sin mover carpetas. Correrlo
dos veces seguidas intenta revertir la misma y falla con «la relación
`cierre_bodega_zona_solicitado_uq` ya existe». Es una propiedad de `scripts/db-rollback.ts`, no del
`down.sql`. La reversibilidad del enum se demuestra en su test, que la ejecuta.

---

## Ningún `down.sql` anterior se tocó

Se comprobó la forma del `down` de **este** enum antes de escribir el nuevo: es
**recrea-con-lista** (el único que dropea el tipo entero es el de `20260902120000_historial_accion`,
que también lo crea entero). El nuevo sigue ese patrón.

---

## Lo que queda vivo como límite

1. **`bloqueada` es un campo constante `false`** y la rama `bodega_bloqueada` de
   `AsignacionSateliteService.asignar` sigue en el árbol (D4 · Q4). Lo ancla el barrido de 12
   combinaciones para que el `false` no pase por una verdad medida.
2. **El camino viejo de aprobar/rechazar no se arrancó** (Q4): queda **imposible de escribir**
   por el `CHECK`, medido. Rechazar sigue siendo legal para la base.
3. **El SINPE de la ficha 429**: cuando cada bodega tenga su propio SINPE, lo que recaude una
   satélite por esa vía dejará de llegar a la central y creará un pendiente que este diseño **no
   cubre** —ni viaja en el bulto ni está en `total_efectivo`—. Declarado en `lib/types/conciliacion-satelites.ts`.
4. **Las `rechazado` quedan fuera del saldo.** En producción hay cero; declarado.
5. **`conciliado_nota` no baja a las descargas** (es texto libre). El censo de columnas sensibles de
   las dos tablas nuevas es parte de T23 (frontend).

---

## Gate completo — `./init.sh`, con `.env`

Log: `progress/gate_431_backend.log`, con `INIT_EXIT` escrito **dentro** del fichero y sin canalizar
por `tail`.

```
✓ typecheck paso
✓ lint paso
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2007 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0

 Test Files  2007 passed (2007)
      Tests  29278 passed | 26 skipped (29304)
```

**Los SALTADOS, mirados uno a uno:**

| Archivo | Saltados | ¿Es de la base? |
| --- | --- | --- |
| `tests/components/AnaliticaPage.test.tsx` | 17 | no |
| `tests/components/AnaliticaShell.test.tsx` | 9 | no |
| **total** | **26** | — |

**Cero archivos de `integration/db` saltados**, y **279 verdes** (los 273 de referencia + los 6 que
añade esta ficha). El `.env` se copió al worktree a propósito: sin él se habrían saltado ~279
archivos de base y el verde no habría valido nada en una ficha que toca dinero.

El aviso de las tres migraciones sin `down.sql` es **previo a esta ficha** (agosto, las de ruta) y no
lo introduce este trabajo. Las dos migraciones nuevas traen el suyo.

**El flake `cierre-bloqueo-nv-sql-real` («expected 4 to be 3») NO apareció** en ninguna de las dos
corridas completas.

### La primera corrida: tres rojos, los tres míos, los tres arreglados

La primera vez el gate dio `INIT_EXIT=1` con tres archivos rojos. **Ninguno era deuda ajena:**

1. `tests/integration/db/cierre-bodega-resumen-pendientes.test.ts` y
   `tests/integration/db/correccion-resultado-gestion.int.test.ts` — sembraban un `cierre_bodega`
   con `estado: 'aprobado'` y sin datos de marca, que es **exactamente** lo que el `CHECK` nuevo
   declara imposible. En el primero, el comentario decía que usaba `aprobado` *porque el índice
   único parcial prohibía dos `solicitado` por zona*: ese índice ya no existe, así que la razón se
   ha invertido. Los dos pasan a `solicitado`, con el motivo reescrito.
2. `tests/integration/db/orden-traspaso-migration.test.ts` — su censo enumera EXACTAMENTE las
   migraciones que van detrás de la suya. Las dos nuevas entran declaradas, con su ficha y su motivo.

---

## Las mutaciones (T24) — seis aplicadas, seis rojas, con su salida

### 1 · el saldo usa `total_general` en vez de `total_efectivo`
`SaldosSatelitesRepository`: `_sum.totalEfectivo` → `_sum.totalGeneral`, y `saldoDe(r.totalEfectivo…)`
→ `saldoDe(r.totalGeneral…)`.

```
× ⭑ R17/R18: las CUATRO poblaciones en una sola bodega, y el saldo las cuadra
× ⭑ R17/Q2: el SINPE NO cuenta — dos bodegas con el mismo general y distinto efectivo
× ⭑ R22/R24: el desglose compone el total y deriva `faltaPorRecibir` en el SERVIDOR
AssertionError: expected '1715.00' to be '1015.00'
AssertionError: expected '1000.00' to be '0.00'
AssertionError: expected '138.45' to be '15.00'
 Tests  3 failed | 9 passed (12)
```

### 1 bis · el BACKFILL usa `total_general` (la otra mitad de la misma decisión)
```
× ⭑ R30/Q2: `monto_recibido` = `total_efectivo` -> EL SALDO DEL PRIMER DIA ES 0,00
AssertionError: expected '-1105790.00' to be '0.00'
× ⭑ el backfill usa `total_efectivo` y NO `total_general` (decision Q2, medida)
AssertionError: expected 'UPDATE "cierre_bodega"\n   SET "conci…' to match /"monto_recibido"\s*=\s*"total_efectiv…/
 Tests  2 failed | 19 passed (21)
```
**Ese `-1105790.00` es el número de la ficha:** con el diseño original, la central habría arrancado
debiéndole ₡1,1 M a sus propias bodegas.

### 2 · el índice único parcial se queda
`DROP INDEX` comentado en la migración **y** el índice recreado en la base local.

```
× ⭑ R6: DOS consolidaciones `solicitado` en la MISMA zona conviven (el indice unico se fue)
× ⭑ R6: y una TERCERA tambien — no hay tope escondido en ningun sitio
× ⭑ R7: la segunda consolidacion sobre la MISMA cola LANZA y NO deja fila
× ⭑ R7: tambien lanza si solo SOBREVIVE PARTE de la cola (el caso peligroso de verdad)
PrismaClientKnownRequestError: Unique constraint failed on the (not available)
AssertionError: la segunda consolidacion no lanzo: se repartio la cola:
  expected PrismaClientKnownRequestError{…} to be an instance of ConsolidacionParcialError
 Tests  4 failed | 14 passed (18)
```

⚠️ **Y esta mutación encontró un agujero REAL en mi propio test, que se arregló.** El barrido
estático leía el `migration.sql` **con sus comentarios**, así que un `-- DROP INDEX …` comentado lo
dejaba VERDE: el texto seguía ahí. Se añadió `soloEjecutable()` con su anti-vacuidad, y se remidió:

```
× ⭑ el up BORRA el indice unico parcial, y el down lo RECREA con su aviso
AssertionError: expected '\nALTER TABLE "cierre_bodega"\n  ADD …' to match /DROP INDEX IF EXISTS "cierre_bodega_z…/
 Tests  1 failed | 13 passed (14)
```

### 3 · `existeBodegaSateliteBloqueada` vuelve a bloquear
`bloqueada: false` → `bloqueada: porCierreBodega`.

```
× ⭑ 431/R1: consolidacion pendiente de conciliar -> AVISO, NO bloqueo
× ⭑ 431/R2: con CUATRO consolidaciones sin conciliar, el aviso cuenta CUATRO
× ⭑ 431/R4: con cierres de mensajeros Y consolidacion pendiente, TAMPOCO bloquea
× ⭑ 431/R4: NINGUNA combinacion bloquea — (las SEIS del barrido, con 0 y con 3 consolidaciones)
× ⭑ 431: anti-vacuidad del barrido — el instrumento SI distingue las causas
AssertionError: la combinacion [sin cierres / 3 consolidaciones] bloqueo la bodega:
  R4 dice que HOY ninguna causa derivada de un cierre puede impedir la asignacion: expected true to be false
 (10 casos rojos)
```

### 4 · el gate de NIVEL 1 se pierde por el camino
El `if (contarCierresDiaSolicitados > 0)` comentado en `solicitarCierreBodega`.

```
× R6/431-R5: con cierre_dia solicitado pendiente -> conflict, sin crear; y bloquea el gate al listar
AssertionError: expected 'ok' to be 'conflict'
 Tests  1 failed | 24 passed (25)
```

### 5 · `appendAccion(tx, …)` → `appendAccion(this.prisma, …)` en `marcarConciliado`
**Y AQUÍ ESTÁ LA CONFIRMACIÓN DE POR QUÉ LA GUARDIA EXISTE**, medida en las dos direcciones:

```
-- la guardia del censo:
× CierresBodegaAdminRepository.ts#marcarConciliado registra su accion en la misma transaccion que la escribe
AssertionError: … una accion que se escribe sin su registro deja el modulo mintiendo en silencio:
  expected [ Array(1) ] to deeply equal []
 Tests  1 failed | 60 passed (61)

-- la integracion + los unitarios de repositorio, CON LA MUTACION PUESTA:
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

**20 tests verdes con la mutación dentro.** Ningún test de integración lo caza —ahí `this.prisma`
*es* el cliente de la transacción del test—; solo la guardia estática.

### 6 · `count !== length` → `count === 0` en `crearCierreBodega`
```
× ⭑ R7: tambien lanza si solo SOBREVIVE PARTE de la cola (el caso peligroso de verdad)
AssertionError: expected null to be an instance of ConsolidacionParcialError
× ⭑ 431/R7: si vincula MENOS cierres de los pedidos, lanza `ConsolidacionParcialError`
AssertionError: promise resolved "'cb1'" instead of rejecting
 Tests  2 failed | 15 passed (17)
```
El caso «vincula 1 de 3» es justo el que un `count === 0` no ve: la consolidación quedaría
declarando ₡600 llevando ₡100.

**Las seis mutaciones se revirtieron y se comprobó el verde después de cada una.**

---

## Veredicto

Backend de la 431 completo y verificado: el saldo mide efectivo, el freno cae con su índice, el gate
de nivel 1 sobrevive anclado, el rastro es atómico y los históricos arrancan en ₡0,00. Falta la
pasada de pantallas (T13, T16–T23), y con ella R28 y las mitades de UI de R23/R25/R26/R29.

---
---

# Ficha 431 — bitácora de implementación (FRONTEND)

**Rama:** `feat/431-cierres-satelite-autonomos` · **base:** `900fa7b6` (el rescate del WIP), sobre
`82ffcc1e` (el backend, completo y verificado).
**Alcance de esta pasada:** T13, T16–T23 y T26 — las pantallas, y con ellas R28 y las mitades de UI
de R23/R25/R26/R29.

---

## 0 · EN QUÉ ESTADO SE ENCONTRÓ EL WIP, MEDIDO

El commit `900fa7b6` era un **rescate**: 2.395 líneas en 46 archivos, sin gate, sin typecheck y sin
mutaciones. Lo primero de esta pasada fue auditarlo. El resultado, con números:

| Medición | Resultado |
| --- | --- |
| `pnpm run typecheck` | **verde** (0 errores) |
| `pnpm run lint` | **0 errores**, 202 warnings — todos preexistentes (`_ctx`/`_id` sin usar en dobles de test) |
| `pnpm run test:guardias` | **ROJO**: 3 archivos, 5 tests |
| `vitest --changed 82ffcc1e` | **ROJO**: los 3 de arriba + `cierre-pagos-lectura.test.ts` (2 tests) |

**Los cuatro archivos rojos que dejó el WIP, uno a uno:**

1. `tests/unit/descarga/cobertura-tablas.guardia.test.ts` — las dos tablas nuevas entraron en
   `censo-tablas.ts` pero **sus tres totales no se actualizaron** (`expected 38 to be 36`,
   `expected 39 to be 37`, `to have a length of 23 but got 25`). El WIP cayó justo aquí: T23 era
   la tarea en curso.
2. `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` — las dos constantes
   `COLUMNAS_DESCARGA_*` nuevas **nacieron sin aserción de orden**, que es exactamente lo que esa
   guardia existe para impedir.
3. `tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts` — el ítem «Satélites» del menú movió
   los conteos por rol (`maestro` 20→21, `admin` 12→13) y no se declararon.
4. `tests/unit/repositories/cierre-pagos-lectura.test.ts` — `TypeError: Cannot read properties of
   undefined (reading 'toFixed')`. El WIP añadió cuatro columnas a `BODEGA_RESUMEN_SELECT` y un
   doble de Prisma se quedó sin ellas.

**Y tres defectos que NO estaban rojos —nadie los medía— y se arreglaron:**

5. ⭑ **La columna «Última recibida» pintaba el ACUMULADO.** `SaldosSatelitesTable` renderizaba
   `money(s.totalRecibido)`, que es la **suma histórica** de todo lo que la bodega ha entregado,
   bajo un rótulo que promete **la última**. El diseño aprobado (`design-satelites/Main.dc.html`)
   dice «12 sep · ₡ 298.400», o sea fecha e importe de UNA consolidación. Con cinco bodegas y
   ~800 consolidaciones al año, la diferencia entre las dos cifras es de un orden de magnitud.
   Se arregló **con dato nuevo del servidor** (`SaldoSateliteDTO.ultimaRecibida`), no relajando el
   rótulo — y el tipo declara en su comentario por qué no es `totalRecibido`.
6. ⭑ **Las fechas se cortaban en UTC.** `iso.slice(0, 10)` sobre `solicitadoAt` y `conciliadoAt`:
   una consolidación marcada a las 19:00 del 15 de septiembre en Costa Rica es
   `2026-09-16T01:00:00Z`, y aparecía fechada **al día siguiente** en la pantalla de quien la
   marcó. En una pantalla que existe para perseguir bultos por su fecha, un día de desfase es la
   diferencia entre encontrar el bulto y discutir cuál era. Entra `diaCR` con
   `timeZone: "America/Costa_Rica"`, medido: `2026-09-16T01:00:00.000Z` → `15 sept`.
7. **Un comentario que mentía.** «Tamaño de página del desglose. Sale de la config del dominio, no
   de un literal de pantalla» encima de `const DESGLOSE_PAGE_SIZE = 20;`. Ahora sale de verdad de
   `cierreBodegaConfig.DEFAULT_PAGE_SIZE`, que es el tope contra el que valida el borde.

**Y una lectura de dinero SIN NINGÚN TEST.** El WIP añadió `SaldosSatelitesRepository.findResumen`
—las tres cifras de cabecera, sumas sobre el conjunto entero— y no la cubrió con nada. Se le
añadieron cuatro casos de integración contra Postgres real (abajo).

---

## 1 · Lo que hacen las pantallas

### T13 — el aviso que sustituye al freno (R2/R4)
`asignacion-satelite-bloqueo.ts` pierde `BODEGA_BLOQUEADA_POR_CIERRE_BODEGA` («Tu cierre de bodega
hacia la central está pendiente de aprobación») y gana
`consolidacionesSinConciliarTitulo(n)` + `CONSOLIDACIONES_SIN_CONCILIAR_DETALLE`. El texto retirado
**no era cierto en ninguno de sus dos extremos**: ni hay aprobación, ni frena.

El aviso se monta en `RecepcionSateliteModule` como **hermano** del de cierres abiertos, no como
otra rama de su ternario: las dos causas son independientes desde la 241 y pueden darse a la vez;
metidas en el mismo ternario, la bodega sólo vería la mitad de lo que tiene pendiente.

**Sin umbral (Q6):** `role="status"` y tono `warning`, iguales pase el tiempo que pase.

### T16/T18 — el vocabulario, y la guardia que lo sostiene
Los seis rótulos viven en `cierre-labels.ts` (módulo puro) y **`ESTADO_LABEL` no se toca**: lo
comparte el cierre del MENSAJERO, donde «Recibido» no significaría nada (D3).

`cierre-bodega-vocabulario.guardia` gana **tres casos y no pierde ninguno**:
- el censo `APROBACION`, que debe salir **vacío** sobre las mismas seis superficies;
- su **autocomprobación**: el MISMO barrido tiene que ENCONTRAR el vocabulario de la conciliación
  en **más de una** superficie, nombradas (`CierresBodegaAdminModule` y el comprobante). Sin esto,
  un extractor roto daría el censo vacío por bueno;
- el **canario y la contraprueba** del detector (6 literales que debe cazar, 5 que NO debe cazar);
- y el **valor de los seis rótulos escrito a mano**, más una regla: ninguno puede contener
  «aprobado/aprobación/rechazado/rechazo/aprobar/rechazar».

### T17 — las superficies de `/cierres-admin`
- `HojaResumen` gana `marcaConciliacion`. Cuando llega, **sustituye** el badge de `estado` por el
  de conciliación y **añade** al desplegable la columna «Conciliación» (monto recibido, falta por
  recibir, quién y cuándo, y la nota). El ternario es EXCLUYENTE: dos badges con dos vocabularios
  sobre la misma fila es justo lo que R28 prohíbe.
- `CierreBodegaFacturaResumen` **deja de pasar `estado`**, y con él se va «Rechazado» de la
  pantalla (R16). La fila sigue en la base.
- `CierresBodegaAdminModule`: fuera «Aprobar», fuera «Rechazar» **y todo su sub-modal de motivo**,
  fuera `confirmarAprobacion` / `confirmarRechazo` / `manejarErrorDecision`. Entra
  `ConciliacionAcciones`, el MISMO componente que monta `/wallet/satelites`. Se monta para
  **cualquier** estado y no sólo para `solicitado`: corregir y desmarcar actúan sobre una ya
  marcada, y con el `esPendiente` de antes no habría forma de deshacer nada.
- `cierres-bodega-descarga-columnas`: el estado sale con el vocabulario de la conciliación
  (`ESTADO_LABEL` ya no se importa aquí) y los **tres** listados ganan «Monto recibido» y «Falta
  por recibir» al final, sin mover ninguna columna existente.

### T19 — lo que ve la satélite (R26/Q7)
No hace falta pantalla nueva: su pestaña (`CierresBodegaSolicitadosLista`) monta el MISMO
comprobante, **sin `acciones`**. Ve el estado, el monto recibido y la diferencia; no ve un solo
botón de marcar, corregir ni desmarcar. Hay test que afirma que la satélite y la central leen
`textContent` IDÉNTICO de la misma tarjeta.

### T21/T23 — `/wallet/satelites`
Cuarta hoja de Wallet. `esAccesoTotal` → `notFound()` en la página, **y además** el servicio
responde `forbidden` por su cuenta. `puedeConciliar={esAccesoTotal(actor.rol)}`, nunca `true`
literal. Tres tarjetas, tabla con conmutador «Con pendiente (N) / Todas (N)», desglose desplegable
por bodega con sus acciones, y **la nota que impide contar dos veces** al pie, visible y sin
desplegable.

### T22 — la identidad del dinero
`monto recibido + falta por recibir = efectivo declarado`, comprobado **sobre las cadenas que se
pintan** en `DineroIdentidadesEnPantalla`. El doble lleva céntimos (`500000.17`) a propósito: un
juego de cifras redondas cierra igual con una resta hecha en `number`.

---

## 2 · Decisiones tomadas en esta pasada

1. **`SaldoSateliteDTO` gana `ultimaRecibida` (fecha, monto, declarado, faltaPorRecibir).** Es el
   arreglo del defecto 5. Se resuelve en DOS consultas acotadas (`groupBy _max conciliado_at` +
   `findMany` sobre esos pares) y no con `findMany + distinct`: si la versión de Prisma no empuja
   el `DISTINCT ON` a Postgres, la consulta se trae todas las conciliadas de la operación para
   quedarse con cinco. El desempate está escrito y es determinista.
2. **La marca viaja por `CierreBodegaResumen` y no por un DTO nuevo** (decisión heredada del WIP,
   auditada y conservada): la satélite ve SUS consolidaciones donde ya las ve, y abrirle
   `/wallet/satelites` sería darle la vista de todas las bodegas, que es lo que R27 prohíbe.
3. **`ConciliacionAcciones` se monta también en la cola de `/cierres-admin`**, en vez de escribir
   allí un botón propio. Es la misma acción sobre la misma fila; dos copias acabarían diciendo
   cosas distintas sobre si el dinero llegó.
4. **El aviso de T13 lleva `aria-label` propio.** La pantalla monta varios `role="status"` y sin
   nombre ninguno se distingue — ni para un lector de pantalla ni para un test.
5. **El recorte del conmutador de saldos es de CLIENTE, y está declarado** con su límite: si un
   día hubiera más bodegas que `pageSize`, hablaría sólo de la página visible.

---

## 3 · Mapa `R<n>` → test (lo que esta pasada cierra)

| R | Qué exige | Test |
| --- | --- | --- |
| R2 | el aviso dice CUÁNTAS son | `RecepcionSateliteModule.test.tsx` «431/R2/R4: … AVISO, y «Asignar» SIGUE HABILITADO» |
| R3 | las dos causas se distinguen en pantalla | idem «431/R3: con las DOS causas a la vez, cada una tiene su aviso y no se tapan» |
| R4 | ninguna causa impide asignar | idem (el `toBeEnabled()` del botón) |
| R16 | rechazar se retira de la PANTALLA | `cierre-bodega-vocabulario.guardia` censo `APROBACION` + `CierreBodegaMarcaConciliacion.test.tsx` «R16 — una `rechazado` NO anuncia ese estado» + `cierres-bodega-descarga-columnas.test.ts` ««Rechazado» ya no se escribe en el archivo» |
| R20 | la pantalla no hace aritmética de dinero | `wallet-satelites.test.tsx` bloque money-safe (9 archivos) + `DineroIdentidadesEnPantalla` B4-bis |
| R21 | cuántas y cuántos días, SIN umbral | `wallet-satelites.test.tsx` «R21/Q6 — la antigüedad se dice, y NO dispara nada» |
| R22 | la composición del total | `wallet-satelites.test.tsx` «lista sus consolidaciones…» + las columnas del desglose |
| R23 | la vista de saldos | `wallet-satelites.test.tsx` (tarjetas, tabla, conmutador, nota) |
| R24 | el desglose por bodega | idem + `saldos-satelites-descarga-columnas.test.ts` |
| R25 | marcar y revertir desde esa vista | `wallet-satelites.test.tsx` «el diálogo PRECARGA…», «marcar por MENOS envía…», «Desmarcar dice el importe…» |
| R26 | la satélite ve y no toca | `CierreBodegaMarcaConciliacion.test.tsx` bloque R26 (3 casos) |
| R27 | sin acceso total, nada | `wallet-satelites.test.tsx` «un rol sin acceso total ni siquiera llega», «sin sesión tampoco», «el permiso se deriva de `esAccesoTotal`» |
| R28 | el vocabulario aprobado en TODAS las superficies | `cierre-bodega-vocabulario.guardia` (censo + autocomprobación + los 6 valores a mano) + `CierreBodegaMarcaConciliacion.test.tsx` (los 3 estados) |
| R29 | descarga del conjunto filtrado | `saldos-satelites-descarga-columnas.test.ts` (2 listados, orden + censo) |

**R17/R18/R19** siguen anclados donde el backend los puso, y esta pasada les añade la cabecera:
`saldo-satelites.int.test.ts` «las TRES cifras de cabecera salen de la MISMA formula que la tabla».

---

## 4 · Las cinco mutaciones, con su salida roja

### 1 · el saldo de la tabla usa `total_general` en vez de `total_efectivo`
`SaldosSatelitesRepository:179`: `saldoDe(efectivo, recibido)` → `saldoDe(general, recibido)`.

```
× ⭑ R17/R18: las CUATRO poblaciones en una sola bodega, y el saldo las cuadra
× ⭑ R17/Q2: el SINPE NO cuenta — dos bodegas con el mismo general y distinto efectivo
× ⭑ R20/R23 — las TRES cifras de cabecera salen de la MISMA formula que la tabla
AssertionError: expected '1715.00' to be '1015.00'
AssertionError: expected '1000.00' to be '0.00'
AssertionError: expected '1415.00' to be '1015.00'
 Tests  3 failed | 14 passed (17)
```

El tercero es el caso NUEVO de esta pasada, y dice algo que los otros dos no: la cabecera y la
columna dejaron de cuadrar entre sí (`findResumen` seguía en efectivo, la fila pasó al general).

### 2 · «Recibido incompleto» se pinta igual que «Recibido»
`ESTADO_CONCILIACION_VARIANT.incompleto`: `"warning"` → `"success"`.

```
× ⭑ «Recibido incompleto» NO se pinta como «Recibido»: los dos tonos son distintos
× ⭑ «Recibido incompleto» NO se pinta como «Recibido»: mientras falte, es un aviso
AssertionError: expected 'group/badge inline-flex h-5 w-fit shr…' not to be 'group/badge inline-flex h-5 w-fit shr…'
 Test Files  2 failed (2)
      Tests  2 failed | 42 passed (44)
```

Rojo en las DOS superficies —la tarjeta de `/cierres-admin` y el desglose de `/wallet/satelites`—,
que es lo que confirma que el tono sale de un solo sitio.

### 3 · la satélite deja de ver la diferencia
`cierre-factura.tsx:1019`: la columna de la marca deja de montarse.

```
× una conciliada enseña monto recibido, lo que falta y quién la marcó
× SIN MARCAR no hay línea de monto recibido, y falta el EFECTIVO íntegro
× ⭑ `faltaPorRecibir` LLEGA del servidor: la tarjeta no lo resta (R20)
× ⭑ la NOTA se ve: es lo que distingue el backfill retroactivo de una conciliación real (R30)
× ⭑ ve el estado, el monto recibido y la diferencia de SU consolidación (Q7)
× ⭑ y NO puede marcar ni desmarcar: ni un solo botón de conciliar (R25/R27)
× la satélite y la central leen la MISMA tarjeta, así que no pueden discrepar
× monto recibido + falta por recibir = efectivo declarado, leído del DOM (R17/R18/R20)
× la cifra que se lee es la del SERVIDOR, sin redondear al colón
× ⭑ la falta se deriva del EFECTIVO y NO del total general (decisión Q2, medida)
× SIN MARCAR no hay línea de «monto recibido», y falta el efectivo ÍNTEGRO
TestingLibraryElementError: Unable to find an accessible element with the role "region" and name "Conciliación"
 Test Files  2 failed (2)
      Tests  11 failed | 35 passed (46)
```

### 4 · vuelve el vocabulario de la aprobación a una superficie de bodega
`CierresBodegaResueltosLista:151`: el rótulo del botón «Ver» → «Rechazar cierre».

```
× ⭑ 431/R16/R28: el vocabulario de la APROBACIÓN no vuelve a ninguna superficie de bodega
AssertionError: una superficie del cierre de bodega volvió a hablar de aprobar o rechazar. …
- []
+ [ "CierresBodegaResueltosLista.tsx:151" ]
 Tests  1 failed | 32 passed (33)
```

**Es la guardia que esta pasada añade, cazando justo lo que dice cazar**, con archivo y línea. Y no
lo caza ningún test de componente: el botón seguiría existiendo y funcionando.

### 5 · el aviso de T13 vuelve a frenar
`RecepcionSateliteModule:624`: `puedeAsignar={!bloqueada}` → `{!bloqueada && !porCierreBodega}`.

```
× ⭑ 431/R2/R4: con consolidación pendiente de conciliar hay AVISO, y «Asignar» SIGUE HABILITADO
Error: expect(element).toBeEnabled()
 Tests  1 failed | 37 passed (38)
```

Es la ficha entera en una línea: si el freno vuelve por cualquier puerta, esto se pone rojo.

**Las cinco se revirtieron y se verificó la reversión línea a línea.**

---

## 5 · Lo que queda vivo como límite (frontend)

1. **El recorte del conmutador «Con pendiente» es de CLIENTE.** Correcto con cinco bodegas; con más
   de `pageSize` hablaría sólo de la página visible y habría que subirlo al servidor con su total.
   Escrito en el propio componente.
2. **`ConsolidacionBodegaModule` no se tocó**: no dice «Aprobado» ni «Rechazado» ni monta acción de
   aprobar (comprobado). Su listado de solicitados —que sí es superficie de bodega— vive en su
   propio archivo y ese SÍ cambia.
3. **La antigüedad no sale a la descarga; la fecha sí.** «hace 3 días» es un derivado del momento en
   que se miró la pantalla y dentro de un archivo que alguien abre la semana que viene es falso.

---

## 6 · Archivos de esta pasada

### Creados
```
app/(app)/wallet/satelites/page.tsx
app/(app)/wallet/satelites/_components/SaldosSatelitesTable.tsx
app/(app)/wallet/satelites/_components/DesgloseConsolidacionesSatelite.tsx
app/(app)/wallet/satelites/_components/satelites-labels.ts
app/(app)/wallet/satelites/_components/saldos-satelites-descarga-columnas.ts
app/(app)/wallet/satelites/_components/consolidaciones-satelite-descarga-columnas.ts
components/shared/conciliacion/ConciliacionAcciones.tsx
components/shared/conciliacion/MarcarRecibidoDialog.tsx
components/shared/conciliacion/conciliacion-labels.ts
lib/utils/conciliacion-satelite.ts
tests/fixtures/marca-conciliacion.ts
tests/integration/wallet-satelites.test.tsx
tests/components/CierreBodegaMarcaConciliacion.test.tsx
tests/unit/descarga/saldos-satelites-descarga-columnas.test.ts
```

### Modificados
```
app/(app)/cierres-admin/page.tsx                              `puedeConciliar={esAccesoTotal(actor.rol)}`
app/(app)/cierres-admin/_components/cierre-labels.ts          los 6 rotulos + `estadoConciliacionDe`
app/(app)/cierres-admin/_components/cierre-factura.tsx        `marcaConciliacion`: badge + columna
app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx  fuera aprobar/rechazar; dentro la marca
app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts  vocabulario + 2 columnas x3
app/(app)/recepcion-satelite/_components/asignacion-satelite-bloqueo.ts  fuera la causa (ii); dentro el aviso
app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx     monta el aviso que no frena
lib/actions/cierre-bodega.ts                                  @sin-superficie en las 2 acciones retiradas
lib/auth/menu-visibility.ts                                   el item «Satelites»
lib/types/conciliacion-satelites.ts                           + `ResumenSatelitesDTO`, + `ultimaRecibida`
lib/repositories/SaldosSatelitesRepository.ts                 + `findResumen`, + la ultima recibida
lib/repositories/CierreBodegaRepository.ts                    la marca en `toBodegaResumenRow`
lib/services/CierresBodegaAdminService.ts                     la marca viaja tal cual
lib/services/ConciliacionSatelitesService.ts                  + `obtenerResumenSatelites`
lib/actions/conciliacion-satelites.ts                         + la accion del resumen; fuera las 6 anotaciones
lib/utils/fecha-cr.ts                                         + `inicioDelMesCREnUtc`
lib/interfaces/{repositories,services}/*                      los contratos de todo lo anterior
tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts   + censo APROBACION, + autocomprobacion, + 6 valores
tests/unit/descarga/cobertura-tablas.guardia.test.ts          36->38 archivos, 23->25 con descarga
tests/unit/guards/pwa-manifiesto-atajos.guardia.test.ts       maestro 20->21, admin 12->13
tests/unit/descarga/cierres-bodega-descarga-columnas.test.ts  el orden + la marca en el archivo
tests/components/DineroIdentidadesEnPantalla.test.tsx         B4-bis: la identidad de la marca
tests/components/RecepcionSateliteModule.test.tsx             los 2 casos del bloqueo, INVERTIDOS
tests/components/AsignarSateliteModal.test.tsx                el toast de la causa (ii), INVERTIDO
tests/components/descarga/CierresDescarga.test.tsx            `marcaPorEstado` + el vocabulario nuevo
tests/integration/db/saldo-satelites.int.test.ts              + 5 casos (ultima recibida, resumen)
tests/unit/repositories/cierre-pagos-lectura.test.ts          el doble, con las 4 columnas nuevas
tests/unit/services/conciliacion-satelites-service.test.ts    el doble, con `ultimaRecibida`
```

---

## 7 · Gate completo — `./init.sh`, con `.env`

Log: `progress/gate_431_frontend.log`, con `INIT_EXIT` escrito **dentro** del fichero y sin
canalizar por `tail`.

```
✓ typecheck paso
✓ lint paso
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2010 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0

 Test Files  2010 passed (2010)
      Tests  29360 passed | 26 skipped (29386)
```

**Los SALTADOS, mirados uno a uno:**

| Archivo | Saltados | ¿Es de la base? |
| --- | --- | --- |
| `tests/components/AnaliticaPage.test.tsx` | 17 | no |
| `tests/components/AnaliticaShell.test.tsx` | 9 | no |
| **total** | **26** | — |

**Cero archivos de `integration/db` saltados**, y **279 en verde** — exactamente la referencia del
backend. El `.env` se copió al worktree a propósito y se borró al terminar: sin él se habrían
saltado los 279 y el verde no habría valido nada en una ficha de dinero.

El aviso de las tres migraciones sin `down.sql` es de agosto (las de ruta) y no lo introduce este
trabajo.

### La primera corrida: cinco rojos, tres míos y dos flakes MEDIDOS

1. `tests/unit/guards/superficie-de-uso.guardia.test.ts` — **mío, y la guardia tenía razón**: al
   retirar los botones, `aprobarCierreBodega` y `rechazarCierreBodega` quedaron sin superficie.
   No se les devuelve pantalla (D2/R16): se anotan `@sin-superficie` con el motivo real y su
   caducidad (Q4/T29), que es literalmente para lo que existe esa anotación.
2. `tests/components/descarga/CierresDescarga.test.tsx` — **mío**: el archivo esperaba
   `["Rechazado", "Aprobado"]` y ahora lee el vocabulario de la conciliación. Se aprovechó para
   arreglar el doble: usaba `marcaSinConciliar` con `estado: "aprobado"`, que es la combinación
   que el `CHECK` declara **imposible** en la base. Pasa a `marcaPorEstado`.
3. `tests/components/AsignarSateliteModal.test.tsx` — **mío**: afirmaba el toast «pendiente de
   aprobación». Se INVIERTE (no se borra): la rama sigue viva (Q4) y ahora se fija que, si
   llegara, diría el título genérico y nunca el texto retirado.
4. `tests/integration/db/ranking-snapshot-migration.test.ts` y
   `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts` — **NO son míos: deadlock
   `40P01` bajo carga**, la familia de flakes ya conocida. Medido aislado: `Test Files 2 passed`,
   `Tests 60 passed`, **cero saltados**. En el gate definitivo los dos salen verdes.
   ⚠️ El del `ranking` además explicaba los 14 «saltados» de esa corrida: el deadlock reventó su
   `beforeAll` y vitest marcó sus 14 casos como skipped. Es la lectura que hay que hacer antes de
   creerse un conteo de saltados: un skip puede ser la sombra de un fallo.

---

## 8 · Veredicto (frontend)

Las pantallas de la 431, completas y verificadas: la satélite asigna con un aviso que cuenta y no
frena, el vocabulario de la aprobación no vuelve —y hay una guardia que lo mide—, la central marca
y desmarca desde las dos superficies con el mismo componente, la satélite ve su diferencia donde ya
mira, y `/wallet/satelites` dice dónde está el efectivo con una nota que impide contarlo dos veces.

Queda **T26 (ver la aplicación)** parcialmente medido: ver §9.

---

## 9 · T26 — ver la aplicación: lo que se vio, y lo que NO se pudo ver

**Cómo.** `pnpm dev` en el worktree (puerto 3431, con `.env`), conducida con `@playwright/test`
desde el scratchpad. Sesión REAL: el `maestro`, que es quien `esAccesoTotal` deja entrar.

**Antes hubo que sembrar el maestro local, y se dice:** ni `MAESTRO_PASSWORD` ni `QA_PASSWORD` del
`.env` abrían sesión contra la base local (las dos dieron «Correo o contraseña inválidos» con su
`POST /login 200` en el log del dev server, o sea el camino funcionaba y la credencial no). Se corrió
`pnpm exec tsx --env-file=.env scripts/seed-maestro.ts`, que es **idempotente por email** y toca
**una sola fila** (`maestro.qa@ordenex.test`). **NO se corrió `seed-usuarios-qa`**, que rota las
cuatro cuentas QA a la vez y le tumbaría la sesión a cualquier otro agente sin avisar.

### Lo que se vio (medido, no razonado)

**`/wallet/satelites`, con sesión de `maestro`:**

- El ítem **«Satélites»** está en el menú como **CUARTO hijo de Wallet**, debajo de «Caja
  principal», «Tiendas» y «Mensajeros», y queda marcado como activo al entrar.
- Cabecera: «Wallet · Satélites» / «Dinero consolidado que todavía no ha llegado a la central».
- Las **tres tarjetas**, con su cifra y su línea de composición:
  «Pendiente de conciliar · ₡0 · no queda nada por llegar»,
  «Recibido este mes · ₡0 · 0 consolidaciones conciliadas»,
  «Con diferencia · ₡0 · todo lo recibido llegó completo».
- El **conmutador** «Con pendiente (0)» / «Todas (12)» — 12 bodegas satélite en la base local.
- La **tabla** con sus columnas: Bodega · Pendiente · Más antigua sin conciliar · Última recibida,
  su control **«Descargar»** y su paginación («1-12 de 12»).
- **LA NOTA, entera y a la vista**, sin desplegable: «El saldo no es un movimiento de caja. Ese
  dinero ya entró a la caja de Ordenex cuando se aprobó el cierre de cada mensajero. Lo que esta
  pantalla dice es dónde está físicamente: cuánto queda en manos de cada bodega esperando llegar a
  la central.»
- Vacío correcto para la pestaña activa: «Ninguna bodega satélite tiene efectivo pendiente de llegar
  a la central.»

**`/cierres-admin`, pestaña de bodega:** ni «Aprobar», ni «Rechazar», ni «Esperando aprobación», ni
«Aprobado», ni «Rechazado** aparecen en NINGUNA parte del documento. (Los dos listados están vacíos
en local, así que esto vale como confirmación de que la superficie no los monta, no como prueba de
las filas — eso lo mide la guardia de vocabulario y el test de la tarjeta.)

**Un falso positivo que conviene dejar escrito:** el `innerText` de la tabla incluye un
encabezado «Desglose» que NO está en el diseño. No es un defecto: es el `<span className="sr-only">`
que el `DataTable` compartido pone en su columna de expandir —lo mismo que hace `/wallet/tiendas`—,
no se ve en pantalla y es el nombre accesible de esa columna. La columna «Ver» del mock es ese
mismo control.

**No se encontró ni un texto roto.** Es el barrido que la memoria del repo recomienda hacer siempre
que se toca algo que un humano lee, y esta ficha añade mucho texto nuevo.

### Lo que NO se pudo ver, y por qué

Los cuatro pasos que `tasks.md` pide para T26 —(a) la satélite asigna con una consolidación sin
conciliar, (b) consolida por segunda vez, (c) la central marca por menos y el saldo enseña la
diferencia, (d) la central revierte y el saldo vuelve— **necesitan datos que la base local no
tiene**: `cierre_bodega` está **vacía** (0 filas, medido por la pasada de backend antes de migrar y
confirmado aquí: las tres tarjetas y los dos listados salen en cero).

Construirlos exigiría sembrar a mano una cadena entera —órdenes, gestiones, `cierre_dia` aprobados y
su consolidación— **en una base local COMPARTIDA con los demás worktrees**, que es justo lo que pone
rojo el gate de otro agente. Se deja **sin hacer a propósito y declarado**, no dado por bueno:

> **T26 (a)–(d) queda PENDIENTE de una pasada con datos.** El sitio natural es el entorno de
> *preview* tras el despliegue, o una base local sembrada a propósito y avisando. Lo que sí está
> medido es que las pantallas montan, que el menú lleva a ellas, que los textos son los aprobados y
> que el vocabulario retirado no aparece.
