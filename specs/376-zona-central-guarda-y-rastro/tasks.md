# Ficha 376 — Tasks

Convención de «hecho»: una task termina cuando compila (`tsc` sin `any` nuevo), pasa lint, y —si toca
DB o repositorio— pasa contra Postgres real (`tests/integration/db`), no solo contra dobles. En este
repo está medido cuatro veces que **una mutación del `WHERE` pasa en verde contra dobles**; y esta
ficha vive entera en el `WHERE` y en el `data` de Prisma.

> ⚠️ **CONFLICTO DE ARCHIVOS CON LA FICHA 377.** Las dos tocan
> `lib/repositories/ZonaRepository.ts` (la 377, por la orden que se queda sin dueño al cambiar de
> zona). No pueden ir en paralelo sobre el mismo archivo: o se secuencian (esta primero, que es la
> que añade la guarda) o la 377 arranca desde el commit de esta. Anotarlo en `progress/current.md`
> antes de lanzar nada.
>
> ⚠️ **Base local compartida.** La migración de T1 pone rojo el gate de cualquier otra feature que
> comparta la base local hasta que corra `prisma migrate deploy` allí. Avisar antes de aplicarla.

## T1 — Migración: el tipo nuevo del catálogo `[P]`

**Depende de:** nada.

- [ ] `pnpm run db:migrate:create` (nombre sugerido: `historial_accion_zona_central_cambiada`).
- [ ] `migration.sql`: `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS
      'zona_central_cambiada';` — **SOLA**, sin backfill ni uso del valor en la misma transacción
      (Postgres `55P04`). Mismo patrón que
      `20260903120000_historial_accion_orden_zona_reconciliada`.
- [ ] `down.sql`: recrea `historial_accion_tipo` con los **48** valores previos, y ésa es la lista
      del `CREATE TYPE` de `20260907120100_historial_accion_nodo_geografico_renombrado/down.sql`
      (47) **más** `'nodo_geografico_renombrado'` al final. Después,
      `ALTER TABLE "historial_accion" ALTER COLUMN "accion" TYPE … USING ("accion"::text::…)` y
      `DROP TYPE … _old`. Escribir la precondición ruidosa (no se puede revertir con filas del valor
      nuevo).
- [ ] **NO se toca ningún `down.sql` anterior**: son fotos históricas. Ya está comprobado que el
      `down` de ESTE enum es de la forma «recrea-con-lista», no «dropea el tipo».
- [ ] `pnpm run db:migrate` en local; `prisma migrate status` limpio; `prisma generate`.

**Hecho cuando:** la migración aplica limpia, `pnpm run db:rollback` funciona sobre una base sin filas
del tipo nuevo, y `db/schema.prisma` no acusa drift.

## T2 — El test de la migración (contra la base aplicada)

**Depende de:** T1.

- [ ] Archivo nuevo en `tests/integration/db/` calcado de
      `geografia-renombrado-migration.test.ts`, que es el modelo bueno: **reconstruye el estado
      previo ejecutando las migraciones REALES anteriores en un esquema temporal**, aplica el `up`,
      aplica el `down` y compara — en vez de comparar el `down.sql` contra una lista escrita a mano.
- [ ] Casos: (a) el `up` es UNA sentencia y no contiene `INSERT/UPDATE/DELETE/CREATE TABLE`; (b)
      `pg_enum` tiene el valor nuevo y coincide EXACTAMENTE con `HISTORIAL_ACCION_TIPOS` (las dos
      direcciones); (c) el `down` devuelve el enum a la lista previa valor a valor y EN ORDEN; (d)
      con UNA fila que use el valor nuevo, el rollback FALLA ruidosamente y NO borra esa fila.
- [ ] Comparar el conteo **contra el catálogo** (`HISTORIAL_ACCION_TIPOS.length`), nunca contra un
      número congelado: la lección está escrita en
      `api-key-eliminada-migration.test.ts:153-159`.

**Hecho cuando:** corre contra Postgres real y el caso (c) se pone rojo si se le quita un valor a la
lista del `down.sql` (probarlo a mano una vez).

## T3 — El catálogo y los tres sitios con números duros

**Depende de:** T1 (para que el enum de Prisma incluya el valor y los `satisfies`/`Exclude` compilen).

