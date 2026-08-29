# Ficha 332 — Eliminar plantillas de gasto fijo · design

> Decisiones técnicas previas al código. Cubre R1–R26 de `requirements.md`.

---

## 0. La decisión que esta ficha REVOCA, dicho con todas las letras

**La ficha 45 prohibió el borrado de plantillas por diseño.** Su requisito `45/R25` dice, verbatim
(`specs/45-wallet-gastos-sueldos/requirements.md:181-183`):

> **R25** — El sistema DEBE permitir al maestro editar `concepto` y `monto` de una plantilla y
> activarla/desactivarla; el sistema NO DEBE borrar plantillas (la desactivación —`activa = false`—
> es el mecanismo para dejar de generar, preservando el historial y los egresos ya emitidos).

**La ficha 332 REVOCA `45/R25` con el OK explícito del humano, fechado el 2026-08-29.** No es un
descuido, ni un atajo, ni alguien que se saltó una regla: es una decisión tomada a sabiendas de que
existía la anterior. Queda escrito aquí y en los contratos vivos (R22) para que el próximo lector
—que se encontrará un `eliminar` donde su spec dice «NO DEBE borrar»— sepa cuál de las dos manda.

**Pedido humano, textual (2026-08-29):**

> «lo importante es el historial del libro, si el movimiento ya se hizo no hay problema que quede
> alli ese historico pero cuando ya no se necesite si es importante poder prescindir y eliminarlo
> de la tabla de plantillas pues hace ruido»

**Por qué la premisa de `45/R25` no se sostiene, y no es opinión.** `45/R25` protegía «el historial
y los egresos ya emitidos». Pero el historial **no depende de la plantilla**:

1. **No hay FK.** `wallet_movimiento` no declara ninguna relación con `gasto_fijo_plantilla`, y
   `GastoFijoPlantilla` no declara relaciones en absoluto (`db/schema.prisma:1509-1528` y
   `1836-1849`). Postgres no tiene ninguna cascada que disparar: borrar la plantilla es un `DELETE`
   sobre una tabla sin dependientes.
2. **La referencia es derivada, no relacional.** `origen_tipo = 'gasto'` y
   `origen_id = '<plantillaId>:<periodo>'` (`GeneracionGastosFijosService.ts:64`). Es un texto,
   no un puntero: sobrevive a la fila que lo originó.
3. **La fila del libro se explica sola.** Su `descripcion` ya lleva el concepto y el periodo —
   `${p.concepto} — ${periodo}`, p. ej. `Alquiler bodega — 2026-09`
   (`GeneracionGastosFijosService.ts:65`). Con la plantilla borrada, el libro sigue diciendo qué se
   pagó y por qué mes.
4. **Hoy no hay nada que proteger.** Medido contra producción el 2026-08-29 (dato de la ficha):
   **cero** movimientos `egreso_gasto_fijo` emitidos jamás, y las 2 plantillas existentes están
   inactivas desde el 2026-08-27 — es decir, alguien ya usó la desactivación como sucedáneo del
   borrado que no existía.

Lo que `45/R25` sí acertaba —y esta ficha **no** toca— es que **el libro es inmutable**. El borrado
llega hasta la tabla de plantillas y se detiene ahí (R8/R9).

### Qué NO se revoca: el toggle activar/desactivar se queda

Desactivar y eliminar son **dos intenciones distintas**, y el diseño las mantiene separadas:

| | Desactivar | Eliminar |
| --- | --- | --- |
| Intención | «esto no se cobra **por ahora**» | «esto no se cobra **nunca más**, y no quiero verlo» |
| Reversible | sí, un clic | no |
| La fila | sigue en la tabla | desaparece |
| Historial del libro | intacto | intacto |

Colapsarlas en una sola sería obligar a borrar para pausar, y borrar es irreversible. Además,
pausar tiene una ventaja concreta que eliminar pierde: **conserva el id**, y con él la clave de
idempotencia del cron (ver §7).

---

