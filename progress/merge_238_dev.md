# Merge `origin/dev` -> `feature/238-confirmacion-fisica-cierre`

Fecha: 2026-08-19 · `MERGE_HEAD` = `3e2a57f3` (PR #401, rama `ux`: 142 archivos, +6513/-2020).
Arbol resuelto y stageado; **sin commit** (lo hace el humano). El gate completo tambien.

---

## 1. `lib/interfaces/repositories/ICierresAdminRepository.ts` — imports

HEAD traia `GestionResultado` (usado en `CierreGestionPendienteRow`, l.86); `dev` traia
`MetodoPagoValue` (usado en `GestionEditableDelCierre` y `ActualizarPagosGestionInput`).

**Resuelto:** un solo import combinado —
`import type { GestionResultado, MetodoPagoValue } from "@prisma/client";`

**Por que:** los dos simbolos se usan, asi que quedarse con uno rompe el typecheck. Se colapsan en
UNA sentencia y sin linea en blanco detras porque es la forma exacta que ya tiene el archivo hermano
`ICierreDiaRepository.ts`, que importa esos DOS mismos simbolos en una sola linea. La linea en blanco
que HEAD ponia detras era la anomalia, no la norma.

## 2. Mismo archivo, ~l.140 — interfaces

HEAD declaraba `ConfirmacionFisicaGestion` (238); `dev`, `GestionEditableDelCierre`,
`ActualizarPagosGestionInput` y `ActualizarPagosGestionResult`.

**Resuelto:** quedan las cuatro, en ese orden.

**Verificado, no asumido:**

- Ningun nombre colisiona: cada uno se declara UNA vez en el archivo (grep sobre `interface X` /
  `type X`).
- Ningun tipo se solapa: la de HEAD es `{ gestionId }`; las de `dev` son la lectura y la escritura de
  otra transaccion (`actualizarPagosGestion`).
- El `/**` de apertura del doc-comment era **compartido** por las dos mitades del conflicto. Al
  quedarse las dos, hay que **reabrir** un `/**` antes del bloque de `dev`; si no, su prosa se
  convertia en codigo. Es la unica linea que no viene literal de un lado.
- `CierreResultado` / `CierreTotales`, que usan los tipos de `dev`, ya venian importados en el bloque
  auto-mergeado (l.8).

## 3. `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts` — el delicado

Las dos ramas tocaron el MISMO caso de forma incompatible, y las **declaraciones** ya habian
auto-mergeado con las dos formas mezcladas (l.120 y l.125, las de `corregir-pagos`, en `string`; el
resto en lista). Asi no compila.

**Resuelto:** lo mas fuerte de cada lado.

| | HEAD (238) | `dev` (ux) | Resuelto |
|---|---|---|---|
| forma de `cubiertaPor` | lista | string | **lista** (+ se convierten las 2 entradas de `dev`) |
| asercion «cita >= 1 suite» | si | no | **si** |
| listas recorridas | 2 | 3 | **3** |

**Por que la LISTA:** es estrictamente mas rica. Permite citar varias suites —lo que la 238 necesita,
porque `tx.gestionOrden.updateMany` describe hoy dos bloques con dueños distintos (indemnizacion 158
y marca fisica 238)— y habilita la asercion de «al menos una»: una lista vacia seria una escritura
declarada que nadie mira, que es literalmente el fallo de agosto de 2026 que motiva la guardia.
Normalizar todo a `string` habria borrado la segunda cita de esa entrada **en silencio**.

**Por que las TRES listas:** `ESCRITURAS_FUERA_DE_LA_APROBACION` no es un capricho de `dev`. El censo
del frente 1 es **por archivo**: `actualizarPagosGestion` vive en el MISMO `CierresAdminRepository.ts`
y escribe `tx.gestionOrdenPago.deleteMany/createMany`. Sin esa lista, el primer caso se pone rojo por
escrituras que no son de la aprobacion. Y si la lista existe pero no entra en el recorrido de «apunta
a tests que existen», seria la unica declaracion del archivo que **nadie comprueba** — un rotulo sin
verificar. Recortar a dos listas era, exactamente, abrir ese agujero.

Se dejo un comentario en el caso explicando la procedencia de cada mitad.

## 4. Daño colateral del merge (sin conflicto textual, pero roto)

`tsc --noEmit` cayo en dos archivos que **git auto-mergeo limpiamente**: cada lado tenia su propio
`fakeRepo()` como literal COMPLETO de `ICierresAdminRepository`, y el contrato mergeado tiene metodos
de los dos lados. A cada doble le faltaba el del otro.

- `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` (238) <- le faltaban
  `findGestionEditableEnCierre` y `actualizarPagosGestion`.
- `tests/unit/services/cierres-admin-corregir-pagos.test.ts` (`dev`) <- le faltaba
  `findGestionesRetornablesDelCierre`.

Stubs **neutros** (`null`, `[]`, `{ status: "fuera_de_alcance" }`): ninguna de las dos suites recorre
la ruta ajena, y un stub «optimista» dejaria pasar por verde un uso accidental.

---

## Mutaciones — la guardia sigue mordiendo (rojo real citado)

Se mato una vez **por cada mitad**, porque una resolucion sesgada dejaria verde justo la del lado que
perdio. Se restauro tras cada una (el `md5sum` de los dos archivos vuelve al valor previo,
`1253c6d7…` / `91b77c52…`), y la guardia vuelve verde (7/7).

**(a1) lista vacia en la mitad HEAD** — `tx.cierreDia.updateMany` con `cubiertaPor: []`

```
AssertionError: tx.cierreDia.updateMany no cita ninguna suite: expected 0 to be greater than 0
 ❯ tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts:185:76
 Tests  1 failed | 6 passed (7)
```

**(a2) lista vacia en la mitad `dev`** — `tx.gestionOrdenPago.createMany` con `cubiertaPor: []`

```
AssertionError: tx.gestionOrdenPago.createMany no cita ninguna suite: expected 0 to be greater than 0
 Tests  1 failed | 6 passed (7)
```

> Esta es la prueba cruzada: **ninguna de las dos ramas por separado la habria cazado**. La de `dev`
> no tenia la asercion de longitud; la de HEAD no recorria esa lista.

**(b1) suite inexistente en la mitad HEAD** — segunda cita de la entrada de la 238

```
AssertionError: tx.gestionOrden.updateMany cita tests/unit/repositories/NO-EXISTE-confirmacion-fisica.test.ts,
que no existe: expected false to be true // Object.is equality
 Tests  1 failed | 6 passed (7)
```

> Muere sobre el **segundo** elemento de la lista: es la cita que una normalizacion a `string` habria
> perdido sin dejar rastro.

**(b2) suite inexistente en la mitad `dev`** — `tx.gestionOrdenPago.deleteMany`

```
AssertionError: tx.gestionOrdenPago.deleteMany cita tests/unit/repositories/NO-EXISTE-corregir-pagos-where.test.ts,
que no existe: expected false to be true // Object.is equality
 Tests  1 failed | 6 passed (7)
```

> Es la prueba de que la tercera lista se recorre de verdad: con la version de HEAD esto habria
> quedado verde.

**(c) escritura sobre `tx` sin declarar** — un `tx.novedad.updateMany({...})` inyectado DENTRO de la
transaccion de aprobacion, en `CierresAdminRepository.ts`

```
AssertionError: escritura sobre `tx` sin entrada en ESCRITURAS_DE_LA_APROBACION ni en
ESCRITURAS_FUERA_DE_LA_APROBACION: declarala con la suite que la nombra, o el fallo de agosto de 2026
se repite: expected [ 'tx.novedad.updateMany' ] to deeply equal []
 ❯ tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts:169:7
 Tests  1 failed | 6 passed (7)
```

**5/5 mutantes muertos.** Ninguna sobrevivio.

## Inventario: las escrituras de las DOS features estan declaradas

Censo real del repositorio: 5 escrituras `tx.*` distintas (10 ocurrencias, l.1111 / 1129 / 1131 /
1165 / 1205 / 1235 / 1349 / 1419 / 1463 / 1570).

| escritura | lista | suite citada |
|---|---|---|
| `tx.cierreDia.updateMany` | aprobacion | `cierres-admin-repository.test.ts` |
| `tx.gestionOrden.updateMany` | aprobacion | `cierres-admin-indemnizacion.test.ts` + `cierres-admin-confirmacion-fisica.test.ts` (**238**) |
| `tx.orden.updateMany` | aprobacion | `cierres-admin-anclaje-devolucion.test.ts` |
| `tx.gestionOrdenPago.deleteMany` | fuera | `cierres-admin-corregir-pagos-where.test.ts` (**ux**) |
| `tx.gestionOrdenPago.createMany` | fuera | `cierres-admin-corregir-pagos-where.test.ts` (**ux**) |

Ninguna queda sin declarar. **No es bloqueante.** (Ver la observacion O1 abajo.)

## Lo que se corrio

```
pnpm exec prisma generate                    ✔ Generated Prisma Client (v7.8.0)   [schema.prisma cambio: +46/-28]
pnpm exec tsc --noEmit                       exit 0
pnpm exec eslint <4 archivos tocados>        exit 0
vitest tests/unit/guards/                    59 files | 856 tests passed
vitest <26 suites de los dos lados>          26 files | 374 tests passed
vitest tests/integration/db/{wallet-idempotencia, cierres-admin-retornables-sql-real,
                             confirmacion-fisica-migration}
                                             3 files | 32 tests passed   (Postgres real, no no-op)
vitest tests/integration/db/cierre-detail-congelado.test.ts
                                             3 failed  <-- ROJO PREEXISTENTE DE `dev`, ver O2
```

Las 26 suites: `cierres-admin-{anclaje-devolucion, caja-cod, confirmacion-fisica,
corregir-pagos-where, gestiones-where, indemnizacion, repository, retornables}`,
`CierresAdminRepository.resolverCierre.devolucion`, `CierresAdminService.{aprobar.devolucion,
gestiones-completo}`, `cierres-admin-{completo, confirmacion-fisica, corregir-pagos,
historico-paginado, indemnizacion, pendiente, pendientes-paginado, service}`,
`cierres-admin-confirmacion-schema`, `corregir-pagos-schema`, `gestion-retorno`,
`confirmacion-{incidentes-excluidos, sin-lectores}.guardia`, `aprobacion-escrituras-cubiertas.guardia`,
`cierres-admin-action`.

Las 3 de Postgres real no son verdes-sin-datos: los tiempos por caso (132ms, 20ms, 17ms…) y las
aserciones que leen `information_schema` lo confirman.

---

## Observaciones — cosas que huelen mal. NO SE TOCARON.

### O1 · La guardia no ve el TERCER bloque de `tx.gestionOrden.updateMany`

`dev` añadio un tercer uso de ese delegado en `actualizarPagosGestion` (l.1111, el sello anti-TOCTOU
que escribe `pagosEditadosAt/Por`), y vive en OTRA transaccion. El censo **deduplica por nombre de
delegado**, asi que ese bloque queda absorbido por la entrada de la aprobacion sin que nada lo note —
y el texto `que:` de esa entrada sigue diciendo «**DOS** bloques comparten esta escritura», que ya es
falso.

No hay perdida de cobertura HOY: `cierres-admin-corregir-pagos-where.test.ts` si asierta sobre ese
`where` y ese `data` (l.134-157). Pero la guardia es **estructuralmente ciega** a un cuarto bloque
sobre el mismo delegado, que es el hueco por el que entro el fallo de agosto. Correccion propuesta y
no aplicada (no es de este merge): declarar el sello como entrada propia de
`ESCRITURAS_FUERA_DE_LA_APROBACION` y que el censo distinga por transaccion, no por delegado.

### O2 · `tests/integration/db/cierre-detail-congelado.test.ts` esta ROJO, y viene de `dev`

3 tests (Feature 69/R17/R18, money-critical) caen con:

```
TypeError: Cannot read properties of undefined (reading 'toFixed')
 ❯ TarifaVigentePorTiendaRepository.resolveTarifasPorTiendas lib/repositories/TarifaVigentePorTiendaRepository.ts:103:36
 ❯ lib/repositories/CierreDiaRepository.ts:589:27
```

**No lo causa el merge.** Comprobado:

- `TarifaVigentePorTiendaRepository.ts` y `CierreDiaRepository.ts` son **byte-identicos** a
  `origin/dev` (`git diff --stat origin/dev` vacio en los dos).
- El commit `891de8be` («el detalle sale con una columna por medio de pago y el fulfillment
  congelado», rama `ux`) introdujo `f.fulfillment.toFixed(2)`.
- La suite usa una base EN MEMORIA (lo dice su propia cabecera). Su `interface TarifaRow` **no tiene**
  campo `fulfillment`, ni en el arbol mergeado ni en `origin/dev` (`grep -c fulfillment` = 0 en los
  dos). Por tanto `f.fulfillment` es `undefined` y revienta.
- El unico delta de la 238 en ese archivo es una linea (`confirmacionFisica: []`) sobre una rama que
  el repositorio recorre como `if (confirmacionFisica.length > 0)` -> no-op.
- `vitest.config.ts` incluye `tests/**/*.test.ts`: esta suite **si** entra en el gate completo.

Conclusion: `origin/dev` esta rojo por si solo. El arreglo (añadir `fulfillment` al doble) es de quien
trajo `ux`, no de la 238.

### O3 · Las dos migraciones nuevas de `dev` no traen `down.sql`

`db/migrations/20260819120000_gestion_pagos_editados/` y
`db/migrations/20260819140000_cierre_detail_tarifa_fulfillment/` solo tienen `migration.sql`. El
contrato de backend lo pide obligatorio. No es nuevo del todo (5 carpetas de 134 estan asi, 3 desde el
2026-08-14) y no hay guardia general que lo cace: las que existen son por-feature. No se toco.
