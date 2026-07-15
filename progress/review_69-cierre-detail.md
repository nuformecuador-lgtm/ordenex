# review 69 — cierre_detail · veredicto

> Rama `feature/69-cierre-detail` (PR #77 a `dev`), HEAD `8a4566d`.
> Spec: `specs/69-cierre-detail/` (R1–R30, 23 tasks). Bitácora: `progress/impl_69-cierre-detail.md`.
> **Todo número de aquí está MEDIDO por el reviewer**, no citado. Un baseline citado no es un
> baseline medido.

## Veredicto: **RECHAZADO**

3 bloqueantes. **Ninguno es un bug de dinero**: el núcleo money-critical de la feature está
verificado y es sólido (ver §Lo que se verificó y AGUANTA). Los tres son de **contrato** (R15),
de **arnés** (`./init.sh`) y de **bookkeeping** (`tasks.md`). El código de producción no necesita,
hasta donde alcanza esta revisión, ningún parche por descuadre.

---

## Checklist CHECKPOINTS.md

### Especificación
- [x] `requirements.md` con EARS numerados R1–R30.
- [x] `design.md` con alternativas descartadas y su porqué (§7.1: (b1)/(b2)/(b3) evaluadas en serio).
- [ ] **`tasks.md` con todas las tasks marcadas** → **0 de 23 marcadas**. BLOQUEANTE 2.

### Trazabilidad
- [x] Cada `R<n>` mapea a >=1 test concreto: verificado uno a uno; ninguno vacío.
- [x] `progress/impl_<feature>.md` contiene el mapa `R<n> -> test`.
- [~] **R15: cobertura PARCIAL** (el propio implementer lo declara). BLOQUEANTE 1.

### Calidad de código (MEDIDO por el reviewer)
- [x] `pnpm typecheck` -> **0 errores**, exit 0 (baseline declarado 2 -> 0: confirmado).
- [x] `pnpm lint` -> **0 errores**, 274 warnings preexistentes, exit 0.
- [x] `pnpm build` -> **VERDE**, Compiled successfully in 12.7s, 25/25 páginas.
- [x] `pnpm test --testTimeout=30000` -> **301/301 archivos · 2842/2842 tests · exit 0**.
- [~] E2E: la feature toca recaudo/pagos. No se añadió E2E; los flujos tienen cobertura
      preexistente (`e2e/cierres-admin.spec.ts`, `e2e/cierre-dia.spec.ts`, `e2e/wallet.spec.ts`).
      No se ejecutaron en esta revisión (requieren servidor). Aceptable, ver menor 4.

### Datos y seguridad
- [x] RLS activada sobre `cierre_detail` **sin policies** (`migration.sql:91`). El test afirma la
      ausencia de CREATE POLICY sobre el SQL **sin comentarios**: metodología correcta.
- [x] `down.sql` presente y coherente (DROP TABLE IF EXISTS cierre_detail: arrastra unique,
      índice, 5 FKs y RLS; migración aditiva, nada más que restaurar).
- [x] Sin secretos hardcodeados. Sin webhooks nuevos.

### Patrón de capas
- [x] El resolver es sólo query Prisma. `cierre-detalle.ts` es lectura + proyección; la fórmula
      sigue en `ingreso-ordenex.ts` (**no tocado en T6-T21**: R21 verificado por ausencia de diff).
- [x] Los services no conocen HTTP. Interfaces en `lib/interfaces/` por categoría.

### Verificación final
- [ ] **`./init.sh` en verde** -> **ROJO**. BLOQUEANTE 3 (causa: flaky de arnés preexistente).
- [x] `progress/review_<feature>.md` existe (este archivo).
- [ ] `progress/history.md`: pendiente del leader (T22, fuera del alcance del implementer).

---

## Lo que se verificó y AGUANTA

### 1. T19, el corazón: REPRODUCIDO

Se restauraron los feeds pre-T14 desde git (`6dc6f55`, padre de `7f16fc8`) en un **worktree
aislado** y se corrió `tests/integration/db/cierre-detail-congelado.test.ts`:

- Contra HEAD: **VERDE 3/3**.
- Contra pre-T14: **ROJO 3/3**, con **exactamente** los tres fallos que declara la bitácora:
  - AssertionError: expected undefined to be 500.00 -> R17: orden re-apuntada a t2, el dinero desaparece.
  - AssertionError: expected 7777.00 to be 1000.00 -> R18: liquidaba con la tarifa nueva.
  - AssertionError: expected undefined to be 1000.00 -> tarifa borrada, liquidaba en cero.

**El test muerde de verdad.** El montaje es honesto: `gestionOrden.findMany` resuelve la relación
`orden` contra las filas VIVAS (como un JOIN real), así que un lector que vuelva a mirar datos
vivos lo pone rojo. La feature vale lo que vale este rojo, y el rojo existe.

*Precisión (menor 1):* la bitácora dice "el **mismo** test con el **mismo** harness". No es exacto:
los feeds pre-T14 reciben `tarifaRepo` por constructor, así que hubo que adaptar **2 líneas de
construcción** (`new WalletFeedService(new TarifaVigentePorTiendaRepository(prisma))`). El cuerpo y
las aserciones del test no se tocaron. La sustancia se sostiene.

### 2. Guarda (g) / backfill: coinciden AL CARÁCTER

- Resolver (`TarifaVigentePorTiendaRepository.ts:71-73`): `where: { tiendaId, deletedAt: null }`,
  `orderBy: { createdAt: "desc" }`, `findFirst`.
- Backfill (`migration.sql:140-145`): WHERE ta."tienda_id" = o."tienda_id" AND ta."deleted_at"
  IS NULL ORDER BY ta."created_at" DESC LIMIT 1.
- **Ninguno menciona `status`.** El batch (`:91`) tampoco. Fijado por test en los **tres** sitios
  (`TAR` con `toEqual` exacto del `where`: añadir `status` lo rompe; `M` sobre el SQL sin comentarios).
- La (g) **no se trata como hallazgo**: está decidida, documentada, y el marcador TODO de R30
  declara las 4 piezas exigidas y sale por feature 70.

Un cierre backfilleado y uno nuevo liquidan **igual**. No hay money bug por esta vía.

### 3. Grano (R2)

Dedupe por `ordenId` (`CierreDiaRepository.ts:326-329`), Map first-wins. Test: 3 gestiones
(o1, o1, o2) -> **2 filas** (o1, o2). Muerde.

### 4. Inmutabilidad (R10) y punto de escritura

- grep sobre `lib/`: **0** escrituras `cierreDetail.update*/delete*/upsert`. Único `createMany`:
  `CierreDiaRepository.ts:338`. El test estructural fija ambas cosas y además que el modelo no
  expone `updated_at`/`deleted_at`.
- La escritura ocurre **dentro de la `$transaction`** y **después** del `updateMany` que vincula, y
  lee **lo que la tx vinculó** (`tx.gestionOrden.findMany({ where: { cierreId: cierre.id } })`,
  `:317-320`), **no** la lista del service. Correcto y bien razonado: elimina por construcción la
  carrera "gestión creada entre la lectura del service y la tx".

### 5. Money-safe

- `montoCobrar` se copia como `Decimal` en origen (sin pasar por number) y sale `toFixed(2)` en el
  feed. Resolver: `toFixed(2)` en los 7 campos. **Cero** `parseFloat` / `Number(` sobre montos en el
  código nuevo (verificado por grep).
- Excepción menor: ver menor 2 (`tarifaDe` usa `.toString()`).

### 6. R27, invariante del backfill: SÓLIDO (se auditó el borde)

Riesgo evaluado: el backfill filtra `anulada_at IS NULL`, pero los feeds leen
`gestionOrden.findMany({ where: { cierreId } })` **sin** ese filtro -> una gestión anulada con
`cierre_id` dejaría una orden sin fila y, sin fallback (R14), **abortaría la aprobación**.
**No es alcanzable:** la anulación está guardada por `cierreId: null` (`CierreDiaRepository.ts:469`)
y `crearCierre` sólo vincula `anuladaAt: null` (`:271`). Una gestión anulada nunca lleva
`cierre_id`, ni antes ni después. El invariante se sostiene.

### 7. Migración y drift de db:migrate: ACEPTABLE

El drift de checksum en `20260714123909` es **preexistente** (no lo causa la 69). `CHECKPOINTS.md`
exige que **`pnpm run db:rollback` funcione**, y `docs/verification.md:28` pide "aplicando y
revirtiendo en un entorno de prueba": **no** exigen `prisma migrate dev`. El round-trip con
`migrate deploy` + `db:rollback` **satisface ambos**. Se acepta. (Deuda de arnés: menor 3.)
*No verificado por el reviewer* (sin acceso a la base): se acepta la evidencia del implementer,
que es específica y falsable (`relrowsecurity=true`, 5 FKs, 0 policies, y el error del DOWN).

---

## Hallazgos

### BLOQUEANTE 1 — R15 incumplido: CierresBodegaAdminRepository sigue mostrando datos VIVOS

**Verificado, y la desviación 1 del implementer es FACTUALMENTE CORRECTA:**

- `design.md:238` afirma: *"Consumidores de WITH_DETALLE verificados: sólo CierreDiaRepository y
  CierresAdminRepository."* -> **FALSO**. `CierresBodegaAdminRepository.ts:14` lo importa y `:102`
  lo consume.
- Ese `findMany` (`where: { cierreId: cd.id }, ...WITH_DETALLE`) navega `gestion_orden.orden.*`
  **vivo**, para los `cierre_dia` **ya creados** (y ya consolidados en un `cierre_bodega`:
  típicamente ya aprobados y liquidados).

**Veredicto sobre la pregunta que se me pidió decidir: es incumplimiento de R15, no alcance
legítimo de una feature aparte.** Argumento:

1. **El texto de R15 la alcanza, y el texto es el contrato.** R15: *"CUANDO un administrador
   consulta el detalle de un cierre ya creado, el sistema DEBE mostrar los datos congelados de ese
   cierre y NO los valores vivos de la orden."* Sin condición ni acotación. Un admin de bodega
   consultando el detalle de un `cierre_dia` ya creado es exactamente el antecedente.
2. **El único sitio que acota R15 a `findCierreByIdEnAlcance` es design.md §4.4 — y su premisa está
   PROBADA FALSA.** Un design no puede estrechar un requisito aprobado; menos aún apoyándose en un
   censo de consumidores incorrecto. Si el design fuera la fuente de verdad, cualquier requisito se
   cumpliría por el método de mirar en menos sitios.
3. **La 69 EMPEORA la coherencia en este punto concreto.** Antes: las dos vistas de admin leían
   vivo -> uniformemente equivocadas, pero **consistentes entre sí**. Ahora:
   `findCierreByIdEnAlcance` congelado y la vista de bodega viva -> **dos pantallas de admin
   muestran detalle DISTINTO del MISMO cierre cerrado**. Es una divergencia **nueva**, introducida
   por aplicar la feature a medias. No es "una deuda vieja que la 69 no tocó".
4. **Atenuante real, y pesa: NO mueve dinero.** Los feeds ya leen el snapshot; esto es display
   (descriptivos: guía, destinatario, nombres de zona/tienda/producto). No hay descuadre. Por eso es
   bloqueante de **contrato**, no de **dinero**, y el arreglo es acotado.

El implementer hizo lo correcto: lo detectó, no lo parcheó por su cuenta y lo escaló. Y
`requirements.md` §7 es explícito: *"Cualquier desviación respecto de lo escrito aquí exige una
nueva gate: no se decide en implementación."* **Tampoco la decide el reviewer.**

**Qué falta para cumplirlo. Dos salidas, ambas legítimas, las dos requieren al HUMANO:**

- **(A) Entra en la 69:** componer el snapshot en `CierresBodegaAdminRepository.findCierreBodegaById`
  igual que hizo T18 (el patrón ya existe: `toPendienteRowDesdeSnapshot` + `byOrden`). Coste bajo.
  Necesita test análogo al de CAR sobre descriptivos desde el snapshot.
- **(B) Va a feature aparte:** entonces hay que **corregir design.md:238** (hoy es una afirmación
  falsa en un documento aprobado) y **enmendar el texto de R15** para acotarlo explícitamente al
  detalle del `cierre_dia`, dejando registrada la vista de la 40 como salida. Sin esa enmienda, R15
  queda incumplido por escrito y el checkpoint de trazabilidad no cierra.

### BLOQUEANTE 2 — tasks.md: 0 de 23 tasks marcadas

`CHECKPOINTS.md` §Especificación: *"Existe specs/<feature>/tasks.md y todas las tasks estan marcadas
[x]."* Medido: 0 tasks marcadas; 23 sin marcar.

Es **clerical**, no sustantivo: la bitácora tiene la tabla de estado con T1-T21 en verde y el
trabajo está hecho y verificado. Pero el checkpoint es literal y se valida contra esta lista.
**Qué falta:** marcar T1-T21 + T2b (T22 es del leader). 1 minuto.

### BLOQUEANTE 3 — ./init.sh ROJO (arnés, no código de la 69)

`CHECKPOINTS.md` §Verificación final y **R29** exigen `./init.sh` en verde; T21 lo define como "la
definición de hecho aquí". `init.sh:80-82` corre typecheck, lint y test, y `pnpm test` usa el
testTimeout default de 5000ms.

**Medido por el reviewer:** con `--testTimeout=30000` -> **2842/2842, exit 0**. Con el default, el
leader midió 1 rojo (HomePage) y el implementer 12-15, **todos** por timeout de 5000ms, con el
conjunto cambiando entre corridas del **mismo** commit. La lectura del implementer es correcta y
está bien argumentada: un fallo real es determinista y no se arregla subiendo el timeout; éste no lo
es y se arregla. No es de la 69 (su alcance es backend; los archivos flaky son de UI).

Se registra como bloqueante porque **el checkpoint literal no pasa** y R29 es criterio de aceptación
explícito, **no** porque la feature esté mal. **Qué falta** (decisión del leader/humano, no del
implementer): subir `testTimeout` en la config de vitest para que `init.sh` sea interpretable, o
registrar formalmente la excepción. Mantener un init.sh rojo "que ya sabemos por qué es" es cómo se
pierde la única puerta que queda.

---

## Menores (deudas, no bloquean)

1. **La bitácora sobrevende la reproducción de T19.** Dice "el **mismo** test con el **mismo**
   harness"; en realidad hubo que adaptar 2 líneas de construcción (los feeds pre-T14 reciben
   `tarifaRepo`). Las aserciones no se tocaron y el rojo es genuino (reproducido 3/3). Imprecisión
   de redacción, no de resultado.
