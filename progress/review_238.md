# Review — Feature 238 · Confirmación física de los paquetes al aprobar el cierre

> Rama `feature/238-confirmacion-fisica-cierre`, tres commits (`678f031c`, `59dc3fcf`,
> `0a0df331`) sobre `origin/dev` = `fc17148e`. Revisado el 2026-08-19.
>
> El reviewer **no edita código**. `./init.sh` **no** se corre aquí, por encargo: lo corre el
> humano con el árbol quieto. Cada mutación va **de una en una**, con `sha256`
> antes/mutado/después y la salida real de vitest citada; el árbol se restauró antes de pasar a
> la siguiente y quedó limpio al terminar (`git status` sólo muestra este acta).

---

# VEREDICTO: **OK**

**No hay bloqueantes.** La ficha hace lo que dice, y lo que dice está sostenido por tests que se
saben poner rojos — lo comprobé yo con cuatro mutaciones, no me fié de la bitácora. Los dos
puntos donde la ficha se podía estar engañando —el `WHERE` medido por dobles y el arreglo del
cierre imposible— resisten el ataque. Las dos correcciones que se hicieron **al spec y no al
código** son ciertas y las verifiqué de forma independiente.

Hay **8 hallazgos menores**, todos de documentación o de cobertura marginal. Ninguno cambia el
comportamiento ni toca dinero. **Lo que queda fuera, y con qué remite, está al final.**

---

## Checklist

### Especificación
- [x] `requirements.md` con EARS numerados `R1`-`R44` (el spec se anuncia como «R1-R42» en un par
      de sitios; los requisitos llegan a R44 — ver hallazgo m8).
- [x] `design.md` con alternativas descartadas y su porqué (§10, seis: A-F).
- [ ] `tasks.md` con **todas** las tasks `[x]` — quedan **T0.3** (aviso a bodega, acción humana,
      declarada como «ya no bloquea el despliegue» tras medir 0 cierres en cola) y **T6.3**
      (cierre documental, que es literalmente el paso posterior a esta revisión).

### Trazabilidad
- [x] R1-R25, R27-R38, R40-R44 mapean a un test concreto que **verifica** el requisito. Muestreé
      los sospechosos y los leí; ninguno es un test vacío.
- [~] **R26** no tiene test propio (hallazgo m1). **R39** sí lo tiene, pero el mapa de `tasks.md`
      apunta al archivo equivocado (hallazgo m2).
- [x] El mapa `R<n> -> test` existe en `progress/impl_238.md` (R1-R26, R38, R40-R44) y en
      `progress/impl_238_frontend.md` (R7, R13-cliente, R16, R27-R37). R39 está en
      `impl_238.md` §B con su propia mutación.

### Calidad de código (corrido por mí, ahora, con el árbol quieto)
- [x] `pnpm run typecheck` → **verde** (sin salida).
- [x] `pnpm run lint` → **0 errores**, 93 warnings preexistentes; **0 en los archivos de esta
      feature** (comprobado filtrando por sus nombres).
- [x] 21 suites de la 238 + las de regresión → **349 passed**.
- [x] `pnpm run test:guardias` → **122 archivos · 1787 tests passed**.
- [x] `tests/components/CierresAdmin*` (7 archivos) → **155 passed**.
- [ ] `pnpm test` completo / `./init.sh`: **no corridos aquí, por encargo** — remiten al humano.
- [~] E2E de flujo crítico: **no aplica** (este repo no tiene arnés de Playwright en la suite).
      El riesgo se cubrió por otra vía y está documentado: `progress/recorrido_238.md`, el
      recorrido del leader con Playwright y los dos roles, con la marca comprobada contra
      Postgres y las devoluciones llegando a `/novedades`.

### Datos y seguridad
- [x] **Ninguna tabla nueva.** Una columna en `gestion_orden`. Comprobado contra la base:
      `relrowsecurity = true`, **0 policies** (sólo service role). No hay superficie nueva que
      aislar ni RLS nueva que escribir.