- [ ] `lib/types/historial-accion.ts`: añadir `"zona_central_cambiada"` a `HISTORIAL_ACCION_TIPOS`,
      en la sección «mueve dinero», con el motivo escrito al lado (elige la columna de flete);
      `CATEGORIA_POR_ACCION.zona_central_cambiada = "mueve_dinero"`;
      `ACCION_LABELS.zona_central_cambiada = "Cambió la marca de zona central"`.
      **No** se amplía `HISTORIAL_ACCION_ENTIDADES`: `zona` ya está.
- [ ] `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`: `48 → 49` (dos aserciones,
      `:77-78`) y el reparto por categoría `26 → 27` (`:247`). Añadir un caso propio que afirme el
      tipo, su categoría y su etiqueta LITERAL, al estilo de los de la 374/375.
- [ ] `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts:586`: `48 → 49` (el
      censo se toca en T10, cuando los métodos ya existen).
- [ ] `tests/integration/db/historial-accion-orden-zona-reconciliada-migration.test.ts:91-97`:
      añadir `"zona_central_cambiada"` a `POSTERIORES`. Es una lista a mano y su rojo es mudo si se
      olvida.

**Hecho cuando:** `tsc` limpio y las dos guardias del historial verdes sin haber tocado su mecanismo,
solo sus números.

## T4 — Los dos esquemas zod `[P]`

**Depende de:** nada.

- [ ] `lib/types/zona.ts`: partir `zonaFields` en la parte común y la marca; `crearZonaSchema`
      conserva `esCentral: z.boolean().default(false)` (R2) y `actualizarZonaSchema` pasa a
      `z.boolean().optional()` (R1). Los dos siguen `.strict()` y siguen aplicando
      `applyTarifaRules`, que no se toca.
- [ ] `tests/unit/types/zona-schema.test.ts`: el caso `:69` de hoy solo mira `.success` y seguiría
      verde con el defecto vivo. **Reforzarlo con el VALOR:**
      `actualizarZonaSchema.parse(sinEsCentral).esCentral` es `undefined` y
      `crearZonaSchema.parse(sinEsCentral).esCentral` es `false`. Añadir además que `esCentral: null`
      se rechaza en los dos.

**Hecho cuando:** devolver `actualizarZonaSchema = crearZonaSchema` pone rojo el caso nuevo (mutación
a probar a mano una vez).

## T5 — Contratos: repositorio, servicio y tipos de acción

**Depende de:** T4.

- [ ] `lib/interfaces/repositories/IZonaRepository.ts`:
      `UpdateZonaData = Omit<CreateZonaData, "esCentral"> & { esCentral?: boolean }`;
      `UpdateZonaResult` pasa a la unión discriminada `{ estado: "ok" | "not_found" | "sin_zona_central" }`
      (design §6.1) y `update` deja de devolver `| null`; `DeleteZonaResult` gana `"es_central"`;
      `create` gana `actorUsuarioId: string | null`.
- [ ] `lib/interfaces/services/IZonaService.ts` y `lib/types/zona.ts`: `BorrarZonaServiceResult` y
      `BorrarZonaResult` ganan `motivo: "en_uso" | "es_central"` en la rama `conflict`.
      `ActualizarZonaResult` y `ZonaActionError` **no se tocan**.
- [ ] `ZonaService.prepararDatos` devuelve `Omit<CreateZonaData, "esCentral">`; `crear` y `actualizar`
      añaden la marca cada uno con su tipo.

**Hecho cuando:** `tsc` señala y se corrigen todos los puntos de llamada (uno de producción por
método, más los dobles de los tests) y no queda ningún `as unknown as` nuevo para tapar el cambio.

## T6 — `ZonaRepository.update`: ausente ≠ apagado, la guarda y el rastro

**Depende de:** T3, T5.

- [ ] Paso 1: el `findUnique` de `exists` pasa a `select: { id: true, esCentral: true }`.
- [ ] Paso 2 (R5): `if (data.esCentral === false && exists.esCentral) return { estado: "sin_zona_central" }`,
      **antes de la primera escritura**.
- [ ] Paso 3 (R12): si la marca va a LLEGAR a esta zona, leer la central previa (`id` + `nombre`)
      ANTES del `updateMany` que la apaga.
