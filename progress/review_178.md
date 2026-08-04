# Review — Feature 178 (purga diaria de los PDF de cargas antiguas)

Rama revisada: `feature/178-purga-pdf-cargas`. Diff: `git diff origin/dev...HEAD`
(23 archivos: 14 creados + `vercel.json`, `.env.example` y bookkeeping).
Revisor: solo lectura. No se edito codigo, ni `feature_list.json`, ni `progress/current.md`,
ni se ejecuto ningun comando git de escritura.

## VEREDICTO: **RECHAZADO** — 1 bloqueante (R22)

Todo lo demas esta bien construido: la seleccion, el borrado, el efecto en base de datos y la
integracion con la 177 (R16) son correctos y estan medidos con tests que discriminan de verdad.
El bloqueante es unico, acotado y de arreglo pequeño, pero incumple un requisito explicito y
ademas quedo *fijado* por un test.

---

## Checklist (CHECKPOINTS.md)

### Especificacion
- [x] `specs/178-purga-pdf-cargas/requirements.md` con 26 requisitos EARS numerados.
- [x] `design.md` con alternativas descartadas y su porque.
- [x] `tasks.md`: 26 de 26 tasks marcadas `[x]` (26 `[x]`, 0 `[ ]`).

### Trazabilidad
- [x] Los 26 `R<n>` mapean a un test concreto. **Los 26 verificados abriendo el test citado**,
      no la tabla.
- [x] `progress/impl_178.md` contiene el mapa `R<n> -> test` completo.
- [ ] **R22 mapea a tests que NO miden el requisito** (BLOQUEANTE 1).

### Calidad de codigo
- [x] `pnpm typecheck` sin errores (via `./init.sh --rapido`).
- [x] `pnpm lint` sin errores (41 warnings preexistentes, ninguno en archivos de la 178).
- [x] Tests: los 6 ficheros de la feature corridos por el revisor -> **65/65 verdes**.
      `./init.sh --rapido` corrido por el revisor: cambiados 6 ficheros / 65 tests + guardias
      46 ficheros / 672 tests, todo verde, `== init OK ==`.
      Gate COMPLETO: lo corrio el leader (869 archivos / 10877 tests, 0 rojos); no se repite.
- [x] E2E: no aplica. Cron de mantenimiento sin UI; no entra en los flujos criticos listados.

### Datos y seguridad
- [x] Sin tablas nuevas -> no hay RLS nueva que exigir; la migracion no toca RLS (test lo afirma).
- [x] Migracion versionada con `migration.sql` + `down.sql` simetrico e inverso.
      **PARCIAL / NO MEDIDO:** ver menor 4.
- [x] Sin secretos hardcodeados. Se reutiliza `CRON_SECRET` via `loadCronConfig()`; no hay env
      de secreto nueva. `.env.example` documenta las dos claves sin valor.
- [x] No hay webhook nuevo. El cron valida `Bearer` y es idempotente (R8/R20 verificados).

### Patron de capas
- [x] Controller (`app/api/cron/purga-pdf-cargas/route.ts`): solo HTTP + auth + composition root.
- [x] Service: no conoce `Request`/`Response`.
- [x] Repository: solo queries Prisma.
- [x] Interfaces en `lib/interfaces/repositories/` y `lib/interfaces/services/`.

### Multi-pais / configuracion
- [x] Sin hardcode de pais/moneda/cuenta. La hora del cron va en UTC con la conversion a CR
      documentada (CR es UTC-6 fijo).

### Verificacion final
- [x] `./init.sh --rapido` verde (el completo, verde por el leader).
- [ ] Veredicto OK -> **no**: RECHAZADO.
- [x] Entrada en `progress/history.md` (la de la 178 la cierra el leader).

---

## Trazabilidad verificada: 26 / 26 R abiertos uno a uno

Convencion: **MIDE** = el test se pone rojo si el requisito se rompe; **INDIRECTO** = cubre el
contrato, pero la garantia fuerte vive en otra capa.