- [x] Migración con su `down.sql` (`DROP COLUMN IF EXISTS`, una sola sentencia, pérdida de dato
      declarada). Round-trip real registrado por la fase backend; la forma la afirman 19 casos.
- [x] Sin secretos, sin PII: el error nuevo lleva **sólo** el id del cierre y hay un caso que lo
      afirma con un `not.toMatch` de guías, gestiones y actores (R44).
- [x] Sin hardcode de país, moneda ni cuenta. La feature no toca configuración.
- [x] Webhooks: no aplica (ninguno nuevo).

### Patrón de capas
- [x] La Server Action pasa la lista **tal cual**, sin coerción; la decisión vive en el servicio.
- [x] El servicio no conoce HTTP; valida cobertura contra el repo y devuelve `validation_error`.
- [x] El repositorio ejecuta la consulta y la escritura; su único `throw` es la guarda de fallo
      cerrado, molde exacto de `IndemnizacionNoAplicableError` (158).
- [x] Interfaces en `lib/interfaces/repositories/` y `lib/interfaces/services/`.
- [x] El cuerpo de la ventana (`cierre-confirmacion-fisica.tsx`) es presentación pura; el estado
      vive en el módulo. Correcto, y es lo que permite que R35 (cerrar sin perder lo escaneado)
      funcione.

---

## Lo que ataqué, y qué encontré

### 1 · El `WHERE` de `findGestionesRetornablesDelCierre` — **resiste**

**¿Puede el test contra Postgres pasar sin comprobar nada?** No.

- Corre de verdad: `Tests 5 passed (5)`, no `skipped`. Usa
  `HAY_BASE_DE_DATOS ? describe : describe.skip` —salto **visible**— y en `beforeAll` hace
  `if (fks === null) throw new Error("hay DATABASE_URL pero la tabla orden esta vacia…")`.
  **No hay ningún `if (!fks) return;`** en el archivo.
- **Mutación 1** — quitar `anuladaAt: null` del `where`:

| | sha256 de `lib/repositories/CierresAdminRepository.ts` |
| --- | --- |
| antes | `0f527ee9208fddce8d76bc939e03963bcc755d2e18d4fbd8acd9de2a0399a2d0` |
| mutado | `62a85bea89767e42dd9b892658e1ea9a5e008155968114bfbfb34983a0e2f860` |
| después | `0f527ee9208fddce8d76bc939e03963bcc755d2e18d4fbd8acd9de2a0399a2d0` |

```
FAIL tests/integration/db/cierres-admin-retornables-sql-real.test.ts >
  R2/R3: el SQL real devuelve las tres clases que vuelven y NADA mas
AssertionError: expected [ …(5) ] to deeply equal [ …(4) ]
+   "e85c6c25-6e66-4e45-9b06-cf05a94dec47"
 Tests  1 failed | 4 passed (5)
```

Mata **por comportamiento** (aparece la gestión anulada), no por forma.

**El doble del unitario aplica el predicado, no lo inspecciona.** Leí `buildRepo`: filtra las
nueve filas con la semántica de `cierreId`, `resultado.in`, `anuladaAt` y la relación
`cierre.{destinoTipo,destinoZonaId}` — y «`where.X` indefinido ⇒ no filtra», que es lo que hace
que **quitar** una condición cambie el resultado. La aserción de forma
(`expect(arg.where).toEqual(...)`) existe **además**, no en lugar de, y su literal
`resultado: { in: [reprogramada, devuelta, rechazada] }` es contrato de verdad: no se importa de
`RESULTADOS_QUE_VUELVEN`, así que no está comparado contra su propia fuente. Hay además el
contrapunto obligatorio («el satélite SÍ ve el suyo»), sin el cual un `where` que devolviera
siempre vacío pasaría las dos aserciones de R6.

### 2 · El arreglo del cierre que no se podía aprobar nunca — **correcto, y por una razón que hay que nombrar**