- [ ] Paso 5 (R1): `esCentral: data.esCentral` con `undefined` = «no toques la columna». Dejar el
      comentario: es una propiedad de Prisma, no una casualidad, y un doble no la distingue.
- [ ] Paso 7 (R12-R17): `appendAccion(tx, [...], loteId)` con UNA entrada por zona afectada,
      `valorAnterior`/`valorNuevo` en `"true"`/`"false"` (precedente literal:
      `UserRepository.ts:475-476`), `monto: null`, etiqueta `etiquetaDeEntidad("zona", { nombre })`.
      **`loteId` propio**, distinto del de la reconciliación de la 366 (design §7.1).
- [ ] El `appendAccion` va DENTRO del callback y recibe **`tx`**, nunca `this.prisma`: las dos cosas
      las mide la guardia, y la segunda nació de una mutación que sobrevivió en la 373.

**Hecho cuando (unit, `tests/unit/repositories/zona-repository.test.ts`):** con dobles se afirma la
FORMA —dos entradas, mismo lote, valores `"true"`/`"false"`, orden de las llamadas— y se deja
explícito por escrito que la atomicidad y el `WHERE` se miden en T11, no aquí.

## T7 — `ZonaRepository.create`: el traslado también deja rastro

**Depende de:** T3, T5.

- [ ] Leer la central previa antes del `updateMany` que la apaga; tras el `create`, una sola llamada
      a `appendAccion` con la fila de la que pierde y la de la recién creada (R12).
- [ ] `create` recibe y usa `actorUsuarioId`; `ZonaService.crear` le pasa `actor.usuarioId`.

**Hecho cuando:** crear una zona SIN la marca no escribe ninguna fila (R18), y crearla CON la marca
habiendo otra central escribe exactamente dos, con el mismo lote.

## T8 — `ZonaRepository.hardDelete`: el rechazo propio

**Depende de:** T5.

- [ ] El `findUnique` que ya congela la etiqueta gana `esCentral`; si es la central, `return
      "es_central"` **antes del primer `deleteMany`** (R10).
- [ ] El `catch` de FK sigue devolviendo `"referenced"` sin tocar: son dos motivos distintos y tienen
      que seguir siéndolo (R11).

**Hecho cuando:** existe un caso donde la zona central NO tiene ninguna orden ni usuario y aun así el
borrado se rechaza — es el caso que las FK no cubren y el único que prueba que la guarda es la que
actúa.

## T9 — Servicio y Server Actions

**Depende de:** T6, T7, T8.

- [ ] `ZonaService.actualizar`: `"sin_zona_central"` → `{ status: "validation_error", fieldErrors: { esCentral: [<mensaje>] } }`
      (R6); `"not_found"` → `{ status: "not_found" }`; `"ok"` reenvía `ordenesReconciliadas` tal cual
      (366/R12, sin cambios).
- [ ] `ZonaService.borrar`: `"es_central"` → `{ status: "conflict", motivo: "es_central" }`;
      `"referenced"` → `{ status: "conflict", motivo: "en_uso" }`.
- [ ] `lib/actions/zonas.ts`: en `borrarZona`, el `conflict` que venga del manejador global
      (`toZonaActionError`) se completa con `motivo: "en_uso"`, y se deja escrito por qué es el
      default correcto (el rechazo de R10 no se LANZA: viaja tipado).
- [ ] Mensaje en español claro, sin siglas ni jerga (`docs/conventions.md`). Texto sugerido para R6:
      «Tiene que haber una zona central. Para quitarle la marca a ésta, márcala en otra zona.»

**Hecho cuando (unit + `tests/integration/actions/zonas-action.test.ts`):** llamar la Server Action
`actualizarZona` DIRECTAMENTE —sin pasar por el formulario— con la marca en `false` sobre la zona
central devuelve el `validation_error` con `fieldErrors.esCentral` (R7), y con la marca AUSENTE
devuelve `ok`.

## T10 — El censo de la guardia de escrituras cubiertas

**Depende de:** T6, T7.

