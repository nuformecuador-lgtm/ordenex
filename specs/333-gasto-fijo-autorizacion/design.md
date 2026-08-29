# Ficha 333 — Diseño

> Decisiones técnicas del cobro autorizado del gasto fijo. Todo lo de aquí se apoya en código
> **leído en el archivo real**, no en el índice del grafo. Las alternativas descartadas van en §11 y
> **no son decorativas**: dos de ellas eran el camino «obvio» y duplicaban plata.

---

## 0 · Qué se conserva intacto, y por qué importa decirlo primero

| Se conserva | Dónde vive hoy |
| --- | --- |
| El formato del período (`YYYY-MM` / `YYYY-MM-DD`) | `lib/utils/periodicidad.ts#periodoDe` |
| La regla de disparo (`aplicaHoy`) | `lib/utils/periodicidad.ts#aplicaHoy` |
| La clave del libro `"<plantillaId>:<periodo>"` | `GeneracionGastosFijosService` |
| El índice **`wallet_movimiento_origen_categoria_uq`** | `db/migrations/20260712160000_wallet_movimiento/migration.sql:71-73` |
| La inmutabilidad del libro (sin `update`/`delete`) | `WalletMovimientoRepository` |
| La reversa por fila del libro | `reversarEgresoAdministrativoAction` + `WalletLedger` |
| El agendado del cron (`0 6 * * *` UTC = 00:00 CR) | `vercel.json` |
| `esAccesoTotal` para todo lo demás de wallet y plantillas | `lib/auth/acceso-total.ts` |

**El cambio es barato porque no hay nada que migrar:** medido contra producción el **2026-08-29**,
**cero** movimientos `egreso_gasto_fijo` emitidos jamás y las **2** plantillas existentes están
**inactivas**. No hay backfill, no hay conversión de filas históricas y no hay ventana en la que
convivan dos formatos de clave. Esta es la razón de hacerlo ahora: dentro de tres meses, con cobros
en el libro, el mismo cambio exigiría una migración de datos sobre dinero ya contabilizado.

---

## 1 · Modelo de datos

### 1.1 Columna nueva en `gasto_fijo_plantilla`

```prisma
requiereAprobacion Boolean @default(true) @map("requiere_aprobacion")
```

```sql
ALTER TABLE "gasto_fijo_plantilla"
  ADD COLUMN "requiere_aprobacion" BOOLEAN NOT NULL DEFAULT true;
```

- `NOT NULL DEFAULT true` no reescribe la tabla (Postgres ≥ 11 guarda el default en el catálogo) y
  deja las **2** filas existentes en «requiere aprobación». Las dos están **inactivas**, así que ese
  valor no cambia el comportamiento de nada hoy (R2, R12).
- **No hay índice nuevo por esta columna.** El cron ya filtra por `activa` con
  `gasto_fijo_plantilla_activa_idx` y decide el interruptor **en memoria** sobre un conjunto de
  decenas de filas: un índice booleano de baja cardinalidad sobre una tabla de configuración sería
  coste de escritura sin consulta que lo use (mismo criterio que `postulacion_recurso`).

### 1.2 Enum nuevo `gasto_fijo_cobro_estado`

```prisma
enum GastoFijoCobroEstado {
  pendiente
  aprobado
  rechazado
  cancelado

  @@map("gasto_fijo_cobro_estado")
}
```

`CREATE TYPE` (no `ALTER TYPE ... ADD VALUE`), así que **no aplica** el `55P04` y puede usarse como
tipo de columna en la misma migración.

### 1.3 Tabla nueva `gasto_fijo_cobro`

```prisma
model GastoFijoCobro {
  id            String               @id @default(uuid())
  plantillaId   String?              @map("plantilla_id")
  origenId      String               @map("origen_id")   // "<plantillaId>:<periodo>" — LA CLAVE DEL LIBRO
  periodo       String                                    // "YYYY-MM" | "YYYY-MM-DD" (lo que se ENSEÑA)
  concepto      String                                    // copia de la plantilla al generar
  monto         Decimal              @db.Decimal(12, 2)   // copia de la plantilla al generar (> 0)
  estado        GastoFijoCobroEstado @default(pendiente)
  generadoEl    DateTime             @map("generado_el") @db.Date  // día CR de la corrida que lo creó
  decididoPor   String?              @map("decidido_por")
  decididoAt    DateTime?            @map("decidido_at")
  movimientoId  String?              @map("movimiento_id")
  createdAt     DateTime             @default(now()) @map("created_at")
  updatedAt     DateTime             @default(now()) @updatedAt @map("updated_at")

  plantilla  GastoFijoPlantilla? @relation(fields: [plantillaId],  references: [id])
  decisor    Usuario?            @relation("GastoFijoCobroDecisor", fields: [decididoPor], references: [id])
  movimiento WalletMovimiento?   @relation(fields: [movimientoId], references: [id])

  @@index([estado, generadoEl])
  @@index([plantillaId])
  @@index([decididoPor])
  @@map("gasto_fijo_cobro")
}
```

Y las **tres back-relations** obligatorias: `GastoFijoPlantilla.cobros`, `Usuario.cobrosGastoFijo` y
`WalletMovimiento.cobroGastoFijo` (esta última `GastoFijoCobro?`, uno a uno). Añadir un campo de
relación **no cambia la tabla `wallet_movimiento`**: sigue sin `updated_at`, sin `deleted_at` y sin
`update`/`delete` expuestos.

#### Claves y restricciones (van a mano en la migración; Prisma no expresa CHECK ni parciales)