**a) ¿Conserva R32 y R31, o los relajó?**

- **R32: conservado, y ahora es cierto donde antes mentía.** Una lectura marca **todas** las
  filas pendientes de esa guía, así que una segunda lectura siempre encuentra
  «pendientes = 0» y avisa. Antes el aviso saltaba **con una fila todavía pendiente**, y ahí era
  donde el requisito se estaba usando para tapar el bloqueo. Hay un caso que lo afirma con su
  literal y que además comprueba que el contador **no** sube («R32 SIGUE VIVO…»).
- **R31: relajado en un caso, y la relajación es la correcta.** El aviso «es de este cierre y no
  vuelve» ahora sale sólo si **ninguna** fila de esa guía vuelve. En el caso mixto —una
  `entregada` y una `devuelta` de la misma orden— se confirma la `devuelta` y no se avisa. Es lo
  que debe pasar: **hay un bulto delante que confirmar**, y avisar ahí reproducía el mismo
  bloqueo mudo por el otro lado (hay un caso propio para esto). Lo que no se hizo es **anotar el
  caso mixto en `requirements.md`**: sólo se corrigió `design.md` §5.3 → hallazgo **m3**.
- **La pieza que hace correcto el arreglo, y que conviene tener escrita**: `orden.numGuia` es
  **`@unique`** (`db/schema.prisma:484`, asignado por `nextval`). Por eso todas las filas con la
  misma guía son de la **misma orden** y por tanto **un solo bulto**. Sin esa unicidad, «una
  lectura confirma todas» sería un agujero —confirmaría paquetes distintos—; con ella es
  correcto. El comentario del código dice «hay UN solo paquete físico» sin citar la unicidad que
  lo garantiza → hallazgo **m4**.

**b) ¿Contar paquetes puede rebajar el bloqueo?** **No.** Dos candados independientes:

1. *En la pantalla*: «faltan 0» equivale a que todo paquete tenga **todas** sus filas
   confirmadas, y eso equivale a que **toda fila retornable esté confirmada**. El agrupado cambia
   el número que se **dice**, no el que bloquea. Y las filas **sin guía** cuentan **cada una por
   su cuenta** (clave `sin-guia:<gestionId>`), así que no se funden y siguen bloqueando —tiene su
   caso, y además esas filas no se pueden confirmar nunca (R13), así que el cierre queda bloqueado
   con su mensaje, que es lo correcto.
2. *En el servidor, que es el que decide*: `listaConfirmacionFisica()` envía sólo lo confirmado, y
   `validarConfirmacionFisica` recorre **`esperadas`** y marca `MSG_CONFIRMACION_FALTANTE` en cada
   gestión que no venga. Es una comprobación **por gestión**, no por paquete. Aunque la pantalla
   se equivocara al agrupar, **lo peor que puede pasar es un `validation_error`**, nunca una
   aprobación con un paquete sin confirmar. Esto es R14 haciendo de red, y está donde tiene que
   estar: antes de abrir la transacción.

**c) La mutación `every` → `some`: ¿equivalente?** **Sí, y lo confirmo yo — pero con un matiz que
merece una línea de comentario, no un cambio.**

| | sha256 de `app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx` |
| --- | --- |
| antes | `3e7cc03697deea777992b3d60fda208e2dd888613e6ab89a7d8cbb3af21bc9ee` |
| mutado (`some`) | `1e3a021b8b9897e7d217679aff1fc747e00530435ef8a17b5c5e6beda26db76c` |
| después | `3e7cc03697deea777992b3d60fda208e2dd888613e6ab89a7d8cbb3af21bc9ee` |

```
pnpm exec vitest run tests/components/CierresAdminConfirmacionFisica.test.tsx
 Test Files  1 passed (1)
      Tests  31 passed (31)
```

