# impl 380 — el guardado de zona reescribe el pago al mensajero sin dejar rastro

**Rama del worktree:** `worktree-agent-a853fb4f315ffed06` (la ficha declara
`fix/380-tarifa-zona-mensajero-sin-rastro`; el PR lo abre el leader).
**Zona:** backend. **Lleva migración**, y se implementó SOLA: ningún otro agente corriendo.
**Base local medida:** `localhost:5432/ordenex` (`prisma migrate status` — dice el host sin exponer
credencial).

---

## Las tres firmas, y quién decidió qué

Se repiten aquí porque son lo que explica por qué el diseño es el que es, y porque **dos de las tres
se firmaron EN CONTRA de la recomendación del leader**.

| | Recomendación del leader | **Firma del humano (2026-09-08)** | Efecto en el código |
| --- | --- | --- | --- |
| **Q1** | tipo nuevo | **A FAVOR: tipo nuevo `zona_pago_mensajero_cambiado`.** No se reutilizan los `tarifa_*`. | Es lo que obliga a la migración de enum. |
| **Q2** | guardar el antes y el después | **EN CONTRA DE LA RECOMENDACIÓN: solo el hecho, sin importes.** | `monto`, `valor_anterior` y `valor_nuevo` van `NULL`, y se AFIRMA que van `NULL`. |
| **Q3** | auditar también la creación | **EN CONTRA DE LA RECOMENDACIÓN: solo la edición.** | `ZonaRepository.create` y `hardDelete` NO se tocaron; hay dos casos negativos que lo fijan. |

### ⚠️ El límite ACEPTADO (Q2), escrito donde se ve

**El registro dirá que el pago de una zona cambió, en cuál, quién lo cambió y cuándo — y NUNCA
podrá reconstruir de cuánto a cuánto.** El guardado destruye las filas viejas de
`tarifa_zona_mensajero` (`deleteMany` + `createMany`) y no queda copia en ninguna otra parte. Si
mañana un mensajero reclama, el rastro dice que hubo un cambio, en qué zona, quién y cuándo, **y ahí
se acaba**. No es deuda a resolver: es alcance firmado.

### ⚠️ El hueco que se VE y NO se cierra (Q3)

**Crear una zona sigue escribiendo pagos de mensajero sin rastro propio.** El primer pago de una
zona —el que se teclea al crearla— no deja fila; el segundo y todos los demás, sí. Coherente con el
catálogo, que ya es asimétrico a propósito: hay `zona_borrada` y no `zona_creada`, igual que hay
`vehiculo_borrado` y no `vehiculo_creado`. Está **probado con dos casos negativos** para que nadie
lo «arregle» dentro de seis meses sin saber que se decidió, ni lo pierda sin querer.

**No hay backfill y no puede haberlo:** nadie registró los cambios de pago del pasado, no existe la
fuente. El rastro empieza el día del despliegue.

---

## Qué escribe EXACTAMENTE la fila nueva

| Columna | Valor |
| --- | --- |
| `accion` | `zona_pago_mensajero_cambiado` |
| `entidad_tipo` | `zona` (**no se amplió** `historial_accion_entidad`) |
| `entidad_id` | el id de la zona guardada (estable; los `id` de `tarifa_zona_mensajero` no lo son) |
| `entidad_etiqueta` | `etiquetaDeEntidad("zona", { nombre: zona.nombre })` — el nombre DESPUÉS del guardado |
| `actor_usuario_id` / `actor_nombre` / `actor_rol` | congelados con `resolverActorCongelado` (los tres a `NULL` a la vez si el actor es el sistema) |
| `monto` | **`NULL`** (Q2) |
| `valor_anterior` | **`NULL`** (Q2) |
| `valor_nuevo` | **`NULL`** (Q2) |
| `lote_id` | `randomUUID()` **propio**: el tercero distinto del mismo guardado, junto al de la 366 y al de la 376 |

- **Etiqueta legible del catálogo:** «Cambió el pago al mensajero de una zona».
- **Categoría:** `mueve_dinero` (27 → **28**). Catálogo total 49 → **50**.
- **Cuándo se escribe:** UNA fila por guardado de una zona EXISTENTE cuyo conjunto de pagos quede
  distinto. Nunca al crear, nunca al borrar, nunca si el conjunto no cambió.

