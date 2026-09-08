# Ficha 376 — Design

## 0. Contexto técnico confirmado en el árbol real (2026-09-07)

Todo lo de abajo se leyó en el archivo, no en el grafo del MCP —que en este repo miente devolviendo
símbolos ya borrados—.

- **`lib/types/zona.ts`**: `zonaFields` (`:21-32`) contiene `esCentral: z.boolean().default(false)`
  (`:26`); `crearZonaSchema = z.object(zonaFields).strict().superRefine(applyTarifaRules)` (`:89`) y
  `actualizarZonaSchema = crearZonaSchema` (`:94`). El esquema de crear es un **`ZodEffects`**, no un
  `ZodObject`: no tiene `.extend()` ni `.partial()`, así que la separación de crear/actualizar exige
  reordenar el archivo, no encadenar un método.
- **`lib/repositories/ZonaRepository.ts`**: `update` (`:196-345`) abre un `$transaction`, lee
  `exists` con `select: { id: true }` (`:203`), desmarca la central previa si
  `data.esCentral === true` (`:208-213`), escribe `esCentral: data.esCentral` (`:217`) y sigue con la
  reconciliación de la 366. `create` (`:102-127`) repite el desmarcado (`:107-109`). `hardDelete`
  (`:356-405`) lee `{ id, nombre }`, borra tarifas + N:M + zona, registra `zona_borrada`, y traduce
  toda violación de FK a `"referenced"` (`:402`). `findCentralZonaId` (`:417-423`) devuelve
  `string | null`.
- **`ZonaPrismaClient`** (`:24-35`) es un `Pick<PrismaClient, …>` que ya incluye `zona`,
  `historialAccion` y `usuario`; dentro del callback de `$transaction`, `tx` expone el tipo completo.
  **No hace falta ensancharlo** (mismo hallazgo que la 366/T4).
- **Prisma trata `undefined` como «campo no provisto»**: `data: { esCentral: undefined }` en un
  `update` NO escribe la columna. Es lo que hace barata la corrección de R1 — y también lo que la
  hace invisible en un test con dobles, por eso R1 se mide contra Postgres real (`tasks.md` T9).
  `null` NO sirve: Prisma intentaría escribir `NULL` en una columna `NOT NULL`.
- **`db/schema.prisma`**: `Zona.esCentral Boolean @default(false) @map("es_central")` (`:492`), con
  el índice único parcial `zona_es_central_unico` que impone «a lo sumo una». `CierreDetail.esCentral`
  (`:2239`) congela la marca al solicitar el cierre; una fila ya escrita ahí NO cambia pase lo que
  pase.
- **`lib/utils/ingreso-ordenex.ts`**: `resolverFlete` (`:121-139`) elige
  `valorFleteGam`/`valorFleteDevueltoGam` frente a `valorFlete`/`valorFleteDevuelto` según
  `esCentral` (`:131`, `:135`). Lo consumen `derivarIngresoOrden` (el cierre),
  `costoEnvioDeTarifa`/`desgloseCargaApi` (la vía API) y `costosListadoOrden` (`:257`), que es lo que
  pinta el listado de `/ordenes` y lo que lee `OrdenRepository.ts:782`.
- **`lib/types/historial-accion.ts`**: catálogo CERRADO de 48 tipos, exhaustivo en las dos
  direcciones (`satisfies readonly PrismaHistorialAccionTipo[]` + `_AsegurarExhaustivoTipos` con
  `Exclude`). Añadir un tipo obliga a tocar `HISTORIAL_ACCION_TIPOS`, `CATEGORIA_POR_ACCION` y
  `ACCION_LABELS`, y la pantalla `/historial-de-acciones` se entera sola.
- **`lib/repositories/UserRepository.ts:470-477`** es el precedente EXACTO de auditar un booleano:
  `usuario_fulfillment_cambiado` escribe `valorAnterior: previo.fulfillment ? "true" : "false"`. No
  hay que inventar vocabulario.
