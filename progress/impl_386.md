# impl_386 — filtrar los cierres por estado (mitad de SERVIDOR)

**Ficha 386** · `sdd: false`, sin spec · **sin migración y sin tocar la base** · 2026-09-08
**Rama:** `worktree-agent-a6f5c53bcabb9cca4` (worktree aislado; la rama registrada en la ficha es
`feat/386-filtro-estado-cierres`).

---

## La clave del filtro, para quien monte la pantalla

```ts
estados?: [CierreEstado, ...CierreEstado[]]   // dentro del bloque `filtros`
```

- **Nombre exacto:** `estados`. **En plural y lista**, como sus dos hermanos `destinoZonaIds` y
  `mensajeroIds`. Un desplegable de una sola opción emite `["vencido"]`.
- **Acepta** los CUATRO estados del cierre del día: `"solicitado" | "vencido" | "aprobado" |
  "rechazado"` (`ESTADOS_FILTRO_CIERRES`, exportado desde `lib/types/filtros-cierres.ts`).
- **Rechaza en el borde** con `validation_error`: un valor que no es un estado, `[]` (que sería
  «los cierres de cero estados», siempre nada) y el singular `estado` (`.strict()`).
- **«Todos» se dice omitiendo la clave** (`undefined`), no mandando los cuatro ni `[]`.
- **Sin tope de longitud**: el universo son cuatro valores y el `z.enum` ya los cierra.
- **La forma del tipo es la MISMA que la de `mensajeroIds`** (tupla no vacía): la pantalla
  necesita el mismo patrón que su `idsONada` de `FiltrosCierresBarra.tsx`, no un `string[]` pelado.
- **Viaja en el bloque `filtros`**, así que los CUATRO puntos de entrada ya lo aceptan sin tocar
  nada más: las dos páginas (`listarHistoricoCierresAdminPaginado`,
  `listarPendientesCierresAdminPaginado`) y sus dos archivos
  (`listarHistoricoCierresAdminCompleto`, `listarPendientesCierresAdminCompleto`).
- **`sinFiltros()` lo cuenta**: con solo el estado puesto devuelve `false`, así que el «limpiar»
  de la barra debe seguir apareciendo.
- **NO entra** en la descarga detallada de gestiones (`filtrosDescargaGestionesSchema`) ni en los
  listados de bodega (`filtrosCierresBodegaSchema`): esos schemas no lo declaran y su `.strict()`
  lo rechaza. Fuera del alcance que el humano acotó.

**Semántica: el filtro INTERSECA con la lista, no la sustituye.** Pedir `aprobado` dentro de
pendientes devuelve **vacío**, no aprobados. Es el mismo comportamiento que ya tenía
`destinoZonaIds` frente al alcance.

---

## Un dato del encargo que NO es exacto (medido en el archivo real)

El encargo decía que quien decide hoy en qué lista cae cada cierre es
`ESTADOS_CIERRE_ABIERTO = ['solicitado','vencido']`, en `CierresAdminService.ts:87`.

- La constante **existe**, en esa línea exacta y con esos dos valores. Pero **no es la que parte
  las listas**: su único uso está en `CierresAdminService.ts:1167`, dentro de
  `actualizarPagosGestion`, para dar un `conflict` legible antes de abrir la transacción cuando el
  desglose de un cierre ya no se puede corregir.
- **El corte real es `ESTADOS_COLA_CIERRE_DIA`**, en `lib/utils/colas-cierre.ts` — misma lista,
  otro archivo—, y lo leen las DOS capas: el servicio para partir en memoria
  (`esColaCierreDia`) y el repositorio para escribirlo como `WHERE` (`in` en la cola, `notIn` en el
  histórico, en `colaWhere`/`historicoWhere`).

**No cambia la conclusión** (los dos valores son los mismos) pero sí cambia el archivo donde había
que intervenir. Lo demás del encargo se confirmó **midiéndolo contra Postgres**, no leyéndolo: el
caso (1) del test de integración siembra los cuatro estados y comprueba que pendientes trae
`{solicitado, vencido}` y el histórico `{aprobado, rechazado}`.

---

## Archivos

### Modificados