**Por qué es equivalente de verdad**: `confirmadas` sólo lo escribe `leerGuia`, y `leerGuia`
escribe **todas** las filas pendientes de esa guía a la vez. Un paquete **medio confirmado es
inalcanzable** por la UI, y por tanto `every` y `some` devuelven siempre lo mismo. No es una
excusa: es una propiedad del grafo de llamadas.

**Y no es un hueco de cobertura, porque el invariante del que depende SÍ está testeado.** Lo medí
con una **mutación 4** que reintroduce el fallo original en forma sutil —confirmar sólo la
primera fila pendiente (`pendientes.slice(0, 1)`)—:

| | sha256 del mismo archivo |
| --- | --- |
| mutado (`slice(0,1)`) | `db33c440f541cc73f73fd5bd6b1cef95d9b156ecae327c438c243d3225bb0f05` |
| después | `3e7cc03697deea777992b3d60fda208e2dd888613e6ab89a7d8cbb3af21bc9ee` |

```
❯ tests/components/CierresAdminConfirmacionFisica.test.tsx (31 tests | 2 failed)
  × las dos filas quedan confirmadas, el botón se habilita y el cierre se aprueba
  × R32 SIGUE VIVO: con las dos filas ya confirmadas, otra lectura avisa y no cuenta de más
AssertionError: expected 'Nº Guía 7010 · REM-DUPDevueltaPendien…' to contain 'Confirmada'
AssertionError: expected 'Paquetes confirmados: 0 de 2.' to be 'Paquetes confirmados: 1 de 2.'
```

Ese segundo rojo es **`every` trabajando**: con una sola de las dos filas confirmada, el paquete
**no** se cuenta. Bajo `some` esa misma aserción habría leído «1 de 2» y habría pasado. Es decir:
`every` no es redundante, es el **segundo candado**, y el primero (una lectura cubre todas las
filas) tiene su propio test. La pareja está protegida; lo que ningún test distingue es `every` de
`some` **con el árbol sano**, y eso es exactamente lo que significa «mutante equivalente».

**El único caso que los distinguiría** es que `retornables` cambie a mitad de sesión con
`confirmadas` ya poblado (aparece una fila nueva con una guía ya confirmada). No es alcanzable:
`detalle` es `useState` cargado una sola vez por `abrirDetalle` —**no** hay `useSWR` revalidando
el detalle— y `confirmadas` se descarta en `cerrarDetalle`. Y si ocurriera, `every` da el
comportamiento correcto y `some` un error de servidor: la elección del código es la defensiva.

**Conclusión del punto 2: el arreglo es correcto, conserva R32, mejora R31 y no puede rebajar el
bloqueo. La declaración de equivalencia del agente es cierta y la confirmo.**

### 3 · El caso de R20 en `confirmacion-fisica-migration.test.ts` — **bien reescrito**

`--reporter=verbose` → **19 passed (19)**, y la mitad que va a Postgres se ejecuta de verdad
(131 ms / 15 ms / 26 ms de consulta real), **con las 12 marcas reales delante**.

Estado de la base local, medido por mí (solo lectura): `gestion_orden` **15 filas, 12 marcadas**;
las 12 cuelgan de un cierre **`aprobado`**; resultados `reprogramada` 8 · `devuelta` 2 ·
`rechazada` 2 — **ninguna `entregada` ni `incidente`**. `cierre_dia`: 3, los 3 `aprobado`. Las
suites pasan **con** ese estado realista.

**¿Las dos invariantes son necesarias y no vacuas?** Sí, las dos.

- **(1) ninguna marca anterior a la migración** — *necesaria*: es la única que caza el backfill
  histórico (copiar `resuelto_at` de los cierres ya aprobados deja marcas con fecha anterior a
  que la columna existiera). *No vacua*: exige que haya gestiones que mirar **y** que la fila de
  `_prisma_migrations` exista con su `finished_at` —sin ella el `JOIN` daría cero sin comparar
  nada—, y la autocomprobación planta esa marca y la caza.