- **Guardias que vigilan esta zona del árbol**, con números duros que esta ficha mueve:
  - `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` — `CENSO` a mano
    (`:68-363`), `expect(HISTORIAL_ACCION_TIPOS).toHaveLength(48)` (`:586`), y exige que el
    `appendAccion` viva DENTRO del `$transaction` y reciba **la `tx`**, no `this.prisma`.
  - `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` — 48 tipos (`:77-78`) y el reparto
    `26 / 10 / 12` por categoría (`:247-249`).
  - `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts:91-97` — la
    lista `POSTERIORES`, que enumera a mano cada tipo añadido después de la 366.
  - `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts` — `ZonaRepository.ts` YA
    está en su censo de puntos de escritura (`:76`): los bloques `appendAccion` nuevos se barren
    solos.
- **`tests/unit/types/zona-schema.test.ts:69`** afirma `actualizarZonaSchema.safeParse(validCrear)`
  con un objeto que OMITE `esCentral`, y solo mira `.success`. Sigue verde después del cambio sin
  probar nada de R1: hay que reforzarlo con el VALOR, no solo con el éxito.
- **`tests/components/CrearZonaFormReconciliacion.test.tsx`** es el arnés ya montado del formulario
  (mock de `@/lib/actions/zonas`, spy de `useToast`): las pruebas de R20-R24 se cuelgan de ahí.

## 1. Ausente ≠ apagado (R1–R4)

**Elegido: dos esquemas, una sola definición de campos.** `zonaFields` se parte en la parte común y
la marca, y cada operación compone el suyo:

```ts
const zonaFieldsComunes = { nombre, cobroVehiculo, distritoIds, tarifas };

export const crearZonaSchema = z
  .object({ ...zonaFieldsComunes, esCentral: z.boolean().default(false) })   // R2: el default se queda
  .strict()
  .superRefine(applyTarifaRules);

export const actualizarZonaSchema = z
  .object({ ...zonaFieldsComunes, esCentral: z.boolean().optional() })       // R1: ausente = no tocar
  .strict()
  .superRefine(applyTarifaRules);
```

`applyTarifaRules` solo lee `cobroVehiculo` y `tarifas`, así que sirve igual a los dos sin tocarla.
`ActualizarZonaInput.esCentral` pasa a ser `boolean | undefined`, y ese `undefined` viaja intacto
hasta el `data` de Prisma, que lo interpreta como «no toques la columna» (§0).

**Por qué NO se resuelve solo en el repositorio** (p. ej. leyendo la marca actual y reescribiéndola
cuando el payload trae `false`): porque entonces sería IMPOSIBLE apagarla nunca, y R3 exige que un
`false` explícito siga siendo una petición explícita —la que R5 rechaza con un motivo, que es muy
distinto de una petición que se ignora en silencio—. La diferencia entre «no lo pediste» y «lo
pediste y no se puede» tiene que sobrevivir hasta el servidor.

**Alternativa descartada A — `actualizarZonaSchema = crearZonaSchema.partial()`.** Además de que
`crearZonaSchema` es un `ZodEffects` y no tiene `.partial()`, haría opcionales TAMBIÉN `nombre`,
`distritoIds` y `tarifas`, convirtiendo el guardado en un `PATCH` parcial. Hoy actualizar es un
REEMPLAZO COMPLETO (el repositorio hace `deleteMany` + `createMany` de la N:M y de las tarifas): un
payload sin `distritoIds` dejaría la zona sin distritos, o exigiría inventar una semántica de
«ausente = conserva» para cuatro campos más. Se descarta por desproporcionada: el defecto medido es
UN campo.

