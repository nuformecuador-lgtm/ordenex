# Ficha 380 — Design

## 0. Contexto técnico confirmado en el árbol real

Leído en los archivos (tip `988c1345`, con la 376 y la 377 ya mergeadas), no en el grafo del MCP.
Las correcciones a la ficha están en `requirements.md`; aquí solo lo que el diseño usa.

- **`lib/repositories/ZonaRepository.ts`**
  - `update` (`:313-534`) abre UN `$transaction` que hoy hace, en este orden: lee `exists` con
    `esCentral` (`:323`), rechaza `sin_zona_central` (`:333`), lee `centralPrevia` (`:341`), apaga la
    central anterior (`:351`), `tx.zona.update` (`:357`), lee `distritosPrevios` **antes** de
    borrarlos (`:370`), reemplaza la N:M (`:376-381`), **reemplaza los pagos**
    (`tx.tarifaZonaMensajero.deleteMany` + `createMany`, `:382-385`), reconcilia órdenes y llama a
    `appendAccion` con `orden_zona_reconciliada` (`:480`), llama a `appendAccion` con
    `zona_central_cambiada` si la marca llegó (`:514`), y por último lee las tarifas para el DTO
    (`:521`).
  - `create` (`:191-238`) crea la zona, sus distritos y sus pagos (`:218`), y registra el traslado de
    la marca si procede (`:225`).
  - `hardDelete` (`:545-602`) borra pagos, N:M y zona, y registra `zona_borrada` (`:573`).
  - `ZonaPrismaClient` (`:25-38`) ya incluye `tarifaZonaMensajero`, `historialAccion`, `usuario` y
    `$transaction`. **No hay que ensancharlo.**
- **`db/schema.prisma:1460-1479`** — `TarifaZonaMensajero`: `cobroEntregado` y `cobroRechazado` son
  `Decimal(12,2)`, `vehiculoId` es `String?`, y hay `@@unique([zonaId, vehiculoId])` con
  `NULLS NOT DISTINCT` en SQL: **a lo sumo un pago por (zona, vehículo), y a lo sumo un pago por
  defecto por zona**. Eso es lo que hace que `vehiculoId` sea una clave válida para comparar
  conjuntos.
- **`lib/repositories/registrar-accion.ts`** — `appendAccion(tx, entradas, loteId?)`: no-op con lote
  vacío, un `lote_id` por LLAMADA, y `resolverActorCongelado(tx, actorUsuarioId)` con `ACTOR_SISTEMA`
  (los tres campos a `null`) cuando no hay usuario.
- **`lib/interfaces/repositories/IHistorialAccionRepository.ts:57-72`** — `EntradaAccion`;
  `entidadEtiqueta` «sale SIEMPRE de `etiquetaDeEntidad`, nunca de una interpolación a mano».
- **`lib/types/historial-accion.ts`** — catálogo CERRADO de **49** tipos, exhaustivo en las dos
  direcciones (`satisfies` + `_AsegurarExhaustivoTipos`). `HISTORIAL_ACCION_ENTIDADES` tiene 20 y ya
  incluye `zona`.
- **`lib/types/historial-accion-etiquetas.ts`** — `etiquetaDeEntidad("zona", { nombre })` ya existe y
  ya la usan `zona_borrada` y `zona_central_cambiada`.
- **Guardias que esta ficha mueve**, con sus números duros:
  `historial-accion-escrituras-cubiertas.guardia.test.ts` (CENSO a mano, `toHaveLength(49)` en
  `:689`, detector que recorre TODAS las llamadas a `appendAccion`),
  `catalogo-y-choke-point.test.ts` (`:79-82` los 49/20, `:265-279` el reparto 27/10/12),
  `historial-accion-orden-zona-reconciliada-migration.test.ts` (`:94-101` la lista `POSTERIORES`).
- **`scripts/db-rollback.ts`** revierte **la última carpeta por orden de nombre**, no una elegida.

## 1. Qué se registra, y cuándo (R1–R3, R5, R6)