- **(2) ninguna marca fuera de un cierre aprobado** — *necesaria*: es la invariante de la
  **escritura** (R17). *No vacua*: la autocomprobación planta una gestión sin cierre marcada y el
  contador la caza. Todo dentro de `enTransaccionRevertida`, y el caso comprueba **después** que
  la base quedó limpia.
- **No se solapan**: (1) mira el *cuándo*, (2) el *dónde*.
- El `AT TIME ZONE 'UTC'` no es cosmético y está bien puesto: `confirmada_fisica_at` es
  `timestamp` y `finished_at` es `timestamptz`; sin él la comparación se desviaría por el
  TimeZone de la sesión.
- Matiz de redacción → hallazgo **m5**.

**Barrido por la misma fragilidad en el resto del árbol.** Censé `tests/integration/db/**`
buscando el patrón que falló —una aserción global sobre una tabla **real** que codifica «nadie ha
ejercido todavía esta feature»—, cruzando aserciones de vacío contra el uso de
`enTransaccionRevertida`. Resultado: **no queda ninguna otra**. Todos los `IS NOT NULL` del árbol
son regex **sobre el texto de `migration.sql`** (estáticas, inmunes al estado); las auditorías
sobre datos reales corren dentro de transacción revertida; y la única que consulta `public` sin
revertir y afirma vacío es `satelite-conjunto-sql-real.test.ts`, cuyo propósito declarado es «el
SQL se ejecuta contra el esquema real» —el vacío es el resultado, no la propiedad—. **El caso de
la 238 era el único de su clase y ya está corregido.**

### 4 · Los dos sitios donde se corrigió el SPEC y no el código — **las dos correcciones son ciertas**

**T5.4** — mutación `incidente: true` en `RETORNA_A_BODEGA`, corrida por mí:

| | sha256 de `lib/types/gestion-retorno.ts` |
| --- | --- |
| antes | `a017850fb725414e19e5eb4bc7b5fda8e4f9d4af06f7e275d1b1ce11a634700d` |
| mutado | `dc31111f4cc7c48abbcbc02e9956fe34ef8797781d659587ac111d8e49f595e3` |
| después | `a017850fb725414e19e5eb4bc7b5fda8e4f9d4af06f7e275d1b1ce11a634700d` |

```
❯ tests/unit/types/gestion-retorno.test.ts                          (8  | 4 failed)
❯ tests/unit/repositories/cierres-admin-retornables.test.ts         (11 | 3 failed)
❯ tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts (13 | 2 failed)
❯ tests/integration/db/cierres-admin-retornables-sql-real.test.ts   (5  | 1 failed)
 Test Files  4 failed | 1 passed (5)
      Tests  10 failed | 43 passed (53)
```

Un rojo por frente: `expected true to be false` (el `Record`);
`expected [ g-dev, g-rec, g-rep, …(2) ] to not include 'g-inc'` (el WHERE de la lectura);
`promise resolved "'updated'" instead of rejecting` (el testigo del `resultado` en la escritura);
`expected [ …(5) ] to deeply equal [ …(4) ]` (Postgres real).

**El archivo que quedó verde es exactamente `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts`.**
La corrección del spec es **cierta**: esa suite usa dobles del repositorio —el conjunto esperado
se lo da el test—, así que `RETORNA_A_BODEGA` no interviene y es **estructuralmente incapaz** de
ver la mutación. Quien la mata es el módulo puro, el repositorio (lectura **y** escritura) y
Postgres. La decisión firmada queda protegida.

*Nota*: mido **10 rojos en 4 archivos**, no los 8 en 3 de la bitácora. La diferencia son los dos
casos del repositorio, que el implementer no incluyó en su corrida — es **más** cobertura de la
declarada, no menos.