---

## Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260908120000_historial_accion_zona_pago_mensajero/migration.sql` | UP: **una sola** sentencia `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'zona_pago_mensajero_cambiado';` |
| `db/migrations/20260908120000_historial_accion_zona_pago_mensajero/down.sql` | DOWN escrito a mano: recrea el tipo con los **49** previos y recastea `historial_accion.accion` |
| `lib/repositories/_shared/pago-mensajero-cambio.ts` | `PagoComparable` + `cambioElPagoAlMensajero`, función PURA, money-safe |
| `tests/unit/repositories/pago-mensajero-cambio.test.ts` | 15 casos del predicado, con `Prisma.Decimal` reales |
| `tests/unit/guards/pago-mensajero-money-safe.guardia.test.ts` | guardia estática del comparador + contrapruebas de sus detectores |
| `tests/integration/db/historial-accion-zona-pago-mensajero-migration.test.ts` | la migración: estático + (a) base viva + (b) el `down` valor a valor + (c) el rollback ruidoso |
| `tests/integration/db/zona-pago-mensajero-rastro.test.ts` | el comportamiento contra **Postgres real** (18 casos) |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `lib/types/historial-accion.ts` | tipo nuevo al final del bloque A.1 + `CATEGORIA_POR_ACCION` + `ACCION_LABELS`, con las dos firmas escritas al lado. Conteos de los comentarios: 49→50 y A.1 27→28 (y el «(9)» de A.2, que llevaba mal desde la 375, a «(10)» — el reparto real es 28/10/12) |
| `db/schema.prisma` | el valor nuevo en `enum HistorialAccionTipo` **(no lo pedía `tasks.md`, ver «Desviaciones»)** |
| `lib/repositories/ZonaRepository.ts` | lectura de `pagosPrevios` antes del `deleteMany`; la lectura final de tarifas MOVIDA a justo después del `createMany`; bloque `appendAccion` nuevo dentro del callback con `tx`. `create` y `hardDelete` **intactos** |
| `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` | entrada nueva del censo (`update`, `abre_tx`, `mutacion: /tx\.tarifaZonaMensajero\.deleteMany\(/`), 49→50, y **el bloque de contraprueba con TRES llamadas** |
| `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` | 49→50 (dos aserciones), `mueve_dinero` 27→28, y un caso propio de la 380 que fija Q1 y Q3 |
| `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts` | `POSTERIORES` gana el valor nuevo |

**No se tocó:** `feature_list.json`, `progress/current.md`, ningún `down.sql` anterior (son fotos
históricas), ninguna pantalla, ningún contrato (`IZonaRepository`, `IZonaService`, `lib/types/zona.ts`).
**Ninguna aserción existente se relajó**: ni un `toEqual` literal se tocó salvo los números duros
que la ficha mueve a propósito (49→50, 27→28), que ES el mecanismo por el que un tipo nuevo obliga a
pasar por el censo.

---

## Mapa R1–R18 → test