**Una fila por GUARDADO que deja el pago distinto**, no una por fila de `tarifa_zona_mensajero`.

- **Entidad:** `zona`, `entidad_id` = id de la zona guardada. **No se amplía el enum de entidades.**
- **Etiqueta:** `etiquetaDeEntidad("zona", { nombre: zona.nombre })` — el nombre **después** del
  guardado, igual que hace `zona_central_cambiada`.
- **`monto`, `valor_anterior`, `valor_nuevo`:** `NULL` (R9; ver §3 y Q2).

**Por qué la fila cuelga de la ZONA y no de la tarifa.** Los `id` de `tarifa_zona_mensajero` **no
sobreviven al siguiente guardado**: el `deleteMany` + `createMany` los regenera todos. Una fila de
auditoría anclada a un `entidad_id` que el próximo guardado destruye es una fila que nadie podrá
seguir: `@@index([entidadTipo, entidadId])` devolvería un id huérfano. El id de la zona es estable y
es donde un humano pregunta («¿qué le pasó a esta zona?»), que es además donde la 376 ya dejó su
rastro.

**El predicado del cambio (R3).** El conjunto de pagos de una zona es el conjunto de tripletas
`(vehiculo_id, cobro_entregado, cobro_rechazado)`. Cambió si:

- aparece un `vehiculo_id` que no estaba (alta), o
- desaparece uno que estaba (baja), o
- alguno de los dos importes de un mismo `vehiculo_id` es distinto.

El `id` **no entra**, y no por disciplina: el `select` de la lectura previa **no lo pide**, y el tipo
del parámetro del comparador no lo declara. No se puede mirar lo que no se leyó.

**Contra qué se compara.** Contra el estado de la **tabla** antes y después, no contra el payload:

- «antes» = lectura nueva de `tarifa_zona_mensajero` de esa zona, colocada **junto a
  `distritosPrevios` y por el mismo motivo** (después del `deleteMany` ya no habría a quién
  preguntar);
- «después» = la lectura que **ya existe** al final del método para construir el DTO (`:521`),
  simplemente **movida** hasta justo después del `createMany`. Cero consultas nuevas por ese lado, y
  el DTO sigue recibiendo exactamente lo mismo.

Comparar estados de la tabla —y no «lo que pedí» contra «lo que había»— hace que la escala de los
decimales sea la misma en los dos lados por construcción (`Decimal(12,2)`), así que `1500` guardado y
releído es `1500.00` en ambos y no puede producir un falso «cambió».

**Coste:** UNA consulta más por guardado (`findMany` por `zona_id`, que tiene índice `@@index([zonaId])`).

**`create` (R5):** no hay estado previo. Se escribe la fila si y solo si la zona se creó con al menos
un pago. **`hardDelete` (R6):** no se escribe nada; `zona_borrada` ya documenta la desaparición.

## 2. Dónde vive el predicado, y por qué es un módulo aparte

`lib/repositories/_shared/pago-mensajero-cambio.ts`, junto a `zona-colapso.ts` y `prisma-fk.ts`, que
son sus hermanos de forma:

```ts
export interface PagoComparable {
  vehiculoId: string | null;
  cobroEntregado: Prisma.Decimal;
  cobroRechazado: Prisma.Decimal;
}

/** ¿El conjunto de pagos de la zona quedó distinto? Ni el `id` ni el orden participan (R3). */
export function cambioElPagoAlMensajero(
  previos: readonly PagoComparable[],
  nuevos: readonly PagoComparable[],
): boolean;
```

**Dos motivos, y ninguno es estético:**

1. **Money-safe acotado (R4).** La regla «ni `Number(`, ni `parseFloat(`, ni `.toNumber(`» **no se
   puede escribir sobre `ZonaRepository.ts`**: `tarifaToDTO` (`:85-92`) usa `.toNumber()` de forma
   legítima para el DTO de la pantalla, y una guardia a nivel de archivo nacería roja. Sobre un
   módulo de 20 líneas que solo compara dinero, la guardia es total y su contraprueba es trivial.