**T5.1** — cierta también. `aprobarCierreBodega` vive en `lib/services/CierresBodegaAdminService.ts:335`;
`tests/unit/services/cierre-bodega-service.test.ts` existe pero es de **otro** servicio y tiene
**0** menciones a la 238. El test de R39 está en `tests/unit/services/cierres-bodega-admin-service.test.ts:654`,
por tres frentes (no lee el conjunto · la firma sigue siendo `(cierreBodegaId, actor)` · censo de
que ni el servicio ni sus repos **nombran** la confirmación) y con su mutación **M15a**
documentada. **Pero el mapa consolidado de `tasks.md` no se actualizó** → hallazgo **m2**.

**design §5.3** — cierta y necesaria; ver punto 2-a.

### 5 · La transacción — **no rompe la 239 ni el dinero, y la escritura está doblemente guardada**

- **Orden**: el bloque va entre `devolucionRechazadas` (139) y el anclaje (239). Está **afirmado**
  por un caso propio que instrumenta los dos delegados y comprueba
  `expect(orden).toEqual(["confirmar", "anclar"])`.
- **La 239 intacta**: en `cierres-admin-anclaje-devolucion.test.ts`,
  `CierresAdminRepository.resolverCierre.devolucion.test.ts` y `cierres-admin-caja-cod.test.ts` el
  diff es **una sola línea cada uno** (`confirmacionFisica: []`, el peaje del tipo obligatorio).
  **Ninguna aserción cambió.** Verde en mi corrida.
- **R23 afirmado, no deducido**: el caso lee `ordenHistorialEstado.createMany` para sacar las
  gestiones que el anclaje movió y comprueba que **cada una** tiene `confirmadaFisicaAt` no nulo,
  con un mensaje que nombra la gestión que se ancló sin confirmar.
- **Guardada por `cierreId` y por `resultado`**: las dos condiciones están en el `where` y **cada
  una tiene su caso testigo** que además comprueba que la transacción **revierte entera**. Mi
  mutación 3 mató el testigo del `resultado` de forma independiente.
- **Dinero**: `data` con **exactamente** `confirmadaFisicaAt` (caso propio). Las guardias
  money-safe y `dinero-sin-centimos` verdes sin tocar. `confirmada_fisica_at` **no tiene lectores**
  fuera del schema, el bloque de escritura y sus tests —lo verifiqué con un grep sobre `lib/` y
  `app/`: **cero** apariciones—, y hay una guardia con censo y autocomprobación que lo mantiene
  así, incluida la detección de aritmética de fechas (R21).
- **Idempotencia (R22)** medida donde se ve: `wallet-idempotencia.test.ts` con un store que honra
  el `where` y un `cierreDia` que honra la guarda de estado resoluble. La segunda aprobación da
  `conflict`, **no vuelve a llamar** a `updateMany` y la marca conserva **el instante de la
  primera**.
- **R40/R42**: el inventario de escrituras pasa a describir **dos** bloques con **dos** suites, y
  la re-identificación de la indemnización es **por significado** (`where.resultado` igual a
  `incidente`), no por presencia o ausencia de una clave. Frente 2 verde.
- Matiz sobre la fuerza de la evidencia de R41 → hallazgo **m6**.

### 6 · Los once mensajes con tilde — **afirmados con su literal, ninguno contra su propia fuente**

- **Ningún test importa las constantes de mensaje.** Grep sobre `tests/`: la única aparición de
  `MSG_CONFIRMACION_*` es dentro de un **comentario**. El encabezado del test de componente lo
  declara explícitamente («todos los textos esperados están escritos a mano, con sus tildes, y no
  importados del módulo que los produce: una aserción contra su propia fuente está siempre
  verde»), y lo comprobé leyendo sus imports: sólo trae el módulo y las actions, nada de
  `cierre-confirmacion-fisica`.
- **Los seis mensajes nuevos del servidor**: los seis con su literal exacto en
  `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts`.
- **Los dos que ganaron tilde en este diff**: `MSG_INDEMNIZACION_FALTANTE` («Falta el monto de
  indemnización…») y `MSG_CATALOGO_ANCLAJE` («…el catálogo de estados está incompleto…»), los dos
  con su literal en `cierres-admin-indemnizacion.test.ts` / `cierres-admin-service.test.ts`.