| R | Test concreto |
| --- | --- |
| **R1** | `tests/integration/db/zona-pago-mensajero-rastro.test.ts` › «R1: cambiar UN importe deja EXACTAMENTE UNA fila, sobre la zona guardada» y «R1: quitar un pago (BAJA) tambien deja fila» |
| **R2** | mismo archivo › «R2: guardar cambiando SOLO EL NOMBRE…» y «R2: mover la marca de zona central escribe la fila de la 376 y NINGUNA de esta» |
| **R3** | mismo archivo › «R3: el MISMO conjunto exacto — los `id` CAMBIAN y aun asi no hay fila nueva» y «R3: reordenar…» · `tests/unit/repositories/pago-mensajero-cambio.test.ts` (15 casos: alta, baja, un importe, los dos, reordenado, `1500` vs `1500.00`, un céntimo, vacío/vacío, pago por defecto, y el `id` que no participa) |
| **R4** | `tests/unit/guards/pago-mensajero-money-safe.guardia.test.ts` (barrido + contraprueba que inyecta cada conversión y control positivo del `toFixed(2)`) |
| **R5** | integración › «R5: CREAR una zona con pagos NO deja fila de este tipo (firma de Q3)» y «R5: BORRAR una zona con pagos deja `zona_borrada` y NINGUNA de este tipo» |
| **R6** | integración › «R6/R8: la fila trae la zona nombrada y el actor CONGELADO, y NI UN IMPORTE» |
| **R7** | integración › «R7: sin usuario detras, los TRES campos del actor quedan vacios A LA VEZ» |
| **R8** | mismo caso «R6/R8» (`monto`, `valor_anterior`, `valor_nuevo` en `NULL`) + `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts`, que ya censa `ZonaRepository.ts:76` y barre el bloque nuevo solo |
| **R9** | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` › «FICHA 380: … es DINERO, y NO se reutilizo ningun `tarifa_*`» y «el reparto por categoria … 28 dinero, 10 desaparicion, 12 permisos» |
| **R10** | integración › «R10: un guardado que reconcilia + mueve la marca + cambia el pago deja TRES lotes» |
| **R11** | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` (entrada del censo + **contrapruebas nuevas con TRES llamadas**: sana, tercera con otro cliente, tercera fuera del callback, tercera borrada) · integración › «R11: un guardado que REVIENTA…» y «R11: si el REGISTRO falla, el pago nuevo tampoco persiste» |
| **R12** | integración › «R12: `not_found` no escribe ninguna fila» y «R12: `sin_zona_central` no reescribe ningun pago ni deja fila» |
| **R13** | `tests/integration/db/historial-accion-zona-pago-mensajero-migration.test.ts` bloque (a) — el enum de `public` contra el catálogo, **nunca contra un número congelado**, y el valor nuevo DESPUÉS de `zona_central_cambiada` |
| **R14** | mismo archivo, bloque estático (corre sin base): una sola sentencia `ADD VALUE`, sin `CREATE/ALTER TABLE`, sin `INSERT/UPDATE/DELETE`, sin nombrar `historial_accion_entidad` |
| **R15** | mismo archivo, bloque (b) — estado previo reconstruido con las migraciones REALES **descubiertas leyendo `db/migrations`**, `up`, `down`, `toEqual` valor a valor y en orden, más «el estado previo ES el catálogo de HOY menos el valor nuevo» |
| **R16** | mismo archivo, bloque (c) — con una fila del tipo nuevo el `down` **rechaza** y la fila sigue ahí |
| **R17** | `pnpm run typecheck` verde + `tests/unit/repositories/zona-repository.test.ts` y `tests/unit/services/zona-service.test.ts` verdes **sin tocar ni una aserción** + integración › R18 afirma que el DTO del guardado sigue trayendo sus tarifas |
| **R18** | integración › «R18: tras guardar, la tabla tiene EXACTAMENTE los pagos del payload», «R18: el payload SIN pagos deja la tabla vacia, y eso SI es un cambio», «R18 acotado: guardar una zona SIN pagos que ya no los tenia no deja fila» |

Ningún `R<n>` sin test nombrado.

---

## Verificación ejecutada

### T0 — la base local, MEDIDA antes de tocar nada

```
pnpm exec vitest run tests/integration/db/historial-accion-zona-central-migration.test.ts \
                     tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts
 Test Files  2 passed (2)
      Tests  18 passed (18)
```

Y el catálogo de la base, contado con una consulta a `pg_enum` (script de un solo uso, borrado):
**49 valores**, en el orden `… nodo_geografico_renombrado, zona_central_cambiada`. Coincide con
`HISTORIAL_ACCION_TIPOS.length` (49) y con la predicción del design. **De ahí sale la lista del
`down.sql`, medida y no razonada.**

### Migración aplicada

```
pnpm exec prisma migrate deploy
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
Applying migration `20260908120000_historial_accion_zona_pago_mensajero`
All migrations have been successfully applied.

pnpm exec prisma migrate status  ->  182 migrations found · Database schema is up to date!
pnpm run db:generate             ->  ✔ Generated Prisma Client (v7.8.0)
```

### Gate completo (`./init.sh`, el rápido se niega solo: toca `db/migrations/`)

`INIT_EXIT` **leído de dentro del log**, no de un `echo` del terminal:

```
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (389 fichas), cupo por zona respetado (in_progress=1)
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 138 archivos de tests contra Postgres SI se ejecutan

 Test Files  1799 passed (1799)
      Tests  25745 passed | 26 skipped (25771)
   Duration  587.93s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1799 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- **26 `skipped`**, que es el número conocido. Ni uno más: no se cayó ningún archivo a mitad.
- Los **138** archivos de `tests/integration/db` se **ejecutaron**, no se saltaron. Verificado además
  archivo a archivo en el log: `zona-pago-mensajero-rastro` (18), `historial-accion-zona-pago-mensajero-migration`
  (17), `zona-central-guarda-y-rastro` (17), `historial-accion-zona-central-migration` (13),
  `historial-accion-orden-zona-reconciliada-migration` (5), `historial-accion-escrituras-cubiertas`
  (56), `catalogo-y-choke-point` (42), `pago-mensajero-money-safe` (8), `pago-mensajero-cambio` (15).
- El aviso de `migraciones sin down.sql` nombra **tres carpetas de agosto, ninguna de esta ficha**:
  es deuda preexistente. La de la 380 tiene su `down.sql`.
- El `.env` se copió de la raíz **solo para el gate** y se borró antes de commitear (está en
  `.gitignore`; el árbol quedó limpio).

### Antes del gate

```
pnpm run typecheck   ->  sin salida (verde)
pnpm run lint        ->  ✖ 174 problems (0 errors, 174 warnings)   [todas preexistentes]
pnpm exec vitest related --run lib/repositories/ZonaRepository.ts \
      lib/repositories/_shared/pago-mensajero-cambio.ts lib/types/historial-accion.ts
 Test Files  160 passed (160)
      Tests  2359 passed | 17 skipped (2376)
