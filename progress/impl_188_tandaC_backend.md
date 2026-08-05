# 184 — la parte BACKEND de la Tanda C (listado 1: «Cierres solicitados por el mensajero»)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **C.1**. `app/**` y `components/**` NO se tocan: C.2 (la pantalla) y C.3 (el
> censo) son del frontend y cierran la tanda.
>
> **Veredicto en una línea: el listado más caro por firma de URL deja de firmar ninguna —de
> cuatro lecturas + la tarifa + N llamadas a Supabase Storage a UNA consulta y cero firmas—, sin
> un solo método de repositorio nuevo, con 17 mutaciones ejecutadas y las 17 rojas.**

---

## 1. Lo primero que se midió: ¿era el firmado de URL el coste, de verdad?

El encargo pedía comprobarlo antes de asumirlo. **Sí, y de forma más limpia de lo que decía el
inventario:** no es que el archivo firme "de más", es que el archivo **no usa ni una** de esas URL.

| Pregunta | Respuesta medida | Dónde se ve |
| --- | --- | --- |
| ¿Qué relee hoy la pantalla para el archivo? | `listarCierreDia()`, y se queda solo con `res.cierresPasados` | `CierreDiaModule.tsx:604-612` |
| ¿Qué hace `listarCierreDia` de más? | 4 lecturas (`findGestionesPendientes`, `contarOrdenesPendientesGestion`, `findCierresByMensajero`, tarifa por zona+vehículo), `derivarPagos`, `derivarIngresoBodega`, `computeTotales` y **`createSignedUrls(paths, TTL)`** sobre TODAS las evidencias del día | `CierreDiaService.ts:164-190` |
| ¿El archivo usa alguna de esas URL? | **No.** Sus ocho columnas (`estado`, `destino`, `efectivo`, `simpe`, `transferencia`, `general`, `ganancia`, `fecha`) salen enteras del `CierrePasadoDTO` | `cierre-dia-descarga-columnas.ts:178-205` |
| ¿El `CierrePasadoDTO` tiene siquiera campo de evidencia? | **No.** Ni `evidenciaUrl` ni `evidenciaStoragePath` | `ICierreDiaService.ts:182-198` |

O sea: la firma no es un coste "colateral aceptable" del archivo, es **trabajo del que no se
consume nada**, y no es aritmética local — son llamadas de red a Supabase Storage, una por lote de
paths, que escalan con las gestiones del día del mensajero.

**Lo que eso implica para las pruebas, y es el requisito que las tandas anteriores no tenían:**
un test que compruebe las filas devueltas NO mide esto. El archivo sale idéntico firmando y sin
firmar — por eso la deuda llevaba aquí desde la 170 sin que nadie la viera. Hace falta un **espía
sobre el proveedor de firmas** y un conteo de llamadas. Ver §3, mutaciones M6 y M7.

---

## 2. ¿Hacía falta escribir repositorio? No, y se midió

| Método que el inventario decía que existe | ¿Sirve tal cual? |
| --- | --- |
| `CierreDiaRepository.findCierresByMensajero(mensajeroId)` | **Sí.** Devuelve el conjunto entero del mensajero, `orderBy solicitadoAt desc`, con `CIERRE_PASADO_SELECT` y `toCierrePasadoDTO` — **el mismo select y el mismo mapper** que `findCierresByMensajeroPaginado` |

Es literalmente lo que la pantalla ya releía: `listarCierreDia()` lo llama y expone su resultado
como `cierresPasados`. La deuda no estaba en «falta una consulta», estaba en **cómo se llegaba a
ella**: por dentro del listado compuesto, arrastrando las otras tres lecturas, la tarifa y las
firmas.

**Se reusó, no se duplicó.** Un `findCierresByMensajeroCompleto` habría sido un gemelo con el mismo
`where`, el mismo orden y el mismo `select`: la tercera declaración del mismo criterio en esta
feature, que es justo lo que R16 prohíbe y lo que las tandas A y B ya evitaron dos veces.

### Lo que sí se tocó del repositorio, y por qué

El mismo hallazgo de la tanda B, en este par: el criterio estaba declarado **dos veces**.