2. **Se puede ejercer exhaustivamente sin base.** Es una función PURA: alta, baja, cambio de un
   importe, cambio de los dos, mismo conjunto en otro orden, `1500` frente a `1500.00`, conjunto
   vacío frente a conjunto vacío. Un doble de Prisma no puede engañar a una función que no habla con
   Prisma. (Lo que un doble SÍ falsea —qué filas se borran y cuáles se recrean— va a integración,
   §7.)

**La comparación se hace en STRING de escala 2** (`cobroEntregado.toFixed(2)`), que es el método del
propio `Prisma.Decimal` y no pasa por coma flotante. Es la misma conversión que ya bendice el repo en
`TarifaZonaMensajeroRepository.toPagoTarifa` y en `HistorialAccionService`. `Decimal.equals` daría el
mismo resultado; se elige `toFixed(2)` porque permite construir una clave de comparación de conjuntos
en un `Map` sin escribir un doble bucle.

## 3. El tipo nuevo del catálogo, y por qué NO se reutilizan `tarifa_*`

| Campo | Valor |
| --- | --- |
| Tipo | `zona_pago_mensajero_cambiado` |
| Entidad | `zona` (ya existe) |
| Categoría | `mueve_dinero` |
| Etiqueta | «Cambió el pago al mensajero de una zona» |
| Productores | `ZonaRepository.update` y `ZonaRepository.create` |

**Nombre:** sigue la familia de la entidad, como `zona_borrada` y `zona_central_cambiada`. Somete a
firma en Q1.

**Categoría `mueve_dinero`, y no es de gusto.** R17 de la 362 exige EXACTAMENTE una categoría por
tipo. `tarifa_zona_mensajero` es la entrada de `resolvePagoTarifa` (feature 39), o sea **lo que se le
paga a un mensajero por cada entrega y por cada rechazo**. No hace desaparecer nada (la zona sigue
ahí) ni cambia quién puede hacer qué.

**Por qué NO se reutilizan `tarifa_creada` / `tarifa_actualizada` / `tarifa_borrada`** —la pregunta
que el encargo obliga a contestar explícitamente—:

1. **Apuntan a otra tabla.** Sus productores son `TarifaRepository.createUnsafe/update/hardDelete`
   sobre `tarifas`: el flete que se le cobra a la TIENDA. Aquí se registra lo que se le paga al
   MENSAJERO. Son dos lados del mismo negocio y confundirlos en un filtro de auditoría es
   exactamente el error que la pantalla de historial existe para no cometer.
2. **Romperían el índice de entidad.** `entidad_tipo = 'tarifa'` significa hoy «un id de la tabla
   `tarifas`». Escribir ahí ids de `tarifa_zona_mensajero` metería **dos espacios de identificadores
   distintos bajo la misma clave**, y `@@index([entidadTipo, entidadId])` dejaría de responder «¿qué
   le pasó a esta tarifa?» sin decir que ha dejado de hacerlo.
3. **La etiqueta ya está definida para otra cosa.** `FuentesEtiqueta.tarifa` es
   `{ zonaNombre, tiendaNombre }` (`historial-accion-etiquetas.ts:80`), pensada para «a quién aplica
   esta tarifa de flete». Un pago al mensajero no tiene tienda.
4. **El coste que ahorraría es exactamente una migración aditiva de una línea.** No compensa.

**Lo que la fila NO lleva, y su precedente literal.** `tarifa_actualizada` registra el hecho y nada
más sobre una tabla con **diez** columnas de dinero (`TarifaRepository.update:225-233`). Se hace
igual aquí. La limitación —el registro no dice de cuánto a cuánto— está declarada en `requirements.md`
(Q2) y no se disimula.

## 4. Modelo de datos y migración

**Sin tablas, sin columnas, sin índices, sin RLS nueva.** `historial_accion` conserva su RLS
habilitada sin policies (solo service role) desde la 362; un valor de enum no la toca.

