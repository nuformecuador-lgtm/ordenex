# Feature 264 — bitácora del bloque BACKEND (B1–B9)

> Rama `feat/264-cierre-sin-gestionar-backend`, desde `origin/dev` (`d6dd96b4`).
> **Alcance: solo B1–B9.** El bloque FRONTEND (F1–F6) y sus mutaciones (M4, M5, M9, M10, M11)
> **no** se tocaron: los hace otro agente. Ningún archivo de `app/**` aparece en el diff.

---

## 1. Qué estaba mal, y por qué hacía falta una tabla

El detalle de un cierre se construye **entero** sobre las gestiones (`gestion_orden.cierre_id`
cruzado con `cierre_detail`). Una orden que el corte diario barrió a `sin_gestionar` **no tiene
gestión**: `CierreDiaRepository.crearCierre` solo le cambia el `estatus_id`. La única relación
cierre ↔ orden barrida era un predicado **vivo** —«las órdenes en `sin_gestionar` del mensajero de
ese cierre»— y **la aprobación lo destruye**: libera la orden a bodega y le borra
`mensajero_asignado_id`.

Consecuencia medible: el cierre `vencido` se crea *precisamente* por esas órdenes y la pantalla
escondía justo eso; y el cierre `aprobado` —el que se audita, porque es el que ya movió dinero—
mostraba **cero**, indistinguible de un cierre que de verdad no barrió ninguna.

---

## 2. Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260822120000_cierre_sin_gestion/migration.sql` | Tabla + 2 índices + 3 FK `RESTRICT` + RLS sin policies + `cierre_dia.sin_gestion_registrado` + backfill + `UPDATE` de la marca |
| `db/migrations/20260822120000_cierre_sin_gestion/down.sql` | `DROP TABLE` **y** `DROP COLUMN` |
| `lib/utils/cierre-sin-gestion.ts` | `SIN_GESTION_SELECT`, `ORDEN_SIN_GESTION`, `toSinGestionRow` — declarados **una** vez y compartidos por las dos superficies |
| `tests/integration/db/cierre-sin-gestion-migration.test.ts` | B2 (27 casos) |
| `tests/integration/db/cierre-sin-gestion-sql-real.test.ts` | B7 (9 casos, contra Postgres) |
| `tests/unit/guards/cierre-sin-gestion-sin-dinero.guardia.test.ts` | B6 (8 casos) |
| `tests/unit/services/cierres-admin-service.aprobar.sin-gestion.test.ts` | B8 (5 casos) |

### Modificados (producción)

| Archivo | Qué cambia |
| --- | --- |
| `db/schema.prisma` | `model CierreSinGestion` + `CierreDia.sinGestionRegistrado` + los tres lados inversos |
| `lib/repositories/CierreDiaRepository.ts` | B3: el pre-`SELECT` del corte proyecta los descriptivos y el `createMany` del vínculo va **en la misma tx**. B9: el detalle propio trae la lista |
| `lib/repositories/CierresAdminRepository.ts` | B4: tercera consulta del `Promise.all`, `where: { cierreId }` + `orderBy` |
| `lib/services/CierresAdminService.ts` | B5: mapeo directo al DTO |
| `lib/services/CierreDiaService.ts` | B9: el mismo par de campos en el camino del mensajero |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | `CierreSinGestionRow` + el retorno del detalle propio |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | El retorno del detalle del admin |
| `lib/interfaces/services/ICierreDiaService.ts` | **Declara** `CierreOrdenSinGestion` + los dos campos del resultado |
| `lib/interfaces/services/ICierresAdminService.ts` | **Re-exporta** el DTO + los dos campos del resultado |

### Modificados (tests ajenos, solo cableado)

`tests/components/{CierreDiaModule,CierresAdminConfirmacionFisica,CierresAdminDeepLink,CierresAdminIndemnizacion,CierresAdminModule,CierresAdminPage,CierresAdminPagoMensajero}.test.tsx`,
`tests/integration/actions/cierre-dia-action.test.ts`,
`tests/unit/repositories/{cierre-dia-repository,cierre-pagos-lectura,cierres-admin-repository}.test.ts`,
`tests/unit/services/{cierre-dia-service,cierres-admin-pendiente,cierres-admin-service}.test.ts`.