| Antes | Ahora |
| --- | --- |
| `where: { mensajeroId }` escrito **dos veces** (`:572` y `:626`) | `cierresDeMensajeroWhere(mensajeroId)`, una vez |
| `orderBy: { solicitadoAt: "desc" }` escrito **dos veces** (`:573` y `:630`) | `ORDEN_CIERRES_MENSAJERO`, una vez |

No es simetría: en cuanto un archivo depende de ese conjunto, si su `where`/`orderBy` divergen de
los de la página, **la fila 26 del archivo deja de ser la primera de la página 2** y no hay ninguna
pantalla que lo diga. Cero cambios de comportamiento: los 89 casos previos de los cuatro archivos
del dominio siguen verdes sin tocarse, incluidos los que fijan `where` y orden en valores
absolutos (contraprueba medida: **M4**).

---

## 3. Qué se escribió

### Servicio — `CierreDiaService.listarCierresPasadosCompleto(actor)`

Guard de rol ANTES del repositorio → `findCierresByMensajero(actor.usuarioId)` → tope
`descargaConfig.MAX_FILAS` evaluado aquí → las filas tal cual. **Una** llamada al repositorio, cero
al firmador, cero a la tarifa.

**No recibe `input`, y es decisión, no olvido** — mismo criterio que los dos conjuntos de la tanda
B. Este listado no admite filtros: su schema de página solo tenía `page`/`pageSize`, y quitarlos
deja una lista blanca de **cero claves**. El borde la sigue aplicando entera —parsear ES la
barrera, medido en M12–M14— pero no hay nada que transportar hasta el servicio.

**Tampoco resuelve zona**, a diferencia de la tanda B: aquí el alcance *es* el actor
(`actor.usuarioId` → `mensajero_id`), así que es una sola lectura y no dos.

### Schema — `lib/types/cierre.ts`

Derivado, no reescrito:

```ts
listarCierresPasadosCompletoSchema = listarCierresPasadosSchema
  .omit({ page: true, pageSize: true }).strict();
```

`.strict()` se reescribe aunque `.omit()` lo herede, por el mismo motivo que en el schema de la
página. Y aquí la lista blanca vacía **no es higiene**: es el único listado del Anexo A cuyo alcance
es el propio usuario, así que un `mensajeroId` colado que el servicio llegara a leer algún día
abriría el histórico de dinero de otro mensajero.

### Borde — `lib/actions/cierre-dia.ts`

`listarCierresPasadosCompleto`, calcado de su hermana paginada: actor primero, zod después,
servicio al final, todo bajo `withErrorHandler`. `input: unknown = {}` para que la pantalla pueda
llamarla sin argumentos.

**Lo que el frontend encontrará listo (C.2):** `listarCierresPasadosCompleto()` devuelve
`ListarCompletoResult<CierrePasadoDTO>` — exactamente lo que `filasDesdeResultado` sabe traducir y
lo que `filaDescargaDiaCierrePasado` ya sabe proyectar.

---

## 4. Dónde vive cada test, y por qué — con la medición delante

El encargo pedía decidir esto con criterio y justificarlo. Se midió con **M5** (el mismo tipo de
mutación que en la tanda A solo cazaba un Postgres real):

```
=== M5 (R14) el criterio gana una condicion sobre una columna QUE NO EXISTE
  × cierres solicitados del mensajero: acota por mensajeroId y NO filtra por estado
  × cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  2 failed | 87 passed (89)
--- typecheck:
  lib/repositories/CierreDiaRepository.ts(238,25): error TS2353: Object literal may only specify
    known properties, and 'mensajeroIdentificador' does not exist in type 'CierreDiaWhereInput'.
  typecheck exit: 2
```

**Doble red, y por eso NO se añade un archivo `tests/integration/db/`:**

1. **`tsc` la caza.** Como en la tanda B, esta consulta va por el constructor tipado de Prisma
   (`Prisma.CierreDiaWhereInput`, `Prisma.CierreDiaOrderByWithRelationInput`, `select` con
   `GetPayload`), así que la columna inexistente no compila. En la tanda A eran `$queryRaw` —texto
   libre— y ahí sí hizo falta Postgres de verdad.