```

La única advertencia de lint en `ZonaRepository.ts` es `'normalizeName' is defined but never used`,
**preexistente** (importación que ya estaba antes de esta ficha).

---

## Mutaciones probadas, con su rojo

Arnés de mutaciones **con autocomprobación**, porque uno sin ella ya mintió en este repo (reportó
9/9 supervivientes dos veces sin haber ejecutado un test). El arnés: **aborta** si el texto a
sustituir no aparece exactamente una vez; **aborta** si la salida de vitest no trae la línea
`Test Files`; **restaura releyendo del disco y comparando byte a byte**. Las siete restauraciones
verificaron OK.

| # | Mutación | Quién la caza | Rojo medido |
| --- | --- | --- | --- |
| **M1** | **la escritura del historial DESAPARECE** (se borra el bloque `appendAccion` de la 380 en `update`) | integración | `13 failed \| 61 passed (74)` — R1, R2×2, R3×2, R6/R8, R7, R10, R11×2, R12, R18… `AssertionError: expected +0 to be 1` |
| **M2** | **recibe el cliente suelto** (`appendAccion(this.prisma, …)` dentro del callback) | **la guardia estática** | `3 failed \| 71 passed (74)` — «no le pasa a `appendAccion` la `tx`, sino otro cliente», en las TRES entradas del censo de `update` |
| **M3** | **el `lote_id` no es propio**: se comparte con el de la marca del mismo guardado | integración | `1 failed \| 17 passed (18)` — R10: `expected 2 to be 3` |
| **M4** | **se escribe TAMBIÉN al crear la zona** (ensancha lo firmado en Q3) | integración | `2 failed \| 16 passed (18)` — los DOS casos negativos de R5: `expected [ { …(11) } ] to deeply equal []` |
| **M5** | el `WHERE` de la lectura previa se abre (`where: {}`) | integración | `5 failed \| 13 passed (18)` — R2×2, R3×2 y «R18 acotado» |
| **M6** | el comparador devuelve **siempre `true`** | unit + integración | `6 failed` en `pago-mensajero-cambio.test.ts`, empezando por el CONTROL POSITIVO |
| **M7** | el comparador sale del mundo `Decimal` (`.toNumber()`) | la guardia money-safe | `2 failed \| 21 passed (23)` — el barrido y su control positivo |
| **M8** | **al `down.sql` le falta un valor** (`nodo_geografico_renombrado`) | el test de la migración, bloque (b) | `1 failed \| 16 passed (17)` — y **dice cuál falta**: `- "nodo_geografico_renombrado"` en el diff |

### ⚠️ Hallazgo de M1, y merece leerse

**La guardia estática NO caza que desaparezca esta escritura concreta**: con el bloque de la 380
borrado, `historial-accion-escrituras-cubiertas.guardia.test.ts` sigue **VERDE**. Y no es un defecto
de la guardia: mide **por método**, y `ZonaRepository.update` conserva las otras dos llamadas a
`appendAccion` (366 y 376) y conserva `tx.tarifaZonaMensajero.deleteMany(`, que es la mutación que
su entrada exige. Es exactamente el motivo por el que el design declara **obligatorio** el archivo
de integración: quien protege R1 aquí es Postgres, no el censo. Queda escrito para que nadie
concluya que con la guardia basta.

---

## Desviaciones respecto de `tasks.md` (una, y mecánica)

**T1 no menciona `db/schema.prisma`, y hay que tocarlo.** `HISTORIAL_ACCION_TIPOS` cierra contra el
enum de Prisma en las dos direcciones (`satisfies readonly PrismaHistorialAccionTipo[]` y
`_AsegurarExhaustivoTipos`), y `enum HistorialAccionTipo` vive en `db/schema.prisma:3038`. Sin el
valor ahí, `pnpm typecheck` —que es el «hecho cuando» de T1— **no compila**. Es la reflexión en el
modelo de Prisma del `ADD VALUE`, no una tabla ni una columna nueva: sigue cumpliendo R14 al pie de
la letra, y el propio test de la migración lo afirma. Lo mismo hizo la 376.

No hay ninguna otra desviación. Nada de lo implementado pidió importes en la fila ni auditar
`create`: si lo hubiera pedido, el encargo obligaba a parar.

---

## Riesgos y notas operativas

- **⚠️ El `down.sql` es una FOTO del 2026-09-08**, y correrlo sobre una base que ya avanzó **borra
  en silencio, sin un solo error**, los valores añadidos después. El aviso está **escrito dentro del
  propio archivo**, con la consulta a `pg_enum` con la que medir el catálogo de hoy. Es la trampa que
  el 2026-09-07 se llevó por delante `zona_central_cambiada` de la base local (7 tests rojos en 6
  archivos ajenos, sin mensaje).
- **La defensa no es «acordarse»:** el test de la migración **descubre las carpetas anteriores
  leyendo `db/migrations`** en vez de listarlas como constantes. Si `dev` mergea una ampliación del
  enum mientras esta rama está abierta, entra sola en la reconstrucción, el bloque (b) se pone rojo y
  obliga a actualizar la lista **antes** del PR.
- **`pnpm run db:rollback` revierte la ÚLTIMA carpeta por nombre**, no la que uno elija. Tras
  revertir algo de esta área hay que reaplicar los `migration.sql` de lo mergeado después
  (`ADD VALUE IF NOT EXISTS` es idempotente) y correr `tests/integration/db`.
- **La base local es compartida entre worktrees:** esta migración ya está aplicada en ella. Cualquier
  otro worktree que arranque tendrá que correr `prisma migrate deploy` (y `pnpm run db:generate`) o
  su gate saldrá rojo por un motivo ajeno a su código.
- **Coste:** una consulta más por guardado de zona (`findMany` por `zona_id`, índice existente,
  a lo sumo una fila por vehículo). La lectura del «después» **no es nueva**: es la que ya existía
  para el DTO, movida.
- **Ni una wallet, ni una liquidación, ni un `cierre_detail` se tocan.**
- **Preexistente y fuera de alcance** (lo dice el spec, §10): el borde de zonas valida
  `cobroEntregado: z.number().nonnegative()` y `tarifaToDTO` devuelve `number` con `.toNumber()`.
  Esta ficha se limitó a **no añadir un paso de coma flotante nuevo**, y la guardia money-safe lo
  vigila sobre el módulo del comparador, donde sí se puede acotar.

---

**Veredicto:** el pago al mensajero deja rastro al guardarse una zona —solo el hecho y solo en la
edición, tal como se firmó—, con la migración aplicada, `INIT_EXIT=0` y ocho mutaciones enseñando su
rojo.