| R | Veredicto | Nota del revisor |
|---|---|---|
| R1 | MIDE | `purga-pdf-config.test.ts`: env `"1"` -> 1. |
| R2 | MIDE | ausente / `""` / `"abc"` / `"-1"` -> 7, los cuatro casos. |
| R3 | MIDE | `"0"` -> 0 **y** `not.toBe(7)`; `"36500"` -> 36500 (sin clamp). Discriminante frente al `readPositiveInt` copiado en `jobs.ts`/`etiquetas.ts`, que mandaria el 0 al default. |
| R4 | MIDE | (a) el modulo no exporta nada que no sea funcion y sus claves son exactamente `["loadPurgaPdfConfig"]`; (b) dos llamadas con env distinta -> ventanas distintas; (c) la ruta pasa `loadPurgaPdfConfig` **por referencia** (`expect(leerConfig).toBe(loadPurgaPdfConfig)`), no su resultado. |
| R5 | MIDE, en el repositorio (que es donde importa) | Sobre el `where` real: `Object.keys(where.createdAt)` === `["lte"]` (mata el off-by-one `lt` y cualquier segundo operador), `lte` === el corte recibido, y `JSON.stringify(where)` sin `fechaCarga`/`fecha_carga` ni anidado. Mas `orderBy createdAt asc` y `take` === limite. |
| R6 | MIDE | Service con fixture de N-1 / N / N+1 dias; el doble aplica el filtro REAL, la de N-1 no recibe `remove` ni `limpiarReferencias` y conserva sus rutas. No es tautologico. |
| R7 | MIDE | Agrupacion con 2 cargas y 5 filas de orden (incluida una con ruta null y otra con `cargaId` null): resultado exacto por `toEqual`. |
| R8 | MIDE | `OR` de 3 ramas leido del `where` real (2 columnas de carga + `ordenes.some`); y la 2a corrida no encuentra candidatas. |
| R9 | MIDE, doble via | Lectura: el `where` de `orden.findMany` no contiene `deletedAt` (ni serializado). Escritura: el `where` del `updateMany` es exactamente `{ cargaId }`. |
| R10 | MIDE | Una sola llamada a `remove` por carga, con consolidado + las 3 rutas, en orden, por `toEqual`. |
| R11 | MIDE (mecanismo de mutacion verificado) | El doble de `SupabaseFileStorage` **no reproduce el default** del 2o parametro, asi que omitirlo deja `args` de longitud 1 -> rojo. Ademas guardia `ETIQUETAS_BUCKET !== postulacionConfig.BUCKET` para que el test no se vuelva vacuo si alguien igualara los buckets por env. |
| R12 | MIDE | Carga elegible sin rutas: `remove` no se invoca **en absoluto** (no "con lista vacia"), pero si se limpia. |
| R13 | MIDE | `data` de `carga.update` con conjunto EXACTO de claves `{downloadUrl, downloadStoragePath}` a null, y `where { id }`. |
| R14 | MIDE | Idem para `orden.updateMany`, y ambos dentro de UNA `$transaction` (orden de llamadas comprobado). |
| R15 | MIDE | Conjunto exacto de claves del `data` (una columna de mas -> rojo) + `delete`/`deleteMany` nunca invocados. |
| **R16** | **MIDE — el mejor test del lote** | Analisis dedicado abajo. |
| R17 | INDIRECTO en service, **FUERTE en el repositorio** (verificado) | El `where` del `updateMany` es `{ cargaId: "<uuid>" }` (igualdad: en SQL una fila con `carga_id IS NULL` jamas casa) y la lectura usa `cargaId: { in: [...] }` (`IN` nunca casa NULL). Ademas el agrupador descarta explicitamente `o.cargaId === null`, y el test de R7 mete una fila `cargaId: null` que no aparece en el resultado. La garantia SQL existe. |
| R18 | MIDE | `vercel.json` leido de disco: path + `"0 9 * * *"`, forma diaria (5 campos), y ninguna otra franja `minuto hora` diaria coincide — con control previo `otrosDiarios.length > 0` para que la asercion no sea vacua. |
| R19 | MIDE | Si `remove` lanza: no se limpia, el error se propaga, `remove` se invoco **una sola vez** (sin reintento) y la fila conserva su ruta -> sigue siendo candidata mañana. |
| R20 | MIDE | Orden `remove` -> `limpiar` por log compartido **y** por `invocationCallOrder`; segunda corrida sobre el estado ya mutado: 0 llamadas. |
| R21 | MIDE | Config (default 200; `""`/`"abc"`/`"0"`/`"-10"` -> 200) + service (tope propagado a las dos consultas y exactamente `tope` cargas procesadas). |
| **R22** | **NO MIDE — el test fija el comportamiento equivocado** | BLOQUEANTE 1. |
| R23 | MIDE | 200 con resumen; `quedaPendiente: true` propagado; reloj inyectado pasado **crudo**; si el service lanza -> >= 500 sin filtrar secreto ni ruta, con el logger invocado. |
| R24 | MIDE | Resumen solo numerico + un bool; `JSON.stringify` sin ninguna cadena (`not.toMatch(/:\s*"/)`) y sin los ids/rutas del fixture. |
| R25 | MIDE, con el listado exigido | Los 5 casos: sin header, token incorrecto, secreto `null`, secreto `""`, y **`GET` real** sin header / sin `CRON_SECRET` afirmando que **no se construye NADA** (`prismaCtor`, `repoCtor`, `storageCtor`, `serviceCtor`, `ejecutar` sin invocar). "Ni una lectura" queda demostrado. |
| R26 | MIDE en estatico; **la mitad empirica NO MEDIDA** | 12 casos sobre el SQL ejecutable (comentarios excluidos): UP = exactamente 2 `CREATE INDEX`, ambos PARCIALES con su `WHERE` literal, tabla/columna exactas, cero DDL sobre datos, sin `CONCURRENTLY`; DOWN = 2 `DROP INDEX` en orden inverso **derivado del UP** (`[...upNombres].reverse()`), sin otro DDL; carpeta con ambos ficheros y timestamp pineado posterior al previo. Falta lo no ejecutable: ver menor 4. |