Son **dobles**, no aserciones: el contrato ganó dos campos obligatorios y los literales que lo
construían dejaban de compilar. En los `.tsx` la única línea añadida es
`ordenesSinGestion: [], sinGestionRegistrado: true`. Ninguna aserción existente se cambió.

---

## 3. Lo que **no** era implementable como estaba escrito (y por qué es bueno saberlo)

**`design.md §6` sitúa `CierreOrdenSinGestion` en `lib/interfaces/services/ICierresAdminService.ts`
y dice que `ICierreDiaService.ts` lo reusa. Escrito así, rompe el bundle del navegador.**

Se implementó literal y el **gate lo cazó**:
`tests/unit/guards/pagos-captura.guardia.test.ts` (R19 de la 212) se puso rojo con

```
AssertionError: el bundle del navegador arrastraría el cliente de Prisma: expected [ …(2) ] to deeply equal []
+   "lib/types/cierres-admin.ts: import { Prisma } from \"@prisma/client\"",
+   "lib/types/wallet.ts: import { Prisma } from \"@prisma/client\"",
```

Esa guardia recorre el grafo de imports **desde `GestionarOrdenPanel.tsx`**. `ICierreDiaService.ts`
ya está en ese grafo; el `import type` nuevo hacia `ICierresAdminService.ts` metía con él
`lib/types/cierres-admin.ts` y `lib/types/wallet.ts`, que importan `Prisma` como **valor**. Es
decir: el panel del mensajero se habría llevado el cliente de Prisma entero al navegador.

Comprobado que era **mío** y no un `dev` que venía rojo: con `git stash --include-untracked` la
guardia pasa `31/31`; con el cambio aplicado, `2` rojos.

**Arreglo:** el DTO se **declara** en `ICierreDiaService.ts` —del que el contrato del admin ya
dependía— y `ICierresAdminService.ts` lo **re-exporta**. La ruta que nombra el design sigue
resolviendo (`import type { CierreOrdenSinGestion } from "@/lib/interfaces/services/ICierresAdminService"`
compila), no hay arista nueva y el DTO sigue siendo **uno solo**. El porqué queda escrito en los
dos archivos, para que nadie lo «arregle» de vuelta.

---

## 4. B1 — round-trip de la migración, **ejecutado**

Base local `postgresql://…@localhost:5432/ordenex` (la compartida, sucia a propósito; no se
corrió `db:reset` ni se borró nada).

```
$ pnpm exec prisma validate
The schema at db\schema.prisma is valid 🚀

$ pnpm run db:migrate                       # UP
Applying migration `20260822120000_cierre_sin_gestion`
The following migration(s) have been applied:
migrations/
  └─ 20260822120000_cierre_sin_gestion/
    └─ migration.sql
Your database is now in sync with your schema.      # ← no propone ninguna migración extra:
                                                    #   schema.prisma y migration.sql coinciden

$ pnpm run db:rollback                      # DOWN
Aplicando rollback: 20260822120000_cierre_sin_gestion
Script executed successfully.
Script executed successfully.
Rollback completado: 20260822120000_cierre_sin_gestion
ROLLBACK_EXIT=0

$ pnpm run db:migrate                       # UP otra vez
Applying migration `20260822120000_cierre_sin_gestion`
Your database is now in sync with your schema.
MIGRATE2_EXIT=0
```

Estado real de la base tras el UP (consulta directa):

```
filas cierre_sin_gestion: [{"n":0}]
con estatus_origen_id:    [{"n":0}]
marca por estado:         [{"e":"aprobado","m":false,"n":6}]
rls: [{"rls":true}]  policies: [{"n":0}]
```

Lectura honesta de esos números: la base local **no tiene ningún cierre abierto ni ninguna orden en
`sin_gestionar`**, así que el backfill insertó 0 filas — lo que demuestra es que el `INSERT … SELECT`
con el `LEFT JOIN LATERAL` **parsea y ejecuta** contra Postgres real. Lo que sí se verificó con
datos es el paso 7: los 6 cierres `aprobado` existentes quedaron en `sin_gestion_registrado = false`
(R26/R29), y la RLS quedó habilitada **sin policies** (R23). La selección de filas del backfill la
cubre B2 por regex sobre el SQL; el `WHERE` de la **lectura** se prueba con datos en B7.