## 1. Modelo de datos

**No hay migración. No hay cambio de esquema. No hay RLS nueva.** Y no es un olvido:

- La tabla `gasto_fijo_plantilla` ya existe con `RLS ENABLE` **sin policies**
  (`db/migrations/20260713150000_gasto_fijo_plantilla/migration.sql:28`), o sea accesible sólo por
  el service role. El acceso de la app va por Prisma con esa credencial, así que el `DELETE` entra
  por el mismo camino que el `UPDATE` de `setActiva`, que ya funciona. **Una policy nueva no haría
  nada**: no hay rol anon/authenticated tocando esta tabla.
- No hay FK, ni `ON DELETE` que declarar, ni índice que añadir: el borrado va por clave primaria.
- El único cambio en `db/schema.prisma` es **un comentario** (l. 1815, «NO se borra (R25)»), que
  R21/R22 obligan a corregir. No altera el modelo, así que `prisma migrate diff` sigue limpio.

**La migración ya aplicada NO se toca (R24).** `migration.sql` de `20260713150000_gasto_fijo_plantilla`
también dice «NO se borra (R25)» en su cabecera, y ahí se queda: una migración aplicada es la foto
de su fecha, y editarla en sitio es el patrón que en este repo ya produjo drift. El guardia de R21
excluye `db/migrations/**` **por escrito y con motivo**, no por olvido.

---

## 2. Capas — el camino completo

```
GastosFijosPlantillasPanel.tsx      ← botón «Eliminar» + Modal de confirmación
  ↓  eliminarPlantillaAction({ id })
lib/actions/gasto-fijo-plantilla.ts ← sesión + zod en el borde (R5/R6)
  ↓  service.eliminarPlantilla({ id }, actor)
lib/services/GastoFijoPlantillaService.ts ← esAccesoTotal (R4) + not_found (R7)
  ↓  repo.eliminar(id)
lib/repositories/GastoFijoPlantillaRepository.ts ← deleteMany({ where: { id } })
  ↓
Postgres (service role, RLS sin policies)
```

Es el **mismo esqueleto** que `setActivaPlantilla`, método por método. No se inventa una capa nueva.

### 2.1 Repositorio — `IGastoFijoPlantillaRepository`

```ts
/**
 * Ficha 332 (R2/R3): borra la plantilla. `true` si borró una fila, `false` si no existía.
 * REVOCA la nota de 45/R25 («NO expone delete») — ver specs/332, decisión humana 2026-08-29.
 */
eliminar(id: string): Promise<boolean>;
```

Implementación:

```ts
async eliminar(id: string): Promise<boolean> {
  const res = await this.prisma.gastoFijoPlantilla.deleteMany({ where: { id } });
  return res.count > 0;
}
```

**`deleteMany`, no `delete`, y hay precedente en el repo:** `VehiculoRepository.delete`
(`lib/repositories/VehiculoRepository.ts:41-44`) hace exactamente esto y explica por qué en su
hermano `update` (l. 35): *«updateMany en vez de update: no lanza si la fila no existe, devuelve
count 0»*. Con `delete`, una fila ya borrada por otra pestaña lanza `P2025` y hay que traducir una
excepción de Prisma a `not_found` en el service — un `catch` que mira códigos de error de la ORM
donde basta un contador.

**R8 sale gratis por construcción, no por disciplina.** El cliente de este repositorio está tipado
`Pick<PrismaClient, "gastoFijoPlantilla">` (`GastoFijoPlantillaRepository.ts:11`): **no tiene
acceso** a `walletMovimiento` ni a ninguna otra tabla. No es que el método «no deba» tocar el
libro; es que **no puede**, y el compilador lo impide. Ese tipo no se ensancha en esta ficha.

### 2.2 Servicio — `IGastoFijoPlantillaService`

```ts
export type EliminarPlantillaServiceResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" };

eliminarPlantilla(
  input: EliminarPlantillaInput,
  actor: Actor,
): Promise<EliminarPlantillaServiceResult>;
```