---

## Analisis dedicado: R16 (lo que justifica media feature)

**Cumple, y el control no es vacuo.** Verificado abriendo
`tests/integration/purga-pdf-regenera-177.test.ts` y siguiendo el estado de datos:

1. `PurgaPdfCargasRepository.limpiarReferencias` pone a NULL **`downloadStoragePath` Y
   `downloadUrl`**, en `carga` (`update`) y en `orden` (`updateMany`), en la misma transaccion.
   Es exactamente el testigo que mira `ApiPdfEtiquetaService` (`:50-51` orden, `:90` carga).
   Confirmado leyendo ambos ficheros, no la bitacora.
2. El test comparte **un unico objeto de estado** entre el doble de Prisma que consume el
   repositorio REAL de la 178 y el doble de `IOrdenRepository` que consume el
   `ApiPdfEtiquetaService` REAL de la 177: las filas que muta la purga son literalmente las que
   lee `/generate` despues. No son dos dobles independientes, que es como este tipo de test se
   vuelve falso.
3. El "bucket" es un `Set` compartido entre el `remove` de la purga y el generador: el test
   afirma que el objeto original **dejo de existir** y que lo firmado es un objeto **subido en
   esa misma llamada** (`objetos.has(rutaGenerada) === true`), no una expectativa hardcodeada.
4. **Discriminacion verificada por razonamiento cerrado sobre el codigo**, no por confianza en
   la bitacora: si `limpiarReferencias` dejase `downloadStoragePath` con valor, los dobles
   `findDownloadStoragePathByOrdenForOwner` / `findCargaConOrdenesForOwner` devolverian la ruta
   vieja, el service re-firmaria y `jsonCarga.generado` seria `false` -> rojo en la linea 484.
   No existe camino por el que el test pase con esa mutacion. Coincide con las dos mutaciones
   que el implementer reporta sobre la forma FINAL del test.
5. **T24 no es vacuo:** antes de la purga afirma `generado: false`, que la URL firmada apunta a
   la ruta ORIGINAL y que el generador **no** se invoco (`rutasGeneradas === []`). Sin el, T23
   pasaria aunque la purga no hiciera nada; con el, "no hacer nada" pone T23 en rojo.
6. El doble de Prisma **lanza** ante cualquier filtro o columna de `data` que no conozca
   (`aplicarData` incluida): si mañana el repo emite un filtro nuevo o toca una columna de mas
   (violando R15), el test revienta con un error explicito en vez de volverse laxo.

Unico matiz, no hallazgo: el test no afirma explicitamente que `downloadUrl` quede a NULL; eso
lo cubre el test de repositorio con conjunto exacto de claves (R13/R14). Cobertura suficiente
entre los dos.

## Analisis dedicado: el `where` del borrado irreversible

Revisado **en el repositorio, donde vive**, no solo en el service:

- `whereCandidatas(corte)` = `{ createdAt: { lte: corte }, OR: [ 3 ramas de referencia viva ] }`.
  En Prisma los campos de primer nivel y `OR` se combinan con AND: no hay forma de que una
  carga fuera del corte entre por la puerta del `OR`.
- `lte` (corte inclusivo, decision (f)); el test lo blinda con
  `Object.keys(where.createdAt) === ["lte"]`, que rompe tanto ante `lt` como ante un segundo
  operador colado.
- El corte se calcula **una sola vez** por corrida y las dos consultas comparten el helper
  `whereCandidatas`: seleccion y comprobacion de pendiente no pueden divergir en el predicado.
- Las rutas de orden solo se leen con `cargaId: { in: cargaIds }`, es decir, unicamente de las
  cargas ya seleccionadas, y el agrupador indexa por un `Map` prellenado solo con esos ids:
  **ninguna ruta de una carga fuera del corte puede llegar a `remove`**.
- N = 0: `corte = now`, verificado en el service (`toEqual(NOW)`), y la carga creada esa misma
  mañana entra. Negativo / no numerico / ausente -> 7, los cuatro casos medidos.