| Nombre | Qué es | Por qué |
| --- | --- | --- |
| `gasto_fijo_cobro_origen_uq` | `UNIQUE(origen_id)` | **La idempotencia** (§2). Una (plantilla, período) tiene como mucho **un** cobro, en cualquier estado. |
| `gasto_fijo_cobro_pendiente_con_plantilla` | `CHECK (estado <> 'pendiente' OR plantilla_id IS NOT NULL)` | **La cascada del borrado, garantizada en la base** (§9). Con `ON DELETE SET NULL`, borrar una plantilla que tenga pendientes vivos violaría este CHECK y **el DELETE falla ruidosamente**. |
| `gasto_fijo_cobro_decision_registrada` | `CHECK ((estado = 'pendiente' AND decidido_at IS NULL) OR (estado <> 'pendiente' AND decidido_at IS NOT NULL))` | Un cobro decidido **sin cuándo** no es escribible ni por error (R15, R21). |
| `gasto_fijo_cobro_movimiento_solo_aprobado` | `CHECK (movimiento_id IS NULL OR estado = 'aprobado')` | Sólo un cobro aprobado puede apuntar al libro (R21: rechazar no emite movimiento). |
| `gasto_fijo_cobro_monto_positivo` | `CHECK (monto > 0)` | Espejo del invariante del libro (R52). |

**Claves foráneas:**

- `plantilla_id` → `gasto_fijo_plantilla(id)` **`ON DELETE SET NULL`**. Ni `CASCADE` (se llevaría por
  delante el rastro de aprobaciones y rechazos, que es justo lo que esta ficha existe para crear) ni
  `RESTRICT` (bloquearía para siempre el borrado real que trae la 332).
- `decidido_por` → `usuario(id)` **`ON DELETE RESTRICT`**: quién autorizó dinero es **evidencia** y no
  se pierde al dar de baja a un usuario. Mismo criterio que `orden_dia_reparto_cambio.actor_usuario_id`
  y `orden_nota.autor_id`. Indexada, porque el `RESTRICT` se ejerce al borrar usuarios.
- `movimiento_id` → `wallet_movimiento(id)` **`ON DELETE RESTRICT`**. **Sin índice a propósito**: el
  libro es append-only y **no se borra nunca** (R3 de la 42), así que ese `RESTRICT` no se ejerce
  jamás y no hay ninguna consulta por esa columna. Un índice sin consulta es coste de escritura sin
  beneficio.

**RLS:** `ALTER TABLE "gasto_fijo_cobro" ENABLE ROW LEVEL SECURITY;` **sin policies** — patrón
`wallet_movimiento` / `gasto_fijo_plantilla` / `notificacion`. Este repo no usa Supabase Auth (sesión
propia, sin `auth.uid()`), así que una policy no tendría a quién preguntar; lo que la RLS garantiza es
que a estas filas no se llega si no es por el servidor de la aplicación (R50).

#### Redundancias declaradas (no son olvidos)

- **`periodo` junto a `origen_id`.** `origen_id` es `"<uuid>:<periodo>"` y el uuid no contiene `:`, así
  que el período es derivable. Se guarda aparte porque es **el dato que se enseña y por el que se
  ordena**, mientras `origen_id` es **la clave** — y una clave no se destripa para pintar una celda.
- **`concepto` y `monto` copiados de la plantilla.** No es desnormalización perezosa: es **la
  corrección de R16**. Lo que el maestro aprueba es lo que vio; si el monto se leyera de la plantilla
  en el momento de aprobar, una edición intermedia cobraría un importe que nadie autorizó. Además es
  lo que hace que R47 siga siendo cierto cuando la plantilla desaparezca.

---

## 2 · La idempotencia, con el nombre del índice delante

**Hoy:** el cron inserta en el libro con `origen_id = "<plantillaId>:<periodo>"` y un `createMany
skipDuplicates` que compila a `ON CONFLICT DO NOTHING` contra
**`wallet_movimiento_origen_categoria_uq`** — `UNIQUE (origen_tipo, origen_id, categoria) WHERE
origen_id IS NOT NULL`. Eso es lo único que impide hoy el doble cobro, y su formato **no se toca**
(R11).

**Con esta ficha, la clave vive en DOS sitios y protege en dos momentos distintos:**

```
    cron (00:00 CR)                          aprobación (cuando el maestro decida)
    ───────────────                          ─────────────────────────────────────
    gasto_fijo_cobro.origen_id  ──────────►  wallet_movimiento.origen_id
    UNIQUE(origen_id)                        UNIQUE(origen_tipo, origen_id, categoria)
    gasto_fijo_cobro_origen_uq               wallet_movimiento_origen_categoria_uq
```

1. **El cron no puede crear dos pendientes.** `createMany({ skipDuplicates: true })` sobre
   `gasto_fijo_cobro` choca contra `gasto_fijo_cobro_origen_uq` y devuelve `count = 0` en la segunda
   corrida del mismo día. Sin TOCTOU: la unicidad la decide el motor, no una lectura previa (R9).
2. **La aprobación no puede crear dos egresos.** El movimiento se escribe con **el `origen_id` que el
   cobro guardó**, así que cae bajo `wallet_movimiento_origen_categoria_uq` **exactamente igual que
   hoy**. La misma protección, en un momento posterior (R14).
3. **El estado del cobro es la tercera red, y es la que serializa a dos humanos.** La aprobación
   empieza por `UPDATE ... SET estado='aprobado' WHERE id = $1 AND estado = 'pendiente'` **dentro de
   la transacción**: bajo `READ COMMITTED` (el nivel por defecto de Postgres y de Prisma) la segunda
   transacción **espera el bloqueo de fila**, re-evalúa el `WHERE` tras el commit de la primera,
   afecta **0 filas** y aborta sin escribir (R17, R18).