**Alternativa descartada B — un campo hermano `tocarEsCentral: boolean` en el payload.** Hace
explícita la intención sin tocar el tipo de `esCentral`, pero añade un campo al contrato público de
la Server Action que nadie envía hoy, y con `.strict()` obligaría a que todo cliente existente lo
mande. Peor: deja dos fuentes de verdad (`tocarEsCentral: false` con `esCentral: true` es un estado
representable y sin sentido). `undefined` ya expresa exactamente «no lo mandé», sin estados
imposibles.

## 2. La guarda «siempre tiene que haber una central» (R5–R9)

**Dónde vive la detección, y por qué ahí.** Dentro de la transacción de `ZonaRepository.update`, en
la MISMA lectura que ya existe:

```ts
const exists = await tx.zona.findUnique({ where: { id }, select: { id: true, esCentral: true } });
if (!exists) return { estado: "not_found" };
if (data.esCentral === false && exists.esCentral) return { estado: "sin_zona_central" };
```

No hace falta contar zonas: el índice único parcial garantiza «a lo sumo una», así que **«esta zona
es la central» ⟺ «quitarle la marca deja el sistema sin ninguna»**. Una sola columna más en un
`select` que ya se hacía, y cero consultas nuevas.

El repositorio **detecta**; el **servicio decide** qué significa eso hacia fuera (`§6`). Es el mismo
reparto que ya usa `hardDelete` → `"referenced"` → `ZonaService.borrar` → `{ status: "conflict" }`:
el repositorio no habla el vocabulario de la respuesta, devuelve un desenlace.

**Por qué la comprobación NO puede vivir en el servicio leyendo antes.** Un
`await repo.findCentralZonaId()` seguido de `await repo.update(...)` es dos transacciones: entre las
dos cabe otro guardado. Y, sobre todo, un test de servicio con dobles daría verde con la comprobación
ROTA —en este repo está medido cuatro veces que una mutación del `WHERE` pasa en verde contra
dobles—. Dentro de la transacción, la condición se puede matar y ver ponerse rojo un test contra
Postgres real (T9).

**Alternativa descartada C — un trigger/constraint en Postgres que impida quedarse sin central.** Es
la única forma de hacerlo verdaderamente inviolable, incluso desde `psql`. Se descarta por tres
motivos concretos: (a) este repo no tiene ni un solo trigger de negocio, así que sería un mecanismo
huérfano que nadie va a buscar cuando algo falle; (b) el error saldría como un fallo crudo de Postgres
que `withErrorHandler` traduciría a error interno, no a un motivo que señale la casilla (R6); y (c)
haría IMPOSIBLE el arranque de una base vacía y el `down` de cualquier seed, que es precisamente lo
que R8 protege.

**Alternativa descartada D — dejar la guarda solo en el formulario.** Prohibido por el encargo, y con
razón: la Server Action `actualizarZona` es una superficie pública del servidor; una regla que solo
existe en un `if` de React se salta con la propia acción, y el formulario ya demostró en esta misma
ficha que es un mal sitio para una regla (la confirmación existía solo en una dirección desde que se
escribió).

**Alternativa descartada E — permitir apagar la marca y crear una zona central «por defecto» si no
queda ninguna.** Elegir automáticamente cuál es la central es inventarse una decisión de negocio con
consecuencias en dinero (§9). Se descarta: el sistema no elige, rechaza y explica.

## 3. Borrar la central, con motivo propio (R10, R11)

En `hardDelete`, la lectura que ya congela la etiqueta gana una columna, y el rechazo sale ANTES de
borrar nada:

```ts
const exists = await tx.zona.findUnique({ where: { id }, select: { id: true, nombre: true, esCentral: true } });
if (!exists) return "not_found" as const;
if (exists.esCentral) return "es_central" as const;   // R10: antes del primer delete
```

`DeleteZonaResult` pasa de `"ok" | "not_found" | "referenced"` a incluir `"es_central"`. El motivo
viaja tipado hasta la pantalla (§6), que es lo que R11 exige: hoy `referenced` significa a la vez
«hay órdenes», «hay usuarios» y «hay una tarifa liquidada», y la pantalla dice «la zona está en uso»
para todos. Añadir un cuarto significado a esa misma palabra sería empeorar el problema que la ficha
viene a arreglar.

