# 362 — Historial de acciones · design

> Cubre `requirements.md` R1–R40. Todo símbolo citado está **confirmado en el archivo real**, no
> solo en el índice del grafo.

## 0. La forma, en una frase

Una tabla append-only (`historial_accion`) escrita por **un único punto** (`appendAccion(tx, …)`)
que recibe la **transacción en curso** de quien hace la acción —calcado de
`lib/repositories/registrar-cambio-estado.ts`, el choke point de `orden_historial_estado`— y un
módulo de solo lectura colgado del apartado «Histórico» que ya existe, con la barra de búsqueda y
filtros compartida y descarga.

---

## 1. Modelo de datos

### 1.1 Los dos enums

Enums **nativos de Postgres** (patrón `OrdenHistorialOrigenTipo`, `db/schema.prisma:2070`), no
tablas de catálogo: el conjunto es cerrado, lo fija el código y añadir un valor debe ser una
migración con nombre y fecha (R14/R15).

```prisma
enum HistorialAccionTipo {
  // --- mueve dinero (23) ---
  cierre_dia_aprobado
  cierre_dia_rechazado
  cierre_dia_pagos_editados
  cierre_bodega_aprobado
  cierre_bodega_rechazado
  pago_mensajero_registrado
  pago_tienda_registrado
  pago_anulado
  reparto_mensajero_registrado
  reparto_anulado
  wallet_movimiento_manual_registrado
  egreso_administrativo_registrado
  egreso_administrativo_reversado
  tarifa_creada
  tarifa_actualizada
  incidente_aprobado
  incidente_rechazado
  cobro_gasto_fijo_aprobado
  cobro_gasto_fijo_rechazado
  cobro_rechazo_tienda_aprobado
  cobro_rechazo_tienda_rechazado
  premio_ranking_registrado
  premio_ranking_anulado
  // --- hace desaparecer algo (6) ---
  orden_eliminada
  orden_recuperada
  tarifa_borrada
  zona_borrada
  vehiculo_borrado
  plantilla_eliminada
  // --- cambia quien puede hacer que (11) ---
  usuario_creado
  usuario_rol_cambiado
  usuario_zona_cambiada
  usuario_estado_cambiado
  usuario_contrasena_restablecida
  postulacion_aprobada
  postulacion_rechazada
  api_key_generada
  api_key_rotada
  api_key_activada
  api_key_desactivada

  @@map("historial_accion_tipo")
}

enum HistorialAccionEntidad {
  orden
  usuario
  tarifa
  zona
  vehiculo
  plantilla_mensaje
  cierre_dia
  cierre_bodega
  gestion_orden
  liquidacion_pago
  liquidacion_reparto
  wallet_movimiento
  orden_incidente
  gasto_fijo_cobro
  rechazo_tienda_cobro
  ranking_snapshot_fila
  api_key

  @@map("historial_accion_entidad")
}
```

**`tarifa_borrada` está en «desaparición» y no en «dinero» aunque mueva precio**: R17 exige
**exactamente una** categoría por tipo, y lo que la fila documenta es la desaparición irreversible
(`tarifas` borra en físico: `db/schema.prisma:1325` lo dice).

### 1.2 La tabla

```prisma
// Ficha 362 — REGISTRO append-only de las acciones que mueven dinero, hacen desaparecer algo o
// cambian quien puede hacer que. Fila INMUTABLE (R2): SIN updatedAt/deletedAt, sin soft delete;
// una correccion se representa con una accion NUEVA, jamas alterando una fila previa. Mismo
// patron que `orden_historial_estado` (49) y `liquidacion_pago` (172). RLS habilitada sin
// policies (solo service role), R8.
model HistorialAccion {
  id              String                 @id @default(uuid())
  accion          HistorialAccionTipo
  entidadTipo     HistorialAccionEntidad @map("entidad_tipo")
  entidadId       String                 @map("entidad_id")       // OPACO: sin FK (ver 1.3)
  entidadEtiqueta String                 @map("entidad_etiqueta") @db.VarChar(120) // CONGELADA (R4)
  actorUsuarioId  String?                @map("actor_usuario_id") // NULL = sistema/cron
  actorNombre     String?                @map("actor_nombre") @db.VarChar(120)     // CONGELADO (R3)
  actorRol        RolValue?              @map("actor_rol")        // CONGELADO (R3)
  monto           Decimal?               @db.Decimal(12, 2)       // el importe que ESA accion movio (R6)
  valorAnterior   String?                @map("valor_anterior") @db.VarChar(60)    // vocabulario CERRADO
  valorNuevo      String?                @map("valor_nuevo") @db.VarChar(60)       // vocabulario CERRADO
  loteId          String                 @map("lote_id")          // uuid POR ACCION (R7)
  createdAt       DateTime               @default(now()) @map("created_at")
  // SIN updated_at / deleted_at: fila INMUTABLE (R2).

  actor Usuario? @relation("HistorialAccionActor", fields: [actorUsuarioId], references: [id], onDelete: Restrict)

  @@index([createdAt(sort: Desc), id])              // el listado por defecto, con su desempate
  @@index([actorUsuarioId, createdAt(sort: Desc)])  // «que hizo Fulano»
  @@index([entidadTipo, entidadId])                 // «que le paso a esta orden»
  @@map("historial_accion")
}
```