**Por qué la clave del cobro es `origen_id` y no `(plantilla_id, periodo)`:** porque `plantilla_id`
pasa a `NULL` cuando la plantilla se borra (§9), y una unicidad con `NULL` deja de proteger sin que
nadie lo note. `origen_id` es `NOT NULL`, se congela al generar y **es literalmente la misma cadena**
que va a acabar en el libro: una sola declaración del criterio, en las dos tablas.

**Efecto lateral BUSCADO: un rechazo es durable dentro de su período (R22).** El cobro rechazado
conserva su `origen_id`, así que la corrida siguiente del mismo período choca con
`gasto_fijo_cobro_origen_uq` y **no reaparece**. Si la clave hubiera sido parcial
(`WHERE estado='pendiente'`), lo rechazado volvería al día siguiente y el «no» del maestro no
significaría nada. Para las plantillas `dias`/`semanas` el período del día siguiente es otro, así que
el «no» aplica al período rechazado y no al ciclo entero — que es lo correcto.

**El caso mixto, que existe y hay que resolver (R19).** Si alguien cambia el interruptor de una
plantilla a mitad de período, pueden coexistir un cobro pendiente y un movimiento con la misma clave.
La aprobación lo resuelve sin duplicar: `crearMovimientos` devuelve `0`, se lee el movimiento
existente por su clave, se **enlaza** al cobro y el resultado viaja como
`{ status: "ok", yaEstabaEnElLibro: true }` para que el mensaje al usuario diga la verdad
(«ese cobro ya estaba en el libro; se marcó como aprobado y no se cobró dos veces»).

---

## 3 · El guard de rol: la primera excepción DELIBERADA a la paridad de la 94

`lib/auth/acceso-total.ts` gana **un segundo predicado, con nombre propio**, y `esAccesoTotal` **no
se toca**:

```ts
/** Roles que pueden DECIDIR un cobro de gasto fijo. Excepción deliberada a la paridad de la 94. */
export const ROLES_DECIDEN_COBRO_GASTO_FIJO: readonly RolValue[] = [RolValue.maestro];

export function puedeDecidirCobroGastoFijo(rol: RolValue): boolean {
  return ROLES_DECIDEN_COBRO_GASTO_FIJO.includes(rol);
}
```

- **Vive en el mismo archivo que la regla que excepciona**, para que quien lea la paridad
  (`maestro` y `admin` son equivalentes aquí) vea la excepción en la misma pantalla. Es aditivo:
  ninguno de los call-sites de `esAccesoTotal` —una veintena larga de servicios y páginas, medido con
  `grep` sobre el árbol de producción— cambia (R28).
- **Nombra la CAPACIDAD, no el rol.** Si mañana el humano quiere que el admin también apruebe, se
  añade un valor a la lista y el diff dice exactamente qué se decidió. Un `actor.rol !== "maestro"`
  suelto en el servicio —el patrón que usan `EliminarOrdenService` y `RecuperarOrdenService`— no
  dejaría ese rastro y no sería greppable como capacidad.
- **`listarPendientes` sigue autorizando con `esAccesoTotal`** (R25): el admin **ve** la cola. Sólo
  `aprobar` y `rechazar` usan el predicado estrecho (R24).
- Lo vigila una guardia estática (`gasto-fijo-decision-rol.guardia.test.ts`): el archivo del servicio
  **no** debe contener `esAccesoTotal` en las ramas de decisión, y el predicado nuevo **no** debe
  aparecer en ningún otro servicio. Se afirma sobre el **uso efectivo** (fuente sin imports ni
  comentarios), porque un `toContain` a secas se satisface con el `import` — la lección medida en
  `notificacion-notificadores-reales.test.ts`.

---

## 4 · El aviso: evento nuevo, entidad nueva y la trampa de la dedupe

### 4.1 Los dos valores de enum que se añaden

```sql
ALTER TYPE "notificacion_evento"      ADD VALUE IF NOT EXISTS 'gasto_fijo_cobro_pendiente';
ALTER TYPE "notificacion_entidad_tipo" ADD VALUE IF NOT EXISTS 'gasto_fijo_cobro_dia';
```

Con su reflejo en `lib/types/notificacion.ts` y en `db/schema.prisma`, y con la lista **literal** de
`tests/unit/services/notificacion-productores-wiring.test.ts` actualizada a mano (R36). Es el precio
que D1 de la 146 puso a añadir un evento, y que ese test se ponga rojo **es la prueba** de que el
inventario sigue cerrado.

### 4.2 La entidad es EL DÍA, y esto es la decisión que evita el fallo de la 262

`notificacion_dedupe_key` es `UNIQUE (evento, entidad_id, destinatario_rol, destinatario_usuario_id)`
con `NULLS NOT DISTINCT` y `WHERE entidad_id IS NOT NULL`, y `NotificacionRepository.crear`
**absorbe el `P2002` devolviendo `false`**. Con una entidad que no cambiara entre días:

- el aviso del día 2 **no se crearía nunca**, en silencio absoluto;
- y ni siquiera haría falta que el índice actuara: `emitirFilas` consulta antes
  `existeNoLeidaPara(evento, entidadId, destinatario)` y, mientras el primer aviso siga **sin leer**,
  se salta la creación.

Es exactamente el error que la 262 documentó (eligió el **cambio** como entidad, no la orden) y el que
la 253 dejó escrito en su migración («emitir con `entidad_id NULL` **desactiva la dedupe entera**»).

**Decisión:** la entidad del aviso es **el día CR de la corrida**.