```ts
async eliminarPlantilla(input, actor) {
  if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };   // R4, ANTES del repositorio
  const borrada = await this.repo.eliminar(input.id);              // R2/R3
  return borrada ? { status: "ok" } : { status: "not_found" };     // R7
}
```

**Sin `obtenerPorId` previo, y es deliberado.** `actualizarPlantilla` y `setActivaPlantilla` leen
antes para poder devolver el DTO actualizado; aquí no hay DTO que devolver. Un `obtenerPorId`
previo sólo añadiría una consulta y una ventana TOCTOU: entre el `SELECT` y el `DELETE` otra
pestaña puede borrar la fila, y el segundo paso volvería a decir lo mismo. El `count` del
`deleteMany` **es** la respuesta, y es atómico.

`{ status: "ok" }` sin payload: no hay nada que devolver de una fila que ya no existe. El panel
recarga su página desde el servidor (R18), no reconstruye el estado desde la respuesta.

### 2.3 Server Action

```ts
export const eliminarPlantillaSchema = z.object({ id: z.string().uuid() }).strict();

export async function eliminarPlantillaAction(
  input: unknown,
  deps: PlantillaDeps = {},
): Promise<EliminarPlantillaActionResult>
```

Espejo literal de `setActivaPlantillaAction` (`lib/actions/gasto-fijo-plantilla.ts:119-131`):
`resolveActorFromSession` → `UnauthenticatedError` (R5) → `schema.parse` → `VALIDATION_ERROR` (R6)
→ service. Todo dentro de `withErrorHandler`, y `toPlantillaActionError` ya traduce los dos códigos
que pueden salir. `.strict()` para que una clave desconocida muera en el borde.

**Server Action y no route handler**, según `docs/architecture.md`: es una mutación interna
disparada por un componente propio.

**Superficie:** la acción nace con consumidor vivo (el panel), así que
`tests/unit/guards/superficie-de-uso.guardia.test.ts` la ve alcanzable desde `wallet/page.tsx`. **No**
lleva anotación `@sin-superficie`.

### 2.4 Contratos I/O

| Entrada | Salida |
| --- | --- |
| `{ id: string /* uuid */ }` | `{ status: "ok" }` |
| | `{ status: "forbidden" }` |
| | `{ status: "not_found" }` |
| | `{ status: "unauthenticated" }` |
| | `{ status: "validation_error", fieldErrors }` |

**Money-safe:** en este camino **no viaja ningún monto**. El único monto que aparece es el que la
confirmación pinta (R14), y sale del `GastoFijoPlantillaDTO` que el panel ya tiene en memoria —
STRING, renderizado con `money(p.monto)`, sin `parseFloat`/`Number`, igual que la columna «Monto
mensual» que ya existe (`GastosFijosPlantillasPanel.tsx:177`).

---

## 3. La interfaz — panel y confirmación

### 3.1 Dónde va el botón

Tercer botón de la columna «Acciones» de `GastosFijosPlantillasPanel`, junto a «Editar» y
«Desactivar»/«Activar»: `<Button variant="destructive" size="sm">Eliminar</Button>`. Se deshabilita
sólo esa fila mientras su borrado está en vuelo (mismo patrón que el estado `alternando`).

### 3.2 La confirmación

`components/shared/Modal.tsx` con `confirmVariant="destructive"` — la primitiva que este mismo
panel ya usa a través de `GastoFijoPlantillaDialog`. Nada nuevo, ni un `AlertDialog` de shadcn que
haría el mismo trabajo con otra API.

**Contenido (R14–R16):**

- **Título:** `Eliminar plantilla de gasto fijo`
- **Descripción:** `«Alquiler bodega» — ₡10.000`
- **Cuerpo:** las tres consecuencias, en este orden y sin rodeos:
  - La plantilla desaparece de esta tabla.
  - Deja de generar cobros automáticos.
  - Los cobros ya hechos **siguen en el libro de movimientos**: no se borran ni se modifican.
  - Y la alternativa, en su propia línea: *«Si sólo querés dejar de cobrarla por ahora, usá
    Desactivar: la plantilla se queda y podés reactivarla cuando quieras.»*