`Usuario` gana la relación inversa `historialAcciones HistorialAccion[] @relation("HistorialAccionActor")`.

### 1.3 Las cinco decisiones de columna, con su porqué

**(a) `entidadId` es OPACO y NO lleva FK.** Dos de las entidades registradas **se borran en
físico**: `tarifas` (la migración `tarifa_zona_is_default` le quitó `deleted_at`) y `zona`
(`ZonaRepository:215` hace `tx.zona.delete`). Una FK dejaría dos únicas salidas, y las dos son
peores: `RESTRICT` haría **inborrable** lo que la acción registrada acaba de borrar, y `SET NULL`
**vaciaría el rastro en silencio** — exactamente lo que `orden_historial_estado.gestion_orden_id`
documenta como corrupción muda. Sin FK, la fila sobrevive a su sujeto, que es el requisito.

**(b) `entidadEtiqueta` se CONGELA, no se resuelve al leer (R4).** Es la lección literal de
`cierre_detail` (69): «`es_central` y los 5 nombres son COLUMNAS aunque exista el FK porque son
MUTABLES; guardar solo el FK re-etiquetaría cierres viejos». Aquí es peor: en `tarifa_borrada` y
`zona_borrada` **no hay a quién preguntar**. Congelar también elimina el N+1 del listado —25 filas
de 17 tipos de entidad distintos serían hasta 17 consultas por página— y evita meter uuid en la
descarga (R38: `columnas-sensibles.guardia` prohíbe la forma uuid en una celda).

Las fuentes de la etiqueta viven en **una función pura** `etiquetaDeEntidad(tipo, fila)` con un
caso por `HistorialAccionEntidad`, y son las únicas admitidas:

| entidad | etiqueta congelada |
|---|---|
| `orden` | `num_guia` ?? `num_remision` ?? `"(sin guía)"` |
| `usuario` | `nombre` + `primer_apellido` |
| `tarifa` | nombre de la zona y/o de la tienda a la que aplica |
| `zona` / `vehiculo` / `plantilla_mensaje` | su nombre |
| `cierre_dia` / `cierre_bodega` | nombre del mensajero o de la zona + fecha del cierre |
| `liquidacion_pago` / `liquidacion_reparto` | nombre del beneficiario |
| resto | el nombre corto que ya usa su pantalla |

**Ninguna** de esas fuentes es un dato del destinatario de una orden (R5). `num_guia` es un
identificador de envío de Ordenex, no un dato personal.

**(c) `actorNombre` y `actorRol` se CONGELAN (R3).** El motivo no es de rendimiento: **uno de los
eventos que este módulo registra es el cambio de rol**. Leer el rol vivo re-etiquetaría la historia
—«el maestro Fulano aprobó» sobre una fila de cuando Fulano era `admin`— y ese error es
indetectable. `actorUsuarioId` se conserva **además**, con FK `RESTRICT`, porque es lo estable para
filtrar (precedente: `orden_nota.autor` y `orden_dia_reparto_cambio.actor_usuario_id`, ambos
RESTRICT porque «la autoría es evidencia»). Los tres son nulos a la vez cuando el actor es el
sistema (patrón 49/R21).

**(d) `monto` se congela; `motivo` NO EXISTE.** Es la línea que separa lo que se copia de lo que se
consulta:
- El **importe** es un número, no es dato personal, y sin él una fila de «mueve dinero» no se
  entiende. Resolverlo al leer serían 25 consultas por página. Se congela. `Decimal(12,2)`,
  `Prisma.Decimal` al escribir y **STRING** en el DTO — nunca `Number()`/`parseFloat` (R6, patrón
  declarado en `lib/actions/wallet-egresos.ts:27`).
- El **motivo** es texto libre tecleado por una persona. Es el único vector real de datos de
  cliente en esta tabla («rechazado porque el cliente Juan Pérez no estaba») y **ya vive en su fila**
  (`cierre_dia.motivo_rechazo`, `liquidacion_anulacion.motivo`). Copiarlo aquí crearía la segunda
  copia con otras reglas de retención que la condición 3 del encargo prohíbe. Se resuelve al leer:
  el maestro abre el cierre.