| Campo | Valor |
| --- | --- |
| `evento` | `gasto_fijo_cobro_pendiente` |
| `entidad_tipo` | `gasto_fijo_cobro_dia` |
| `entidad_id` | `"YYYY-MM-DD"` — el día CR de la corrida |
| `destinatario` | `{ tipo: "rol", rol: "maestro" }` |
| `tipo` (presentación) | `warning` — «algo pendiente de aprobación», igual que `cierre_dia_por_aprobar` |
| `descripcion` | `textoCobrosGastoFijoPendientes(n)` |
| `anexo` | `null` |

Consecuencias, y son **estructurales**, no de disciplina:

- **Días distintos ⇒ entidades distintas ⇒ el recordatorio diario sale siempre** (R30), leído o no
  leído el del día anterior.
- **Misma corrida repetida el mismo día ⇒ misma entidad ⇒ un solo aviso** (R31): lo filtra la guardia
  de no-leídas y, si ya se leyó, lo filtra `notificacion_dedupe_key` con su `P2002` absorbido.
- **`gasto_fijo_cobro_dia` es el primer `entidad_tipo` que NO apunta a una fila de tabla**, y por eso
  se le da un valor propio en vez de reutilizar uno existente: el nombre **declara** que la entidad es
  el día de la cola. Reusar un valor que promete una fila (`carga`, `usuario`…) sería escribir un dato
  falso con formato de dato — el motivo por el que la 253 no reusó `usuario`. Queda escrito en el enum,
  en `lib/types/notificacion.ts` y en la migración.

### 4.3 El texto

```ts
export function textoCobrosGastoFijoPendientes(n: number): string {
  return n === 1
    ? "Hay 1 cobro de gasto fijo esperando tu aprobación."
    : `Hay ${n} cobros de gasto fijo esperando tu aprobación.`;
}
```

Vive **sólo** en `lib/notificaciones/emitir.ts`, como manda la 146 §4.6. **Sin monto, sin concepto,
sin nombre** (R35): el aviso dice que hay algo que atender; **qué** es se lee en `/wallet`, que es
donde vive la autorización por rol. Mismo criterio, palabra por palabra, que
`TEXTO_POSTULACION_RECURSO_PENDIENTE`.

### 4.4 El cableado (y la lección que cuesta 2 de 7 notificadores muertos)

```
lib/notificaciones/emitir.ts        emitirGastoFijoCobroPendiente(repo, ctx, tx?)
lib/notificaciones/notificadores.ts GastoFijoCobroPendienteNotificador  (tipo)
                                    notificarGastoFijoCobroPendienteCon(repo, logger?)  (testeable)
                                    notificarGastoFijoCobroPendienteReal                (binding prod)
lib/services/GeneracionGastosFijos… constructor: notificador = notificadorNoOp  ← DEFAULT
app/api/cron/generar-gastos-fijos/  buildService(): pasa notificarGastoFijoCobroPendienteReal ← ROOT
```

El default es el **no-op** para que ninguna suite escriba avisos en la base —que en este repo es
compartida— y el real se inyecta **en el composition root**. El precedente está escrito en
`app/api/cron/corte-diario/route.ts`: la llamada pasaba cinco argumentos, el notificador se quedó con
su default y **el aviso no se emitió nunca, con la suite en verde**. Por eso R34 exige que el censo de
`notificacion-notificadores-reales.test.ts` incorpore este cableado **afirmando sobre el uso efectivo**
(fuente sin imports ni comentarios): con un `toContain` a secas, borrar la línea del cableado deja el
test verde porque el `import` de arriba sigue conteniendo el nombre.

La emisión es **best-effort y fuera de la transacción** (`emitirBestEffort`): el cron es
money-critical y corre sin nadie mirando; un aviso caído no puede tumbar la corrida ni dejar cobros a
medias. La dirección segura del error es esa: **la corrida manda, el aviso es cortesía** (R33).

---

## 5 · El cron: sin cron nuevo, y por qué

`vercel.json` ya agenda `GET /api/cron/generar-gastos-fijos` con `0 6 * * *`, que es **06:00 UTC =
00:00 de Costa Rica**: el arranque del día CR. Un recordatorio diario no necesita más frecuencia que
esa, y **añadir un segundo cron traería tres costes por cero beneficio**: otra entrada en `vercel.json`
(el plan tiene un límite de crons), otro secreto que verificar, y —lo caro— **dos relojes que pueden
divergir**: el aviso «hay N pendientes» calculado a una hora distinta de aquella en la que los
pendientes nacen abriría una ventana en la que el número es falso. Con un único paso, el conteo y el
aviso salen **de la misma lectura**.

`ejecutarGeneracion(now)` pasa a hacer, en este orden:

```
1. plantillas = plantillaRepo.listarActivas()                       (sin cambio)
2. aplican    = plantillas.filter(p => aplicaHoy(p, now))           (sin cambio)
3. particion  = aplican.split(p => p.requiereAprobacion)
4. $transaction:
     a. movimientoRepo.crearMovimientos(tx, egresosDeLasQueCobranSolas)   → egresosGenerados
     b. cobroRepo.crearPendientes(tx, cobrosDeLasQueRequierenAprobacion)  → cobrosCreados
5. pendientes = cobroRepo.contarPendientes()        ← TODOS, no sólo los de hoy
6. si pendientes > 0: notificador({ pendientes, diaCR })   ← best-effort, FUERA de la tx
7. return { fecha, plantillasActivas, plantillasQueAplicanHoy, egresosGenerados,
            cobrosPendientesCreados, cobrosPendientesTotales }
```

- **El paso 4 es UNA transacción** (R10). Hoy la corrida es un único `createMany`, o sea atómica por
  construcción; partirla en dos escrituras sin transacción abriría un hueco real: si la segunda
  fallara, los cobros de ese día **no se recuperarían mañana**, porque `aplicaHoy` es una regla de
  día, no una cola. La transacción devuelve la garantía que ya había.