```sql
-- UP (db/migrations/<timestamp>_historial_accion_zona_pago_mensajero/migration.sql)
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'zona_pago_mensajero_cambiado';
```

Va **sola** en su archivo: Postgres prohíbe USAR un valor de enum en la misma transacción que lo
añade (`55P04`) y Prisma Migrate corre cada `migration.sql` en su propia transacción. Mismo patrón
que las seis ampliaciones anteriores.

**`down.sql`** recrea `historial_accion_tipo` con la lista **PREVIA (49 valores)** y recastea la
única columna que lo usa (`historial_accion.accion`). De dónde sale esa lista, sin lugar a duda: es
el `CREATE TYPE` de `20260907130000_historial_accion_zona_central_cambiada/down.sql` (48 valores)
**más** `'zona_central_cambiada'` al final, que es el valor que aquella migración añadió y que su
propio `down` no podía listar. `ADD VALUE` sin `BEFORE`/`AFTER` **apende**, así que ése es el
`enumsortorder` real.

**Ningún `down.sql` anterior se toca:** son fotos históricas.

### 4.1 ⚠️ La trampa del `down.sql`, y cómo se evita aquí

Un `down.sql` de enum en este repo **recrea el tipo con la lista completa** (Postgres no sabe borrar
un valor suelto). Esa lista es **una foto del punto de ramificación**. Medido el 2026-09-07: el
`down.sql` de la rama de la 381 —ramificada antes del merge de la 376— **borró `zona_central_cambiada`
de la base local sin un solo error**; el síntoma fueron 7 tests rojos en 6 archivos ajenos.

Tres defensas, y ninguna es «acordarse»:

1. **El test de la migración reconstruye el pasado ejecutando las migraciones REALES**, no copiando
   la lista del `down.sql` que prueba, y compara **valor a valor y en orden** (patrón de
   `historial-accion-zona-central-migration.test.ts:218-269`). Una lista mal copiada se pone roja y
   **dice cuál falta**.
2. **Las carpetas anteriores se DESCUBREN leyendo `db/migrations`** —las que contienen
   `historial_accion_tipo` y ordenan antes que ésta—, en vez de escribirse a mano como constantes
   (`DIR_374`, `DIR_375`…). Es la diferencia entre un test que caduca en el merge y uno que se entera:
   si `dev` trae una ampliación nueva mientras esta rama está abierta, la reconstrucción la incluye,
   la comparación con el `down.sql` falla y obliga a actualizar la lista **antes** del PR.
3. **Y una aserción que cierra el círculo:** la lista previa reconstruida DEBE ser exactamente
   `HISTORIAL_ACCION_TIPOS` menos el valor nuevo. Si el catálogo de TypeScript y las migraciones
   discrepan, no hay forma de que las tres cosas cuadren por casualidad.

**Precondición ruidosa, heredada y deliberada (R17):** revertir solo es seguro si NINGUNA fila usa
todavía `zona_pago_mensajero_cambiado`. Si queda alguna, el `USING` del `ALTER COLUMN` aborta el
rollback. Es lo correcto: esa fila es lo único que dice quién tocó lo que cobra una persona.

**Y el aviso operativo, que ya costó una tarde:** `pnpm run db:rollback` revierte **la última carpeta
por nombre**, no la que uno quiera. Después de revertir cualquier cosa en esta área, se reaplican los
`migration.sql` de las fichas mergeadas después (`ADD VALUE IF NOT EXISTS` es idempotente) y se corre
`tests/integration/db` para comprobar que la base vuelve a ser el catálogo.

## 5. Flujo transaccional

### 5.1 `ZonaRepository.update` — dentro del `$transaction` que ya existe

Los pasos **nuevos** son tres, y ninguno mueve a los demás de sitio:

1. **[380/R1]** Junto a `distritosPrevios` (`:370`), y por el mismo motivo, ANTES del `deleteMany`
   de pagos:
   ```ts
   const pagosPrevios = await tx.tarifaZonaMensajero.findMany({
     where: { zonaId: id },
     select: { vehiculoId: true, cobroEntregado: true, cobroRechazado: true }, // sin `id` (R3)
   });
   ```