**(e) `valorAnterior`/`valorNuevo` solo aceptan vocabulario CERRADO.** Se usan en exactamente tres
tipos y siempre con valores de un enum: `usuario_rol_cambiado` (`RolValue`),
`usuario_estado_cambiado` (`EstadoUsuario`) y `api_key_activada`/`api_key_desactivada`
(`EstadoApiKey`). En todos los demás van `NULL`. `VarChar(60)` y una guardia sobre los puntos de
escritura los mantienen así. **No** se usan para tarifas: ver Q3 de `requirements.md`.

### 1.4 Lo que la tabla NO tiene, y por qué

- **Sin `categoria`** (R17): se **deriva** con un mapa puro `CATEGORIA_POR_ACCION:
  Record<HistorialAccionTipo, CategoriaAccion>` exhaustivo sobre el enum. Guardarla sería una
  segunda fuente de verdad capaz de divergir — la lección A5 de la 129/133, que el repo ya castiga
  con guardia.
- **Sin índice único de idempotencia** (a diferencia de `wallet_movimiento`): un reintento del
  usuario **es otra acción** y debe verse. Un único aquí escondería el doble clic que precisamente
  se quiere auditar.
- **Sin `canal`**: distinguir app de API la da `actorRol` congelado (la cuenta dedicada de una key
  tiene rol `apiKey`). Una columna más para la misma pregunta son dos respuestas que divergen.

### 1.5 Migración

`db/migrations/<timestamp>_historial_accion/` con `migration.sql` (UP) y **`down.sql` obligatorio**.

- UP: `CREATE TYPE historial_accion_tipo`, `CREATE TYPE historial_accion_entidad`, `CREATE TABLE
  historial_accion`, los 3 índices, la FK a `usuario` con `ON DELETE RESTRICT`, y
  `ALTER TABLE historial_accion ENABLE ROW LEVEL SECURITY` **sin políticas** (Prisma no lo expresa;
  va a mano, patrón `orden_historial_estado`/`wallet_movimiento`).
- DOWN: `DROP TABLE historial_accion` + `DROP TYPE` de los dos enums. Son enums **nuevos**: los
  `down.sql` de migraciones anteriores **no se tocan** (son fotos históricas).
- **No hay backfill.** Las 79 órdenes borradas el 2026-09-02 no se pueden recuperar: no quedó
  rastro. El módulo empieza vacío y eso hay que decirlo en pantalla (§5.4).

---

## 2. La escritura: el punto único y la transacción (R9–R13)

### 2.1 `appendAccion` — el choke point

`lib/repositories/registrar-accion.ts`, calcado en forma y en contrato de
`lib/repositories/registrar-cambio-estado.ts`:

```ts
export type HistorialAccionTxClient = Pick<Prisma.TransactionClient, "historialAccion">;

export interface EntradaAccion {
  accion: HistorialAccionTipo;
  entidadTipo: HistorialAccionEntidad;
  entidadId: string;
  entidadEtiqueta: string;
  actorUsuarioId: string | null;
  actorNombre: string | null;
  actorRol: RolValue | null;
  monto?: Prisma.Decimal | null;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
}

export async function appendAccion(
  tx: HistorialAccionTxClient,
  entradas: EntradaAccion[],
  loteId: string = randomUUID(),
): Promise<void>;
```

- Recibe **la transacción**, no un cliente Prisma. No puede abrir la suya: eso es lo que hace que
  R10 y R11 sean estructurales y no una promesa.
- `entradas.length === 0` es no-op (patrón `appendCambioEstado`).
- `loteId` se genera **una vez por llamada** y va igual en todas las filas (R7). Es parámetro con
  default para poder fijarlo en los tests.
- **Es el único sitio del árbol que nombra `tx.historialAccion` o la tabla** (R13), vigilado por
  guardia.

### 2.2 La regla, escrita como regla

> **Toda escritura de una acción del Anexo A DEBE invocar `appendAccion` en su MISMA
> `$transaction`, y SOLO con las entidades que EFECTIVAMENTE se escribieron.**

Es la misma frase que ya gobierna `orden.estatus_id` (design §3.3 de la 49). El sitio correcto para
la llamada es el **método del repositorio que hace la mutación**, no la Server Action: el service no
conoce Prisma y la acción no tiene transacción.

### 2.3 Las escrituras que hoy no tienen transacción

Tres formas, según lo que ya haya:

1. **Ya corre en `$transaction`** (`ZonaRepository.borrarZona`, los cierres, la liquidación, la
   wallet): se añade la llamada dentro del callback. Coste: dos líneas.
2. **Es un `update`/`delete` suelto** (usuarios, tarifas, vehículos, plantillas, api keys): el
   método se envuelve en `prisma.$transaction(async (tx) => { … })`. La mutación pasa a usar `tx`.