- **El paso 5 cuenta TODOS los pendientes, no los de la corrida** (R30): el recordatorio existe
  precisamente para los días en que no se genera nada nuevo.
- **El paso 6 no entra en la transacción** (§4.4).
- El resumen del paso 7 sigue siendo **sólo conteos + fecha** (R13). El route handler no cambia de
  forma: sigue autorizando por `CRON_SECRET` **antes de cualquier efecto** y delegando todo en el
  servicio; lo único que gana es el argumento del notificador real en `buildService()`.

---

## 6 · Capas, archivos y contratos

```
app/api/cron/generar-gastos-fijos/route.ts     ← composition root del cron (+ notificador real)
lib/services/GeneracionGastosFijosService.ts   ← reparte: libro vs cobro; cuenta; avisa
lib/services/GastoFijoCobroService.ts          ← aprobar / rechazar / listar / cancelar
lib/repositories/GastoFijoCobroRepository.ts   ← sólo Prisma
lib/repositories/WalletMovimientoRepository.ts ← + obtenerPorOrigen (lectura por la clave)
lib/interfaces/{services,repositories}/…       ← IGastoFijoCobroService, IGastoFijoCobroRepository
lib/types/gasto-fijo-cobro.ts                  ← DTO + schemas zod + resultados
lib/actions/gasto-fijo-cobro.ts                ← Server Actions ('use server')
lib/auth/acceso-total.ts                       ← + puedeDecidirCobroGastoFijo
lib/notificaciones/{emitir,notificadores}.ts   ← + el evento nuevo
app/(app)/wallet/page.tsx                      ← pre-fetch + puedeDecidir
app/(app)/wallet/_components/WalletModule.tsx  ← monta la sección
app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx   ← la sección (nuevo)
```

### 6.1 DTO (frontera servidor → cliente)

```ts
export type GastoFijoCobroDTO = {
  id: string;
  concepto: string;
  monto: string;          // Decimal -> STRING 2 dec. NUNCA number (R43)
  periodo: string;        // "YYYY-MM" | "YYYY-MM-DD"
  generadoEl: string;     // "YYYY-MM-DD"
  estado: "pendiente" | "aprobado" | "rechazado" | "cancelado";
};
```

Ni `origenId`, ni `plantillaId`, ni `movimientoId` cruzan la frontera: la pantalla no los necesita y
un identificador de clave de idempotencia en el navegador es superficie que no hace falta abrir.

### 6.2 Server Actions

| Action | Entrada (zod, `.strict()`) | Salidas |
| --- | --- | --- |
| `listarCobrosPendientesAction` | `{}` | `{ status:"ok", items: GastoFijoCobroDTO[], total: number }` · `forbidden` · `unauthenticated` · `validation_error` |
| `aprobarCobroGastoFijoAction` | `{ id: uuid }` | `{ status:"ok", yaEstabaEnElLibro: boolean }` · `ya_decidido` · `not_found` · `forbidden` · `unauthenticated` · `validation_error` |
| `rechazarCobroGastoFijoAction` | `{ id: uuid }` | `{ status:"ok" }` · `ya_decidido` · `not_found` · `forbidden` · `unauthenticated` · `validation_error` |
| `contarCobrosPendientesDePlantillaAction` | `{ plantillaId: uuid }` | `{ status:"ok", pendientes: number }` · `forbidden` (`esAccesoTotal`) · `unauthenticated` · `validation_error` |

Patrón exacto de `lib/actions/wallet-egresos.ts`: `resolveActorFromSession` → `UnauthenticatedError`
antes de tocar el servicio → `schema.parse(input)` → servicio bajo `withErrorHandler`; el borde
resuelve `unauthenticated` y `validation_error`, y el servicio devuelve el resto como resultado de
dominio (R26).

**Ninguna de las tres acepta el monto del cliente.** El monto lo pone el servidor desde la copia del
cobro (R16). Es la misma regla por la que `reversarEgreso` lee el monto server-side.

### 6.3 `aprobarCobro`, paso a paso (el método que mueve dinero)

```
puedeDecidirCobroGastoFijo(actor.rol) === false            → { status: "forbidden" }      (R24)
$transaction(async tx => {
  cobro = cobroRepo.obtenerPorId(tx, id)
  cobro === null                                           → not_found                    (R20)
  n = cobroRepo.marcarDecidido(tx, id, "aprobado", actor, ahora)   // WHERE id AND estado='pendiente'
  n === 0                                                  → ya_decidido (rollback)       (R17,R18)
  insertadas = movimientoRepo.crearMovimientos(tx, [{
      tipo: "egreso", categoria: "egreso_gasto_fijo",
      monto: cobro.monto,                 // STRING, la COPIA (R16)
      origenTipo: "gasto", origenId: cobro.origenId,        // LA CLAVE (§2)
      descripcion: `${cobro.concepto} — ${cobro.periodo}`,
      registradoPor: actor.usuarioId,                      // quién autorizó (R14)
  }])
  mov = movimientoRepo.obtenerPorOrigen(tx, "gasto", cobro.origenId, "egreso_gasto_fijo")
  mov === null                                             → error (rollback; imposible)
  cobroRepo.enlazarMovimiento(tx, id, mov.id)
  return { status: "ok", yaEstabaEnElLibro: insertadas === 0 }                            (R19)
})
```

`rechazarCobro` es la mitad de arriba: guard, `marcarDecidido(..., "rechazado", ...)`, y **nada más**
(R21). No abre transacción porque es **una sola sentencia condicional**, que ya es atómica.

**El reloj (`ahora`) se inyecta**, como en todo el resto del módulo (`GeneracionGastosFijosService`
recibe `now`): un test no puede depender de `new Date()` dentro del servicio.

