# Ficha 375 — `codigo_dta`, la clave estable del catálogo geográfico · bitácora de implementación

> **Rama:** `worktree-agent-a32d0a09ca97283bc` (worktree aislado, partido de `dev` en `d9c38644`).
> **Continuación directa de la 374**, que dejó el renombrado fuera a propósito.
> **No hay `specs/375-…`:** el encargo llegó del leader como brief, sin pasar por `spec_author`.
> Lo que sigue es la bitácora del implementador, no un spec: si esta ficha necesita spec formal,
> hay que escribirlo aparte.

---

## 0 · Por qué existe esta ficha

La 374 escribió el motivo con todas sus letras y estaba **medido**: `scripts/seed-zonas.ts`
resolvía la geografía **por nombre exacto** y, si no la encontraba, **creaba**. Si un maestro
renombraba un distrito y el `.xlsx` seguía trayendo el nombre viejo, la siguiente corrida del seed
creaba un **duplicado activo**, y a partir de ahí `resolveGeo` respondía
`"distrito ambiguo en el canton"` a toda carga masiva que lo mencionara. El
`@@unique([canton_id, nombre])` **no lo atrapa**: los nombres difieren.

La causa raíz no era el renombrado: era que **el nombre hacía de clave sin serlo**. Esta ficha le da
al catálogo una clave de verdad —`codigo_dta`— y con ella habilita el renombrado.

---

## 1 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260907120000_geografia_codigo_dta/migration.sql` | `codigo_dta` en las tres tablas + backfill de las 585 filas + los tres índices únicos (681 líneas) |
| `db/migrations/20260907120000_geografia_codigo_dta/down.sql` | suelta los tres índices y las tres columnas; ni un `DELETE`, ni un `UPDATE` |
| `db/migrations/20260907120100_historial_accion_nodo_geografico_renombrado/migration.sql` | `ALTER TYPE historial_accion_tipo ADD VALUE 'nodo_geografico_renombrado'` |
| `db/migrations/20260907120100_historial_accion_nodo_geografico_renombrado/down.sql` | recrea el tipo con la lista PREVIA de 47 y recastea `accion` |
| `tests/integration/db/geografia-codigo-dta-migration.test.ts` | el backfill, los huecos, los nulos y el down, contra Postgres (24 casos) |
| `tests/integration/db/geografia-renombrado.test.ts` | el renombrado y su auditoría, contra Postgres (15 casos) |
| `tests/integration/db/geografia-renombrado-migration.test.ts` | el enum nuevo, su down y la precondición ruidosa (12 casos) |
| `tests/integration/db/seed-zonas-cruza-por-codigo.test.ts` | **el test que sostiene la ficha**: el seed cruza por código (8 casos) |
| `tests/unit/scripts/seed-zonas-codigo-dta.test.ts` | la derivación por prefijo + el `.xlsx` REAL leído y comprobado (16 casos) |
| `tests/unit/guards/geografia-renombrado-punto-unico.guardia.test.ts` | sustituye a la guardia de «no se renombra» (16 casos) |

### Borrado