3. **Es un `updateMany` por lote y no devuelve ids** — `OrdenRepository.softDelete` y
   `restaurar`. Aquí no basta con envolver: R12 exige registrar **las alcanzadas**, y `updateMany`
   solo devuelve un `count`.

   **Solución:** dentro de la misma transacción, la sentencia pasa a
   `UPDATE … SET deleted_at = … WHERE … RETURNING id, num_guia, num_remision` vía `$queryRaw` con
   `Prisma.sql`/`Prisma.join` (sin interpolación de texto; el repo ya usa ese escape, ver
   `impl_170-fase2-tanda-k.md`). Con eso:
   - el `where` no cambia y la frontera multi-tenant de la ficha 358 (`tiendaId: ownerId`) sigue
     **dentro de la sentencia**;
   - el conteo devuelto sigue siendo `filas.length`, así que el contrato del service no cambia;
   - las etiquetas (`num_guia`) salen del **mismo `RETURNING`**: cero consultas extra y cero riesgo
     de etiquetar una orden que no se borró.

   Es la misma lección que ya está escrita en `appendCambioEstado` sobre el mensaje de bienvenida:
   *«el service devuelve los ids PEDIDOS y `recogerLote` tira los del `RETURNING`, así que colgarlo
   allí mandaría un WhatsApp de una orden que no salió a reparto»*.

### 2.4 De dónde salen el actor y sus datos congelados

El `Actor` de la sesión (`lib/auth/resolve-actor.ts`) ya viaja hasta el service en las 40 acciones.
Lleva id y rol. **El nombre no**: se lee **una vez, dentro de la misma transacción**, con un `select
{ nombre, primerApellido }` sobre `usuario` por el id del actor. Una consulta por acción (no por
fila) sobre una tabla de decenas de filas.

*Alternativa descartada:* ensanchar el tipo `Actor` con el nombre. Toca la resolución de sesión de
toda la app para un dato que solo usa esta ficha, y pone datos de persona en una cookie/objeto que
hoy no los lleva.

### 2.5 Cómo se PRUEBA que no puede haber una sin la otra

Cuatro capas, porque ninguna sola basta:

1. **Guardia estructural con censo cerrado** — `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`.
   El censo declara, por cada uno de los 40 tipos, el **archivo y el método** que lo produce. El
   test recorta el **cuerpo real** del método por llaves balanceadas (técnica de
   `corregir-datos-sin-rastro.guardia.test.ts`) y exige tres cosas: que aparezca `appendAccion`, que
   aparezca la sentencia de mutación, y que el índice de `appendAccion` caiga **dentro del rango del
   callback de `$transaction`** del mismo cuerpo. Con **contraprueba**: la misma aserción sobre el
   cuerpo mutado en memoria (sin la llamada, y con la llamada fuera del callback) tiene que fallar.
2. **Guardia de cobertura del enum** — todo valor de `HistorialAccionTipo` tiene productor en el
   censo, y todo productor del censo existe en el árbol. Sin esto, un tipo declarado y nunca escrito
   convierte el módulo en un mentiroso silencioso (precedente: el valor `incidente` de
   `OrdenHistorialOrigenTipo`, declarado sin productor **y dicho por escrito**).
3. **Integración contra Postgres real** — `tests/integration/db/historial-accion-atomicidad.test.ts`.
   Por cada familia (una de dinero, una de desaparición, una de permisos): (a) se fuerza el fallo
   del `appendAccion` dentro de la tx y se comprueba que **la mutación no persiste** (R10); (b) se
   fuerza el fallo de la mutación y se comprueba que **no queda fila de registro** (R11); (c) un lote
   de 3 con una ya borrada produce **2** filas y ninguna de la tercera (R12).
4. **Mutaciones medidas**, y declaradas en `progress/impl_362.md`: quitar el `appendAccion` de
   `softDelete`; sacarlo fuera del `$transaction`; construir las entradas con los ids pedidos;
   generar el `loteId` por fila. Las cuatro tienen que poner rojo un test **nombrado**, con su línea.

> **Por qué la 3 no se puede saltar:** el repo ya tiene la lección de que «una imposibilidad
> razonada no es medida». Que el código *parezca* atómico leyéndolo no prueba que la transacción
> exista donde uno cree.

---

## 3. Quién lo ve (R18–R21)

### 3.1 Sin lista de roles nueva

El módulo cuelga del ítem **«Histórico»** que ya existe en `lib/auth/menu-visibility.ts:497`, como
**segundo subítem**:

```ts
children: [
  { label: "Conversaciones", href: "/historico/conversaciones" },
  { label: "Acciones",       href: "/historico/acciones" },
],
```