Conclusion: **el borrado no puede alcanzar objetos de cargas que no cumplen el corte.**

## Aislamiento del cron

- `middleware.ts:32` — `SELF_AUTH_ROUTES = ["/api/cron", ...]` y `:47` devuelve `next()` por
  prefijo: `/api/cron/purga-pdf-cargas` pasa igual que los otros cinco crons, sin tocar nada.
- El guard de `handlePurgaPdfCargas` corre **antes** de `withErrorHandler` y antes de
  `buildService()`: con secreto ausente, vacio o incorrecto no se construye Prisma, ni el repo,
  ni el storage, ni se invoca el service. Verificado en el codigo y afirmado sobre el `GET` REAL
  en dos tests. **Sin secreto no ejecuta ni una lectura: cumple.**
- Desviacion deliberada y correcta respecto del clon `procesar-devueltas-sla`: se añade
  `expected === ""` al guard (defensa en profundidad; `loadCronConfig` ya mapea `""` a `null`).

---

## Hallazgos

### BLOQUEANTE 1 — R22: `quedaPendiente` reporta `false` habiendo trabajo pendiente

`PurgaPdfCargasService.ejecutar` llama a `repo.quedanCargasPurgables(corte, tope)` **despues**
del bucle de purga (`lib/services/PurgaPdfCargasService.ts:85`; asi lo prescribe tambien
`design.md:251`, paso 5). Pero `quedanCargasPurgables` hace
`findFirst({ where: whereCandidatas(corte), skip: limite, take: 1 })`
(`lib/repositories/PurgaPdfCargasRepository.ts:96-105`), con el comentario "saltando las
`limite` ya devueltas".

Esa premisa es falsa **justo por lo que hace la feature**: las `limite` cargas ya procesadas
perdieron su referencia viva, asi que ya **no casan** `whereCandidatas` y no estan entre las
filas que `skip` deberia saltar. El `skip: limite` descuenta entonces un segundo lote de
candidatas que SI siguen pendientes.

Consecuencia medible: siendo `P` las candidatas al inicio y `L` el tope,
**para todo `L < P <= 2L` la corrida responde `quedaPendiente: false` aunque queden `P - L`
cargas sin purgar.** Con el default `L = 200`, cualquier backlog de entre 201 y 400 cargas
miente. R22 exige lo contrario: "dejar constancia de que quedo trabajo pendiente".

**Reproducido por el revisor** (script desechable en el scratchpad, fuera del repo; no se
modifico ni un archivo del proyecto), con el `PurgaPdfCargasService` y el
`PurgaPdfCargasRepository` REALES sobre un doble de Prisma con estado mutable, 3 candidatas y
tope 2:

```
cargasPurgadas 2 · restantes reales 1 · quedaPendiente false
AssertionError: expected false to be true
```

Por que los tests verdes no lo vieron:

- `tests/unit/services/purga-pdf-cargas-service.test.ts` (`R21/R22`) usa **5** candidatas con
  tope **2**: quedan 3 > 2, asi que sale `true` por el margen, no por correccion. Con 3
  candidatas y tope 2 ese mismo test se pondria rojo.
- El doble del repo en ese test implementa `candidatas(corte).length > limite`, que **reproduce
  fielmente la semantica equivocada** del repositorio real: por construccion no puede detectarla.
- `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` afirma `expect(arg.skip).toBe(200)`:
  **fija el bug como contrato**.

Que falta para cumplir R22 (no lo arregla el reviewer):

1. Que la comprobacion de pendiente refleje el estado **post-purga**: lo natural es
   `quedanCargasPurgables(corte, 0)` tras el bucle (o un `existeAlgunaCandidata(corte)` sin
   `skip`); alternativa: evaluarla **antes** del bucle si se quiere conservar `skip: limite`.
2. Un test que discrimine de verdad: `candidatas = tope + 1` (p. ej. 3 con tope 2) esperando
   `quedaPendiente === true`. El caso 5/2 actual no distingue las dos implementaciones.
3. Actualizar la asercion `skip === 200` del test de repositorio y el paso 5 de `design.md:251`,
   que arrastra la misma premisa.

### menor 1 — la migracion no es re-aplicable (`CREATE INDEX` / `DROP INDEX` sin `IF [NOT] EXISTS`)

`db/migrations/20260803140000_purga_pdf_indices/migration.sql` usa `CREATE INDEX` a secas y
`down.sql` usa `DROP INDEX` a secas. El precedente mas cercano del repo,
`20260803090000_gestion_orden_idx_created_at`, si usa `IF NOT EXISTS` / `IF EXISTS`. Con el
flujo normal de Prisma (una aplicacion, un rollback) no molesta, pero un `db:rollback`
ejecutado dos veces, o un UP sobre una base donde el indice ya exista, aborta. Dado que el
round-trip **no se pudo medir** (menor 4), la version defensiva seria la prudente.