---

## 7 · La pantalla

**Dónde va.** Entre la tarjeta de la caja y la de la ganancia — es decir, **lo primero que se lee**
después del dinero, y antes de la composición y del libro. No se mueve nada más de `WalletModule`.

**Con qué se pinta** (las primitivas que el módulo ya usa desde el rediseño de la 200, sin lenguaje
visual nuevo, R37):

```tsx
<section aria-label="Cobros de gasto fijo por aprobar">
  <Card>
    <CardHeader className="border-b">
      <CardTitle>Cobros de gasto fijo por aprobar</CardTitle>
      <CardDescription>Nadie los cobró todavía: esperan tu decisión.</CardDescription>
      <CardAction><Badge variant="warning">{total} por aprobar</Badge></CardAction>
    </CardHeader>
    <CardContent><DataTable … /></CardContent>
  </Card>
</section>
```

- **`Badge variant="warning"`** es lo que «llama la atención sin romper el diseño»: es un token del
  sistema (`bg-warning-soft` / `text-warning-strong`, contraste AA atado por
  `contraste-tokens.guardia`), el mismo lenguaje que ya usan las demás tablas. No se inventa color, ni
  banner, ni animación.
- **`{total}` sale del servidor, no de `items.length`** (R41). `WalletModule` monta `<Pagination>`,
  así que este archivo entra en el alcance de `contadores-cabecera.guardia`, que prohíbe —con razón—
  el patrón `({X.length})` en una pantalla paginada. Aquí ni siquiera se escribe.
- **Si `total === 0` la sección no se renderiza** (R38): una tarjeta vacía permanente sería ruido, y
  lo que se pide es que se note **cuando hay algo**.
- **Columnas:** Concepto · Período · Monto (`money(c.monto)`, STRING tal cual, sin `parseFloat`) ·
  Generado el · Acciones.
- **Acciones sólo si `puedeDecidir`** (R40), calculado en `page.tsx` como
  `actor.rol === RolValue.maestro` y pasado por prop — precedente literal: `puedeEliminar` en
  `app/(app)/ordenes/page.tsx`. La UI que esconde es **comodidad**; la autorización real es la del
  servicio (R24), y las dos se prueban por separado.
- **`descarga`: NO.** Queda registrada en `tests/unit/descarga/censo-tablas.ts` como `fuera` con su
  motivo obligatorio (cola de decisión efímera; lo aprobado aterriza en el libro de la caja, que sí
  descarga). Sin esa entrada, `cobertura-tablas.guardia` se pone roja.
- **Tras aprobar/rechazar:** `mutate()` de la sección + `onCambio()` al módulo, que recarga libro,
  resumen, composición y desglose con los filtros vigentes (R42). Exactamente el ciclo que ya hace
  `GastosFijosPlantillasPanel`.

**Pre-fetch en el Server Component** (R44): `page.tsx` añade `listarCobrosPendientesAction({})` al
`Promise.all` que ya hace, y pasa `{ items, total }` + `puedeDecidir` por props. Datos sensibles →
props, nunca fetch del cliente (docs/architecture.md).

---

## 8 · Interruptor en el CRUD de plantillas

- `crearGastoFijoPlantillaSchema` y su derivado de actualizar ganan
  `requiereAprobacion: z.boolean().default(true)`. **Con default**, igual que hizo la 84 con la
  periodicidad: la UI que todavía no lo mande sigue funcionando y la fila nace en «requiere
  aprobación» (R2).
- `GastoFijoPlantillaDTO` gana `requiereAprobacion: boolean`; el repositorio lo mapea; el servicio lo
  pasa. El guard sigue siendo `esAccesoTotal` (R3, R28).
- `GastoFijoPlantillaDialog` gana un `Switch` con dos etiquetas explícitas —**«Cobra sola»** /
  **«Requiere aprobación»**— y `GastosFijosPlantillasPanel` una columna `Badge` con el mismo texto
  (R4). El texto sale de un módulo puro (`gasto-fijo-estado-label.ts` ya existe con ese patrón), para
  que tabla y diálogo no puedan divergir.
- **La descripción de la tarjeta de plantillas hoy MIENTE en cuanto entre esta ficha**: dice «El
  sistema cobra estos gastos automáticamente cada mes». Pasa a decir que depende del interruptor de
  cada plantilla. (Y de paso deja de decir «cada mes», que ya era falso desde la 84.)

---

## 9 · Borrado de plantilla (la cascada es de esta ficha, no de la 332)

**`specs/332-eliminar-plantilla-gasto-fijo/design.md §5` ya fijó el reparto por escrito** y esta
ficha lo cumple literalmente: la 332 **declara** el contrato (su R25) y **no** esquematiza la tabla ni
implementa la cascada; la 333 es la dueña de la tabla, **implementa la cancelación y calcula el
número** de la confirmación (su R26, que aquí son R45–R57).

1. `GastoFijoCobroRepository.cancelarPendientesDePlantilla(tx, plantillaId, actorId, ahora): number` —
   `updateMany({ where: { plantillaId, estado: "pendiente" }, data: { estado: "cancelado",
   decididoPor: actorId, decididoAt: ahora } })`, y devuelve **cuántos** (R45).
2. `contarCobrosPendientesDePlantillaAction({ plantillaId })` — lectura dedicada que el **diálogo de
   confirmación** llama al abrirse, para que el usuario lea «se cancelarán 2 cobros pendientes»
   **antes** de aceptar (R55). Se lee en ese momento y **no** se cuelga del listado: un número traído
   con la página puede tener minutos y este número autoriza un borrado.