Los subítems **no declaran `roles` propios: heredan los del padre** (R3 de la 321). El padre ya
apunta a `ROLES_HISTORICO_CONVERSACIONES`. Resultado: **no nace ninguna lista nueva y no hay
segunda lista que pueda divergir**, que es lo que pedía el encargo.

El gate de `app/(app)/historico/acciones/page.tsx` lee **esa misma constante** —patrón literal de
`app/(app)/historico/conversaciones/page.tsx`— y no escribe ni un literal de rol. Lo vigila una
guardia hermana de `historico-roles-una-sola-fuente.guardia.test.ts` (que hoy está fijada a la ruta
de conversaciones; se añade la nueva ruta, no se reescribe el mecanismo).

**Efecto colateral declarado:** hoy esa constante es `["maestro","admin"]`, así que el `admin`
también verá el módulo. Ver **Q4** de `requirements.md`.

**Posición:** «Histórico» es el último ítem del bloque de administración y `primerDestino` devuelve
el `href` del **primer subítem** del primer ítem visible. Añadir un segundo subítem **no cambia el
aterrizaje post-login de nadie** (R20), y por eso el ítem sigue sin necesitar `destinoInicial: false`.
El test `tests/unit/auth/destino-post-login.test.ts` afirma con `toEqual` que los marcados son
exactamente `["/analitica","/monitoreo"]`: no se toca.

**No hace falta `IconKey` nuevo**: el subítem no lleva icono.

### 3.2 Alternativas descartadas

**A1 — Una constante propia `ROLES_HISTORIAL_ACCIONES = ["maestro"]`.** Es lo que literalmente pidió
el humano («la navegación del maestro») y lo que argumenta la 321 (una whitelist propia obliga a que
ampliar sea una edición con fecha y autor). **Descartada** porque el encargo es explícito —«reúsalo;
no nace una lista de roles nueva»— y porque un subítem con `roles` propios reintroduce justo la
segunda lista que la 321/R3 evitó. Queda como **Q4**: si el humano la quiere, es un cambio de una
línea y de un guard.

**A2 — Derivar de `esAccesoTotal` / `ROLES_ACCESO_TOTAL`.** Descartada por el mismo motivo que la
321 la descartó: si mañana alguien añade `adminSatelite` a «acceso total de gestión», derivar le
regalaría **el registro de todo lo que se hace en la app** sin que nadie lo decidiera. La asimetría
va en la dirección mala.

**A3 — Un ítem de primer nivel «Auditoría» con icono propio.** Descartada: obliga a decidir posición
en la barra —y la posición **no es decorativa**, cambia el aterrizaje post-login (los incidentes ya
documentados de «Analítica» y «Monitoreo»)—, a añadir un valor a la unión cerrada `IconKey`, y a
declarar roles. Tres decisiones nuevas para algo que es, literalmente, otro histórico.

---

## 4. La lectura: contrato de servidor

### 4.1 Capas

```
app/(app)/historico/acciones/page.tsx           ← gate + pre-carga del catálogo de filtros
lib/actions/historial-acciones.ts               ← Server Actions ('use server')
lib/services/HistorialAccionService.ts          ← autorización + DTO money-safe
lib/repositories/HistorialAccionRepository.ts   ← Prisma; UN solo constructor de `where`
```

Interfaces en `lib/interfaces/services/IHistorialAccionService.ts` y
`lib/interfaces/repositories/IHistorialAccionRepository.ts`. Tipos y zod en
`lib/types/historial-accion.ts`.

### 4.2 Entrada

```ts
filtroHistorialAccionSchema = z.object({
  q: z.string().trim().min(BUSQUEDA_MIN_CHARS).max(120).optional(),
  actorId: z.array(z.string()).optional(),
  accion: z.array(z.enum(HISTORIAL_ACCION_TIPOS)).optional(),
  categoria: z.array(z.enum(CATEGORIAS_ACCION)).optional(),
  entidadTipo: z.array(z.enum(HISTORIAL_ACCION_ENTIDADES)).optional(),
  desde: z.string().optional(),   // fecha calendario CR
  hasta: z.string().optional(),
  page: …, pageSize: …,
  ...esquemaOrdenamiento(HISTORIAL_SORT_FIELDS, "created_at", "desc"),
}).strict();
```

`.strict()`: una clave desconocida es `validation_error`, no un descarte mudo (lección de la 352).
`esquemaOrdenamiento` se **importa** de `lib/types/ordenamiento-listado.ts`; no se reescribe.

`categoria` se traduce a `accion IN (…)` en el borde, con `CATEGORIA_POR_ACCION` (R17). Si llegan
`categoria` y `accion` a la vez, se intersecan.

### 4.3 Salida

```ts
{ status: "ok", items: HistorialAccionDTO[], page, pageSize, total }
```