### menor 2 — el guard de ORDEN COMPLETO de `crons` en `vercel.json`: **relajarlo**

`R18: la entrada nueva no altera ni reordena las cinco existentes` fija el array completo por
`toEqual`. Cumplio su funcion (demostrar "añadir, no reescribir"), pero desde el merge pasa a
juzgar cualquier reordenacion legitima futura de un fichero compartido por 6 features — el
mismo patron de la leccion "guard branch-scoped caduca al mergear". **Decision del revisor:
relajarlo** a "las cinco entradas previas siguen presentes con su `path` y su `schedule`", sin
fijar posiciones. Los otros tres tests de R18 (existencia, forma diaria, no colision de franja)
ya cubren lo que importa y no caducan.

### menor 3 — `maxDuration = 60`: se acepta como precedente nuevo

Ninguna otra ruta de `app/api/cron/` lo declara. La justificacion escrita en el fichero es
correcta y verificable (hasta 200 cargas por corrida, cada una con una llamada a Storage y una
transaccion; con el default de plataforma de 10 s la primera corrida sobre un historico moriria
a medias) y el valor coincide con el precedente ya existente en
`app/api/ordenes/api-key/carga/route.ts`. **Se conserva.** Si el patron se acepta, conviene
extenderlo a `procesar-jobs` y `corte-diario` en un ticket aparte, en vez de dejar esta como la
unica ruta de cron con presupuesto explicito.

### menor 4 — R26 a medias: `db:migrate` / `db:rollback` **NO MEDIDOS** (dicho explicitamente)

La mitad empirica de R26 —que el UP aplique contra Postgres, que `pnpm db:rollback` lo revierta,
y si un `migrate dev --create-only` posterior propone un `DROP INDEX` fantasma de los dos
indices parciales— **no esta verificada, ni por el implementer ni por este reviewer.** La causa
es **ajena y preexistente** a la 178: la base local tiene aplicada la migracion
`20260728120000_orden_historial_origen_deshacer_asignacion`, ausente del repo, mas un checksum
modificado en `20260714123909_reconcile_fks_...`; `prisma migrate dev` exige un reset. No se
intento arreglar el drift ni resetear nada (correcto). Lo verificable en estatico esta
verificado y es solido. **Queda como deuda medible: correrlo en un entorno con la historia de
migraciones alineada antes del deploy.** No bloquea la revision de codigo, pero R26 no puede
declararse cerrado del todo.

### menor 5 — R17 en el service es indirecto (aceptado)

Lo declaro el implementer y se confirma: el test de service solo puede afirmar que la ruta de
una orden sin lote no viaja a `remove` y que el service usa unicamente los tres metodos del
contrato. La garantia fuerte se verifico donde vive, en el SQL del repositorio (igualdad
`cargaId` en el `updateMany`, `IN` en la lectura: ninguno casa NULL). Suficiente.

### menor 6 — `objetosBorrados` = rutas SOLICITADAS, no confirmadas

Consecuencia de que `SupabaseFileStorage.remove` descarte el `{ error }` del SDK. Esta
documentado en el JSDoc de la interfaz, en el comentario de clase del service y en los riesgos
del spec. Correcto declararlo; el numero no debe leerse como espacio liberado. Corolario
tambien declarado: R19/R20 solo se activan ante excepciones de red/cliente.

### menor 7 — laxitud heredada de `parseInt` en la config

`readNonNegativeInt("7.9")` -> 7 y `("10x")` -> 10, en vez de caer al default. Es identico a
`lib/config/jobs.ts` y `lib/config/etiquetas.ts`: consistencia con el repo, no una regresion.
Se anota por si algun dia se endurece en los tres a la vez.

### menor 8 — huerfanos de la 136/141 y ordenes sin lote

Ambas limitaciones estan declaradas en `requirements.md` y en los riesgos de la bitacora, con
ticket aparte recomendado. La 177 (`specs/177-api-consulta-orden-pdf/design.md:84-87`) daba por
hecho que esta feature barreria sus huerfanos: **no puede**, y la correccion de ese supuesto
esta escrita. Bien resuelto documentalmente.

---

## Estado de la 177 (lo que esta feature podia romper)

No se toco `lib/services/ApiPdfEtiquetaService.ts` ni ningun archivo de la 177: verificado en el
diff (los unicos ficheros de produccion son los 6 nuevos de la 178, mas `vercel.json` y
`.env.example`). La interaccion se resuelve por estado de datos, que es lo correcto, y esta
cubierta por el test de integracion de R16. `vitest run --changed origin/dev` -> 6 ficheros /
65 tests verdes; guardias 46 ficheros / 672 tests verdes.