| Archivo | Por qué |
| --- | --- |
| `tests/unit/guards/geografia-sin-renombrado.guardia.test.ts` | Exigía que **nadie** escribiera `nombre` sobre las tres tablas (R49 de la 374). Su **causa** desaparece con `codigo_dta`; el **riesgo** no. Se sustituye por `geografia-renombrado-punto-unico.guardia`, que invierte la afirmación: la única escritura de `nombre` legal es `GeoRepository.renombrar` |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `db/schema.prisma` | `codigoDta String? @unique` en `Provincia`, `Canton` y `Distrito`; `nodo_geografico_renombrado` en el enum; el comentario de `valorAnterior`/`valorNuevo` puesto al día (ya no eran «cuatro tipos») |
| `scripts/seed-zonas.ts` | `GeoRow.codigoDta`; `codigosDeLaTerna`; el resolutor por código con respaldo por nombre y adopción; `ResolucionGeoStats` en el resumen |
| `public/geografia-cr-completa.xlsx` | columna nueva `Codigo DTA` (494 valores) |
| `public/geografia-cr-completa-NOTAS.md` | documenta la columna, su derivación y quién la vigila |
| `lib/types/geografia-nodo.ts` | `renombrarNodoGeograficoSchema` (reusa `nombreGeoSchema`, el del alta) |
| `lib/types/historial-accion.ts` | el tipo nuevo, su categoría y su etiqueta; 47 → **48** |
| `lib/types/historial-accion-etiquetas.ts` | `VALOR_MAX_CHARS = 60` y `valorDeCatalogo`, el recorte a la anchura de la columna |
| `lib/interfaces/repositories/IGeoRepository.ts` | `findHermanosDeNodo` y `renombrar` |
| `lib/interfaces/services/IGeografiaService.ts` | `renombrar` + su tipo de resultado |
| `lib/services/GeografiaService.ts` | `renombrar`: rol → hermanos → clave normalizada excluyendo el propio nodo → escribir |
| `lib/repositories/GeoRepository.ts` | `findHermanosDeNodo` y `renombrar` (tx + `appendAccion` dentro) |
| `lib/actions/geografia.ts` | `renombrarNodoGeografico`, con el mismo `catch` del UNIQUE que el alta |
| `app/(app)/configuracion/geografia/_components/GeografiaAdminModule.tsx` | botón «Renombrar» por fila en los tres niveles + su formulario |
| `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` | entrada del censo para `GeoRepository#renombrar`; 47 → 48 |
| `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` | 48 tipos; el caso de la categoría del tipo nuevo; 9 → **10** desapariciones |
| `tests/unit/historial-accion/lectura-borde-y-servicio.test.ts` | la unión de dos categorías pasa de 21 a 22 |
| `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts` | la cadena `POSTERIORES` gana el valor nuevo |
| `tests/unit/services/geografia-service.test.ts` | la puerta de rol de la quinta operación + 9 casos del renombrado |
| `tests/unit/actions/geografia-action.test.ts` | sin sesión, validación del borde, traducción del UNIQUE |
| `tests/unit/scripts/seed-zonas.test.ts` | el doble de Prisma gana `update`; `codigoDta` en la fila |
| `tests/unit/components/geografia-admin.ui.test.tsx` | 12 casos del botón «Renombrar» |

---

## 2 · `codigo_dta` — cuántos códigos, y cuántos nulos

### Lo que se backfilleó

| Nivel | Filas en la base local | Con código | **Nulos** |
| --- | ---: | ---: | ---: |
| provincia | 7 | **7** | **0** |
| cantón | 84 | **84** | **0** |
| distrito | 494 | **494** | **0** |

**Ningún código quedó nulo** en la base local porque las 585 filas del catálogo son exactamente las
del `.xlsx`. La columna **sigue siendo nullable a propósito**: en cualquier otra base, una fila que
el `.xlsx` no nombre —o que un maestro haya dado de alta a mano desde la pantalla— se queda en
`NULL`, y eso es lo correcto. **Un código inventado es peor que ninguno**: colisiona con el real el
día que el IGN lo asigne, y además miente.

### Los duplicados, medidos ANTES del índice único

El `CREATE UNIQUE INDEX` falla si el backfill produce un código repetido, así que se midió antes.
Método: aplicar `ADD COLUMN` + los tres `UPDATE` **dentro de una transacción** y hacer **ROLLBACK**,
corriendo `GROUP BY codigo_dta HAVING count(*) > 1` en las tres tablas:

```
filas actualizadas: 7
filas actualizadas: 84
filas actualizadas: 494
provincia: duplicados=0 nulos=0
canton:    duplicados=0 nulos=0
distrito:  duplicados=0 nulos=0
rollback OK: la base queda como estaba
```

**0 duplicados en los tres niveles.** Y sobre el propio `.xlsx`, antes de emitir el SQL: 494 filas,
**494 códigos distintos**.

### Los tres huecos, que es donde una derivación ingenua se rompe

La numeración de la DTA **no es secuencial**. `public/geografia-cr-completa-NOTAS.md` documenta tres
códigos retirados, y los tres se respetan:

| Cantón | Código vacante | Por qué | Qué queda |
| --- | :---: | --- | --- |
| Alajuela / Grecia | `20306` | Río Cuarto se hizo cantón | Tacares `20305` → Puente de Piedra **`20307`** → Bolívar `20308` |
| Puntarenas / Puntarenas | `60109` | Monteverde se hizo cantón | Barranca `60108` → Isla del Coco **`60110`** |
| Puntarenas / Golfito | `60702` | Puerto Jiménez se hizo cantón | Golfito `60701` → Guaycará **`60703`** → Pavón `60704` |