3. `eliminarPlantilla` —el punto de sutura que la 332 dejó previsto— **abre la transacción**, llama a
   (1) y borra; `EliminarPlantillaServiceResult` gana el campo con el conteo **realmente** cancelado.
   Si entre el aviso y la ejecución el número cambió, **el borrado sigue** y el resultado reporta el
   número real (R56): abortar un borrado legítimo porque alguien aprobó un cobro entre medias sería
   castigar al usuario por una carrera que no puede ver.
4. **Y si alguien se olvida, la base lo impide (R46).** Con `plantilla_id ON DELETE SET NULL` y el
   `CHECK gasto_fijo_cobro_pendiente_con_plantilla`, un `DELETE` de una plantilla con pendientes vivos
   **viola el CHECK y aborta ruidosamente**. Esto es lo que hace que el orden de llegada de las dos
   fichas no importe: si la 332 se implementa antes y sin la cancelación, su borrado **falla con un
   error claro** en vez de dejar cobros huérfanos y aprobables sin plantilla.
5. Y por si el CHECK no se ejerciera nunca (porque nadie llegó a tener un pendiente), una **guardia
   estática** cierra el hueco (R57): *si* existe en el árbol una operación que borra plantillas, su
   fuente —sin imports ni comentarios— **debe** contener la llamada a
   `cancelarPendientesDePlantilla`. Es el mismo archivo que la 332 ya nombra en su trazabilidad
   (`tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts`), y se escribe **condicional a
   que el símbolo exista**, para que valga en los dos órdenes de implementación.
6. Los cobros ya decididos sobreviven al `DELETE` con `plantilla_id = NULL` y **su copia intacta** de
   concepto, monto y período (R47), y los movimientos del libro no se tocan (son inmutables).

**Desactivar no es borrar** (R48): `setActivaPlantilla` no toca ningún cobro. Detiene la generación
futura —`listarActivas` ya filtra— y deja lo generado esperando decisión.

---

## 10 · Migraciones

Dos, con timestamp propio y su `down.sql` (R53):

**(1) `<ts>_gasto_fijo_cobro`** — `CREATE TYPE gasto_fijo_cobro_estado`, `CREATE TABLE
gasto_fijo_cobro` con sus CHECK/FK/índices, `ENABLE ROW LEVEL SECURITY`, y
`ALTER TABLE gasto_fijo_plantilla ADD COLUMN requiere_aprobacion`.
`down.sql`: `DROP TABLE gasto_fijo_cobro` → `DROP TYPE gasto_fijo_cobro_estado` →
`ALTER TABLE gasto_fijo_plantilla DROP COLUMN requiere_aprobacion`. Sin `55P04`: el enum se **crea**,
no se amplía.

**(2) `<ts+1>_notificacion_evento_gasto_fijo_cobro`** — los dos `ALTER TYPE ... ADD VALUE IF NOT
EXISTS`. **Va sola y con timestamp propio** por la razón que este repo ya tiene escrita cinco veces:
Postgres no permite **usar** un valor de enum recién añadido en la misma transacción que lo añadió
(`55P04`) y Prisma Migrate corre cada `migration.sql` en una. Aquí sólo se añaden; su primer uso es en
runtime.
`down.sql`: **recrear los dos tipos con la lista previa exacta** —los **ocho** valores vigentes de
`notificacion_evento` y los **seis** de `notificacion_entidad_tipo`— con
`RENAME TO *_old` + `CREATE TYPE` + `ALTER COLUMN ... USING (…::text::…)` + `DROP TYPE *_old`, copiando
literalmente el patrón de `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql`.

**La pregunta obligatoria del repo, hecha y respondida:** *¿el down de la migración que creó el enum
recrea-con-lista o sólo dropea?*

| down previo de estos enums | Qué hace | ¿Se toca? |
| --- | --- | --- |
| `20260727120000_notificacion` (146, los creó) | **sólo dropea** (se lleva las tablas) | **No.** Foto histórica; los valores nuevos no cambian nada de lo que aquel down debe hacer. |
| `20260820210000_…postulacion_recurso` (253) | recrea con lista (los 4 de la 146) | **No.** Su lista es «el enum antes de la 253» y sigue siendo cierta. |
| `20260822140000_…dia_reparto_corregido` (262) | recrea con lista (5 y 5) | **No.** Idem. |
| `20260823120000_…bloqueo_cierre` (271) | recrea con lista (6 en `evento`) | **No.** Idem. |

**Ningún `down.sql` anterior se edita ni se renumera** — «migración editada en sitio = drift». El
único que conoce la lista de hoy es el nuestro.

**Precondición ruidosa (R54):** ninguna fila de `notificacion` con `evento =
'gasto_fijo_cobro_pendiente'` ni `entidad_tipo = 'gasto_fijo_cobro_dia'`. Si quedara alguna, el
`USING` falla y el rollback **aborta**. Es el comportamiento correcto: son avisos de dinero por
autorizar que el maestro puede no haber leído. **Aquí no hay ni un `DELETE` ni un `UPDATE` para
«hacer sitio».**

---

## 11 · Alternativas descartadas

### A1 — El pendiente vive en el LIBRO, con un estado (`wallet_movimiento.estado`) · **DESCARTADA**

Parecía lo barato: la clave de idempotencia no se movería de sitio. Se descarta por tres razones, y la
primera sola bastaría:

1. **Rompe la propiedad que define al libro.** `wallet_movimiento` es **append-only e inmutable**
   (R1/R3 de la 42): sin `updated_at`, sin `deleted_at`, y el repositorio no expone `update` ni
   `delete` a propósito. Un estado que cambia exige un `UPDATE` sobre la tabla de la caja.