**Alternativa descartada F — resolverlo con una FK o un `CHECK` en base.** No hay a qué apuntar: la
marca es una columna de la propia fila que se borra. La única expresión declarativa sería un trigger,
descartado en §2-C.

## 4. El rastro: un tipo nuevo del catálogo (R12–R19)

- **Tipo:** `zona_central_cambiada` (Q3 lo somete a firma).
- **Entidad:** `zona` — ya existe en `HISTORIAL_ACCION_ENTIDADES`; **no** se amplía ese enum.
- **Categoría:** `mueve_dinero`. No es una elección de gusto: `esCentral` elige la columna de flete
  en `resolverFlete` (§0) y esa columna se factura. Es el mismo motivo textual con el que la 366
  clasificó `orden_zona_reconciliada` y la 362 `orden_ubicacion_corregida`.
- **Etiqueta legible:** «Cambió la marca de zona central» — mismo registro de voz que «Cambió la zona
  de un usuario».
- **`entidadEtiqueta`:** `etiquetaDeEntidad("zona", { nombre })`, que ya existe y ya la usa
  `zona_borrada`. Es el NOMBRE de la zona: catálogo de la casa, ni un dato de destinatario (R14).
- **`valorAnterior`/`valorNuevo`:** `"true"` / `"false"`, calcado de
  `usuario_fulfillment_cambiado` (`UserRepository.ts:475-476`). Sin esos dos valores la fila diría
  «alguien tocó la marca» sin decir en qué dirección, que es exactamente el defecto que se está
  arreglando.
- **`monto`:** `null`. La fila registra el hecho; el importe que se mueve no es uno solo, son dos
  tarifas por cada tienda de dos zonas enteras.
- **`loteId`:** UNO por guardado o por creación, aunque produzca dos filas (R15). Es lo que permite
  leer un traslado como UN acto de dos efectos y no como dos actos sueltos.

**Una fila por CADA zona afectada (R12), y esto es el corazón de la ficha.** Un traslado escribe DOS
filas con el mismo lote: `{ zona que la pierde: "true" → "false" }` y
`{ zona que la gana: "false" → "true" }`. La primera es la que hoy no existe: es el cambio que nadie
pidió, sobre una zona que no aparece en ningún payload.

**Alternativa descartada G — UNA sola fila por acto, sobre la zona guardada, con el nombre de la otra
en `valorAnterior`.** Es más corta y cabe en la columna. Se descarta porque rompe la pregunta que
esta tabla existe para responder: `historial_accion` tiene `@@index([entidadTipo, entidadId])` y la
pantalla filtra por entidad. Con una sola fila, «¿qué le pasó a la zona GAM?» NO devolvería el día en
que GAM dejó de ser la central —el único evento que explica por qué sus fletes cambiaron—, porque esa
fila estaría colgada de la otra zona. La zona que pierde la marca en silencio es la que más necesita
que su historia lo diga.

**El alta se audita, no solo la baja.** `create` con la marca encendida le quita la marca a la
central anterior EXACTAMENTE igual que `update` (`ZonaRepository.ts:107-109`), así que produce las
mismas dos filas (R12). Que crear una zona no tenga tipo propio en el catálogo no es motivo para que
el traslado que provoca sea invisible.

**Rechazos y no-cambios no dejan fila** (R18, R19). El rechazo sale antes de escribir nada; el
no-cambio ni siquiera entra en la rama (`data.esCentral === true && !exists.esCentral`). Es lo mismo
que ya hace `UserRepository.update`: reenviar el mismo rol no escribe auditoría.

## 5. Modelo de datos y migración

**Sin tablas nuevas, sin columnas nuevas, sin índices nuevos.** Una sola migración, aditiva y SOLA:

```sql
-- UP
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'zona_central_cambiada';
```

Va sola porque Postgres no permite USAR un valor de enum en la misma transacción que lo añade
(`55P04`) y Prisma Migrate corre cada `migration.sql` en su propia transacción. Mismo patrón que
`20260903120000_historial_accion_orden_zona_reconciliada` y que las cuatro ampliaciones posteriores.

**`down.sql`** recrea `historial_accion_tipo` con la lista PREVIA —los **48** valores— y recastea la
única columna que lo usa. De dónde sale esa lista, sin lugar a duda: es el `CREATE TYPE` de
`20260907120100_historial_accion_nodo_geografico_renombrado/down.sql` (47 valores) **más**
`'nodo_geografico_renombrado'` al final, que es justamente el valor que aquella migración añadió y
que su propio `down` no podía listar. `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, así que ese es el
`enumsortorder` real.

**Ningún `down.sql` anterior se toca:** son fotos históricas de lo que había cuando se escribieron.
Se comprobó cuál es la forma del `down` de ESTE enum: **recrea-con-lista**, no dropea el tipo —el
único que lo dropea entero es el de `20260902120000_historial_accion`, que también lo crea entero—.

**Precondición ruidosa, heredada y deliberada:** revertir solo es seguro si NINGUNA fila de
`historial_accion` usa todavía `zona_central_cambiada`. Si queda alguna, el `USING` del
`ALTER COLUMN` aborta el rollback. Es lo correcto: esa fila es lo único que dice quién movió la marca
que decide un flete.

`historial_accion` conserva su RLS habilitada sin policies (solo service role) desde la 362; un valor
nuevo de enum no la toca. Y `pnpm exec vitest run tests/integration/db` es obligatorio: es donde se
mide que el enum de la base y el catálogo de TypeScript dicen lo mismo (el `satisfies` compara contra
el cliente GENERADO, y un `prisma generate` rancio lo dejaría pasar).

## 6. Contratos I/O

### 6.1 `lib/interfaces/repositories/IZonaRepository.ts`

```ts
export interface CreateZonaData { nombre; cobroVehiculo; esCentral: boolean; distritoIds; tarifas }
export type UpdateZonaData = Omit<CreateZonaData, "esCentral"> & { esCentral?: boolean }; // R1

/** 366 + 376. `null` deja de ser el «no existe»: ahora es un desenlace nombrado. */
export type UpdateZonaResult =
  | { estado: "ok"; zona: ZonaDTO; ordenesReconciliadas: number }
  | { estado: "not_found" }
  | { estado: "sin_zona_central" };            // 376/R5

export type DeleteZonaResult = "ok" | "not_found" | "referenced" | "es_central"; // 376/R10

create(data: CreateZonaData, actorUsuarioId: string | null): Promise<ZonaDTO>;    // 376/R12
update(id: string, data: UpdateZonaData, actorUsuarioId: string | null): Promise<UpdateZonaResult>;
```

`update` deja de devolver `| null`: el `not_found` pasa a ser una rama del desenlace. Es un cambio de
tipo, no de comportamiento, y `tsc` señala todos los puntos de llamada (hay uno de producción,
`ZonaService.actualizar`, más los dobles de los tests). `create` gana `actorUsuarioId` con el MISMO
patrón que `hardDelete` (362) y que `update` (366): quien guarda firma cada fila.

### 6.2 `lib/interfaces/services/IZonaService.ts` y `ZonaService`

`ActualizarZonaServiceResult` **no cambia de forma**. El desenlace `"sin_zona_central"` se traduce a
la rama que ya existe:

```ts
{ status: "validation_error", fieldErrors: { esCentral: ["Tiene que haber una zona central. Para quitarle la marca a ésta, márcala en otra zona."] } }
```

`BorrarZonaServiceResult` y `BorrarZonaResult` ganan el motivo:

```ts
export type MotivoConflictoBorrado = "en_uso" | "es_central";
export type BorrarZonaResult =
  | { status: "ok" }
  | { status: "conflict"; motivo: MotivoConflictoBorrado }
  | Exclude<ZonaActionError, { status: "conflict" }>;