Ni una columna `DECIMAL` en la tabla (B2 y B6 lo afirman, y M7 los mata).

---

## 5. Mapa `R<n> → test` (solo los del bloque BACKEND)

| R | Test | Archivo |
| --- | --- | --- |
| R1 | «devuelve las CUATRO barridas de ESTE cierre y ninguna mas» | `cierre-sin-gestion-sql-real.test.ts` |
| R2 | «escribe el vinculo DENTRO de la misma tx, con las MISMAS ordenes que el updateMany movio» | `cierre-dia-repository.test.ts` |
| R3 | «si la transaccion se revierte, NO queda ni un vinculo registrado» | `cierre-dia-repository.test.ts` |
| R4 | «cada fila lleva el estatus de origen de SU vuelta, nunca uno supuesto» | `cierre-dia-repository.test.ts` |
| R5 | «la orden ya LIBERADA a bodega sigue apareciendo» + «la aprobacion NO borra ni reescribe el vinculo» | `cierre-sin-gestion-sql-real.test.ts` + `cierres-admin-service.aprobar.sin-gestion.test.ts` |
| R6 | «solicitar el cierre por el flujo normal (37, sin corte) NO registra ningun vinculo» | `cierre-dia-repository.test.ts` |
| R7 | «el cierre B (mismo mensajero) trae SOLO lo suyo, y el C SOLO lo suyo» | `cierre-sin-gestion-sql-real.test.ts` |
| R8 | «fuera de alcance -> `no_encontrada`, sin lista» + «un cierre fuera del alcance del satelite es indistinguible» | `cierres-admin-service.test.ts` + `cierre-sin-gestion-sql-real.test.ts` |
| R9 | «los OCHO campos llegan al DTO» + «los ocho campos llegan resueltos» | `cierres-admin-service.test.ts` + `cierre-sin-gestion-sql-real.test.ts` |
| R10 | las 8 aserciones de la guardia + «ni un DECIMAL en el CREATE TABLE» | `cierre-sin-gestion-sin-dinero.guardia.test.ts` + `cierre-sin-gestion-migration.test.ts` |
| R11 | «devuelve el descriptivo CONGELADO, no el de la orden viva» (lee el valor vivo de la base) | `cierre-sin-gestion-sql-real.test.ts` |
| R12 | «el orden es por guia ascendente con los `null` al final, y es el MISMO dos veces» | `cierre-sin-gestion-sql-real.test.ts` |
| R22 | «los movimientos de los CINCO feeds son iguales campo a campo, con y sin la lista» | `cierres-admin-service.aprobar.sin-gestion.test.ts` |
| R23 | «habilita RLS SIN policies» | `cierre-sin-gestion-migration.test.ts` |
| R24 | «DROP TABLE» + «suelta TAMBIEN la columna» + round-trip real (§4) | `cierre-sin-gestion-migration.test.ts` |
| R25 | «es un solo INSERT … SELECT sobre los TRES estados abiertos» | `cierre-sin-gestion-migration.test.ts` |
| R26 | «el backfill NO menciona `aprobado`» | `cierre-sin-gestion-migration.test.ts` |
| R27 | «emite `sinGestionRegistrado` tal cual» + «el cierre nace con la marca en `true`» | `cierres-admin-service.test.ts` + `cierre-sin-gestion-sql-real.test.ts` |
| R29 | «el UPDATE baja la marca a `false` FUERA de los tres estados abiertos» | `cierre-sin-gestion-migration.test.ts` |
| R30 (datos) | «el detalle propio trae la lista del cierre» + «un cierre AJENO sigue cayendo en `no_encontrada`» | `cierre-dia-service.test.ts` + `cierre-dia-repository.test.ts` |
| R32 | «sin estatus de origen viaja `null`, no una cadena inventada» | `cierre-dia-repository.test.ts` + `cierre-sin-gestion-sql-real.test.ts` |
| R33 | «LEFT JOIN LATERAL sobre el historial, por `corte_sin_gestionar`, el mas reciente» + «es LEFT, no un JOIN» | `cierre-sin-gestion-migration.test.ts` |

**Pendientes del bloque FRONTEND, no cubiertos aquí:** R13–R18, R19, R20, R21, R28, R31, R34 y la
mitad de pantalla de R30. Los cubren F1–F6.