- **Botones:** `Eliminar` (destructivo) / `Cancelar`.

Sobre el «usá / querés»: el panel ya es **voseo** («No tenés permiso para administrar plantillas»,
`GastosFijosPlantillasPanel.tsx:156`). Se sigue la forma del archivo, no se abre aquí el debate de
la ficha 331 — que es justamente la ficha que decidirá la forma para toda la app.

### 3.3 Después del borrado (R18–R20)

`ok` → `toast.success("Plantilla eliminada.")` + `recargar()` (el `mutate` de SWR ya existente) +
`router.refresh()`. Los cuatro estados de error mapean a cuatro mensajes distintos, calcados de
`alternarActiva` (l. 150-164), más el de `not_found`: *«La plantilla ya no existe.»* seguido de
`recargar()` — porque en ese caso el listado del usuario está desactualizado y releerlo es la
respuesta correcta.

**R20 — la página que se queda vacía.** Con paginación server-side, borrar la única fila de la
página 3 deja una tabla vacía con un mensaje («Todavía no hay plantillas de gasto fijo») que es
**falso**: sí las hay, en la página 1. Regla mínima, evaluada tras un borrado con éxito:

```
si (filas visibles antes del borrado === 1 && page > 1) setPage(page - 1)
```

Nada de recalcular el número total de páginas ni de tocar `Pagination`: es una condición sobre lo
que el panel ya tiene en la mano. Con 2 plantillas en producción hoy no puede dispararse; se
escribe porque el día que haya 30 se disparará sin que nadie lo pruebe.

---

## 4. La revocación, escrita donde se lee (R21–R24)

### 4.1 Censo completo de lo que hoy afirma `45/R25`

Verificado con `grep` sobre el árbol (el índice del grafo no ve comentarios). **Catorce sitios en
producción + dos en tests + el spec de la 45:**

| # | Archivo | Línea(s) | Qué dice hoy | Qué hacer |
| --- | --- | --- | --- | --- |
| 1 | `db/schema.prisma` | 1815 | «NO se borra (R25): la desactivacion… preserva el rastro» | reescribir con la revocación |
| 2 | `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts` | 7-8 | «NO expone `delete` (R25)» | reescribir |
| 3 | idem | 33 | «activa/desactiva una plantilla (sin borrado)» | reescribir |
| 4 | `lib/interfaces/services/IGastoFijoPlantillaService.ts` | 12-14 | «Sin borrado (R25)» | reescribir |
| 5 | idem | 59 | «activa/desactiva (sin borrado)» | reescribir |
| 6 | `lib/services/GastoFijoPlantillaService.ts` | 27-28 | «Sin borrado (R25)» | reescribir |
| 7 | idem | 74 | `// R25 (sin borrado)` | reescribir |
| 8 | idem | 108-109 | «una tabla de CONFIGURACION que un humano da de alta a mano y **que no se borra (R25)**» | **cuidado**, ver §4.2 |
| 9 | `lib/repositories/GastoFijoPlantillaRepository.ts` | 57-59 | «CRUD sin borrado (R25)» | reescribir |
| 10 | idem | 96 | «activa/desactiva (sin borrado)» | reescribir |
| 11 | `lib/types/gasto-fijo-plantilla.ts` | 66 | «activar/desactivar (sin borrado…)» | reescribir |
| 12 | `lib/actions/gasto-fijo-plantilla.ts` | 31 | «Sin borrado (R25)» | reescribir |
| 13 | idem | 118 | «(solo maestro; sin borrado)» | reescribir |
| 14 | `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` | 66-70 | «(NUNCA borrar, R25…)» | reescribir |
| 15 | `app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx` | 18, 23 | «Sin borrado (R25): la desactivación (en el panel) es el mecanismo» | reescribir |
| 16 | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` | 188-199 | `describe("— sin borrado (R25)")` afirma que el service **no** expone borrado | **INVERTIR**, ver §4.3 |
| 17 | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` | 12-15 | comentario «(nunca borran)» | actualizar |
| 18 | `specs/45-wallet-gastos-sueldos/{requirements,design,tasks}.md` | varias | el requisito original | **apéndice**, ver §4.4 |
| — | `db/migrations/20260713150000_gasto_fijo_plantilla/migration.sql` | 6-7 | «NO se borra (R25)» | **NO SE TOCA** (R24) |