2. **Mientras el pendiente esté ahí, el balance miente.** El balance se **deriva**
   (`SUM ingreso - SUM egreso`, R16 de la 42) y lo consumen la caja, la composición de la ganancia, el
   desglose de egresos y la analítica financiera. Cada uno de esos lectores tendría que aprender a
   excluir el nuevo estado; el que se olvidara restaría dinero que nadie autorizó, **sin ningún error**.
3. **Contamina un enum de dinero para siempre.** Postgres no permite `DROP VALUE`.

### A2 — El interruptor es global (una fila de configuración) en vez de por plantilla · **DESCARTADA por la puerta humana el 2026-08-29**

Decisión ya tomada: **por plantilla**. Un interruptor global obligaría a elegir entre autorizar el
alquiler (que no cambia nunca) o dejar sin control los gastos que sí varían, y **cambiaría la conducta
de las plantillas que hoy cobran solas**, que es justo lo que la puerta prohibió.

### A3 — Recordatorio con la **entidad = el cobro** · **DESCARTADA, y es la trampa de esta ficha**

Es la elección natural («la entidad es la cosa de la que se avisa») y produce **un silencio total**:
`notificacion_dedupe_key` admitiría **una sola fila por (evento, cobro, maestro) para siempre**, el
`P2002` se absorbe devolviendo `false`, y el recordatorio del día 2 **no existiría nunca**. Sin error,
sin log, sin nada. Es literalmente lo que le pasó a la 262 con `orden` como entidad. Ver §4.2.

### A4 — Recordatorio con `entidad_id = NULL` (dedupe desactivada) · **DESCARTADA**

`emitirFilas` se salta la guardia cuando `entidadId` es `null` y el índice único es parcial
(`WHERE entidad_id IS NOT NULL`), así que **saldría un aviso por cada ejecución**: dos corridas del
mismo día ⇒ dos avisos idénticos que nadie puede agrupar (R31 rota). La 253 ya rechazó esto por
escrito en su propia migración.

### A5 — Un aviso **por cada cobro** en vez de uno agregado por día · **DESCARTADA**

Con 5 plantillas pendientes serían 5 avisos diarios, 150 al mes en una campana con ventana de 30 días,
y ninguno diría nada que el anterior no dijera. Además obligaría a poner concepto o monto en el texto
para distinguirlos, contra la regla de la 146 («nunca dirección, teléfono ni monto»). El aviso dice
**cuántos**; **cuáles** se leen en `/wallet`, que es donde la autorización por rol vive — mismo
criterio que `TEXTO_POSTULACION_RECURSO_PENDIENTE`.

### A6 — Un cron nuevo sólo para el recordatorio · **DESCARTADA**

Ver §5: `generar-gastos-fijos` ya corre a las 00:00 CR. Dos relojes distintos abrirían una ventana en
la que el número del aviso no coincide con los pendientes que hay.

### A7 — Reusar `esAccesoTotal` y filtrar el botón en la UI · **DESCARTADA**

Sería autorización de mentira: la Server Action queda abierta al `admin` y la UI es sugerencia, no
control. La ficha pide una excepción **de servidor** (R24). La UI esconde el botón **además** (R40),
no en vez de.

### A8 — Cobrar el monto **vigente de la plantilla** al aprobar · **DESCARTADA**

Si alguien edita la plantilla entre la generación y la aprobación, se cobraría un importe que el
maestro **no vio**. El cobro guarda su copia (R16). El coste aceptado: si el monto real cambió, hay
que rechazar el cobro y esperar al período siguiente — que es exactamente lo que debe pasar cuando el
importe autorizado ya no es el correcto.

### A9 — Unicidad del cobro **parcial** (`UNIQUE(origen_id) WHERE estado = 'pendiente'`) · **DESCARTADA**

Permitiría regenerar un pendiente ya rechazado en el mismo período: el «no» del maestro duraría hasta
la madrugada siguiente. La unicidad total sobre `origen_id` hace que **la decisión valga para su
período** (R22).

---

## 12 · Riesgos y verificación

| Riesgo | Cómo queda cubierto |
| --- | --- |
| Doble cobro por la clave | Dos índices únicos + el `WHERE estado='pendiente'`, probados **contra Postgres** (`tests/integration/db/**`). Los dobles no ven el SQL. |
| Recordatorio que no se repite | La entidad-día, probada con dos corridas de días distintos **y** dos del mismo día contra la base. |
| Notificador muerto | Censo sobre el **uso efectivo** en el composition root (R34). |
| Un rol de más aprobando | Guardia estática (R27) + test de servicio con actor `admin` (R24). |
| Monto convertido a número | Guardia money-safe sobre los archivos nuevos (R43). |
| Regresión en el camino «cobra sola» | Los tests existentes de `generacion-gastos-fijos-service` se conservan **sin tocar** para el camino automático (R5). |

**El gate:** este diff toca `db/migrations/**`, `db/schema.prisma`, `lib/types/**` y **una docena de
archivos con nombre de dinero** (`wallet`, `cobro`, `egreso`, `gasto`). `./init.sh --rapido`
**se niega solo** y manda al completo. No es una recomendación: es el comportamiento del gate
(`docs/verification.md`). Planifíquese el tiempo del `./init.sh` completo, no el del rápido.

**Sin `DATABASE_URL` no hay evidencia de la mitad de esta ficha.** Los seis requisitos que viven en el
motor (R9, R10, R15, R17, R18, R19, R22, R31, R46, R47, R50, R51, R52) se **saltan** —no fallan— si la
base no resuelve. En un worktree eso es lo normal. Quien cierre la fase debe **exportar
`DATABASE_URL`** y decir en `progress/impl_333.md` que esos archivos **corrieron**, no que «pasaron».