```

`toZonaActionError` (que traduce el `AppErrorShape` global) sigue devolviendo un `conflict` sin
motivo; en `borrarZona` se le añade `motivo: "en_uso"` y se deja escrito por qué es el default
correcto: por esa vía solo puede llegar un `ConflictError` LANZADO, y el rechazo de R10 no se lanza
—viaja tipado como `"es_central"`—.

`ZonaService.prepararDatos` devuelve hoy un `CreateZonaData` con `esCentral` obligatorio. Pasa a
devolver `Omit<CreateZonaData, "esCentral">` y cada llamador añade la marca: `crear` con
`input.esCentral` (siempre `boolean`, R2) y `actualizar` con `input.esCentral` (puede ser
`undefined`, R1). Sin `any` y sin duplicar la validación referencial.

### 6.3 `lib/types/zona.ts`

Además de los dos esquemas (§1): `ActualizarZonaResult` **no cambia** (la 366 ya le puso
`ordenesReconciliadas`) y `BorrarZonaResult` adopta la forma de §6.2. `ZonaActionError` NO se toca:
las otras cuatro acciones de zonas siguen usándolo tal cual.

### 6.4 Autorización

Sin cambios: todo el CRUD de zonas sigue siendo `maestro`-only (`esMaestro`). Esta ficha no crea
rutas, ni endpoints, ni superficies nuevas: son las mismas dos Server Actions
(`actualizarZona`, `borrarZona`) y la misma pantalla `/configuracion/tarifas`.

## 7. Flujo transaccional

### 7.1 `ZonaRepository.update` (dentro del `$transaction` que ya existía)

1. `exists = tx.zona.findUnique({ where: { id }, select: { id: true, esCentral: true } })`;
   si no existe → `{ estado: "not_found" }`.
2. **[376/R5]** `if (data.esCentral === false && exists.esCentral) return { estado: "sin_zona_central" }`
   — ANTES de la primera escritura, así que no se aplica nada del guardado (R5).
3. **[376/R12]** `if (data.esCentral === true && !exists.esCentral)`: lee la central previa
   `centralPrevia = tx.zona.findFirst({ where: { esCentral: true, NOT: { id } }, select: { id: true, nombre: true } })`
   ANTES de apagarla —después ya no habría a quién preguntar—.
4. `if (data.esCentral === true)`: `tx.zona.updateMany({ where: { esCentral: true, NOT: { id } }, data: { esCentral: false } })` (sin cambios).
5. `zona = tx.zona.update({ where: { id }, data: { nombre, cobroVehiculo, esCentral: data.esCentral } })`
   — con `esCentral` `undefined`, Prisma **no toca la columna** (R1/§0).
6. Reemplazo de la N:M y de las tarifas + toda la reconciliación de la 366 (sin cambios).
7. **[376/R12-R17]** Si el paso 3 se activó: `loteId = randomUUID()` PROPIO de este cambio,
   `actor = resolverActorCongelado(tx, actorUsuarioId)`, y UNA llamada a `appendAccion(tx, [...], loteId)`
   con una entrada por zona afectada: la previa (`"true"→"false"`, si la había) y ésta
   (`"false"→"true"`).
8. `return { estado: "ok", zona: toDTO(...), ordenesReconciliadas }`.

**Sobre el `loteId`:** el de la reconciliación de la 366 y el de este cambio son DISTINTOS a
propósito, aunque ocurran en el mismo guardado. Son dos hechos de naturaleza distinta —«se movió la
marca» y «se re-estamparon N órdenes»— y el lote existe para agrupar filas HOMOGÉNEAS. Compartirlo
haría que filtrar por lote devolviera una mezcla que nadie pidió.

**Orden de los pasos, y por qué importa:** el `appendAccion` va DESPUÉS de las escrituras y DENTRO
del mismo callback, recibiendo **`tx`** y no `this.prisma`. Las dos cosas las mide
`historial-accion-escrituras-cubiertas.guardia.test.ts`, y la segunda nació de una mutación que
sobrevivió en la ficha 373: escribir por `this.prisma` dentro del callback compila, parece correcto y
escribe FUERA de la transacción.

### 7.2 `ZonaRepository.create`

1. **[376/R12]** `if (data.esCentral === true)`: `centralPrevia = tx.zona.findFirst({ where: { esCentral: true }, select: { id: true, nombre: true } })` antes del `updateMany`.
2. `updateMany` que desmarca (sin cambios) → `tx.zona.create(...)` (sin cambios).
3. **[376/R12]** `appendAccion(tx, [...], loteId)` con la fila de la central previa (si la había) y
   la de la zona recién creada.

### 7.3 `ZonaRepository.hardDelete`

Solo el paso nuevo de §3, antes del primer `deleteMany`. El resto —incluida la fila `zona_borrada`—
queda exactamente como está.

## 8. Superficie de pantalla (`CrearZonaForm.tsx`, `ZonasTarifasModule.tsx`)

**El formulario NO decide, avisa.** La regla vive en el servidor (§2). Lo que cambia en pantalla:

1. **Confirmación al DESMARCAR (R20).** Hoy la confirmación está dentro de `if (esCentral)`
   (`:293`). Se añade la rama simétrica: si `initial?.esCentral === true` y la casilla queda
   apagada, modal que nombra la zona y advierte que tiene que existir una zona central. **Al
   confirmar SE ENVÍA**, y el servidor responde el rechazo (R5), que se pinta en el paso 3. Ver Q2:
   la alternativa —que el formulario lo impida de entrada— es más amable y es una SEGUNDA copia de la
   regla; se somete a firma en vez de decidirse aquí.
2. **Confirmación al REASIGNAR (R21).** Ya existe y ya nombra la zona en conflicto
   (`centralConflicto.nombre`, `:420`). Se conserva tal cual y pasa a estar cubierta por un test:
   hoy no lo está.
3. **El rechazo, junto a la casilla (R23).** `actualizarZona` devuelve
   `fieldErrors.esCentral`, que `enviar()` ya vuelca en `setErrors` (`:273`). Falta el
   `<FieldError messages={errors.esCentral} />` bajo la casilla «Zona Central» (`:320-329`): sin él,
   el motivo llega al cliente y no se pinta en ninguna parte.
4. **El borrado (R24).** `ZonasTarifasModule.tsx:210-217` pinta hoy «No se puede eliminar: la zona
   está en uso.» para todo `conflict`. Pasa a distinguir por `motivo`: `"es_central"` → «No se puede
   eliminar la zona central. Marca otra zona como central antes de eliminarla.»; `"en_uso"` → el
   texto de hoy, sin tocar.

Sin pantallas nuevas, sin rutas nuevas y sin cambiar el toast de éxito de la 366.

## 9. Riesgos declarados (no escondidos)

- **Mover la marca re-tarifa DOS zonas enteras, y en vivo.** `esCentral` se lee en el momento de
  derivar el flete y no se congela hasta `cierre_detail` (§0). Medido el 2026-09-07: son **850**
  órdenes vivas en GAM. Esta ficha NO impide el traslado —es una operación legítima—, lo hace
  CONFIRMABLE y AUDITABLE. Lo que la confirmación NO dice hoy es el número: Q4.
- **La guarda cierra un agujero, no lo arregla hacia atrás.** Si alguien ya apagó la marca por
  omisión antes de esta ficha, la base puede estar HOY sin zona central y R8 permite guardar así. No
  hay backfill: no hay forma automática de saber cuál ERA la central (nadie lo registró — es el
  defecto). Reponerla es un acto humano, y desde esta ficha deja rastro.
- **El `null` de `findCentralZonaId()` sigue siendo alcanzable fuera de la app.** Un `UPDATE` directo
  contra la base, un seed o una restauración pueden dejar el sistema sin central, y ahí los ocho
  consumidores siguen discrepando entre sí (fallar cerrado / caer a satélite / literal de respaldo).
  Con la guarda eso deja de ser alcanzable POR LA APP; unificar el desacuerdo es rediseño y está
  fuera de alcance (`requirements.md`, decisión 2).
- **La consecuencia que es la ficha 377.** Si la marca sale de GAM, sus 19 `reprogramada` y 8
  `devuelta` se liberarían a `en_bodega_satelite` de una zona con **0** `adminSatelite`: invisibles y
  sin transición de salida. Esta ficha lo hace confirmable y auditable, **no** lo impide.
- **Ni una wallet, ni una liquidación, ni un `cierre_detail` se tocan.** Estructural, no declarado:
  el flujo del §7 no tiene un solo `write` a esas tablas, y `cierre_detail` es inmutable.

## 10. Fuera de alcance (y por qué)

- **Unificar el desacuerdo de los consumidores de `findCentralZonaId()`.** `requirements.md`,
  decisión 2. Ocho puntos de llamada en ocho servicios; con la guarda el `null` deja de ser
  alcanzable desde la app y los fallbacks quedan como defensa en profundidad.
- **Auditar toda edición de una zona** (nombre, distritos, tarifas). Q1 lo somete a firma; el diseño
  deja el ensanche barato (un tipo más en el mismo catálogo, escrito en el mismo `appendAccion`).
- **Exigir que SIEMPRE exista una zona central**, incluso en una base que nunca la tuvo. R8 lo
  prohíbe expresamente: rompería el arranque de una base vacía y los seeds.
- **Elegir automáticamente una central de repuesto.** §2-E: el sistema no elige por su cuenta algo
  que decide un flete.
- **Contar el impacto en la confirmación.** Q4; hoy la confirmación nombra zonas, no órdenes.
- **La ficha 377** (la orden que se queda sin dueño al cambiar de zona). Se cita como consecuencia.

## 11. Alternativas descartadas (resumen, con motivo en su sección)

| Alternativa | Sección | Por qué se descarta |
| --- | --- | --- |
| `actualizarZonaSchema = crearZonaSchema.partial()` | §1-A | `ZodEffects` no tiene `.partial()`, y haría opcionales otros cuatro campos convirtiendo el reemplazo completo en un `PATCH` que nadie diseñó. |
| Campo hermano `tocarEsCentral` en el payload | §1-B | Añade al contrato público un campo que nadie envía y crea estados representables sin sentido; `undefined` ya dice «no lo mandé». |
| Trigger/constraint en Postgres para «al menos una central» | §2-C | Mecanismo huérfano en este repo, error crudo en vez de motivo accionable (R6), y rompe el arranque de una base vacía (R8). |
| La guarda solo en el formulario | §2-D | Prohibido por el encargo; la Server Action es superficie del servidor y se salta el `if` de React. |
| Elegir una central «de repuesto» automáticamente | §2-E | Inventa una decisión de negocio con efecto en dinero. |
| Un `CHECK`/FK para proteger el borrado | §3-F | No hay a qué apuntar: la marca es una columna de la fila que se borra. |
| UNA sola fila de auditoría por acto | §4-G | «¿Qué le pasó a esta zona?» dejaría de devolver el día en que perdió la marca, que es lo único que explica su cambio de flete. |
| Reutilizar `referenced` para el rechazo de borrar la central | §3 | Sería un cuarto significado para la palabra que ya mezcla tres; R11 pide justo lo contrario. |