**La nota de la revocación**, una sola vez larga (en `IGastoFijoPlantillaRepository`, que es donde
`45/R25` estaba enunciado con más fuerza) y en el resto una línea con el puntero. Las cuatro piezas
que el guardia va a exigir (R22): la palabra **revoca**, la **fecha** `2026-08-29`, el **motivo**
(la tabla acumula ruido y el histórico no depende de la plantilla) y el **puntero**
`specs/332-eliminar-plantilla-gasto-fijo`.

### 4.2 El sitio #8 hay que leerlo antes de reescribirlo

`GastoFijoPlantillaService.ts:103-115` usa «no se borra (R25)» dentro de un argumento **que no es
sobre el borrado**: es la excepción declarada a `170/R29` de la feature 184, y dice que la tabla de
plantillas no puede crecer sin límite porque es configuración dada de alta a mano, no una bitácora.

**Ese argumento sobrevive intacto** — de hecho se refuerza: si ahora las plantillas **se pueden
borrar**, la tabla crece todavía menos. Lo que hay que cambiar es la premisa citada, no la
conclusión. Sustituir el «que no se borra (R25)» por «que se da de alta y de baja a mano (ficha
332)» y **dejar el resto del párrafo tal cual**. Borrar el párrafo entero sería tirar la excepción
declarada de otra feature viva.

### 4.3 El test #16 se INVIERTE, no se borra

`tests/unit/services/gasto-fijo-plantilla-service.test.ts:188-199` afirma hoy que el service y el
repo **no** exponen `borrar`/`eliminar`/`delete`. Es el testigo de `45/R25`, y este repo tiene
convención escrita para esto (`decision5-revertida`, `d5-revertida`, `reversion-r49`): *la decisión
vieja no se borra, se da vuelta*. El `describe` pasa a llamarse **«borrado habilitado — la ficha
332 revoca 45/R25»** y sus aserciones se invierten: el service **sí** expone `eliminarPlantilla`, el
repo **sí** expone `eliminar`, y se conserva en el comentario del bloque que hasta el 2026-08-29
afirmaba lo contrario, con el puntero. Quien lo lea dentro de seis meses tiene que poder ver que
hubo una decisión anterior y quién la cambió.

Nota práctica: `buildRepo` (l. 38-50) y el `fakeService` de
`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` (l. 34-57) son **literales completos** de
sus interfaces; añadir un método las rompe en typecheck. Igual `fakePlantillaRepo` de
`tests/integration/db/generacion-gastos-fijos.test.ts:81-92`. Son tres dobles a actualizar, y salen
en el typecheck, no en rojo silencioso.

### 4.4 El apéndice en el spec de la ficha 45

Se **añade** al final de `45/R25` (y a la línea equivalente de su `design.md:236`) un bloque del
tipo:

> **⚠️ SUPERSEDED 2026-08-29 por la ficha 332** (`specs/332-eliminar-plantilla-gasto-fijo`). El
> borrado de plantillas dejó de estar prohibido: decisión humana de esa fecha. El texto de arriba
> se conserva verbatim como la foto de su momento — la premisa que lo sostenía («preserva el
> historial y los egresos ya emitidos») resultó no depender de la plantilla: no hay FK y la
> descripción del movimiento ya lleva el concepto.