Verificados contra los datos del encargo: **Cabagra `60310`**, **Pijije `50405`**,
**Duacarí `70605`**, **provincia Puntarenas `6`**, **cantón Buenos Aires `603`**. Los diez se
comprobaron sobre la base ya migrada y están fijados por test.

---

## 3 · El `.xlsx`: una columna, no tres

`public/geografia-cr-completa.xlsx` gana **una sola** columna, `Codigo DTA`, con el código del
**distrito** (5 dígitos). Los otros dos niveles salen por **prefijo**, porque la DTA es jerárquica
por construcción: `codigo.slice(0,1)` es la provincia y `codigo.slice(0,3)` el cantón. Tres columnas
serían tres sitios donde equivocarse y dos oportunidades de que se contradigan entre sí.

Escrito con `exceljs` desde un script de un solo uso, **borrado al terminar**, y **verificado
releyendo el archivo**: 4 columnas, cabecera `Provincia | Canton | Distrito | Codigo DTA`, 494 filas
de datos, 494 códigos distintos, ninguno vacío. `tests/unit/scripts/seed-zonas-codigo-dta.test.ts`
lo relee en cada corrida: si alguien regenerara el binario sin la columna, el seed caería al
respaldo por nombre **sin un solo error**, y ese test es lo único que lo diría.

---

## 4 · El seed: código primero, nombre de respaldo

`resolverNodo` (uno para los tres niveles):

1. **por `codigo_dta`**, si la fila trae código. Es lo que hace seguro el renombrado: el nodo se
   encuentra **aunque se llame distinto**, y su `nombre` **no se reescribe** — el `.xlsx` es la foto
   de la DTA; el nombre vigente lo decide el maestro en la pantalla;
2. **por nombre dentro del padre**, el respaldo de siempre. Si el nodo encontrado no tiene código y
   la fila sí lo trae, lo **adopta**. Sin esa adopción el respaldo no converge nunca: un nodo creado
   a mano al que el IGN asigne código después seguiría sin clave estable, y su primer renombrado
   volvería a duplicarlo;
3. **crear**, con su código si lo hay.

Un código **mal formado** (cuatro dígitos, una letra, un espacio dentro) devuelve `null` y se cae al
nombre, en vez de cruzar con nada: un código que no encuentra nodo hace que el seed **cree** una
fila, que es exactamente el duplicado que la ficha cierra.

El índice del cruce de zonas (`distritoByTerna`) **sigue siendo por nombre**, y no es una
incoherencia: su clave se compara contra el **otro** `.xlsx` —`mapa-geografico-costa-rica.xlsx`, la
fuente de las zonas—, que no tiene códigos. Las dos fuentes hablan el mismo idioma (los nombres de
la DTA), así que el cruce entre ellas sigue funcionando aunque la base llame al nodo de otra forma.

---

## 5 · El renombrado

`renombrarNodoGeografico` → `GeografiaService.renombrar` → `GeoRepository.renombrar`, con el gate
`maestro` de sus tres hermanas y el mismo patrón de resultado.

- **Unicidad entre hermanos por clave normalizada.** Se reusa `normalizeName` —la **misma** función
  con la que `resolveGeo` indexa la carga masiva—, no una segunda normalización. El UNIQUE literal
  de la base **no basta**: dejaría convivir «San José» y «San Jose», dos filas legales para Postgres
  y **una sola cosa ambigua** para la carga. Sería el defecto de la ficha entrando por la puerta de
  al lado.
- **Renombrar a sí mismo devuelve `ok`.** El nodo se **excluye por su `id`** de la comparación, así
  que ni su propio nombre ni una variante que se normalice igual («cabagra») dan conflicto. En el
  repositorio, un nombre **idéntico** devuelve `sin_cambio`: no escribe ni el `update` ni la fila de
  auditoría. Guardar sin cambios sigue funcionando.
- **Renombrar al nombre de un hermano devuelve `conflict`**, también si el hermano está retirado: el
  nombre sigue ocupado para el UNIQUE, y reactivar el viejo después chocaría con el nuevo.
- **El `update` lleva `nombre` y nada más.** En particular **no** toca `codigoDta`: el código es la
  identidad y el nombre la etiqueta. Una guardia lo afirma.