2. La lectura final de tarifas (`:521`) **se mueve** a justo después del `createMany` y conserva su
   `select` completo: la sigue consumiendo `toDTO` (R18) y ahora también el comparador.
3. **[380/R1/R11/R12]** Al lado del bloque de la 376, DENTRO del callback y recibiendo **`tx`**:
   ```ts
   if (cambioElPagoAlMensajero(pagosPrevios, tarifas)) {
     const actorDelPago = await resolverActorCongelado(tx, actorUsuarioId);
     await appendAccion(tx, [{
       accion: "zona_pago_mensajero_cambiado",
       entidadTipo: "zona",
       entidadId: id,
       entidadEtiqueta: etiquetaDeEntidad("zona", { nombre: zona.nombre }),
       ...actorDelPago,
     }], randomUUID());
   }
   ```

**Sobre el `lote_id` (R11):** el de la 366 (reconciliación), el de la 376 (marca) y éste son **tres
lotes distintos** en el mismo guardado, a propósito. El lote agrupa filas HOMOGÉNEAS de un mismo
hecho; compartirlo haría que filtrar por lote devolviera una mezcla que nadie pidió. Es la misma
frase que ya está escrita en `ZonaRepository.ts:505-508`. Como `appendAccion` genera uno por LLAMADA,
la propiedad se cumple sola; el `randomUUID()` explícito solo la hace visible.

**Sobre el tercer `resolverActorCongelado`:** son, como mucho, tres lecturas por clave primaria
dentro de la misma transacción, y **solo cuando hay algo que escribir**. Izarlo al principio del
método lo ejecutaría en TODOS los guardados, incluidos los que no registran nada. Se deja local.

### 5.2 `ZonaRepository.create`

Después del `createMany` de pagos y junto al bloque de la 376:

```ts
if (data.tarifas.length > 0) {   // R5: sin pagos no hay fila
  const actorDelPago = await resolverActorCongelado(tx, actorUsuarioId);
  await appendAccion(tx, [{ accion: "zona_pago_mensajero_cambiado", entidadTipo: "zona",
    entidadId: zona.id, entidadEtiqueta: etiquetaDeEntidad("zona", { nombre: zona.nombre }),
    ...actorDelPago }], randomUUID());
}
```

No hay comparación porque no hay estado previo: la zona acaba de nacer.

### 5.3 `ZonaRepository.hardDelete`

**No se toca.** R6.

## 6. Contratos I/O

**Ninguno cambia (R18).** Ni `IZonaRepository`, ni `IZonaService`, ni `lib/types/zona.ts`, ni las
Server Actions, ni la pantalla. `UpdateZonaResult` sigue devolviendo `ok | not_found |
sin_zona_central` con `ordenesReconciliadas` y `ordenesRetenidasEnBodegaSatelite`; `CrearZonaResult`
sigue igual. La única superficie que gana algo es `/historial-de-acciones`, y **se entera sola**: el
selector de tipos se deriva de `HISTORIAL_ACCION_TIPOS` y la etiqueta de `ACCION_LABELS`.

Autorización: sin cambios. Todo el CRUD de zonas sigue siendo `maestro`-only.

## 7. Cómo se prueba lo que un doble no ve

**Los tests de servicio y de repositorio con dobles NO valen para R1–R3, R13 ni R19**, y está medido
cuatro veces en este repo: una mutación del `WHERE` pasa en verde contra dobles. Peor aquí: el doble
de `tx.tarifaZonaMensajero.findMany` devuelve **el mismo array** a la lectura de «antes» y a la de
«después» salvo que el test use `mockResolvedValueOnce`, así que **un test con dobles no puede
distinguir los dos estados**. Por eso:

- **`tests/integration/db/zona-pago-mensajero-rastro.test.ts` (Postgres real) es obligatorio** para
  R1, R2, R3, R5, R6, R7, R8, R9, R11, R13 y R19. Se cuelga del arnés que ya existe en
  `tests/integration/db/_postgres-real.ts` (`HAY_BASE_DE_DATOS`, `crearPrismaDeTest`,
  `enTransaccionRevertida`, `clienteConSavepoint`, `serializarEscriturasReales`, `fksDeOrden`), que es
  el mismo que usa `zona-central-guarda-y-rastro.test.ts`.
- **Anti-vacuidad, con la lección escrita:** **nada de `if (!fks) return;`**. Con base y sin catálogo,
  el `beforeAll` **lanza** con un mensaje que dice qué seed correr; sin base alcanzable, `describe.skip`
  VISIBLE. Y cada caso afirma primero su premisa (que la zona tenía N pagos, que los `id` cambiaron,
  que el guardado devolvió `ok`) antes de afirmar el efecto: un `expect(filas).toHaveLength(0)` sobre
  un escenario que no se sembró está verde por la razón equivocada.
- **La prueba de R3 es la más barata y la más decisiva:** guardar EL MISMO conjunto exacto, afirmar
  que los `id` de la tabla **cambiaron** (o sea, que el `deleteMany`+`createMany` sí corrió) y que aun
  así **no** hay fila. Mata a la vez «compara por id» y «escribe siempre».
- **R12 (atomicidad) tiene dos pruebas y las dos son necesarias:**
  (a) la **estructural**, en el censo de `historial-accion-escrituras-cubiertas.guardia.test.ts`, más
  una **contraprueba nueva con TRES llamadas** en el bloque de auto-prueba del detector: mutar la
  tercera —sacarla del callback y pasarle `this.prisma`— tiene que ponerlo rojo. La guardia recorre
  todas las llamadas desde la 376, pero **su auto-prueba solo enumera dos**, y una guardia que no se
  ha ejercido en la forma que va a vigilar es una guardia que no se ha probado;
  (b) la **de comportamiento**, contra Postgres: un guardado que revienta DESPUÉS de haber escrito
  —`distritoIds` con un id inexistente dispara la FK de `zonaDistrito`— tiene que dejar **cero** filas
  de historial y los pagos anteriores **intactos**.

## 8. Las guardias y los números duros que se mueven

| Archivo | Qué cambia |
| --- | --- |
| `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` | dos entradas nuevas en el CENSO (`update` con `mutacion: /tx\.tarifaZonaMensajero\.deleteMany\(/` y `create` con `/tx\.tarifaZonaMensajero\.createMany\(/`), `toHaveLength(49)` → **50**, y la contraprueba de tres llamadas |
| `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` | 49 → **50** tipos (dos aserciones) y `mueve_dinero` 27 → **28** |
| `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts` | `POSTERIORES` gana `zona_pago_mensajero_cambiado` |
| `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts` | **nada**: `ZonaRepository.ts` ya está en su censo (`:76`), así que el bloque nuevo se barre solo |
| `tests/unit/repositories/zona-repository.test.ts` | los casos que afirman `historialAccion.createMany` **no** fue llamado siguen verdes (el doble devuelve el mismo array a las dos lecturas ⇒ «no cambió»); los que cuentan llamadas hay que revisarlos uno a uno |

## 9. Riesgos declarados

- **El registro dice QUE cambió, no de cuánto a cuánto** (Q2), y el guardado destruye las filas
  viejas: ese dato no queda en ninguna parte. Es una decisión, no un descuido.
- **No hay backfill y no puede haberlo:** nadie registró los cambios anteriores. El rastro empieza el
  día del despliegue.
- **Una consulta más por guardado de zona.** `findMany` por `zona_id` (índice existente), sobre una
  tabla con como mucho una fila por vehículo y zona. Irrelevante, pero se dice.
- **La base local es COMPARTIDA entre worktrees.** Aplicar esta migración pone el enum nuevo en la
  base de las demás features; y su `down.sql`, si alguien lo corre desde una rama vieja, borra en
  silencio los valores ajenos (§4.1). Por eso esta ficha se implementa SOLA (`tasks.md`).