```ts
interface HistorialAccionDTO {
  id: string;
  fecha: string;              // ISO; la pantalla lo pinta en CR
  accion: HistorialAccionTipo;
  accionLabel: string;
  categoria: CategoriaAccion;
  entidadTipo: HistorialAccionEntidad;
  entidadEtiqueta: string;
  actorNombre: string | null; // null = sistema (R36)
  actorRol: RolValue | null;
  monto: string | null;       // ⚠ STRING. Nunca number (R6)
  valorAnterior: string | null;
  valorNuevo: string | null;
  loteId: string;
}
```

`entidadId` **no cruza al DTO**: no aporta nada en pantalla y `columnas-sensibles.guardia` prohíbe
la forma uuid en la descarga. Correlacionar con la entidad es trabajo de base, no de pantalla.

### 4.4 Orden, paginación y crecimiento — con el número delante

**El orden es `created_at <dir>, id ASC`** (R23), armado con `ordenTotal(criterios, {id:"asc"})` de
`lib/types/ordenamiento-listado.ts`, que **exige** el desempate como argumento. `id` es PK, única y
`NOT NULL`; el desempate es fijo `asc` y no acompaña a `sortDir` porque el orden de un uuid v4 no
significa nada: lo que la paginación necesita es que sea **el mismo** en las dos consultas.

**Y aquí el empate no es una rareza, es la norma.** Todas las filas de un lote nacen del mismo
`CURRENT_TIMESTAMP` de la transacción: un borrado de 79 órdenes produce **79 filas con el mismo
instante al milisegundo**, y con páginas de 25 eso cruza **tres** cortes de página. Es el defecto que
midió la 352 (200 filas distintas de 241 al recorrer 10 páginas), amplificado. El test de R24 tiene
que sembrar un lote de **≥120 filas de un mismo instante** con páginas de 25 — con corpus pequeños
Postgres ordena el conjunto entero y **la mutación «quitar el desempate» sobrevive en verde**, que es
el hallazgo nº 1 de `progress/impl_352.md`.

**¿Paginar en el servidor desde el día uno?** Sí. No por el volumen diario (~30–105 filas), sino por
el acumulado: **11.000–38.000 filas al año**. Mandar eso al navegador para cortarlo allí es el fallo
mudo que `ordenamiento-listado.ts` describe en su cabecera. Además, todo listado de este repo pagina
en el servidor y las piezas (`DataTable`, `Pagination`, `contrato-paginado`) ya existen.

**Índices: tres, y se justifica cada uno y cada ausencia** (R40).
- `(created_at DESC, id)` — la primera página, que es el 90 % de las visitas.
- `(actor_usuario_id, created_at DESC)` — «qué hizo Fulano», el filtro más probable. Igualdad →
  rango, el único orden que un btree recorre sin filtro residual.
- `(entidad_tipo, entidad_id)` — «qué le pasó a esta orden».
- **No** hay índice por `accion`: cardinalidad de 40 valores sobre decenas de miles de filas, y casi
  siempre viene acompañado de fecha; el índice por fecha ya acota.
- **No** hay índice por `lote_id`: es una consulta puntual y rara sobre una tabla que cabe en
  memoria.
- Nombres: los tres por defecto de Prisma quedan por debajo del **límite de 63 caracteres de
  Postgres** (el más largo, `historial_accion_actor_usuario_id_created_at_idx`, mide 48). No hace
  falta `map:` explícito, pero la regla queda escrita porque `orden_historial_estado` ya se comió ese
  truncamiento silencioso.

**Retención: ninguna, y a propósito.** Las filas no contienen datos de clientes (R5), así que no hay
motivo de protección de datos para purgarlas, y el volumen anual (unas pocas decenas de MB) no es un
motivo de coste. Un registro de auditoría que se borra solo es la peor clase de borrado. R39 lo
convierte en requisito: **si algún día hace falta purgar, será una decisión humana con ficha propia**,
no un job que aparece.

### 4.5 La búsqueda libre, y qué alcanza exactamente

El término **no** se resuelve con una columna denormalizada (eso copiaría el nombre del actor a la
tabla y quedaría rancio) sino con **dos resoluciones previas baratas**, en el servidor:

1. contra `usuario` (decenas de filas) → conjunto de `actor_usuario_id`;
2. contra `historial_accion.entidad_etiqueta` (`ILIKE`, la columna ya congelada) → cubre guía,
   remisión y nombres de zona/tarifa/plantilla.

El `where` final es `(actor_usuario_id IN (…) OR entidad_etiqueta ILIKE …)`. El placeholder **es la
documentación del campo** (lección de la 321) y por eso enumera exactamente eso:

> **«Persona, guía, remisión o nombre de lo afectado»**