- **Auditoría dentro de la misma transacción** (`appendAccion` **dentro** del callback de
  `$transaction`, forma `abre_tx` del censo), con `valor_anterior` = nombre viejo y `valor_nuevo` =
  nombre nuevo, recortados a 60 caracteres en la fuente porque Postgres **no trunca, aborta**.
- **La categoría es `hace_desaparecer`**, con sus dos hermanos. R17 de la 362 exige exactamente una
  por tipo y las otras dos no encajan: renombrar no mueve dinero ni cambia quién puede hacer qué.
  Lo que sí hace es **hacer desaparecer el nombre viejo** de toda carga futura. Y mantiene el eje
  geográfico entero en una categoría: partirlo rompería el filtro justo donde se usa.

---

## 6 · Mapa requisito → test

El encargo no venía como spec EARS numerado, así que el mapa va por **afirmación**.

| Lo que se afirma | Test |
| --- | --- |
| Las tres tablas ganan `codigo_dta` NULLABLE, sin default | `tests/integration/db/geografia-codigo-dta-migration.test.ts` |
| El backfill pone los 7 + 84 + 494 códigos, con los códigos verificados del encargo | ídem |
| Los **tres huecos** se respetan (`20307`, `60110`, `60703`), y `20306`/`60109`/`60702` no se usan | ídem (dos casos: sobre el SQL y contra Postgres) |
| Lo que el `.xlsx` no nombra se queda en **NULL**, no con un código inventado | ídem |
| **0 duplicados** medidos con el `GROUP BY … HAVING count(*) > 1` | ídem |
| El índice único rechaza el repetido **y admite varios NULL** | ídem |
| Re-aplicar el backfill no pisa un código ya puesto | ídem |
| El `down` suelta columnas e índices sin borrar ni tocar una fila, y es idempotente | ídem |
| El `.xlsx` real trae la columna, con 494 códigos válidos y prefijos coherentes | `tests/unit/scripts/seed-zonas-codigo-dta.test.ts` |
| `codigosDeLaTerna` deriva por prefijo y rechaza lo mal formado | ídem |
| **El seed cruza por código: un nodo renombrado NO se duplica** | `tests/integration/db/seed-zonas-cruza-por-codigo.test.ts` |
| El seed no reescribe el nombre que decidió el maestro | ídem |
| El respaldo por nombre sigue, y **adopta** el código que faltaba | ídem |
| Sin código en la fila, el cruce cae al nombre (límite conocido, afirmado) | ídem |
| El renombrado cambia `nombre` y **no** `codigo_dta` / `activo` / `canton_id` | `tests/integration/db/geografia-renombrado.test.ts` |
| Renombrar a su propio nombre → `sin_cambio`, sin escritura ni auditoría | ídem |
| Nodo inexistente → `no_existe` | ídem · `tests/unit/services/geografia-service.test.ts` |
| **Una** fila `nodo_geografico_renombrado` con los dos nombres y el actor congelado | `tests/integration/db/geografia-renombrado.test.ts` |
| Si `appendAccion` falla, el nombre **no** queda persistido | ídem |
| El UNIQUE por padre rechaza el homónimo literal; bajo otro padre entra | ídem |
| `findHermanosDeNodo` incluye el propio nodo, trae inactivos y acota al padre | ídem |
| El conflicto se decide por clave **normalizada**, excluyendo el propio nodo | `tests/unit/services/geografia-service.test.ts` |
| Rol ≠ `maestro` → `forbidden` sin tocar el repositorio | ídem |
| Sin sesión → `unauthenticated` sin instanciar el service | `tests/unit/actions/geografia-action.test.ts` |
| Entrada inválida → `validation_error` sin llegar al service; el nombre llega recortado | ídem |
| El UNIQUE que escapa se traduce a `conflict` | ídem |
| El enum de la base **es** el catálogo (48 tipos); el `down` recrea los 47 previos | `tests/integration/db/geografia-renombrado-migration.test.ts` |
| El rollback **aborta** si queda una fila con el valor nuevo, y no la borra | ídem |
| El tipo nuevo está en `hace_desaparecer`, con etiqueta y como filtro | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` |
| El registro va **dentro** de la transacción del `update` | `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` |
| `GeoRepository.renombrar` es el **único** sitio de `lib/` que escribe `nombre` | `tests/unit/guards/geografia-renombrado-punto-unico.guardia.test.ts` |
| «Renombrar» existe en los tres niveles, también en un nodo retirado | `tests/unit/components/geografia-admin.ui.test.tsx` |
| Guardar manda `{nivel,id,nombre}` recortado; guardar sin cambios no se veta | ídem |
| Cada desenlace muestra su mensaje propio | ídem |

---

## 7 · Autocomprobación: cuatro mutaciones, con su mensaje literal

### M1 · El seed vuelve a cruzar por nombre

En `scripts/seed-zonas.ts`, desactivada la búsqueda por `codigo_dta` de `resolverNodo`.
**4 de 8 casos rojos** en `tests/integration/db/seed-zonas-cruza-por-codigo.test.ts`:

```
FAIL  tests/integration/db/seed-zonas-cruza-por-codigo.test.ts > 375 — el seed cruza por codigo, no por nombre (Postgres real) > 375 — un nodo RENOMBRADO no se duplica en la siguiente corrida del seed > ⭑ el seed lo encuentra por su codigo aunque el .xlsx traiga el nombre viejo
PrismaClientKnownRequestError:
Invalid `prisma.distrito.create()` invocation in
scripts/seed-zonas.ts:332:44
Unique constraint failed on the (not available)
```

El seed **intenta crear el duplicado** y el índice único de `codigo_dta` lo para en seco. También
caen «tampoco se duplican el cantón ni la provincia renombrados», «re-correr el seed dos veces sigue
sin duplicar» y «con el código ya adoptado, un renombrado posterior tampoco duplica».

### M2 · El `appendAccion` fuera de la transacción

En `GeoRepository.renombrar`, el `appendAccion` movido fuera del callback de `$transaction`.
**Dos rojos, uno estático y uno contra Postgres**:

```
FAIL  tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts > 362/R9 — los 48 tipos se registran DENTRO de la transaccion de su accion > GeoRepository.ts#renombrar registra su accion en la misma transaccion que la escribe
AssertionError: lib/repositories/GeoRepository.ts#renombrar (nodo_geografico_renombrado): una accion que se escribe sin su registro deja el modulo mintiendo en silencio: expected [ …(2) ] to deeply equal []
- []
+ [
+   "no le pasa a `appendAccion` la `tx`, sino otro cliente",
+   "el `appendAccion` cae FUERA del callback de `$transaction`",
+ ]
```

```
FAIL  tests/integration/db/geografia-renombrado.test.ts > … > ⭑ si `appendAccion` FALLA, el nombre NO queda persistido
AssertionError: el `appendAccion` esta FUERA de la transaccion del `update`: un fallo del registro deja el nombre cambiado y sin rastro de quien lo cambio: expected 'Cabagrita f375rmtpbf6duffbe' to be 'Cabagra f375rmtpbf6duffbe' // Object.is equality
```

### M3 · El backfill asume numeración secuencial

En `migration.sql`, Puente de Piedra `20307` → `20306` y Bolívar `20308` → `20307` (lo que saldría
de derivar sin la tabla de huecos). **Dos rojos**, uno sobre el SQL y otro contra Postgres:

```
FAIL  tests/integration/db/geografia-codigo-dta-migration.test.ts > 375 — el up del backfill, contra Postgres > ⭑ los distritos de los TRES huecos reciben el codigo SALTADO, no el secuencial
AssertionError: expected '20306' to be '20307' // Object.is equality
Expected: "20307"
Received: "20306"
```

```
FAIL  tests/integration/db/geografia-codigo-dta-migration.test.ts > 375 — migracion geografia_codigo_dta: forma en disco > ⭑ los TRES huecos de la numeracion oficial estan respetados en el SQL, literalmente
AssertionError: expected 'ALTER TABLE "provincia" ADD COLUMN "c…' to contain '(\'Alajuela\', \'Grecia\', \'Puente d…'
```

### M4 · El servicio compara literales en vez de la clave normalizada

En `GeografiaService.renombrar`, `normalizeName` sustituido por comparación literal.
**5 casos rojos** en `tests/unit/services/geografia-service.test.ts`:

```
FAIL  tests/unit/services/geografia-service.test.ts > 375 — renombrar: el conflicto se decide por la clave NORMALIZADA > «perez zeledon» (sin acentos ni mayusculas) choca con el hermano y devuelve conflict
AssertionError: expected { status: 'ok', …(3) } to deeply equal { status: 'conflict' }
- "status": "conflict",
+ "id": "d1", "nivel": "distrito", "nombre": "perez zeledon", "status": "ok",
```

Las cuatro mutaciones se revirtieron y los cinco archivos volvieron a verde
(**142 tests passed**) antes de correr el gate.

---

## 8 · El gate

`./init.sh` **completo** (el rápido se niega solo: el diff toca `db/migrations/**`,
`db/schema.prisma` y `lib/types/**`). Log propio, con el id del agente en el nombre —`/tmp` es
compartido entre worktrees y ya se pisaron dos veces—, y `INIT_EXIT=$?` **escrito dentro del log**.

**El `.env` se copió del árbol principal y se borró al terminar.** Sin él, ~130 archivos contra
Postgres se saltan y el gate dice «init OK» igualmente. Con él, el propio gate lo confirma:

```
✓ DATABASE_URL resuelta: los 130 archivos de tests contra Postgres SI se ejecutan
```

### Primera corrida — ROJO, y el rojo era MÍO

```
Test Files  1 failed | 1763 passed (1764)
     Tests  1 failed | 25156 passed | 26 skipped (25183)
  Duration  568.17s

ROJOS NUEVOS (1 archivo(s) que no estan en el baseline):
  - tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts
INIT_EXIT=1
```

Ese archivo lleva una **cadena verificable** de los valores del enum añadidos ficha a ficha
(`POSTERIORES`), y es a propósito: cualquiera que amplíe el enum tiene que pasar por ahí. Se añadió
`nodo_geografico_renombrado` a la cadena, con su comentario y el archivo de migración que lo cubre.
No es deuda ajena y **no** se metió en el baseline.

### Segunda y tercera corrida — el rojo propio desaparece; queda un flake distinto cada vez

```
# corrida 2 (log: gate2-agent-a32d0a09ca97283bc.log)
✓ typecheck paso
✓ lint paso                       (154 warnings preexistentes, 0 errores)
✓ DATABASE_URL resuelta: los 130 archivos de tests contra Postgres SI se ejecutan
Test Files  1 failed | 1763 passed (1764)
     Tests  1 failed | 25156 passed | 26 skipped (25183)
  Duration  563.15s
ROJOS NUEVOS: tests/integration/tablero-dia-dia-reparto.test.ts
INIT_EXIT=1
```

```
# corrida 3 (log: gate3-agent-a32d0a09ca97283bc.log)
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 130 archivos de tests contra Postgres SI se ejecutan
Test Files  1 failed | 1763 passed (1764)
     Tests  1 failed | 25156 passed | 26 skipped (25183)
  Duration  598.21s
ROJOS NUEVOS: tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts
INIT_EXIT=1
```

**El rojo es DISTINTO en cada corrida y ninguno de los dos toca nada de esta ficha.** Sus mensajes
son los dos modos de fallo por saturación que este repo tiene documentados:

```
FAIL  tests/integration/tablero-dia-dia-reparto.test.ts > … > C1 · asignada HOY y reservada para HOY: cuenta hoy (R2)
DriverAdapterError: se ha detectado un deadlock
```

```
FAIL  tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts > … > AUTOCOMPROBACIÓN: el detector encuentra los casos conocidos y rechaza el que no cuenta
Error: Test timed out in 20000ms.
```

Corridos **los tres archivos juntos y aislados** —los dos flakes más el que sí era mío—:

```
Test Files  3 passed (3)
     Tests  15 passed (15)
  Duration  3.50s
```

Es exactamente lo que `docs/verification.md` describe («la suite tira 2–5 flakes de saturación que
cambian de sitio entre corridas») y lo que el propio gate dice al pie: *«los flakes de saturación
pasan solos y no son deuda de nadie»*. Por eso **no** se han metido en `tests/baseline-rojos.json`:
esa lista es para deuda ajena **medida**, no para callar un flake.

Detalle que respalda el diagnóstico del deadlock: `tests/integration/tablero-dia-dia-reparto.test.ts`
**no llama a `serializarEscriturasReales`**, el lock de aviso que `_postgres-real.ts` creó
precisamente para eliminar el `40P01` entre archivos que escriben en las tablas reales en paralelo.
Los dos archivos de integración que esta ficha añade **sí lo toman**.

**Los doce archivos de esta ficha salieron VERDES en la corrida 3:**

```
✓ tests/unit/components/geografia-admin.ui.test.tsx                     (49 tests)
✓ tests/unit/services/geografia-service.test.ts                         (49 tests)
✓ tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts (46 tests)
✓ tests/unit/historial-accion/catalogo-y-choke-point.test.ts            (40 tests)
✓ tests/unit/actions/geografia-action.test.ts                           (29 tests)
✓ tests/integration/db/geografia-codigo-dta-migration.test.ts           (24 tests)
✓ tests/unit/scripts/seed-zonas-codigo-dta.test.ts                      (16 tests)
✓ tests/integration/db/geografia-renombrado.test.ts                     (15 tests)
✓ tests/unit/guards/geografia-renombrado-punto-unico.guardia.test.ts    (12 tests)
✓ tests/integration/db/geografia-renombrado-migration.test.ts           (11 tests)
✓ tests/integration/db/seed-zonas-cruza-por-codigo.test.ts               (8 tests)
✓ tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts (5 tests)
```

### Los `skipped`

**26 tests saltados**, y ninguno es de la capa de datos: 17 en `tests/components/AnaliticaPage.test.tsx`
y 9 en `tests/components/AnaliticaShell.test.tsx`, dos ficheros con `skip` condicionales propios que
esta ficha no toca. **Cero archivos de `tests/integration/db/**` saltados** — es lo que confirma la
línea del `DATABASE_URL` de arriba.

### El entorno

El coordinador avisó a mitad de sesión de que el `node_modules` **del repo principal** estuvo roto un
rato. **No afecta a este veredicto**: este worktree tiene su propio `node_modules`, instalado con
`pnpm install --frozen-lockfile` (16,5 s), **no un junction** —el harness rechazó el `mklink`—.
Comprobado antes de dar el gate por bueno:

```
$ pnpm exec tsc --version     → Version 5.9.3
$ pnpm exec vitest --version  → vitest/4.1.10 win32-x64 node-v24.13.0
```

Y el log del gate no contiene ni un `Cannot find module` ni un binario ausente.

---

## 9 · Lo que NO se hizo, dicho explícitamente

- **No hay `specs/375-…`.** El encargo llegó como brief del leader. Si la ficha necesita spec
  formal con requisitos EARS, hay que escribirlo aparte.
- **No se tocó `feature_list.json`.** Escribirlo desde dentro de un worktree cuela el cambio en
  ESTA rama y puede revertir cierres al mergearse; ya pasó dos veces.
- **No se añadió entrada al changelog del canal por API key.** Se consideró y se descarta con
  motivo: esta ficha **no cambia el contrato publicado**. Los mensajes de error de fila son los
  mismos que ya declara la 374; lo que cambia es el **dato** (cómo se llama un nodo), no la forma de
  la respuesta. Un renombrado sí puede romper la carga de un integrador que mande el nombre viejo,
  pero eso ya era cierto para el alta y la retirada de la 374.
- **No se expone `codigo_dta` en la pantalla ni en los DTO del árbol.** No hacía falta para nada de
  lo que la ficha afirma, y añadirlo habría ensanchado el diff sin cubrirlo con un requisito.
- **No se tocó ningún `down.sql` anterior.** Son fotos históricas.
- **No se corrió el seed contra ninguna base.** Su comportamiento nuevo se afirma con tests contra
  Postgres en transacción revertida, no ejecutándolo.
- **No hay verificación manual en la pantalla real.** No se levantó dev server (otro agente podría
  tener el suyo, y dos se pisan). El botón «Renombrar» está cubierto por 12 casos de componente,
  pero **ver la app encuentra lo que la suite no**: queda pendiente mirarlo con sesión `maestro`.

---

## 10 · Veredicto

**El catálogo geográfico ya tiene clave estable y el renombrado está vivo, probado contra Postgres
y auditado.** El gate termina en `INIT_EXIT=1` en las tres corridas, pero el único rojo **propio**
—la cadena de valores del enum de `historial-accion-orden-zona-reconciliada-migration`— está
arreglado y verde, y los dos restantes son flakes de saturación distintos en cada corrida
(`40P01` y un timeout de 20 s) que pasan aislados en 3,5 s: **el veredicto que hay que mirar no es
el exit code, sino de quién es el rojo.**