**El texto original NO se reescribe.** Un spec es la foto de su fecha; si se «deja coherente», se
borra la prueba de que aquella decisión se tomó a conciencia. El guardia lo verifica con testigos
verbatim (R23).

### 4.5 El guardia

Un solo archivo, `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts`, con seis
bloques (a–f) que cubren R21–R25. Lo selecciona `vitest run guard` por el nombre; no hay que
registrarlo en ninguna lista. Dos exigencias que este repo aprendió a la mala y que aplican aquí:

- **El detector se auto-prueba** (bloque 0): los archivos censados existen, ninguno está vacío y el
  censo no está vacío. Una guardia estática rota no falla: calla.
- **`db/migrations/**` queda fuera del censo con su motivo escrito EN el archivo del guardia** (R24),
  no como una exclusión silenciosa que el siguiente lector tome por descuido.

---

## 5. Contrato con la ficha 333 — el único punto delicado

La ficha 333 va a introducir **cobros pendientes de aprobación**: el cron dejará de escribir el
egreso directo en el libro y creará un pendiente que un administrador aprueba o rechaza.

**Decisión humana ya tomada (2026-08-29):** al eliminar una plantilla, sus cobros pendientes **se
cancelan**, y la confirmación lo dice **con el número delante**: «se cancelarán 2 cobros
pendientes».

**Reparto de responsabilidad — y esta ficha lo respeta:**

| | Ficha 332 (esta) | Ficha 333 |
| --- | --- | --- |
| Tabla de pendientes | **no la menciona ni la esquematiza** | es su dueña |
| Cancelación en cascada al borrar | **no la implementa** | la implementa |
| El número en la confirmación | **no lo calcula** | lo calcula y lo pasa al diálogo |
| El contrato escrito | **lo escribe** (R25) | lo cumple (R26) |

**Por qué así:** la 333 es dueña de la tabla de pendientes. Que la 332 inventara su esquema —aunque
fuera «sólo un contador»— sería fijar hoy un modelo que mañana decide otra ficha, y en la peor
posición para decidirlo. La 332 declara la interacción y se detiene ahí.

**La 332 es implementable HOY, sin la 333, y el borrado es correcto tal cual.** Hoy no existe
ninguna tabla de pendientes: no hay nada que cancelar, el número sería siempre 0 y la confirmación
no lo menciona. Nada en el diseño de la 332 queda «a medias» esperando a la 333.

**Lo que la 333 tendrá que hacer cuando llegue** (esto es lo que R25 obliga a dejar escrito en el
docstring de `eliminarPlantilla`, además de aquí):

1. Cancelar los cobros pendientes de la plantilla **en la misma operación atómica** que la borra —
   una transacción que abarque los dos pasos. Media cancelación con la plantilla ya borrada deja
   pendientes huérfanos que apuntan a una plantilla que no existe, y ésos sí serían inalcanzables.
2. **Contarlos ANTES** y pasar el número a la confirmación, para que el usuario lea «se cancelarán
   2 cobros pendientes» antes de aceptar, no después.
3. Si al ejecutar el borrado el número cambió (alguien aprobó uno entre medias), la 333 decide qué
   hace; la 332 no lo prejuzga.

**Punto de sutura previsto, sin construirlo hoy:** `eliminarPlantilla` es el sitio donde entra la
transacción, y `EliminarPlantillaServiceResult` es el tipo que ganará el campo del conteo. No se
añade hoy ni un parámetro opcional ni un `deps` de más «por si acaso»: un asiento vacío
esperando a un invitado que quizá cambie de forma es peor que ninguno.

---

## 6. Alternativas descartadas

### 6.1 ❌ Soft-delete (`deleted_at`) o «papelera» de plantillas

**Qué era:** añadir `deleted_at` a `gasto_fijo_plantilla`, filtrarlo en los cuatro listados
(`listar`, `listarPaginado`, `listarActivas`, `listarPlantillasCompleto`), y ofrecer una vista de
papelera para restaurar.

**Por qué se descarta:**