| Archivo | Qué |
| --- | --- |
| `lib/types/filtros-cierres.ts` | `ESTADOS_FILTRO_CIERRES` (los 4, `satisfies readonly CierreEstado[]`), `listaDeEstados` (`z.enum` + `nonempty` + `optional`), la clave `estados` en `filtrosCierresSchema`, y `estados` añadido a `sinFiltros()` |
| `lib/repositories/CierresAdminRepository.ts` | En `filtrosWhere`: `condiciones.push({ estado: { in: [...filtros.estados] } })`, **la última** de las cuatro condiciones y **dentro del `AND`** |
| `tests/unit/repositories/cierres-filtros-where.test.ts` | +4 casos (386) sobre el objeto que Prisma recibe |
| `tests/unit/guards/filtros-cierres-alcance.guardia.test.ts` | Lista blanca actualizada a CINCO claves; caso `(a2)` nuevo; `(c)` ahora manda `estados`; `(d)` exige **exactamente una** clave `estado:` en `colaWhere`/`historicoWhere` y el `estado: { in:` dentro de `filtrosWhere` |

### Creados

| Archivo | Qué |
| --- | --- |
| `tests/integration/db/cierres-filtro-estado-sql-real.test.ts` | 7 casos contra **Postgres real**: siembra un cierre por estado para un mensajero nuevo y mide QUÉ FILAS salen |
| `tests/unit/services/cierres-admin-filtro-estado.test.ts` | 4 casos: los cuatro caminos del servicio entregan el bloque **entero** al repositorio |

### NO tocados, a propósito

- **Ninguna migración, ningún `db/schema.prisma`, ninguna escritura en la base.** `cierre_dia` ya
  tiene `@@index([estado])`.
- **Ningún componente, página ni layout.** El filtro llega hasta el borde y ahí para.
- **`lib/services/CierresAdminService.ts`**: no hizo falta. Los cuatro métodos ya pasan `filtros`
  como caja negra al repositorio. Que eso siga siendo cierto lo fija
  `tests/unit/services/cierres-admin-filtro-estado.test.ts` (ver mutación M3).
- **`lib/actions/cierres-admin.ts`**: tampoco. Los cuatro schemas del borde derivan de
  `filtrosCierresSchema`, así que la clave entra sola.
- `feature_list.json` y `progress/current.md`: intactos.

---

## Decisión que merece quedar escrita

**Por qué `ESTADOS_FILTRO_CIERRES` se escribe en `filtros-cierres.ts` y no se importa
`CIERRE_ESTADO_SEED`.** `lib/types/filtros-cierres.ts` es un módulo del BORDE y lo carga un
componente `"use client"` (`FiltrosCierresBarra.tsx`). `lib/types/cierre.ts` arrastra `cierreConfig`,
que lee `process.env` con **clave dinámica**; hoy TODAS las importaciones de ese módulo desde `app/`
son `import type` (se borran al compilar), así que traer el seed como VALOR metería esa lectura en el
bundle del navegador para ahorrar cuatro literales.

El precio es que hay dos listas, y eso se paga con una aserción: la guardia compara
`ESTADOS_FILTRO_CIERRES` contra `CIERRE_ESTADO_SEED` **como conjunto**, así que un estado nuevo en el
enum la pone roja y alguien decide si el filtro debe ofrecerlo. El `satisfies readonly CierreEstado[]`
cubre la otra dirección (aquí no puede entrar un estado que el enum no tenga).

---

## Mapa requisito → test

No hay `requirements.md` (`sdd: false`). Los `R<n>` de abajo son los del encargo, numerados aquí.