## Que hace falta para pasar a APROBADO

Corregir **solo el BLOQUEANTE 1**: calculo de `quedaPendiente`, test discriminante con
`tope + 1` candidatas, asercion `skip` del test de repositorio y paso 5 de `design.md`. Los
menores 1 y 2 son mejoras recomendadas en el mismo viaje; el resto son notas o deuda declarada.

---

# Ronda 2 — verificacion del cierre del BLOQUEANTE 1 (R22)

Alcance ACOTADO por el leader: **no** se rehace el review completo (los 26 R quedaron verificados
uno a uno en la ronda 1, que se conserva intacta arriba). Esta ronda solo responde a: ¿quedo el
bloqueante REALMENTE cerrado, y puede `quedaPendiente` mentir por otra via?

Revisor: solo lectura salvo dos **mutaciones temporales** (declaradas abajo), ambas restauradas y
verificadas con `git status --porcelain` VACIO. Ningun comando git de escritura.

## VEREDICTO RONDA 2: **APROBADO** — el bloqueante esta cerrado

---

## 1. Mutacion reproducida por el revisor (la prueba que importa)

**Mutacion A — reintroducir el `skip` en el repositorio REAL.**
En `lib/repositories/PurgaPdfCargasRepository.ts:existeAlgunaCandidata` se inserto `skip: 2`
(el tope que usan los fixtures; en el bug original el valor era el `limite` del lote, aqui = 2:
mismo comportamiento observable). Resultado sobre los dos ficheros afectados:

```
x R22 (AL LIMITE): 3 candidatas con tope 2 -> ... AssertionError: expected false to be true
x R22: 4 candidatas con tope 2 -> ...            AssertionError: expected false to be true
x R20/R22: la corrida siguiente ...              AssertionError: expected false to be true
x (repo) R22: ... consulta SIN skip   AssertionError: expected [ where, skip, take, select ] to not include skip
Test Files 2 failed (2) - Tests 4 failed | 12 passed (16)
```

**Confirmado punto por punto lo que reporto el implementer:**
- 3 de los 4 casos de `tests/integration/purga-pdf-queda-pendiente-r22.test.ts` se ponen ROJOS.
- El **caso de control (2 candidatas / tope 2 -> `false`) sigue VERDE** bajo la mutacion. Esto es
  lo que demuestra que los rojos vienen de la SEMANTICA y no de un test que exija `true` a ciegas:
  un test que solo pidiese `quedaPendiente === true` habria puesto tambien rojo el control.
- Los fallos son **AssertionError limpios**, no errores del doble de Prisma: el doble honra `skip`
  a proposito (comentado en su cabecera), asi que la mutacion falla por donde debe.
- El test de repositorio tambien discrimina: la asercion de que no existe la clave `skip` se rompe.

**Mutacion B — la semantica erronea en el doble del test de service.**
En `tests/unit/services/purga-pdf-cargas-service.test.ts` se cambio el doble
`existeAlgunaCandidata: candidatas(corte).length > 0` por `> 2` (emulando el descuento del tope):

```
x R21/R22: con una candidata mas que el tope ... AssertionError: expected false to be true
Test Files 1 failed (1) - Tests 1 failed | 11 passed (12)
```

Es decir: el test de service, ahora con **3 candidatas / tope 2** (antes 5/2, que pasaba por
margen), **ya discrimina**. Ademas fija que a la comprobacion no le llega el tope: la asercion
sobre `mock.calls[0]` exige un unico argumento, el corte.

**Restauracion:** ambos ficheros repuestos desde copia en el scratchpad.
`git status --porcelain` -> vacio; `git diff --stat` -> vacio. **El arbol quedo limpio.**

**Baseline verde tras restaurar** (solo los 4 ficheros de la feature, no la suite completa):
`purga-pdf-queda-pendiente-r22` + `purga-pdf-cargas-repository` + `purga-pdf-cargas-service` +
`purga-pdf-cargas-route` -> **4 archivos / 44 tests, 0 rojos.**

## 2. Bordes: cubiertos y midiendo

| Borde | Donde | Veredicto |
|---|---|---|
| 0 candidatas | service (R8/R20, segunda corrida: resumen `toEqual` con `quedaPendiente:false`) y repositorio (`findFirst` -> `null` -> `false`) | cubierto |
| exactamente `tope` (2/2) | integracion, caso de control: purga 2, `false`, y las vivas restantes se calculan del estado, no se hardcodean | cubierto y **es el que sostiene la discriminacion** |
| `tope + 1` (3/2) | integracion (caso central) + service (R21/R22) | cubierto, rojo bajo mutacion |
| `2 * tope` (4/2) | integracion | cubierto, rojo bajo mutacion |
| backlog drenado en 2 corridas | integracion (R20/R22): la 2a corrida purga 1 y ya declara `false` | cubierto |