2. **Los `*-where.test.ts` también la cazan**, y esto es diferencia con la tanda B: aquí la
   afirmación es `toEqual({ mensajeroId: "m-a" })`, igualdad estricta, de modo que una clave de más
   en el `where` pone rojo el caso aunque el tipo lo permitiera.

No se encontró ninguna propiedad de esta consulta que un Postgres real pudiera desmentir y estas
dos no. Lo que un Postgres real sí seguiría cazando —drift entre `schema.prisma` y la base— no lo
introduce esta tanda: la consulta es la misma que ya corre en producción.

**Lo que los dobles NO ven, y por eso está en los `*-where.test.ts`:** el `where`, el `orderBy`,
cuántas consultas se emiten y qué NO llevan. Los dos casos nuevos ejecutan el repositorio REAL y
afirman sobre los ARGUMENTOS de la consulta (R14).

**Lo que los `*-where.test.ts` NO ven, y por eso está en el test de servicio:** que el camino del
archivo no firme URL. Eso es orquestación del servicio, no SQL.

---

## 5. Las 17 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura. Ninguna quedó aplicada (`git status`
limpio tras cada lote, verificado y pegado).

### Lote repositorio (5) — el criterio compartido

```
=== M1 (R16/R5) el conjunto ordena al reves que su pagina
  × mapea cada cierre con totales STRING toFixed(2) y solicitadoAt ISO, mas reciente primero
  × cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  2 failed | 87 passed (89)
=== M2 (R16/R4) el conjunto deja de acotar por mensajero
  × mapea cada cierre con totales STRING toFixed(2) y solicitadoAt ISO, mas reciente primero
  × cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  2 failed | 87 passed (89)
=== M3 (R15) el conjunto recorta como si fuera una pagina
  × cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del mensajero cuesta UNA consulta, sin recorte y sin conteo de página (R15)
  Tests  2 failed | 87 passed (89)
=== M4 (R5/R16) el orden COMPARTIDO cambia para los dos a la vez
  × mapea cada cierre con totales STRING toFixed(2) y solicitadoAt ISO, mas reciente primero
  × cierres solicitados del mensajero: acota por mensajeroId y NO filtra por estado
  × cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  3 failed | 86 passed (89)
=== M5 (R14) el criterio gana una condicion sobre una columna QUE NO EXISTE
  (salida completa en §4)
  Tests  2 failed | 87 passed (89)   +   typecheck exit: 2
=== arbol restaurado
```

**M2 es el lado feo de R4:** un conjunto sin `mensajero_id` en el `WHERE` entrega el histórico de
dinero de TODOS los mensajeros en el archivo de uno.

**M4 es la contraprueba de que compartir el orden no lo vuelve invisible:** cambiar la constante
compartida pone rojas a la vez las afirmaciones ABSOLUTAS de la página y las del conjunto. Una
declaración única no es una declaración sin vigilar.

### Lote servicio (7) — el firmado, el tope y el alcance

```
=== M6 (R9) el conjunto firma las evidencias del dia y TIRA las URL
  × el conjunto de la descarga no firma ninguna URL de evidencia (R9)
  Tests  1 failed | 113 passed (114)
=== M7 (R9/R1) el conjunto vuelve a servirse del listado COMPUESTO
  × el conjunto de la descarga no firma ninguna URL de evidencia (R9)
  Tests  1 failed | 113 passed (114)
=== M8 (R6) el tope se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 113 passed (114)
=== M9 (R6) el tope TRUNCA en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 113 passed (114)
=== M10 (R4) el guard de rol se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 113 passed (114)
=== M11 (R5/R9) el conjunto se sirve del metodo PAGINADO
  × el conjunto de la descarga no firma ninguna URL de evidencia (R9)
  × las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  3 failed | 111 passed (114)
=== M17 (R5) el conjunto entrega SOLO las dos primeras filas (la primera pagina)
  × el alcance sale del ACTOR, no de la entrada: cada mensajero descarga el SUYO (R4)
  × el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)
  × las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  4 failed | 110 passed (114)
=== arbol restaurado
```