`minChars` sale de `BUSQUEDA_MIN_CHARS` (`lib/types/orden.ts`), **la misma constante que valida el
borde** — escribir un `3` a mano en el control es la mutación que R32 prohíbe.

*Alternativa descartada:* una columna generada `busqueda_texto` como la de `orden`. Aquí la tabla es
mil veces más pequeña (`pg_trgm` no aporta a esta escala), y guardar el nombre del actor duplicado
lo dejaría desincronizado del día que alguien corrija un apellido.

### 4.6 Descarga (contrato)

Dos acciones, como el resto del repo: `listarHistorialAccionesPaginado` (pantalla) y
`listarHistorialAccionesCompleto` (descarga). **Comparten el mismo constructor de `where` y el mismo
`orderBy`**, así que no pueden divergir (R30) — es lo que hace `OrdenRepository.list`.

`app/(app)/historico/acciones/_components/historial-acciones-descarga-columnas.ts`:

| clave | encabezado |
|---|---|
| `fecha` | Fecha |
| `actor` | Quién |
| `rol` | Rol |
| `categoria` | Categoría |
| `accion` | Qué |
| `entidadTipo` | Tipo |
| `entidad` | Sobre qué |
| `monto` | Importe |
| `anterior` | Valor anterior |
| `nuevo` | Valor nuevo |

**Sin `id`, sin `entidadId`, sin `loteId`**: `columnas-sensibles.guardia` rechaza la forma uuid en
una celda y los identificadores internos en clave o encabezado. La tabla entra en
`tests/unit/descarga/censo-tablas.ts` como `con_descarga`, y los **cuatro** números duros de
`cobertura-tablas.guardia.test.ts` suben al valor que la propia guardia reporte (impl_336 avisa de
que son cuatro y de que dos son literales sueltos, no constantes).

---

## 5. La pantalla

### 5.1 Ruta y armazón

`app/(app)/historico/acciones/page.tsx`, Server Component:

1. `resolveActorFromSession()`;
2. `notFound()` si el rol no está en `ROLES_HISTORICO_CONVERSACIONES` — **antes** de cualquier
   lectura (R18);
3. pre-carga **solo** del catálogo de actores para el filtro;
4. `<AppPage title="Acciones">` + `<HistorialAccionesModule …/>`.

Inyección de dobles por un **segundo parámetro `deps`** con default (patrón literal de la página de
conversaciones): Next nunca lo pasa, la aridad declarada no cambia y el test puede afirmar
`not.toHaveBeenCalled()`.

### 5.2 La barra: la compartida, sin excepciones (R28)

`HistorialAccionesFiltrosBar` es el mismo montaje que `HistoricoFiltrosBar`: `BuscadorFiltros` como
contenedor, `FilterComponent` para los controles pedidos, y dos módulos puros al lado:

- `historial-acciones-filtros-def.ts` → declara los filtros (función pura catálogo → `FilterDef[]`);
- `seleccion-a-filtro.ts` → traduce lo elegido al `filtro` que valida el borde.

Filtros ofrecidos en el selector (R29), en este orden:

| clave | control | opciones |
|---|---|---|
| `categoria` | `multi` | 3: mueve dinero · hace desaparecer · cambia permisos |
| `accion` | `multi` con buscador | los 40 tipos, etiquetados |
| `actor_id` | `multi` con buscador | usuarios que han actuado |
| `entidad_tipo` | `multi` | los 17 tipos de entidad |
| `fecha` | `dateRange` | `ATAJOS_CREACION` + `ultimosNDiasCalendarioCR`, **importados** de `ordenes-filtros-def.ts` y `lib/utils/fecha-cr.ts`, nunca reescritos |

La búsqueda libre es el **campo** de la barra, no un filtro que se pide (lección 321): su `minChars`
y su `placeholder` salen del `FilterDef` de `q`.

### 5.3 La tabla

`DataTable` con las columnas de §4.6 (las mismas que la descarga, para que pantalla y archivo no
digan cosas distintas), `Pagination` server-side, y la cabecera ordenable por **Fecha** en los dos
sentidos (R26). La clave de SWR incluye `claveDeOrden({sortBy, sortDir})` además de la del filtro y
la página — sin eso, el primero que pida «más antiguo» le sirve su resultado al siguiente que pida
«más reciente» (defecto medido y documentado en `impl_352.md`).

**La pantalla no importa ni una Server Action que escriba** (R21), vigilado por guardia.

### 5.4 Estado vacío

`EmptyState` con un texto que **no miente**: el registro empieza el día que se despliega y **lo
anterior no existe** — las 79 órdenes borradas el 2026-09-02 no dejaron rastro y no se pueden
reconstruir. Decirlo evita que un cero se lea como «no ha pasado nada» (misma familia que la nota
`sin_gestion_registrado` de la 264: «ninguna» y «no lo sabemos» son cosas distintas).