| # | Requisito | Test |
| --- | --- | --- |
| R1 | La clave se llama `estados` y acepta una lista no vacía de los cuatro `CierreEstado` | `filtros-cierres-alcance.guardia.test.ts` → `(a)` y `(a2)` |
| R2 | Los otros filtros no se tocan: sin filtros el `WHERE` es byte a byte el de antes | `cierres-filtros-where.test.ts` → `(1) SIN filtros el criterio es el de siempre` (ya existía, sigue verde) + `cierres-admin-filtro-estado.test.ts` → `sin filtros el repositorio sigue recibiendo undefined` |
| R3 | El filtro va DENTRO de cada lista: interseca con el corte, nunca lo sustituye | `cierres-filtro-estado-sql-real.test.ts` → `(2)`, `(3)` · `cierres-filtros-where.test.ts` → `(386) en la COLA…`, `(386) en el HISTORICO…` · guardia `(d)` (una sola clave `estado:` por criterio) |
| R4 | Pedir un estado del histórico dentro de pendientes devuelve VACÍO (y al revés) | `cierres-filtro-estado-sql-real.test.ts` → `(4)` y `(5)`, los dos con control positivo |
| R5 | El filtro no reabre el alcance ni anula los otros recortes: todo por conjunción | `cierres-filtro-estado-sql-real.test.ts` → `(7)` · `cierres-filtros-where.test.ts` → `(386) el estado convive con los otros tres recortes` |
| R6 | Los archivos de las dos listas filtran igual que sus páginas | `cierres-filtro-estado-sql-real.test.ts` → `(6)` · `cierres-admin-filtro-estado.test.ts` → `el ARCHIVO de cada lista recibe el MISMO bloque` · guardia `(c)` |
| R7 | El filtro llega entero desde el borde hasta el repositorio; ninguna capa lo pierde | `cierres-admin-filtro-estado.test.ts` → los 3 primeros casos |
| R8 | Un valor que no es estado, `[]` y el singular `estado` mueren en el borde | guardia `(a2)` |
| R9 | `sinFiltros` cuenta el estado (la pantalla ofrece «limpiar») | guardia `(a)` |

---

## Mutaciones (arnés con autocomprobación)

El arnés (`mutar.mjs`, de un solo uso, en el scratchpad) **aborta** si: el texto buscado no aparece
exactamente una vez; la relectura tras escribir no contiene el reemplazo; vitest no emitió su línea
`Tests …`; o si tras restaurar el archivo no vuelve a ser **byte a byte** el original. Las tres
corridas imprimieron `RESTAURADO: relectura identica byte a byte al original`.

### M1 — «el filtro deja de intersecar con el conjunto de la lista» → **ROJO**

En `colaWhere`, el corte de la lista pasa a rendirse cuando hay filtro de estado:

```
-     estado: { in: [...ESTADOS_COLA_CIERRE_DIA] },
+     ...(filtros?.estados === undefined ? { estado: { in: [...ESTADOS_COLA_CIERRE_DIA] } } : {}),
```

```
 Test Files  2 failed | 1 passed (3)
      Tests  3 failed | 21 passed (24)
 FAIL  cierres-filtros-where.test.ts > (386) en la COLA, el estado pedido se SUMA al de la lista
AssertionError: el filtro pisó el corte cola/histórico: expected undefined to deeply equal { in: [ 'solicitado', 'vencido' ] }
 FAIL  cierres-filtro-estado-sql-real.test.ts > (4) ⭑ el filtro INTERSECA con la lista…
AssertionError: un cierre APROBADO se coló en la cola de pendientes: expected [ { …(13) } ] to have a length of +0 but got 1
 FAIL  cierres-filtro-estado-sql-real.test.ts > (6) los ARCHIVOS de las dos listas filtran EXACTAMENTE igual…
```

Lo importante: **una fila real apareció donde no debía**, contra Postgres. Con dobles habría sido
invisible.

### M2 — «el filtro se ignora y devuelve todo» → **ROJO**

```
-     condiciones.push({ estado: { in: [...filtros.estados] } });
+     void filtros.estados; // MUTACION
```

```
 Test Files  3 failed | 1 passed (4)
      Tests  11 failed | 17 passed (28)
 FAIL  … (2) PENDIENTES filtrado por `vencido` …  expected [ 'solicitado', 'vencido' ] to deeply equal [ 'vencido' ]
 FAIL  … (3) HISTORICO filtrado …                  expected [ 'aprobado', 'rechazado' ] to deeply equal [ 'aprobado' ]
 FAIL  … (4) …  expected [ { …(13) }, { …(13) } ] to have a length of +0 but got 2
 FAIL  … (5) …  un cierre VENCIDO se coló en el histórico … got 2
 FAIL  … (6) …  · (7) …
 FAIL  guardia (d) …  expected 'function filtrosWhere(…' to match /estado:\s*\{\s*in:/
 FAIL  cierres-filtros-where.test.ts × 4
```

### M3 — «el servicio reconstruye el bloque y pierde `estados`» → **ROJO** (extra)

En `CierresAdminService.listarPendientesCierresAdminPaginado`, `input.filtros` se sustituye por un
literal con las otras cuatro claves.