**M6 es LA mutación de esta tanda, y merece leerse dos veces.** El código mutado lee las gestiones
del día, extrae los paths de evidencia, **llama a `createSignedUrls` y tira el resultado**. Produce
exactamente el mismo archivo, exactamente las mismas filas y exactamente el mismo objeto de vuelta.
Es indistinguible por cualquier vía razonable… salvo por el espía de este archivo. **Un solo caso
la caza**, y es el que R9 pide.

La anti-vacuidad de ese espía está medida en el mismo caso: la relectura que esta tanda sustituye
(`listarCierreDia`) **sí** firma, y el test lo afirma con los paths exactos
(`[["evidencias/g-1.jpg", "evidencias/g-2.jpg", "evidencias/g-3.jpg"]]`). Sin esa mitad, el
`toHaveBeenCalledTimes(0)` sería un adorno: un espía que no se disparase nunca pasaría igual.

**M17 existe porque M11 dejó vivo R5.** M11 (servirse del paginado con `take: 25`) mata el caso de
R9 y dos más, pero **no** el de R5: con cinco filas de almacén, la página 1 de 25 *es* el conjunto
entero. Se ejecutó entonces M17 —el paginado con `take: 2`— y ahí sí cae el caso de R5. Sin esa
segunda pasada, R5 habría quedado con un killer aparente y ninguno real.

### Lote borde (5) — la lista blanca derivada

```
=== M12 (R17) el borde usa el schema de la PAGINA en vez del derivado
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 5 passed (6)
=== M13 (R17) el borde NO parsea la entrada
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 5 passed (6)
=== M14 (R17) el schema derivado deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 5 passed (6)
=== M15 (R7) el borde valida ANTES de resolver el actor
  × el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca
  Tests  1 failed | 5 passed (6)
=== M16 (borde) el borde deja de admitir la llamada SIN entrada
  × sin entrada, o con un objeto vacío, delega en el service con SOLO el actor
  Tests  1 failed | 5 passed (6)
=== arbol restaurado
```

**M12 es la que justifica que el schema se DERIVE.** Con la lista blanca copiada a mano del listado
paginado, `page: 2` y `pageSize: 100` pasarían: son claves que la página acepta y el conjunto no
debe. El caso las prueba explícitamente, junto a `mensajeroId` y `usuarioId` —las dos que abrirían
el histórico de dinero de otro mensajero—.

**Resultado: 17 mutaciones, 17 rojas. Ninguna sobrevivió, así que no hay código propio sin
vigilar que retirar.**

---

## 6. Archivos

**Nuevos (2)**

- `tests/unit/services/cierre-dia-pasados-completo.test.ts` — 6 casos (incluye el espía de firmas
  y su anti-vacuidad).
- `tests/unit/actions/cierre-dia-descarga-action.test.ts` — 6 casos.

**Modificados — producción (5)**

- `lib/repositories/CierreDiaRepository.ts` — `cierresDeMensajeroWhere` + `ORDEN_CIERRES_MENSAJERO`,
  cada uno declarado una vez. **Sin métodos nuevos.**
- `lib/services/CierreDiaService.ts` — `listarCierresPasadosCompleto`.
- `lib/interfaces/services/ICierreDiaService.ts` — su contrato y su result type.
- `lib/types/cierre.ts` — el schema derivado y el `…CompletoResult`.
- `lib/actions/cierre-dia.ts` — el borde.

**Modificados — tests (1)**

- `tests/unit/repositories/historicos-paginados-where.test.ts` — +2 casos (11 → 13).

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema, `feature_list.json`
y la configuración de `useSWR` de ninguna pantalla (R33).