2. **`tarifaDe` (`lib/utils/cierre-detalle.ts:75-82`) usa `.toString()`, no `.toFixed(2)`.** R11
   pide escala 2 al cruzar la frontera, y el resolver de al lado sí usa `toFixed(2)`: un
   Decimal 1000.00 sale como "1000". **Sin impacto en dinero**: `derivarIngresoOrden` re-envuelve en
   `Prisma.Decimal` (`ingreso-ordenex.ts:60,63,71`), así que la aritmética es exacta. Es
   inconsistencia con la letra de R11. Alinear a `toFixed(2)`.
3. **Deuda de arnés: `pnpm db:migrate` inutilizable** por drift de checksum preexistente en
   `20260714123909`. No lo causa la 69 y no bloquea (los checkpoints exigen `db:rollback`, que
   funciona), pero debería registrarse como deuda con dueño: la próxima feature con migración se lo
   come igual.
4. **Sin E2E nuevo** para un cambio en recaudo. Los flujos tienen cobertura preexistente y el cambio
   es de **procedencia** del dato (no de UI ni de contrato HTTP), así que se acepta. No se
   ejecutaron los E2E en esta revisión.
5. **Convención rota (ya declarada): un commit por task.** T19 quedó dentro del commit de T17
   (`a536c11`) por un `git add -A`. Reportado en vez de disimulado, historia no reescrita. Correcto
   así.
6. **design.md:238 queda como afirmación falsa en un documento aprobado.** Se corrija o no el código
   (BLOQUEANTE 1), **esa línea hay que arreglarla**: es exactamente el tipo de "hecho verificado"
   que la próxima feature va a citar sin re-medir.

---

## Nota de método

Se re-midieron todas las puertas de forma independiente (typecheck / lint / build / test) y
coinciden con lo reportado por leader e implementer. La reproducción de T19 se hizo en un **worktree
aislado** para no tocar el árbol del usuario; el árbol quedó limpio y `node_modules` intacto
(verificado). Una corrida de la suite **dentro del worktree** dio 2 fallos que **no** se reproducen
en el repo real (301/301, 2842/2842): son artefactos del montaje del worktree, no de la feature. Se
descartan y se toma la medición del repo real como autoritativa.

**El núcleo money-critical de esta feature está bien hecho y bien probado. El rechazo es por R15,
no por el dinero.**