1. **No es lo que el humano pidió.** Textual: *«poder prescindir y eliminarlo de la tabla de
   plantillas pues hace ruido»*. Una fila con `deleted_at` **sigue en la tabla**: el ruido no se va,
   se esconde detrás de un `WHERE`.
2. **Ya existe el mecanismo reversible y se llama `activa`.** Un soft-delete sería un **segundo**
   eje de estado sobre la misma fila: `activa=false` + `deleted_at=null` vs `activa=true` +
   `deleted_at≠null`… cuatro combinaciones para dos intenciones. La `activa=false` de hoy **es** la
   papelera; el hueco era la salida definitiva.
3. **Cuesta migración + cuatro `WHERE` nuevos**, y cada `WHERE` que se olvide es una fila borrada
   que reaparece. La ficha es de complejidad baja precisamente porque no toca el esquema.
4. **Coste de equivocarse, medido:** cero movimientos emitidos y 2 plantillas en producción. No hay
   ningún dato cuyo borrado accidental haya que poder deshacer.

### 6.2 ❌ Bloquear el borrado si la plantilla ya generó movimientos

**Qué era:** antes de borrar, contar movimientos con `origen_id LIKE '<id>:%'` y devolver `in_use`
si hay alguno — el patrón `VehiculoService.borrar` (`lib/services/VehiculoService.ts:59-73`).

**Por qué se descarta:** en `Vehiculo` la comprobación existe **para dar un mensaje mejor que el
fallo de una FK real** (`ON DELETE RESTRICT`, y el comentario del propio servicio lo dice: *«esta
comprobacion es para el MENSAJE, no para la integridad»*). Aquí **no hay FK ni integridad que
proteger**: el movimiento sobrevive intacto y se explica solo. Bloquear el borrado convertiría el
mecanismo en inservible justo para el caso que motiva la ficha —una plantilla vieja, que cobró
durante meses y ya no sirve, es exactamente la que **más** ruido hace—. Además, obligaría al
repositorio a mirar `wallet_movimiento`, ensanchando su `Pick<PrismaClient, "gastoFijoPlantilla">`
y tirando la garantía estructural de R8.

### 6.3 ❌ Borrado en cascada declarado en la base (FK + `ON DELETE`)

**Qué era:** añadir una FK real de `wallet_movimiento` a `gasto_fijo_plantilla` para que la
relación fuese explícita, con `ON DELETE SET NULL` o `RESTRICT`.

**Por qué se descarta:** `origen_id` es una **columna polimórfica** —guarda el origen de cualquier
categoría de movimiento, no sólo de gastos fijos— y además guarda una clave **compuesta**
(`'<id>:<periodo>'`), no un uuid. No hay FK posible sin rediseñar el libro entero, que es una tabla
inmutable con 38 filas en producción y varias features encima. Es exactamente el rediseño que esta
ficha tiene prohibido.

### 6.4 ❌ Reutilizar `setActivaPlantilla` con un tercer estado (`archivada`)

**Qué era:** convertir el booleano `activa` en un enum de tres valores.

**Por qué se descarta:** cambia el tipo de una columna que el cron filtra (`where: { activa: true }`,
índice `gasto_fijo_plantilla_activa_idx`), obliga a migración de datos y de índice, y **la fila
sigue en la tabla** — o sea, no resuelve el problema. Todo el coste de 6.1 sin ni siquiera su
ventaja.

### 6.5 ❌ Confirmación con `window.confirm`

Descartado sin más: el repo tiene `components/shared/Modal.tsx` con `confirmVariant="destructive"`,
foco atrapado, `aria-modal` y anti-doble-submit, y este mismo panel ya lo usa. `window.confirm` no
es testeable en jsdom sin mockear un global, y R14–R16 exigen contenido rico (concepto, monto
formateado, tres consecuencias y una alternativa) que no cabe en un `confirm`.

---

## 7. Riesgos declarados