---

## 6. Alternativas descartadas (además de A1–A3 de §3.2)

**A4 — Ir por logs.** Es lo que preguntó el humano y ya está respondido: los logs del servidor
rotan, no se filtran desde la app y meter datos de clientes ahí los saca de sus reglas de retención.
Un módulo que se consulta necesita tabla. **Cerrada, no se reabre.**

**A5 — Un `trigger` de Postgres por tabla auditada.** Da atomicidad gratis y no se puede olvidar.
**Descartada por tres motivos concretos de este repo:** (a) el trigger no conoce al **actor** —la
sesión vive en la app, no en la conexión— y habría que empujarlo con `SET LOCAL`, un mecanismo que
hoy no existe y que se rompe en silencio si alguien lo olvida; (b) el criterio es **semántico**
(«aprobar un cierre» son varias escrituras en varias tablas, y un `UPDATE` sobre `usuario` es un
cambio de rol o un cambio de teléfono según la columna), y un trigger por fila no sabe distinguirlo;
(c) el rastro dejaría de ser greppable desde el código y se saldría del `db/migrations` versionado
que este repo usa como fuente de verdad.

**A6 — Ampliar `orden_historial_estado` con un `origen_tipo` nuevo por acción.** Es la tentación
obvia porque el patrón ya está. **Descartada:** esa tabla tiene `orden_id` **NOT NULL** y una FK a
`orden`; la mitad de los eventos (usuarios, tarifas, api keys, wallet) no tienen orden. Colgarlos de
una orden ficticia corrompería el derivador de intentos, que dispara cobros (49/56). Y ahogaría el
módulo: 799 transiciones/día contra ~30–105 acciones.

**A7 — Grano por ACCIÓN (una fila por acto, con un contador `cantidad`).** Convertiría los 79
borrados en una sola línea, que se lee mucho mejor. **Descartada:** la pregunta que abre esta ficha
es «¿quién borró **esta** orden?», y con grano por acción hay que abrir un detalle para responderla —
o guardar los N ids en un JSON, que es una lista sin tipo dentro de una fila que se quiere auditable.
Se conserva lo bueno de la alternativa con `lote_id` (R7): grano por entidad **y** el acto
reconstruible.

**A8 — Agrupar los lotes en la pantalla** (una línea «Fulano borró 79 órdenes», desplegable).
**Descartada para esta ficha:** agrupar en el servidor rompe la paginación (el `total` deja de ser un
`count`, y el orden total sobre grupos exige una segunda capa), y agrupar en el cliente ordenaría
25 filas de las 38.000, que es exactamente el fallo mudo que §4.4 evita. Con `lote_id` en la fila,
añadirlo después es una feature de pantalla y no una migración.

**A9 — Guardar el importe y el motivo en un `payload` JSON.** Flexible y barato de escribir.
**Descartada:** un JSON libre es una invitación abierta a volcar ahí el objeto de entrada entero
—con el nombre y el teléfono del destinatario dentro—, y ninguna guardia estática puede vigilar el
contenido de un `Json` de Prisma. Columnas tipadas y vocabulario cerrado (§1.3-e) son lo que hace
que R5 sea comprobable.

**A10 — Una columna `secuencia BIGSERIAL` como desempate «con significado».** Daría un orden total
*y* el orden real de inserción. **Descartada:** no aporta sobre el desempate por `id` que la 352 ya
midió y dejó probado en este árbol, añade una segunda fuente de orden y exigiría verificar el soporte
de `autoincrement()` fuera de la PK antes de comprometerse. No se compra una columna con una
suposición.

---

## 7. Riesgos declarados

1. **Cuarenta puntos de escritura.** El coste de esta ficha no es la tabla, es instrumentar 40
   sitios y probarlos. `tasks.md` lo parte en tandas por categoría; **la ficha no se da por hecha con
   tandas a medias**, porque un registro de auditoría incompleto es un mentiroso silencioso.
2. **Tres escrituras pasan de `updateMany` a `UPDATE … RETURNING`** (§2.3). Es el cambio más
   arriesgado del lote: toca el borrado de órdenes, que lleva **la frontera multi-tenant de la ficha
   358 dentro de su `where`**. El `where` no se toca y hay integración contra Postgres que ya lo
   cubre (`eliminar-orden-pantalla-frontera-tienda.test.ts`); esa suite tiene que seguir verde.
3. **La base local la comparten varios worktrees**: la migración de esta ficha puede poner rojo el
   gate de otras. Aplicarla y avisar.
4. **`./init.sh --rapido` se va a negar**: el diff toca `db/schema.prisma`, migraciones y
   `lib/types/**`. La corrida completa es **obligatoria**.