- **Ni una wallet, ni una liquidación, ni un `cierre_detail` se tocan.** Estructural: el flujo del §5
  no tiene una sola escritura fuera de `historial_accion`.

## 10. Fuera de alcance (y por qué)

- **Convertir el pago al mensajero a STRING en el borde y en el DTO.** `z.number()` en
  `lib/types/zona.ts:5` y `.toNumber()` en `tarifaToDTO` son preexistentes y cambiarlos es tocar el
  contrato de la pantalla de tarifas. Esta ficha se limita a no añadir un paso de coma flotante
  nuevo (R4).
- **Impedir o condicionar la reescritura de pagos.** R19: se registra, no se restringe.
- **Auditar el nombre y los distritos de una zona.** Q4.
- **Guardar los importes anteriores** en el historial o en una tabla de versiones. Q2: es modelo
  nuevo.
- **Los pagos que se van en cascada al borrar una zona.** R6: `zona_borrada` ya lo dice.

## 11. Alternativas descartadas

| Alternativa | Por qué se descarta |
| --- | --- |
| **Reutilizar `tarifa_creada`/`tarifa_actualizada`/`tarifa_borrada`** | Apuntan a la tabla `tarifas` (flete de la TIENDA); meterían ids de dos tablas bajo `entidad_tipo = 'tarifa'` y romperían `@@index([entidadTipo, entidadId])`, que existe para responder «¿qué le pasó a esta entidad?». Ahorra exactamente una migración aditiva de una línea (§3). |
| **Una fila por CADA pago afectado, con `entidad_id` = id de la fila de `tarifa_zona_mensajero`** | Ese id lo destruye el siguiente guardado: el rastro apuntaría a filas inexistentes y sería inseguible. Además exigiría una entidad nueva en el enum de entidades. |
| **Una fila por vehículo con los importes en `valor_anterior`/`valor_nuevo`** | Son dos importes por fila y la columna es `VarChar(60)` de vocabulario CERRADO —Postgres **no trunca**: un valor largo aborta la transacción del guardado—. Obligaría además a componer la etiqueta a mano, saltándose `etiquetaDeEntidad`, que es fuente única por diseño (362). |
| **Usar `valor_anterior`/`valor_nuevo` para el NÚMERO de pagos («2» → «0»)** | Distingue «se quedó sin pago» de «cambiaron importes», pero inventa una semántica que ningún tipo del catálogo tiene hoy (ahí van valores de enum o nombres de catálogo) y sigue sin decir de cuánto a cuánto: media respuesta con un precedente nuevo. Si el humano firma Q2, esto viene incluido en algo mejor. |
| **Escribir la fila SIEMPRE que se guarde la zona, sin comparar** | Es más simple y no necesita la lectura previa, pero convierte el registro en ruido: renombrar una zona diría «cambió el pago al mensajero», que es **falso**, en un registro que se descarga y no se purga. Y contradice el precedente explícito de R18 de la 376 (un no-cambio no deja fila). |
| **Comparar el payload de entrada contra el estado previo** | Ahorra mover la lectura final, pero compara «lo que pedí» con «lo que había» en vez de dos estados de la tabla: cualquier normalización de Postgres (escala del decimal) o cualquier fila que el `createMany` no llegara a escribir daría un veredicto que no describe la base. `appendAccion` exige registrar lo ALCANZADO, no lo PEDIDO. |
| **Meter el predicado dentro de `ZonaRepository`** | La guardia money-safe no se podría acotar: `tarifaToDTO` usa `.toNumber()` legítimamente en ese archivo y la guardia nacería roja (§2). |
| **Un trigger en Postgres sobre `tarifa_zona_mensajero`** | Sería inviolable incluso desde `psql`, pero este repo no tiene un solo trigger de negocio (mecanismo huérfano), no podría congelar el actor de la sesión de la app, y dejaría el registro fuera del punto único `appendAccion` que la 362 impuso y que una guardia vigila. |