---

## 6. Mutaciones — **ejecutadas**, con la salida roja pegada

Protocolo por mutación: aplicar → correr **solo** el test indicado → pegar el rojo → revertir →
confirmar verde. Las cinco del bloque FRONTEND (M4, M5, M9, M10, M11) **no** se hicieron: mutan
`cierre-factura.tsx` y `CierreDiaModule.tsx`, que no toco.

### M1 — quitar `where: { cierreId }` de la consulta nueva (B4) → **B7 ROJO**

```
 Test Files  1 failed (1)
      Tests  3 failed | 6 passed (9)

AssertionError: expected [ 'R-264-mt46qbak-a-congelada', …(5) ] to deeply equal [ … (3) ]
  [
    "R-264-mt46qbak-a-congelada",
    "R-264-mt46qbak-a-liberada",
    "R-264-mt46qbak-a-normal",
+   "R-264-mt46qbak-b-otro-cierre",
+   "R-264-mt46qbak-c-otro-mensajero",
    "R-264-mt46qbak-a-sin-guia",
  ]
```

Revertida → `Tests 9 passed (9)`.

### M2 — `orderBy` → `{ createdAt: "desc" }` → **B7 ROJO** (R12)

```
 FAIL  … > R12: el orden es por guia ascendente con los `null` al final, y es el MISMO dos veces
AssertionError: expected [ 'R-264-mt46qpv9-a-sin-guia', …(3) ] to deeply equal [ 'R-264-mt46qpv9-a-congelada', …(3) ]
+   "R-264-mt46qpv9-a-sin-guia",
    "R-264-mt46qpv9-a-congelada",
    "R-264-mt46qpv9-a-liberada",
    "R-264-mt46qpv9-a-normal",
-   "R-264-mt46qpv9-a-sin-guia",
```

Las guías del corpus se siembran **decrecientes** respecto al orden de inserción justamente para
que este caso no pueda acertar por casualidad. Revertida → `9 passed`.

### M3 — devolver `orden.destinatario` **vivo** en vez del congelado → **B7 ROJO** (R11)

```
 FAIL  … > R11: devuelve el descriptivo CONGELADO, no el de la orden viva
AssertionError: expected 'VIVO EDITADO DESPUES' to be 'Dest a-congelada' // Object.is equality
Expected: "Dest a-congelada"
Received: "VIVO EDITADO DESPUES"
```

Revertida → `9 passed`.

### M6 — añadir `'aprobado'` al `WHERE` del backfill → **B2 ROJO** (R26)

```
 Test Files  1 failed (1)
      Tests  2 failed | 25 passed (27)

 FAIL  … > R26: el backfill NO menciona `aprobado` — un vinculo que no consta no se inventa
   211|     expect(upExec).not.toMatch(/'aprobado'/);
```

Revertida → `27 passed`.

### M7 — columna `monto_cobrar DECIMAL(12,2)` en la tabla + su campo en el DTO y en el modelo → **B2 y B6 ROJOS** (R10)

```
 ❯ tests/integration/db/cierre-sin-gestion-migration.test.ts (27 tests | 2 failed)
     × R10: ni un DECIMAL en el CREATE TABLE
     × R10: ninguna columna del CREATE TABLE lleva un nombre del vocabulario de dinero
 ❯ tests/unit/guards/cierre-sin-gestion-sin-dinero.guardia.test.ts (8 tests | 4 failed)
     × el modelo Prisma `CierreSinGestion`: ningun campo del vocabulario de dinero
     × el modelo Prisma `CierreSinGestion`: ningun tipo numerico de dinero
     × el DTO de servicio `CierreOrdenSinGestion`: ningun campo del vocabulario de dinero
     × R10: tampoco en la COLUMNA — el `CREATE TABLE` no declara dinero

AssertionError: expected [ 'monto', 'cobrar' ] to deeply equal []
```

Revertida → `35 passed (35)`. *(Se volvió a ejecutar **después** de mover el DTO de archivo, para
que el rojo sea el del sitio donde el DTO vive de verdad.)*

### M8 — el feed de wallet lee también `cierre_sin_gestion` → **B8 ROJO** (R22), al segundo intento