- **Los textos de pantalla**: los que verifiqué uno a uno están afirmados con su literal («Esa
  guía ya está confirmada. No se cuenta dos veces.», «Sin número de guía: no se puede confirmar.
  Avisá a un administrador.», «Están todos. Ya se puede aprobar el cierre.», «Este paquete aparece
  en 2 filas de esta lista…», etc.). **Uno no**: la descripción del modal → hallazgo **m7**.

---

## Hallazgos

Todos **menores**. Ninguno bloquea.

**m1 · menor — R26 no tiene test propio, y `tasks.md` dice que sí.**
El mapa de `tasks.md` afirma que `cierres-admin-confirmacion-fisica.test.ts` (repo) cubre «la
válvula de escape no confirma nada; la aprobación posterior sí exige la lista completa». **Ese
caso no existe**: grep de `forzarSolicitudVencido`, `R26` y «válvula» en ese archivo → 0.
`progress/impl_238.md` es honesto y dice «por construcción». *Por qué no bloquea*: verifiqué la
propiedad yo. `forzarSolicitudVencido` toca **sólo** `cierreDia.estado` (money-safe), y
`confirmadaFisicaAt` se escribe en **un único sitio** del árbol, dentro de la rama `aprobado` de
`resolverCierre`. La segunda mitad de R26 sí está medida, por R7/R8.
*Remedio*: o un caso de una línea, o corregir el mapa para que diga lo que `impl_238.md` ya dice.
Lo que no puede quedarse es el mapa afirmando un test que no está.

**m2 · menor — el mapa de `tasks.md` apunta R39 al archivo equivocado.**
Dice `tests/unit/services/cierre-bodega-service.test.ts`; el test vive en
`tests/unit/services/cierres-bodega-admin-service.test.ts:654`. El archivo nombrado existe y
tiene **0** menciones a la 238, así que el puntero es falso, no ambiguo. La nota de T5.1 sí
documenta la corrección — sólo faltó bajarla al mapa. En la misma línea: la fila de **R3** del
mapa anota el test **del servicio** como el que la mutación T5.4 mata, y mi medición demuestra
que es justo el que **sobrevive**. Son la misma corrección sin propagar.

**m3 · menor — `requirements.md` no recoge el caso mixto de R31.**
La corrección de la guía repetida se anotó en `design.md` §5.3 pero **R31 sigue con su texto
original**, que leído al pie de la letra pediría avisar también cuando la guía casa una fila que
no vuelve **y** otra que sí. El comportamiento nuevo es el correcto (y tiene su caso), pero el
requisito debería decirlo, que es donde alguien lo va a leer dentro de seis meses.

**m4 · menor — la unicidad de `num_guia` es la premisa del arreglo y no está citada.**
«Una lectura confirma todas las filas de esa guía» es correcto **porque `orden.numGuia` es
`@unique`** (`db/schema.prisma:484`). Si esa unicidad desapareciera, el arreglo pasaría de
correcto a agujero —una lectura confirmaría paquetes distintos— y **nada lo avisaría**. Merece
una línea en el comentario de `interpretarLectura` / `clavePaquete`, y quizá una guardia.

**m5 · menor — el comentario de R20 insinúa más cobertura de la que la pareja da.**
Sus dos viñetas describen, juntas, un caso que **ninguna de las dos invariantes ve**: un `UPDATE`
con `now()` sobre gestiones de cierres **ya aprobados**. Ese caso es indistinguible por
construcción de una aprobación legítima, así que no es un defecto del test; lo que sobra es la
insinuación. La conclusión que el comentario firma («ninguna de las dos basta sola») sí es cierta.