**Peaje de los `vi.mock` ajenos: CERO en esta tanda.** Ninguna pantalla importa todavía la acción
nueva: eso es C.2. Se comprobó ejecutando los diez archivos que mockean o renderizan este dominio
(`CierreDiaModule`, `CierreDiaModuleIncidente`, `CierreDiaPage`, `CierresDescarga`,
`MisAsignacionesPage`, `BajoRiesgoPaginacion`, `paginacion-transversal`, `RecoleccionPage`,
`cierre-dia-action`, `notificacion-notificadores-reales`): **131 casos, todos verdes sin tocarlos**.
**Quien haga C.2 sí lo pagará**, y conviene que lo enumere antes con
`pnpm exec vitest related --run app/(app)/cierre-dia/_components/CierreDiaModule.tsx`.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito sin
nombrarlo y varios títulos de los archivos vecinos citan requisitos de la **feature 170** (`R40`,
`R41`, `R44`, `R51`, `R54`), cuyo espacio de nombres se cruza con el de esta.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | — | la lectura dedicada existe (servicio + borde); que la PANTALLA la use es C.2 | **parcial: cierra en C.2** |
| R2 | `tests/unit/services/cierre-dia-pasados-completo.test.ts` | «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» + «las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero» (el servidor entrega el conjunto ya resuelto; el servicio no reordena ni recorta) | backend ✔ (la mitad de cliente, en C.2) |
| R3 | `tests/unit/actions/cierre-dia-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ **con matiz**: este listado NO tiene filtros (su schema de página solo llevaba `page`/`pageSize`), así que «los filtros vigentes» es siempre el conjunto entero del mensajero. Lo afirmable es que ninguna clave puede viajar |
| R4 | `…/cierre-dia-pasados-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» (6 roles, cero llamadas al repo, cero firmas) + «el alcance sale del ACTOR, no de la entrada: cada mensajero descarga el SUYO (R4)» (contraprueba con dos mensajeros + `toHaveLength(1)` sobre la aridad del método: no hay parámetro por el que pedir el histórico de otro). En el borde, «una clave no declarada muere con validation_error…» con `mensajeroId`/`usuarioId` | ✔ |
| R5 | `tests/unit/repositories/historicos-paginados-where.test.ts` | «cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)». Más, en servicio, «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» — killer medido: **M17** | ✔ |
| R6 | `…/cierre-dia-pasados-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» (borde exacto por arriba y por abajo) + en el borde «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)» | ✔ |
| R7 | `tests/unit/actions/cierre-dia-descarga-action.test.ts` | «sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)» + «forbidden del service pasa tal cual, sin filas ni total (R7)» + «el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca». El mensaje al usuario lo redacta el adaptador, y sus casos ya existen | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción del conjunto) | **C.2** |
| **R9** | `tests/unit/services/cierre-dia-pasados-completo.test.ts` | **«el conjunto de la descarga no firma ninguna URL de evidencia (R9)»** — espía sobre `createSignedUrls` en CERO llamadas, más la prueba estructural que falla por separado (`llamadas === ["findCierresByMensajero"]`, sin `findGestionesPendientes`, que es de donde salen los paths), más el contador de resoluciones de tarifa en 0, más la ANTI-VACUIDAD sobre `listarCierreDia` (1 llamada, con los tres paths exactos). Killers medidos: **M6**, **M7**, **M11** | ✔ |
| R12 | — | columnas y textos del archivo: no se tocan. `cierre-dia-descarga-columnas.ts` no se modificó y `ControlDescargaTransversal.test.tsx` sigue verde | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | el listado 1 **sigue** declarado `conjunto` y sigue en `PENDIENTES_184`, porque su pantalla no ha migrado: el censo pasa sin tocarlo. Sacarlo es C.3, en el mismo commit que C.2 | ✔ |
| R14 | `tests/unit/repositories/historicos-paginados-where.test.ts` | «cierres del mensajero: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» — ejecuta el repositorio REAL y afirma sobre los ARGUMENTOS de la consulta | ✔ (sin método nuevo: se verifica el reusado) |
| R15 | `…/historicos-paginados-where.test.ts` | «el conjunto del mensajero cuesta UNA consulta, sin recorte y sin conteo de página (R15)» | ✔ |
| R16 | `…/historicos-paginados-where.test.ts` | el caso de R14, que es donde se afirma «mismas condiciones y mismo orden». La otra mitad de R16 —«no hay dos declaraciones del mismo criterio»— se cumple por construcción (`cierresDeMensajeroWhere`, `ORDEN_CIERRES_MENSAJERO`) y se midió con **M4** | ✔ |
| R17 | `tests/unit/actions/cierre-dia-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — seis entradas; incluye `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA, y `mensajeroId`/`usuarioId`, que son las que importan | ✔ |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (parcial), R2 (mitad de cliente) y
R8 son de **pantalla**, y salen en C.2. R13/R29–R32 son de **censo** (`paginacion-transversal`,
`adaptador-conjunto.guardia`) y salen en C.3 y en la tanda H. **R10** es de la tanda B (los
agregados de la consolidación) y **R11** es del listado 10, cerrado en la tanda A. **R18–R28** son
la poda de la selección satélite, cerrada en la tanda A.

---

## 8. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec vitest run <mis 3 archivos + los 5 vecinos del dominio>
 Test Files  8 passed (8)
      Tests  217 passed (217)
   Duration  2.43s

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  12.16s

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)
```