```
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 20 passed (21)
 FAIL  cierres-admin-filtro-estado.test.ts > la PÁGINA de pendientes entrega el bloque tal cual
AssertionError: expected { desde: '2026-09-01', …(3) } to deeply equal { desde: '2026-09-01', …(4) }
```

Y **solo** ese test la mata: el de integración y el del `WHERE` siguieron verdes. Es la prueba de
que el archivo de servicio no es decorativo — cubre el hueco de «alguien lo importa pero nadie lo
pasa».

---

## Gate

`.env` copiado desde la raíz antes de correr (si no, ~134 archivos de `tests/integration/db` se
saltan y el gate dice OK sin comprobar nada) y **borrado antes de commitear**.
`pnpm run db:generate` ejecutado antes del typecheck.

### `./init.sh --rapido` → se niega, como debe

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/repositories/CierresAdminRepository.ts
    lib/types/filtros-cierres.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

### `./init.sh` completo — corrida 1: **ROJO por contención ajena**

```
 Test Files  1 failed | 1789 passed (1790)
      Tests  25616 passed | 35 skipped (25651)
   Duration  593.30s
 FAIL  tests/integration/db/liquidacion-reparto-migration.test.ts > 205 / bloque B …
Raw query failed. Code: `40P01`. Message: `se ha detectado un deadlock`
INIT_EXIT=1
```

**Medido, no supuesto** (`liquidacion-reparto-migration.test.ts` no toma el
`pg_advisory_xact_lock` que serializa a los 77 archivos que sí escriben en las tablas reales):

| Qué corrí | Resultado |
| --- | --- |
| el archivo AISLADO | **24 pasan, 0 skipped**, 898 ms |
| ese archivo + mi test de integración, ×3 | **3 de 3 en verde** |
| `tests/integration/db` entero, CON mi archivo, ×2 | 1 rojo — pero en **otro** archivo (`ranking-snapshot-migration.test.ts`, mismo `40P01`) |
| `tests/integration/db` entero, **SIN** mi archivo, ×3 | **1 rojo igual**, `ranking-snapshot-migration.test.ts`, mismo `40P01` |

O sea: **reproduce sin mi cambio**, y cae en un archivo distinto cada vez. Es contención entre los
tests de migración que aplican DDL en esquemas temporales con FKs a `public` sin tomar el lock de
aviso — agravada por otros agentes sobre la misma base local. **No se metió en
`tests/baseline-rojos.json`.**

Los `35 skipped` de esa corrida también se explican solos: `35 − 9 = 26`, y los 9 son justo los
casos que el archivo muerto a mitad dejó sin ejecutar. Los 26 son los conocidos.

### `./init.sh` completo — corrida 2: **VERDE**

```
 Test Files  1790 passed (1790)
      Tests  25625 passed | 26 skipped (25651)
   Duration  827.97s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1790 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

`INIT_EXIT=0`, leído **de dentro del log**. Los `26 skipped` son exactamente los conocidos. El aviso
de las tres migraciones sin `down.sql` es deuda previa y ajena: esta ficha no crea migraciones.

### Comandos sueltos

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: cero errores)

$ pnpm run lint
✖ 174 problems (0 errors, 174 warnings)      ← 0 errores; los warnings son preexistentes

$ pnpm exec vitest run tests/unit/repositories/cierres-filtros-where.test.ts \
      tests/unit/guards/filtros-cierres-alcance.guardia.test.ts \
      tests/unit/services/cierres-admin-filtro-estado.test.ts
 Test Files  3 passed (3)
      Tests  21 passed (21)

$ pnpm exec vitest run tests/integration/db/cierres-filtro-estado-sql-real.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

---

## Lo que queda para `frontend_dev`

El control de la barra (`FiltrosCierresBarra.tsx`): una clave nueva junto a `CLAVE_FECHA`,
`CLAVE_ZONA` y `CLAVE_MENSAJERO`, y su traducción en `aFiltros` a `estados`, con el mismo patrón
`…ONada` que ya usa `idsONada` (lista vacía → `undefined`, nunca `[]`). El servidor está listo y no
hace falta tocarlo.

---

## Veredicto

Filtro por estado en el borde, el servicio y el `WHERE`, intersecando con cada lista y probado
contra Postgres real; gate completo en verde (`INIT_EXIT=0`) y tres mutaciones muertas.