**m6 · menor — la evidencia de R41 vía `cierres-admin-caja-cod.test.ts` es más débil de lo que
suena.** Esa suite pasa `confirmacionFisica: []`, así que el bloque nuevo **nunca se ejecuta**
allí: no puede ponerse roja por él, y «verde sin tocar» no demuestra que el bloque aterrizó en el
sitio correcto. Quien de verdad lo demuestra es el caso de orden del propio archivo de la 238
y el de `wallet-idempotencia`. El diseño ya avisa de esto en §4.1; sólo conviene que R41 no se
apoye en la pata floja.

**m7 · menor — un texto visible sin test.**
`CONFIRMACION_DETALLE` («Antes de aprobar, tené delante cada paquete que vuelve a bodega y
confirmá su guía: escaneá el código o escribí el número.») es el único string de la feature sin
aserción literal. Un humano lo leyó en pantalla (`recorrido_238.md` §2), que es mejor que nada,
pero es justo el tipo de texto que se rompe en un refactor sin que nadie lo note.
*Fuera del alcance de la 238, misma familia*: `MSG_INDEMNIZACION_AJENA` y
`MSG_INDEMNIZACION_DUPLICADA` (158) tampoco tienen literal en ningún test. **No** los tocó esta
ficha, así que no es regresión suya; queda anotado porque el barrido lo encontró.

**m8 · menor — numeración del spec.**
`requirements.md` y `tasks.md` se anuncian como «R1-R42» en sus encabezados; los requisitos llegan
a **R44**. Cosmético, pero el encabezado es lo que se lee para saber cuántos hay.

---

## Qué queda fuera de este veredicto, y a quién remite

El `OK` cubre **el código, los tests y la trazabilidad**. Estas cinco cosas **no** las verifiqué y
no puedo firmarlas:

1. **`./init.sh` completo, con el árbol quieto.** No lo corrí, por encargo. → **el humano**, antes
   del PR. Sin ese verde el checkpoint «Verificación final» no está cumplido, y esta revisión no
   lo sustituye: corrí typecheck, lint, guardias y 28 archivos de test, pero **no** la suite
   entera.
2. **`pnpm test` completo.** Ídem. Lo que sí puedo decir es que ninguna de las suites que el
   diseño marcó como «rojo por diseño» o «rojo = regresión» está roja.
3. **T6.3 — cerrar la ficha.** `feature_list.json` sigue en `in_progress`; falta el `status_note`
   final y falta **la entrada en `progress/history.md`** (grep: no hay ninguna para la 238). Los
   dos son checkpoints explícitos. → **el leader**.
4. **T0.3 — avisar a bodega.** Sigue `[ ]`. Ya no bloquea el despliegue (0 cierres en cola cuando
   se midió), pero **esa medición caduca**: un cierre `solicitado` aparece en cuanto un mensajero
   cierre su día. **Re-medir justo antes de desplegar**, no antes de mergear. → **el humano**.
5. **El SHA del pre-vuelo.** Medí contra `origin/dev` = `fc17148e`. `dev` se mueve; **volver a
   comparar justo antes de abrir el PR**.

Y una que no es tarea de nadie, sino una consecuencia aceptada que conviene tener escrita: **D2 no
tiene escapatoria y eso está bien**, pero encadenado con la 239 **aumenta** la probabilidad de que
haya devoluciones congeladas en `devolucion_por_confirmar`. La consulta de población atascada de
`specs/239-devolucion-espera-cierre/design.md` §12 pasa a vigilar las dos fichas. No es deuda de
la 238: es el riesgo 1 que las dos comparten y que la 238 refuerza — y ya está anotado en el §13
de la 239.

---

## Nota de método

Cuatro mutaciones, una a la vez, cada una aplicada con un script escrito **a archivo** (nunca
`node -e`: ahí el escapado se come una capa) y con guardia de coincidencia única, cada una con la
salida real de vitest leída y citada, y cada una restaurada y verificada por `sha256` **antes** de
pasar a la siguiente. Al terminar, `git status` sólo muestra este acta y `git diff` está vacío.