**Primer intento: SOBREVIVIÓ, y es un dato, no un descuido.** La primera versión de la mutación
añadía las órdenes barridas al feed con `montoCobrar: null`, `cobraComision: false` y `tarifa: null`
—que es lo único que esas filas *tienen*—, y eso produce conceptos en `0.00` que la 42/R10 omite:
`Tests 5 passed (5)`. Es exactamente el argumento estructural del `design.md §5`: **de esas filas no
se puede sumar nada, porque no hay nada que sumar**. Para que el feed mueva dinero con ellas hay que
**inventarle** un importe tomado de otra fila.

Segundo intento, con la mutación que sí mueve dinero (facturar cada barrida como devolución usando
la tarifa congelada de otra fila del cierre) → **ROJO**:

```
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)

 FAIL  … > R22: los movimientos de los CINCO feeds son iguales campo a campo, con y sin la lista
      {
        "categoria": "ingreso_iva_flete_devolucion",
-       "monto": "104.00",
+       "monto": "260.00",
      }

 FAIL  … > R22: los importes de la caja son los del cierre semilla, no unos derivados de la lista
AssertionError: expected '1600.00' to be '800.00' // Object.is equality
```

Revertida → `5 passed`, y `git diff lib/services/WalletFeedService.ts` vacío.

### Extra (no está en el bloque M, pero R3 no se cree sin ella)

Mover el `createMany` del vínculo **fuera** de la transacción (`tx.` → `this.prisma.`) →
`cierre-dia-repository.test.ts` **ROJO**, 4 casos:

```
     × R2: escribe el vinculo DENTRO de la misma tx, con las MISMAS ordenes que el updateMany movio
     × R3: si la transaccion se revierte, NO queda ni un vinculo registrado
     × una vuelta que no movio nada no escribe filas de esa vuelta
     × usa `skipDuplicates`: una segunda corrida del corte no duplica el vinculo
```

Revertida → `103 passed (103)`. El doble de ese bloque emula **commit y rollback de verdad** (dos
almacenes: lo escrito por `tx` solo se compromete si el callback resuelve); sin eso, «se escribe
dentro de la transacción» sería una afirmación que ningún test podría desmentir.

---

## 7. Salidas reales

```
$ pnpm run typecheck
(sin salida — 0 errores)

$ pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

Las 99 son `no-unused-vars` sobre parámetros `_`-prefijados de dobles de test **preexistentes**;
ninguna está en un archivo de esta feature.

### `./init.sh` COMPLETO (el rápido se niega solo: toca `db/migrations/**`, `db/schema.prisma` y archivos con `cierre` en el nombre)

```
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso

 Test Files  1301 passed (1301)
      Tests  17347 passed | 26 skipped (17373)
   Duration  361.20s

✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de los tres `down.sql` es **preexistente** (feature 92) y no se tocó. La migración de esta
feature **sí** lleva el suyo.

Los 26 `skipped` son los mismos que antes del cambio (los totales cuadran: `17347 + 26 = 17373`, y
la corrida anterior daba `17345 + 2 + 26`). El archivo de B7 **no** está entre ellos: corre con la
base local y sus 9 casos pasan; sin base alcanzable se saltaría entero y se vería como `skipped`,
nunca en verde por omisión.

---

## 8. Lo que no se hizo, y por qué

- **F1–F6 y M4/M5/M9/M10/M11.** Fuera del encargo. El archivo principal del frontend
  (`cierre-factura.tsx`) lo está tocando otra ficha sin mergear.
- **Descargas de gestiones y detalle de bodega.** `requirements.md > Límites declarados` los deja
  fuera con puntero. No se tocó ninguno de los dos.
- **E2E.** `design.md §8.4` lo declara opcional y **sin valor como evidencia** (la suite del gate no
  los ejecuta). No se ampliaron.
- **`feature_list.json` / `progress/current.md`.** Los mantiene el leader.

---

## Veredicto

Backend completo (B1–B9) con gate completo en verde (`INIT_EXIT=0`, 17 347 tests) y las seis
mutaciones de este bloque muertas con su rojo pegado; la única decisión del spec que no era
implementable —dónde vive el DTO— se corrigió invirtiendo la dependencia, y la cazó una guardia, no
una revisión.
