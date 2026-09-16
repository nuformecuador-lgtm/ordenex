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