- [ ] `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: DOS entradas nuevas
      en `CENSO`, porque el censo mide UNA mutación por entrada:
      - `{ tipos: ["zona_central_cambiada"], archivo: "lib/repositories/ZonaRepository.ts", metodo: "update", forma: "abre_tx", mutacion: /tx\.zona\.updateMany\(/ }`
        — la mutación que se exige es **el apagado silencioso de la central anterior**, que es
        exactamente lo que la fila documenta;
      - `{ tipos: ["zona_central_cambiada"], archivo: "lib/repositories/ZonaRepository.ts", metodo: "create", forma: "abre_tx", mutacion: /tx\.zona\.create\(/ }`.
- [ ] Comprobar que la entrada ya existente de `update` (`orden_zona_reconciliada`, mutación
      `tx.orden.updateMany`) **no se toca**: dos entradas con el mismo archivo y método son legítimas
      y el `it.each` las corre por separado.

**Hecho cuando:** la guardia pasa, y sacar el `appendAccion` nuevo fuera del `$transaction` —o
pasarle `this.prisma`— la pone roja (probarlo a mano una vez).

## T11 — `tests/integration/db`: lo medido contra Postgres real, no contra dobles

**Depende de:** T6, T7, T8.

> Un test que hace `if (!fks) return;` reporta «passed» sin comprobar nada. Cada caso de abajo
> necesita su semilla y su mutación: matar la condición correspondiente y ver el test rojo es parte
> de «hecho», no un extra.

- [ ] **R1 — la marca sobrevive a su ausencia:** zona central A; `update(A, payload SIN esCentral)`
      ⇒ `A.esCentral` sigue `true`. Mutación: volver `esCentral` obligatorio con `?? false`.
- [ ] **R4 — y el resto del guardado sí cambia:** el mismo payload trae otro nombre, otra lista de
      distritos y otras tarifas ⇒ los tres cambian y la marca no.
- [ ] **R3/R5 — `false` explícito sobre la única central se RECHAZA:** `update(A, { esCentral: false, … })`
      ⇒ desenlace `sin_zona_central`, y **nada** cambió: ni el nombre, ni los distritos, ni las
      tarifas, ni la marca. Mutación: quitar la condición del paso 2.
- [ ] **R19 — y no deja fila:** cero filas nuevas en `historial_accion` tras ese rechazo.
- [ ] **R8 — base sin ninguna central:** ninguna zona con la marca; guardar una zona con
      `esCentral: false` ⇒ `ok`. Es el caso que prueba que la guarda es «no quedarse sin», no
      «siempre debe haber».
- [ ] **R9/R12 — el traslado escribe DOS filas:** A es central, `update(B, { esCentral: true })` ⇒
      exactamente una zona con la marca (B), y DOS filas `zona_central_cambiada`: la de A
      (`"true"→"false"`) y la de B (`"false"→"true"`).
- [ ] **R15 — mismo lote:** las dos filas anteriores comparten `lote_id`, y ese lote es distinto del
      de un segundo guardado. Y —design §7.1— distinto del `lote_id` que la reconciliación de la 366
      genere en el MISMO guardado.
- [ ] **R13 — forma de la fila:** `entidad_tipo = 'zona'`, `entidad_id` = la zona, `entidad_etiqueta`
      = su nombre, actor congelado, `monto` NULL.
- [ ] **R18 — idempotencia:** repetir `update(B, { esCentral: true })` cuando B ya es la central ⇒
      cero filas nuevas.
- [ ] **R12 en `create`:** crear una zona con la marca habiendo otra central ⇒ dos filas, mismo lote,
      y la anterior apagada. Crear sin la marca ⇒ cero filas.
- [ ] **R10 — borrar la central sin órdenes ni usuarios:** la zona central no tiene ni una orden ni
      un usuario apuntando ⇒ `hardDelete` devuelve `es_central`, la zona SIGUE existiendo y sus
      tarifas y su N:M también (el rechazo sale antes del primer `deleteMany`). Mutación: quitar la
      condición ⇒ este test tiene que ponerse rojo por BORRADO, no por otra cosa.
- [ ] **R11 — y es distinguible:** una zona NO central con una orden apuntando sigue devolviendo
      `referenced`, no `es_central`.
- [ ] **R17 — atomicidad:** provocar un fallo después del `appendAccion` dentro de la misma
      transacción ⇒ ni la marca cambia ni queda la fila. (Si el arnés no permite inyectar el fallo,
      dejarlo dicho por escrito y apoyarse en la guardia estática de T10, que es lo que mide que el
      `appendAccion` recibe la `tx`.)

**Hecho cuando:** todos los casos corren contra la base de test de Postgres —no contra un doble de
Prisma—, ninguno tiene un `return` temprano que lo vacíe, y cada mutación descrita se probó a mano al
menos una vez (dejarlo dicho en el PR).

## T12 — Pantalla: confirmar antes, explicar después

**Depende de:** T9.

- [x] `CrearZonaForm.tsx` — **R20:** rama simétrica de la confirmación de `:293`: si la zona que se
      edita ES la central y la casilla queda apagada, modal que la nombra y advierte que tiene que
      existir una zona central. Al confirmar, se envía (design §8 y Q2). Las dos direcciones
      comparten UN modal, con el estado `ConfirmacionCentral` como discriminante.
- [x] **R21:** la confirmación al marcar ya existe y ya nombra la zona en conflicto (`:420`); se
      conserva y **pasa a tener test**, que hoy no tiene. El texto de su descripción se conserva
      LITERAL y así queda afirmado.
- [x] **R23:** `<FieldError messages={errors.esCentral} />` bajo la casilla «Zona Central»
      (`:320-329`). Sin él, el motivo llega al cliente y no se pinta en ningún sitio. La casilla lo
      enlaza por `aria-describedby` (+ `aria-invalid`), y el toast deja de decir «el formulario
      está incompleto» —era falso: el formulario estaba completo— y repite el motivo del servidor.
- [x] `ZonasTarifasModule.tsx:210-217` — **R24:** distinguir por `motivo`: `"es_central"` → «No se
      puede eliminar la zona central. Marca otra zona como central antes de eliminarla.»;
      `"en_uso"` → el texto de hoy, intacto.
- [x] **Q4 FIRMADA POR EL HUMANO — la confirmación DICE EL IMPACTO.** Los dos modales piden
      `impactoZonaCentral` para las zonas del traslado (la que pierde la marca y la que la gana) y
      dicen cuántas órdenes sin cerrar pasarían a cobrarse con otra tarifa de flete. El borde
      devuelve NÚMEROS; el texto se compone en el formulario. Mientras se cuenta, «Continuar» está
      bloqueado —nadie confirma un impacto que no ha visto—; si la consulta falla, se dice y se
      desbloquea, porque un fallo de LECTURA no puede dejar atrapado un guardado.
- [x] La anotación `@sin-superficie` de `impactoZonaCentral` (`lib/actions/zonas.ts`) se **borró**:
      caducó en cuanto el formulario importó la acción, y `superficie-de-uso.guardia` se pone roja
      si sobrevive a su motivo (comprobado a mano volviéndola a poner).

**Hecho cuando (component tests, sobre el arnés ya montado de
`tests/components/CrearZonaFormReconciliacion.test.tsx`):** desmarcar abre el modal y **no** llama a
`actualizarZona` hasta confirmar; cancelar no llama a nada (R22); marcar con otra central abre el
modal con el NOMBRE de la otra zona; un `validation_error` con `fieldErrors.esCentral` se pinta junto
a la casilla; y el modal de borrado dice el texto de la central cuando el motivo es `es_central`.

**Hecho, y con qué se comprobó que los tests MIDEN algo** (cuatro mutaciones, corridas a mano una
vez cada una y revertidas):

| Mutación aplicada | Qué se puso rojo |
| --- | --- |
| La rama de R20 en `guardar()` pasa a `else if (false)` | 9 de 15 casos de `ZonaCentralConfirmacion.test.tsx` |
| Se borra el `<FieldError>` de la casilla | solo el caso de R23 (1 de 15) |
| `confirmDisabled={false}` en el modal | solo el caso de «mientras se cuenta no se puede confirmar» |
| `mensajeBorradoFallido` deja de mirar el `motivo` | solo el caso de `es_central` (1 de 4) |
| Se vuelve a poner `@sin-superficie` en `impactoZonaCentral` | `superficie-de-uso.guardia`, caso «ninguna anotación sobrevive a su motivo» |

Ficheros: `tests/components/ZonaCentralConfirmacion.test.tsx` (15 casos, R20-R23 + Q4) y
`tests/components/ZonaBorradoMotivo.test.tsx` (4 casos, R24).

## Coordinación y orden sugerido

```
T1 ─┬─ T2
    └─ T3 ─┐
T4 ── T5 ──┼─ T6 ─┬─ T10
           ├─ T7 ─┘
           └─ T8 ─┴─ T9 ── T12
                      └──── T11
```

`[P]` reales: **T1 y T4** pueden ir a la vez (no comparten archivo). T6, T7 y T8 tocan **el mismo**
`ZonaRepository.ts`: van en serie, y en serie con la ficha 377.

## Trazabilidad R → test

| Requisito | Task | Test que lo prueba |
| --- | --- | --- |
| R1 | T4, T6 | T11 «la marca sobrevive a su ausencia» + T4 unit del esquema (`.esCentral` es `undefined`) |
| R2 | T4 | T4 unit del esquema: `crearZonaSchema` sigue aplicando el default `false` |
| R3 | T4, T6 | T4 unit (`false` explícito parsea a `false`) + T11 «`false` explícito se RECHAZA» |
| R4 | T6 | T11 «y el resto del guardado sí cambia» |
| R5 | T6 | T11 «`false` explícito sobre la única central se RECHAZA» (y nada se aplicó) |
| R6 | T9 | unit de `ZonaService.actualizar`: `sin_zona_central` → `validation_error` con `fieldErrors.esCentral` |
| R7 | T9 | `tests/integration/actions/zonas-action.test.ts`: la Server Action rechaza sin pasar por el formulario |
| R8 | T6 | T11 «base sin ninguna central» |
| R9 | T6 | T11 «el traslado escribe DOS filas» (exactamente una zona con la marca al final) |
| R10 | T8 | T11 «borrar la central sin órdenes ni usuarios» |
| R11 | T8, T9 | T11 «y es distinguible» + unit de `ZonaService.borrar` (`motivo`) |
| R12 | T6, T7 | T11 «el traslado escribe DOS filas» + «R12 en `create`» |
| R13 | T6 | T11 «forma de la fila» |
| R14 | T3, T6 | `historial-accion-sin-datos-cliente.guardia.test.ts` (ya censa `ZonaRepository.ts`) |
| R15 | T6, T7 | T11 «mismo lote» |
| R16 | T3 | `catalogo-y-choke-point.test.ts` (categoría `mueve_dinero`, reparto 27/10/12) |
| R17 | T6, T10 | `historial-accion-escrituras-cubiertas.guardia.test.ts` (censo nuevo) + T11 «atomicidad» |
| R18 | T6, T7 | T11 «idempotencia» + «crear sin la marca ⇒ cero filas» |
| R19 | T6, T8 | T11 «y no deja fila» (rechazo de R5) + el rechazo de R10 no escribe nada |
| R20 | T12 | `ZonaCentralConfirmacion.test.tsx` › «abre el modal nombrando la zona y NO llama a actualizarZona todavía» + «al confirmar SÍ envía, con la marca apagada» |
| R21 | T12 | `ZonaCentralConfirmacion.test.tsx` › «el modal dice el NOMBRE de la zona que perderá la marca» + «al confirmar envía con la marca encendida» |
| R22 | T12 | `ZonaCentralConfirmacion.test.tsx` › «cancelar el modal de desmarcar no llama a ninguna acción de guardado» + «cancelar el modal de marcar tampoco envía» |
| R23 | T12 | `ZonaCentralConfirmacion.test.tsx` › «fieldErrors.esCentral aparece bajo «Zona Central» y la casilla lo referencia» + «el toast repite el motivo del servidor» |
| R24 | T12 | `ZonaBorradoMotivo.test.tsx` › «motivo `es_central` dice que hay que marcar otra zona, no que esté en uso» + «motivo `en_uso` conserva EXACTAMENTE el texto de antes de esta ficha» |
| Q4 | T12 | `ZonaCentralConfirmacion.test.tsx` › «pregunta por las DOS zonas del traslado y suma el impacto», «una sola orden usa el singular», «cero órdenes NO se dice igual que “no lo pude contar”», «mientras se cuenta no se puede confirmar» y «si la consulta falla, lo dice y NO deja el guardado atrapado» |