La carga "joven" del fixture es control del corte: si la purga la contase, incluso el caso "no
queda nada" saldria `true`. Y la candidata que sobra esta viva **solo por su orden**, asi que el
`true` depende de la rama `ordenes.some` del predicado, no de las columnas de la carga.

## 3. Puede `quedaPendiente` mentir por OTRA via? — analisis de los caminos de fallo

Se recorrieron los caminos uno a uno sobre el codigo (service, repositorio y route):

- **`limpiarReferencias` lanza a mitad del bucle** -> el service **no captura**: la excepcion sube
  a `withErrorHandler` en la ruta y sale por `appErrorToResponse` (>= 500) **sin cuerpo de
  resumen** (`route.ts:91-105`). No existe camino donde una corrida abortada publique un
  `quedaPendiente`. Ademas `limpiarReferencias` es UNA transaccion por carga: la que falla no queda
  a medias ni pierde su referencia viva, asi que sigue siendo candidata manana. **Honesto.**
- **`storage.remove` lanza** -> identico: se propaga antes de limpiar y la carga conserva su ruta.
  **Honesto** (ya medido en R19).
- **`storage.remove` falla en SILENCIO** (best-effort: `SupabaseFileStorage` descarta el `{error}`
  del SDK, decision del humano) -> las referencias se limpian igual y la carga sale del predicado:
  `quedaPendiente` puede ser `false` con el objeto **todavia en el bucket**. Es honesto respecto de
  lo que la bandera significa (queda alguna CARGA candidata?), pero no cubre huerfanos de Storage.
  Ya declarado en la ronda 1 (menor 6) y en el JSDoc/spec. **No es una via de mentira nueva**; se
  reitera como menor porque es el unico hueco real: nadie debe leer `quedaPendiente:false` como
  "el bucket quedo limpio".
- **Una candidata que no se purga por otro motivo** -> no existe: el bucle no tiene `continue` ni
  `try/catch`; procesa las N filas devueltas o revienta. Y la comprobacion final usa **el mismo
  helper `whereCandidatas(corte)` y el mismo `corte`** que la seleccion (calculado una sola vez),
  asi que seleccion y comprobacion no pueden divergir en el predicado.
- **Carrera con la feature 177** (regeneracion entre las dos consultas) -> el sesgo es hacia
  `true`, no hacia `false`: si la 177 repuebla las columnas de una carga vieja, la comprobacion la
  ve y declara pendiente. Conservador y correcto; el falso negativo no ocurre por esta via.
- **Carga borrada concurrentemente** -> `carga.update` por `id` lanza P2025 -> error propagado,
  sin resumen. **Honesto.**
- **`take: 1` sin `orderBy`** -> irrelevante: la pregunta es existencial, no posicional.

**Conclusion: no se encontro ninguna otra via por la que `quedaPendiente` pueda reportar `false`
habiendo cargas candidatas.** El unico silencio restante es el de los objetos de Storage, ya
declarado y fuera del alcance de la bandera.

## 4. Los dos tests que TAPABAN el bug: ahora discriminan

- `tests/unit/services/purga-pdf-cargas-service.test.ts` — pasa de **5/2** (verde por margen) a
  **3/2 AL LIMITE**, con el comentario explicando por que el margen no valia. El doble del repo
  paso de reproducir la semantica erronea (`length > limite`) a la correcta (`length > 0` sobre el
  fixture MUTADO por `limpiarReferencias`). **Verificado con la mutacion B: rojo.**
- `tests/unit/repositories/purga-pdf-cargas-repository.test.ts` — pasa de fijar el bug
  (`skip === 200`) a **prohibirlo**: la clave `skip` no puede existir en los argumentos, `take`
  vale 1, y el `where` es **identico por `toEqual` al de `findCargasPurgables`**. **Verificado con
  la mutacion A: rojo.**
- Anadido: `tests/integration/purga-pdf-queda-pendiente-r22.test.ts`, service REAL + repositorio
  REAL sobre un doble de Prisma que **interpreta** el `where` (incluida `ordenes.some`) y **lanza**
  ante cualquier filtro o columna que no conozca. Es el nivel correcto: a nivel de service el
  repositorio es un doble y puede reproducir cualquier semantica, incluida la equivocada.

## 5. Menores 1 y 2 de la ronda 1: **cerrados**