**Rojos: cero, ni propios ni ajenos.**

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: es el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03), la tanda A y la tanda B sobre el árbol limpio. **Delta propio:
cero** — el idiom `const { mensajeroId: _mensajeroId, ...dto }` que el archivo hermano usa (y que
aporta una de esas 44) se evitó aquí con `void mensajeroId`, para no engordar el número.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 9. Incidencia de proceso: el árbol se restauró bajo mis pies

A mitad de la tanda, con typecheck y tests ya verdes, **mis cinco archivos de `lib/**` y mi
modificación de `historicos-paginados-where.test.ts` aparecieron revertidos al estado de `HEAD`**,
y en el árbol aparecieron a cambio cuatro archivos modificados que no son míos
(`app/(app)/cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx`,
`tests/components/descarga/CierresDescarga.test.tsx`,
`tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`,
`tests/components/paginacion/paginacion-transversal.test.tsx`) — que son la **B.2/B.3 del
frontend**. `git log`/`reflog` no registran ningún commit nuevo, así que fue un `git restore` /
`checkout --` de un proceso concurrente sobre el MISMO worktree.

Sobrevivieron solo mis dos archivos de test nuevos, por estar sin trackear.

**Qué se hizo:** reaplicar los cinco cambios de `lib/**` y el del `*-where.test.ts`, verificar
typecheck + tests, y **commitear de inmediato** (dos commits) antes de seguir. Los cambios del otro
agente **no se han tocado ni commiteado**: siguen en el árbol como los dejó.

**Qué conviene saber:** dos agentes escribiendo a la vez en `.claude/worktrees/lote-135` es una
condición de carrera real, no teórica — aquí costó reescribir cinco archivos. Si C.2 y otra tanda
van a solaparse, o van en worktrees distintos, o se secuencian.

---

## 10. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **C.2** | frontend | `CierreDiaModule.tsx` (`:598-612`): `obtenerFilas` pasa de `filasDelConjuntoCompleto(listarCierreDia().then(...), filaDescargaDiaCierrePasado)` a `filasDesdeResultado(listarCierresPasadosCompleto(), filaDescargaDiaCierrePasado)`. **Ojo:** este módulo hospeda además el listado del Anexo IV que usa `filasLocales` legítimamente (`:548-549`) y está declarado en `CONVIVEN_ANEXO_III_Y_IV`; esa excepción se conserva tal cual |
| **C.3** | frontend | listado 1 a `adaptador: "completo"` y fuera de `PENDIENTES_184` (quedan 8), en el MISMO commit que C.2 |

**Aviso para C.2 (peaje del `vi.mock`):** en cuanto la pantalla importe la acción nueva, todo
archivo de test que haga `vi.mock("@/lib/actions/cierre-dia", …)` con factoría y renderice
`CierreDiaModule` revienta al importarlo si no declara el export nuevo. Los candidatos medidos hoy
son `tests/components/CierreDiaModule.test.tsx`, `tests/components/CierreDiaModuleIncidente.test.tsx`,
`tests/components/CierreDiaPage.test.tsx`, `tests/components/descarga/CierresDescarga.test.tsx` y
`tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`. Es peaje esperado, no regresión.