**R-1 · Borrar y volver a crear el mismo concepto puede cobrar dos veces el mismo periodo.**
La idempotencia del cron es `origen_id = '<plantillaId>:<periodo>'` bajo el índice único parcial
`(origen_tipo, origen_id, categoria)`. Si se borra «Alquiler» después de que cobró `2026-09` y se
crea otra plantilla «Alquiler», la nueva tiene **otro uuid** → otra clave → el cron puede emitir un
segundo egreso del mismo mes, y el índice único no lo impide porque son claves distintas.

- **No lo introduce esta ficha:** hoy se consigue lo mismo creando una segunda plantilla con el
  mismo concepto, sin borrar nada.
- **Hoy es nulo:** cero movimientos emitidos en producción.
- **Mitigación, y es de diseño, no un parche:** la confirmación empuja a **Desactivar** cuando la
  intención es pausar (R16). Desactivar conserva el id y con él la clave; eliminar la tira. Está
  dicho con esas palabras en el diálogo porque el usuario no tiene por qué saber qué es una clave
  de idempotencia.
- **Queda anotado en el docstring de `eliminarPlantilla`**, junto a la nota de idempotencia que
  `GeneracionGastosFijosService` ya lleva («ojo, aca se puede duplicar plata»).

**R-2 · Conflicto de archivos con la ficha 85.** Las dos tocan
`GastosFijosPlantillasPanel.tsx` y `GastoFijoPlantillaDialog.tsx`; la 85 además va a quitarle los
defaults al schema de ACTUALIZAR en `lib/types/gasto-fijo-plantilla.ts`, archivo que esta ficha
también toca (para añadir `eliminarPlantillaSchema`). Van **secuenciadas**, no en paralelo. Es lo
que explica el `depends_on: 85` de la ficha (ver Pregunta abierta 1).

**R-3 · La medición de producción envejece.** El «cero movimientos `egreso_gasto_fijo`» es del
2026-08-29 y **no se re-midió en esta sesión**. Si entre la aprobación del spec y el despliegue el
cron llega a emitir alguno, nada del diseño cambia (R8/R9 los protegen igual), pero el texto de la
confirmación pasa de ser una precaución a ser una descripción de algo que sí ocurrió. Vale la pena
volver a contarlos antes de desplegar.

---

## 8. Verificación

- **El gate rápido NO sirve para esta ficha, y se niega solo.** El diff toca
  `db/schema.prisma` y archivos con nombre de dinero en su ruta
  (`app/(app)/wallet/...`, `lib/actions/gasto-fijo-plantilla.ts`), dos de las rutas que
  `docs/verification.md §"Cuándo --rapido se niega"` marca como cimientos. **Se corre `./init.sh`
  completo.** No es una elección del implementer: el gate lo impone.
- **El test que prueba R8/R9 de verdad vive contra Postgres.**
  `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` inserta una plantilla, inserta su
  movimiento con `origen_id = '<id>:2026-09'`, borra la plantilla y comprueba que el movimiento
  sigue ahí con monto, fecha, `origen_id` y descripción intactos. Ese archivo va envuelto en
  `HAY_BASE_DE_DATOS`: **sin `DATABASE_URL` se salta y la suite queda verde sin haberlo ejecutado**.
  El implementer debe declarar en `progress/impl_332.md` si corrió o se saltó, y el test debe
  **fallar** —no `return`— si el fixture no se pudo crear.
- **Los tests de servicio no ven el `WHERE`.** Por eso R3 se cubre en
  `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` con un doble de Prisma que captura
  los argumentos de `deleteMany`, no en el test del servicio con un `vi.fn()`.
- **Repaso a mano obligatorio.** Es superficie visible nueva (botón destructivo + diálogo de
  confirmación) y en este repo un repaso visual de minutos encontró 7 textos rotos que 12.000 tests
  daban por buenos. Un subagente no puede levantar un navegador: la tarea queda para el humano o
  para una sesión con navegador, y **no se marca hecha** por haber pasado los tests.