- **menor 1 (migracion re-aplicable): CERRADO.**
  `20260803140000_purga_pdf_indices/migration.sql` -> `CREATE INDEX IF NOT EXISTS` en **las dos**
  sentencias; `down.sql` -> `DROP INDEX IF EXISTS` en **las dos**, en orden inverso. Alineado con
  el precedente `20260803090000_gestion_orden_idx_created_at`, y el porque queda escrito en el
  encabezado de ambos ficheros. El test estatico de R26 sigue verde con la nueva forma.
- **menor 2 (guard de ORDEN de `crons`): CERRADO.**
  El test de R18 ya **no** fija el array completo por `toEqual`: recorre una lista `PREVIAS` con
  las cinco entradas y afirma, para cada una, **presencia unica + `schedule` exacto**, con mensaje
  de fallo que nombra el cron; mas "la entrada nueva no se duplica". Sin posiciones: una
  reordenacion legitima futura de un fichero compartido por seis features ya no lo pone rojo, pero
  borrar una entrada o cambiarle la franja si. Los otros tres tests de R18 (existencia, forma
  diaria, no colision de franja con el control `otrosDiarios.length > 0`) se conservan.

## 6. Spec vs codigo: alineados, sin rastro del metodo viejo

- `design.md:180-185` — la interfaz declara `existeAlgunaCandidata(corte: Date): Promise<boolean>`
  con el porque del "sin `skip`". Coincide **literal** con
  `lib/interfaces/repositories/IPurgaPdfCargasRepository.ts:44` y con la implementacion.
- `design.md:255` — paso 5 = `quedaPendiente = repo.existeAlgunaCandidata(corte)` con la nota
  "(sin skip: ver seccion interfaz)". Coincide con `PurgaPdfCargasService.ts:87`.
- `requirements.md:178-182` — el texto de R22 incorpora la regla: la comprobacion es "queda alguna
  candidata?", **no** "queda alguna mas alla del tope?".
- `tasks.md:69` (T7) y `tasks.md:181` (fila R22) citan el metodo nuevo y el caso AL LIMITE 3/2.
- **Grep sobre todo el repo:** `quedanCargasPurgables` no aparece en **ningun** fichero de codigo,
  test ni spec. Solo sobrevive en `progress/impl_178.md` y en el texto de la ronda 1 de este mismo
  review, que es donde debe estar (historico).

## 7. Hallazgos nuevos de la ronda 2

- `menor 9` — `quedaPendiente:false` no dice nada sobre objetos huerfanos en Storage cuando
  `remove` falla en silencio (best-effort aceptado): la bandera solo habla de cargas candidatas.
  Implicito en el menor 6; se explicita para que nadie lo lea como "bucket limpio".
- `menor 10` — el fichero de integracion no tiene un fixture que ARRANQUE con 0 candidatas (solo
  llega a 0 tras purgar). El borde esta medido en el test de service y en el de repositorio, asi
  que la cobertura es suficiente; se anota por completitud.
- `menor 11` — con la 177 activa, una carga vieja cuyo PDF se regenera vuelve a ser candidata y
  puede mantener `quedaPendiente` en `true` de forma sostenida. Es el comportamiento correcto
  (habra trabajo la corrida siguiente), pero conviene saberlo antes de colgar una alerta de la
  bandera.

Ninguno es bloqueante.

## 8. Lo que esta ronda NO revisa (aceptado en la ronda 1, por instruccion del leader)

`maxDuration = 60` (menor 3); R17 indirecto en el service (menor 5); `objetosBorrados` = rutas
solicitadas (menor 6); `parseInt` laxo heredado (menor 7); huerfanos 136/141 y ordenes sin lote
(menor 8). **R26 sigue SIN MEDIR en su mitad empirica** (`db:migrate` / `db:rollback`) por el drift
AJENO y PREEXISTENTE de la base local (migracion fantasma `20260728120000_...` + checksum de
`20260714123909_...`): se mantiene **declarado como deuda** (menor 4); no se intento arreglarlo ni
resetear la base. Suite completa: la corrio el leader tras el arreglo (870 archivos / 10883 tests,
0 rojos); no se repite aqui.

---

## VEREDICTO FINAL RONDA 2: **APROBADO**

El BLOQUEANTE 1 (R22) esta **realmente cerrado**, no solo declarado: la mutacion que lo reintroduce
pone rojos 3 de los 4 casos del test nuevo **dejando verde el caso de control**, y ademas rompe el
test de repositorio. Los dos tests que antes lo tapaban ahora discriminan. Menores 1 y 2 cerrados.
Spec y codigo dicen lo mismo y no queda ninguna referencia al metodo viejo. Sin bloqueantes nuevos.
Deuda declarada que sobrevive al merge: la mitad empirica de R26 (menor 4).
