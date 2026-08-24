# Feature 264 — Diseño

> **Actualizado el 2026-08-22** con las ocho respuestas del humano. Lo que cambió respecto al
> diseño anterior está marcado con **[Q<n>]**. El núcleo —tabla puente persistida— no cambió;
> se le añadieron la **marca por cierre** (Q3), la **segunda superficie** (Q1) y tres reglas
> de presentación (Q5, Q6, Q7).

## 1. El camino real de una orden barrida (§ pedido (a) de la ficha)

Trazado sobre el código, no supuesto:

1. **Selección.** `CorteDiarioRepository.findMensajerosConActividadSinCierre(diaCerrado)`
   (`lib/repositories/CorteDiarioRepository.ts:62`) trae los mensajeros por unión de
   (a) gestiones sin cerrar y (b) órdenes en `ESTADOS_A_BARRER` (`en_reparto`,
   `ayuda_tienda`) no reservadas para un día posterior. Resta a los que ya tienen un cierre
   abierto (`solicitado`, `vencido`, `rechazado`).
2. **Escritura.** `CorteDiarioService` (`lib/services/CorteDiarioService.ts:103`) arma
   `corteSinGestionar` (los tres `estatusId` + `diaCerrado`) y llama a
   `CierreDiaRepository.crearCierre(...)`. Dentro de **una sola transacción**
   (`CierreDiaRepository.ts:558-606`) se recorre **una vuelta por estatus de origen**, se
   hace `updateMany` guardado a `sin_gestionar` y se registra el cambio por el choke point
   con `origen_tipo = corte_sin_gestionar`.
   **El `data` de ese `updateMany` toca ÚNICAMENTE `estatus_id`.** Ni el cierre recién
   creado, ni `mensajero_asignado_id`, ni un total.
3. **Lo que NO ocurre.** No se escribe ninguna fila que relacione esa orden con el cierre.
   `orden` no tiene columna de cierre; `cierre_detail` se construye **desde
   `gestion_orden` ya vinculada** (`CierreDiaRepository.ts:675-719`), así que una orden sin
   gestión tampoco tiene fila congelada.
4. **Lectura del detalle.** `CierresAdminRepository.findCierreByIdEnAlcance`
   (`:1007-1045`) hace dos consultas —`gestion_orden WHERE cierre_id` y
   `cierre_detail WHERE cierre_id`— y las cruza por `orden_id`.
   `CierresAdminService.verCierreDetalle` (`:476-565`) agrupa por `resultado` en las cinco
   claves de `CierreGrupos`. **Una orden sin gestión no puede entrar por ninguna de las dos
   consultas.** Eso es lo estructural que dice la ficha.
5. **Fin del rastro.** Al APROBAR, `CierresAdminRepository` (`:1349-1415`) libera esas
   órdenes: `estatus → en_bodega(_satelite)`, `mensajero_asignado_id = NULL`,
   `asignado_at = NULL`, `fecha_reparto = NULL`, `prioridad = true`.

**Conclusión de la traza:** hoy la relación cierre ↔ orden barrida existe solo como
predicado vivo (`orden.mensajero_asignado_id = cierre.mensajero_id AND estatus =
sin_gestionar`) y **la aprobación la borra**. Cualquier diseño que lea ese predicado da una
lista correcta mientras el cierre está abierto y **vacía o ajena** en cuanto se aprueba.

---

## 2. Decisión D1 — el vínculo se PERSISTE, en la misma transacción del barrido

Tabla puente nueva, **sin una sola columna de dinero**. Que no pueda mover un total no es
una promesa de la capa de arriba: es que no hay nada que sumar.

### 2.1 Modelo (`db/schema.prisma`)

```prisma
model CierreSinGestion {
  id       String @id @default(uuid())
  cierreId String @map("cierre_id")
  ordenId  String @map("orden_id")

  // --- descriptivos CONGELADOS al barrer (R11). Copia, no identidad. ---
  numGuia      Int?    @map("num_guia")      // SIN @unique
  numRemision  String  @map("num_remision")
  destinatario String
  producto     String
  tiendaNombre String  @map("tienda_nombre")
  zonaNombre   String  @map("zona_nombre")

  // R4: el estatus REAL del que salió esta orden (`en_reparto` | `ayuda_tienda`), tomado de
  // la vuelta del bucle que la barrió. NULL = no consta (R32/R33): la fila OMITE la pieza en
  // pantalla, no pinta un guion. No se supone nunca.
  estatusOrigenId String? @map("estatus_origen_id")

  createdAt DateTime @default(now()) @map("created_at")
  // SIN updated_at / deleted_at: fila INMUTABLE, como `cierre_detail` (69/R10).

  cierre        CierreDia    @relation(fields: [cierreId], references: [id])
  orden         Orden        @relation(fields: [ordenId], references: [id])
  estatusOrigen OrderStatus? @relation(fields: [estatusOrigenId], references: [id], onDelete: Restrict)

  @@unique([cierreId, ordenId]) // grano e índice de la ruta caliente (se filtra por cierre_id)
  @@index([ordenId])            // trazar en qué cierres se barrió una orden
  @@map("cierre_sin_gestion")
}
```

**Por qué el grano es `(cierre_id, orden_id)` y no una columna en `orden`:** una orden puede
ser barrida, liberada, reasignada y barrida otra vez en otro cierre. Una columna la
sobrescribiría y perdería el vínculo anterior; es la misma razón por la que `cierre_detail`
es tabla y no columnas.

**Por qué se congelan seis descriptivos y no se hace `JOIN` con `orden` viva:** precedente
exacto de la feature 69/T18 — el detalle de un cierre ya creado se leía navegando
`gestion_orden.orden.*` y «el admin veía los valores de HOY, no los del cierre que está
revisando». No hay motivo para repetir ese error en la mitad nueva de la misma pantalla.
Se congela **solo lo que la sección pinta** (R18) más `zona_nombre`, que es contexto
operativo del barrido.

**Lo que deliberadamente NO se guarda:** ninguna fecha con nombre de «barrido». `created_at`
sirve de auditoría técnica de la fila, pero en las filas del backfill valdría la fecha de la
migración, así que **no se muestra en pantalla**: un dato que miente en el 100 % de las filas
viejas es peor que un dato ausente.

### 2.2 Migración

`db/migrations/<ts>_cierre_sin_gestion/migration.sql` + `down.sql` (obligatorio,
`docs/architecture.md`).

UP:
1. `CREATE TABLE "cierre_sin_gestion" (...)` con `id TEXT NOT NULL` + pkey, las seis columnas
   descriptivas, `estatus_origen_id TEXT NULL`, `created_at TIMESTAMP(3) NOT NULL DEFAULT
   CURRENT_TIMESTAMP`.
2. `CREATE UNIQUE INDEX "cierre_sin_gestion_cierre_id_orden_id_key"` +
   `CREATE INDEX "cierre_sin_gestion_orden_id_idx"`.
3. Tres FK con `ON DELETE RESTRICT ON UPDATE CASCADE` (cierre, orden, order_status), el mismo
   molde que las cinco de `cierre_detail`.
4. `ALTER TABLE "cierre_sin_gestion" ENABLE ROW LEVEL SECURITY;` **sin policies** (R23),
   idéntico a `cierre_detail`: el acceso es por service role vía Prisma.
5. **[Q3] La marca por cierre (R27/R29)** — una columna booleana en `cierre_dia`:

```sql
ALTER TABLE "cierre_dia"
  ADD COLUMN "sin_gestion_registrado" BOOLEAN NOT NULL DEFAULT true;
```

   `DEFAULT true` deja marcados como **registrados** a los cierres nuevos (sin escribir una
   línea en el camino caliente del corte: el default lo pone Postgres) y a los existentes; el
   paso 7 baja a `false` exactamente los que **no se pueden** reconstruir.

6. **Backfill de los vínculos (R25/R26/R33)**, un solo `INSERT … SELECT`. El `LATERAL`
   recupera el estatus de origen del historial de **esa orden** (**[Q6]**): no es una
   heurística de tiempo como la alternativa A4, porque la orden **sigue** en `sin_gestionar`
   y su última transición hacia ese estado es, por construcción, la del corte que la barrió.

```sql
INSERT INTO "cierre_sin_gestion" (id, cierre_id, orden_id, num_guia, num_remision,
                                  destinatario, producto, tienda_nombre, zona_nombre,
                                  estatus_origen_id, created_at)
SELECT gen_random_uuid(), c.id, o.id, o.num_guia, o.num_remision, o.destinatario,
       o.producto, t.nombre, z.nombre, h.estatus_origen_id, CURRENT_TIMESTAMP
  FROM "cierre_dia" c
  JOIN "orden" o  ON o.mensajero_asignado_id = c.mensajero_id AND o.deleted_at IS NULL
  JOIN "order_status" s ON s.id = o.estatus_id AND s.value = 'sin_gestionar'
  JOIN "usuario" t ON t.id = o.tienda_id
  JOIN "zona"    z ON z.id = o.zona_id
  LEFT JOIN LATERAL (
      SELECT he.estatus_origen_id
        FROM "orden_historial_estado" he
       WHERE he.orden_id = o.id
         AND he.estatus_destino_id = o.estatus_id      -- sin_gestionar
         AND he.origen_tipo = 'corte_sin_gestionar'
       ORDER BY he.created_at DESC
       LIMIT 1
  ) h ON TRUE
 WHERE c.estado IN ('solicitado','vencido','rechazado');
```

   `LEFT JOIN` y no `JOIN`: si el historial no tuviera la fila, la orden entra igual con
   `estatus_origen_id NULL` (R33). Un `JOIN` la perdería en silencio, que es peor.

7. **Los que no se pueden reconstruir quedan MARCADOS (R26/R29)**:

```sql
UPDATE "cierre_dia" SET "sin_gestion_registrado" = false
 WHERE "estado" NOT IN ('solicitado','vencido','rechazado');
```

Es **exacto** para los cierres abiertos y no por casualidad: `CorteDiarioRepository` excluye
del corte a todo mensajero con un cierre abierto, y `solicitarCierre` **transiciona** el
vencido/rechazado en vez de crear otro. Por tanto un mensajero tiene **a lo sumo un cierre
abierto**, y todas sus órdenes en `sin_gestionar` son de ese cierre. Para los `aprobado` no
hay nada que recuperar (la liberación ya borró el vínculo) y **no se inventa** (R26).

DOWN: `DROP TABLE "cierre_sin_gestion";` (índices y FK caen con ella) **y**
`ALTER TABLE "cierre_dia" DROP COLUMN "sin_gestion_registrado";`. No hay dato previo que
restaurar: la tabla y la columna nacen en esta migración (R24).

### 2.3 Escritura (misma transacción)

En `CierreDiaRepository.crearCierre`, dentro del bucle por estatus de origen ya existente
(`:567-605`), **después** del `updateMany` y con la **misma guarda**:

- El pre-`SELECT` (`pendientes`) pasa a proyectar también los descriptivos
  (`numGuia`, `numRemision`, `destinatario`, `producto`, `tienda.nombre`, `zona.nombre`).
- Si `movidas.count > 0`, un `createMany` con las filas **de esa vuelta** y
  `estatusOrigenId = origenEstatusId` (R4: el origen de SU bloque, nunca uno supuesto — es
  literalmente la razón por la que el bucle tiene dos vueltas, ver el comentario de la 235).
- `skipDuplicates: true`: el `@@unique` es la red por si una segunda corrida del corte
  entrara por el mismo cierre.

**Congruencia con lo que de verdad se escribió:** las filas se crean a partir de `ids` +
`movidas.count`, exactamente como el `appendCambioEstado` de al lado. Si el `updateMany` no
movió nada, no hay filas: R3 se cumple por la transacción y R6 porque `crearCierre` sin
`corteSinGestionar` (flujo 37) ni entra al bloque.

---

## 3. Decisión D2 — sección aparte, NO una sexta pestaña (§ pedido (b))

`TAB_TONO`, `RESULTADO_LABEL`, `RESULTADO_VACIO` y `ORDEN_RESULTADOS` son
`Record<CierreResultado, …>`, y `CierreResultado = GestionResultado`, el enum de Postgres.
Meter `sin_gestionar` como sexta clave obligaría a **ensanchar el tipo del resultado de una
gestión con un valor que ese enum no tiene**, y esa mentira se propagaría a todo lo que hoy
consume `CierreGrupos`: el archivo de descargas, los retornables de la 238, los incidentes de
la 158, las guardias de contraste. Una orden sin gestionar **no es un resultado: es la
ausencia de uno**.

Estructura de la hoja (`CierreFacturaDetalle`):

```
… KPIs y renglones de dinero (SIN TOCAR) …
<section aria-label="Órdenes del cierre">      ← tablist de 5, intacto (R14)
<section aria-label="Órdenes sin gestionar">   ← NUEVA, hermana, después
… pie «Total recaudado … N entregas» (SIN TOCAR) …
```

Va **después** de las pestañas y **antes** del pie, con encabezado propio, conteo (R16) y una
nota fija (R17):

- Título: `Órdenes sin gestionar` + píldora con el conteo, tono `warning` (es una anomalía
  operativa, no una salida rutinaria; el mismo criterio con el que la 158 puso `incidente`
  en `warning`).
- Nota: «El corte del día las cerró sin gestión. No tienen dinero asociado.»

### 3.1 [Q3] Los TRES estados de la sección, y por qué son tres y no dos

| Estado del cierre | Qué se pinta |
| --- | --- |
| Registrado, con ≥1 orden | La sección con su lista y su conteo (R13/R16) |
| Registrado, con 0 órdenes | **Nada** (R15). Es la lectura correcta: no hubo ninguna |
| **No registrado** (`sin_gestion_registrado = false`) | La sección **con un aviso y sin lista**: «Este cierre es anterior al registro de órdenes sin gestionar: no se conserva la lista.» (R28) |

La tercera fila es la razón de existir de la marca. Sin ella, un cierre viejo se pintaría
como la segunda —sin sección— y diría **«no hubo ninguna»**, que es tranquilizador y falso.
Distinguir «ninguna» de «no lo sabemos» cuesta una columna booleana; confundirlas cuesta que
alguien cierre una auditoría con una pantalla que no comprobó nada.

### 3.2 [Q1] Las DOS superficies, porque el componente es UNO

`CierreFacturaDetalle` lo renderizan hoy **dos** módulos:
`CierresAdminModule.tsx:1116` (admin) y `CierreDiaModule.tsx:857` (el propio mensajero, con
`audiencia="mensajero"`). Siendo el mismo componente, **la sección aparece en los dos** (R30):
que pintara en uno y callara en otro es exactamente el arreglo a medias que se corrigió en la
263.

Consecuencia: el camino del mensajero también tiene que traer los datos —ver §6—. La sección
**no** es plata de la empresa, así que no cae por la regla de audiencia del design §7.2 de la
38/40: son **sus** órdenes, las que le bloquean el cierre.

`CierresBodegaAdminModule` **no** usa este componente (tiene su propio detalle consolidado):
queda fuera y declarado en `requirements.md > Límites declarados`.

### 3.3 [Q5] Solo lectura

Ni botones, ni enlaces, ni fila desplegable (R31), mismo criterio que la 260. No hay segundo
nivel que desplegar —ni desglose de ingreso, ni evidencia, ni pagos— así que la fila es un
`<div>` de rejilla y no un `<button aria-expanded>`.

`break-inside-avoid` en cada fila y en el bloque de encabezado, como las cinco piezas de la
223. La guardia `factura-contraste.guardia.test.ts` mantiene un inventario **cerrado** de
pares (tinta, fondo) de la hoja: cualquier utilidad de color nueva de esta sección **hay que
darla de alta ahí o la guardia se pone roja** — está previsto en `tasks.md` (F4), no es una
sorpresa.

## 4. Decisión D3 — columnas (§ pedido (c))

| Columna | Por qué |
| --- | --- |
| Guía | Es por lo que el admin la busca; `—` si es `null` (la orden puede no tener guía) |
| Destinatario (+ remisión · producto debajo) | Mismo patrón visual que `FilaGestion`, sin inventar layout |
| Tienda | De quién es el paquete que se quedó sin mover |

Fuera, y no por olvido: **Cobrado / Recibido / Ingreso / Pago al mensajero / Método /
Evidencia / Motivo / Nueva fecha**. Ninguno existe para estas órdenes; una columna con `—` en
el 100 % de las filas sugiere «este dato falta» cuando lo cierto es «este dato no existe».

**[Q6] El estado del que salió SÍ se pinta**, junto al producto, traducido
(`en_reparto` → «En reparto», `ayuda_tienda` → «Ayuda de la tienda»): distingue al paquete que
se quedó en la mano del mensajero del que estaba esperando respuesta de la tienda, y eso
cambia lo que el admin hace con él. **Cuando no consta, la pieza se OMITE** (R32): nada de un
«—» permanente, que sería el silencio ambiguo de Q3 en pequeño. El `LATERAL` del backfill
(§2.2) existe justamente para que ese caso sea raro y no el normal.

`zona_nombre` se congela y **no se pinta** hoy: es contexto de auditoría, y la sección ya
tiene tres columnas. Está en el DTO para no tener que migrar otra vez si se pide.

**[Q7] Sin recorte (R34).** Se listan **todas**. No hay tope, así que no hay número oculto que
declarar. Si algún día se añade uno, la regla ya está escrita: la sección tiene que decir
cuántas no se muestran —una lista truncada en silencio se lee como una lista completa—, y el
sitio natural es junto al conteo del encabezado.

## 5. Decisión D4 — los totales del pie NO cambian (§ pedido (d))

**No cuentan en ningún total.** El pie sigue diciendo `Total recaudado <totales.general> ·
<grupos.entregada.length> entregas`, y el KPI de conteo sigue sumando sobre
`ORDEN_RESULTADOS`. Razón: los dos son **lecturas de dinero y de entregas**; una orden sin
gestionar no recaudó ni se entregó.

**[Q4] Pero el rótulo del KPI cambia: `Órdenes` → `Gestiones` (R21).** Hoy ese KPI cuenta
gestiones y se llama «Órdenes»; con doce filas de órdenes sin gestionar debajo diría «3» y
sería un error de lectura garantizado —dos números que se desmienten en la misma pantalla—.
Se elige **renombrar** en vez de hacerle contar las dos cosas porque el número que ya cuenta
es correcto y es el que usan las comprobaciones existentes; lo que estaba mal era el nombre.
`FACTURA_ORDENES_KPI_LABEL` pasa a valer `"Gestiones"`, y los tests/E2E que lo localizan por
texto se actualizan con él (`tasks.md` F6).

El único número nuevo es el conteo **dentro** de la sección (R16).

**La garantía es estructural, no de disciplina:** el DTO nuevo (`§6`) no tiene ni un campo
`string` de monto, y la tabla no tiene ni una columna `DECIMAL`. Aun así R19/R20/R22 se
**afirman con tests que se matan por mutación** (`tasks.md`, bloque M): la ficha lo pide
explícitamente y este repo ya midió cuatro veces que una guardia de dinero puede estar verde
sin comprobar nada.

## 6. Contratos I/O

**Sin endpoint nuevo.** El detalle ya viaja por la Server Action `verCierreDetalle`
(`lib/actions/cierres-admin.ts:285`). El cambio es **aditivo** sobre su resultado.

```ts
// lib/interfaces/services/ICierresAdminService.ts
/**
 * Una orden que el corte diario barrió a `sin_gestionar` al crear este cierre.
 * NO es un resultado de gestión: no tiene gestión, y por eso no tiene NI UN campo de
 * dinero. Si algún día aparece uno aquí, es un bug de diseño, no una mejora.
 */
export interface CierreOrdenSinGestion {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  producto: string;
  tiendaNombre: string;
  zonaNombre: string;
  /** `en_reparto` | `ayuda_tienda`; `null` solo si no consta (R4/R32/R33). */
  estatusOrigen: OrderStatusValue | null;
}

export type CierreDetalleAdminServiceResult =
  | {
      status: "ok";
      cierre: CierreAdminResumen;
      grupos: CierreGrupos;
      totalesIngreso: TotalesIngresoOrdenex;
      desgloseIngresoBodegaRechazos: { sla: string; manual: string; total: string };
      ganancia: string;
      pagoTienda: string;
      /** R7: las barridas de ESTE cierre. `[]` SOLO significa «no hubo ninguna». */
      ordenesSinGestion: CierreOrdenSinGestion[];
      /**
       * R27/R28 — `false` = este cierre es ANTERIOR al registro y su lista es
       * irrecuperable. `[]` con `false` NO es «no hubo ninguna»: es «no lo sabemos», y la
       * pantalla tiene que decirlo. Los dos campos viajan juntos SIEMPRE, por eso no se
       * modela como `ordenesSinGestion: CierreOrdenSinGestion[] | null` (un `null` obliga a
       * cada consumidor a acordarse de distinguirlo, y ya sabemos cómo acaba eso).
       */
      sinGestionRegistrado: boolean;
    }
  | { status: "forbidden" }
  | { status: "no_encontrada" };
```

**[Q1] El MISMO par de campos se añade al camino del mensajero**, porque comparte componente
(§3.2): `VerCierrePasadoServiceResult` en
`lib/interfaces/services/ICierreDiaService.ts` gana `ordenesSinGestion` y
`sinGestionRegistrado`, poblados por `CierreDiaService.verCierrePasado` desde una consulta
gemela en `CierreDiaRepository` (el método de `:760`, que ya trae el cierre con el scope
`mensajero_id` **en el WHERE**; la lista cuelga de `cierre_id`, así que hereda ese scope y no
necesita guardia propia). Nada de dinero cruza por ahí, así que la regla de audiencia de la
38/40 (§7.2: «el mensajero no ve la plata de la empresa») no aplica: son sus órdenes.

**Repositorio.** `findCierreByIdEnAlcance` devuelve una clave más
(`sinGestion: CierreSinGestionRow[]`), poblada por una **tercera consulta dentro del mismo
`Promise.all`**:

```ts
this.prisma.cierreSinGestion.findMany({
  where: { cierreId },                                   // R7: el WHERE, no un filtro en memoria
  orderBy: [{ numGuia: "asc" }, { numRemision: "asc" }], // R12: determinista y con `null` estable
  select: SIN_GESTION_SELECT,                            // sin `createdAt`: no se pinta (§2.1)
});
```

El alcance (R8) **no se repite**: la guardia ya está en el `findFirst` de arriba, que devuelve
`null` y corta antes de llegar a las consultas de detalle. Es el mismo camino por el que hoy
se protegen las gestiones.

**Props del componente:**

```ts
ordenesSinGestion?: CierreOrdenSinGestion[];
/** R28: `false` ⇒ la sección pinta el AVISO en vez de la lista. Default `true`. */
sinGestionRegistrado?: boolean;
```

Ambas **opcionales por retrocompatibilidad de los dobles de test**, pero **las dos superficies
las pasan** (R30): no hay ningún renderizador de `CierreFacturaDetalle` que las omita. Una
guardia lo vigila (`tasks.md` F5), porque «opcional en el tipo» es justo como se cuela un
arreglo a medias.

## 7. Alternativas descartadas

### A1 — Leer vivo: `orden WHERE mensajero_asignado_id = cierre.mensajero_id AND estatus = sin_gestionar`

Es la opción **sin migración, sin backfill y sin gate completo**, y funcionaría hoy mismo
para el caso que duele (el cierre `vencido`, que está abierto).

**Descartada porque miente en cuanto el cierre se aprueba.** La aprobación borra
`mensajero_asignado_id` y cambia el estatus (`CierresAdminRepository:1389-1398`): un cierre
`aprobado` mostraría **cero** órdenes, y lo mostraría **exactamente igual** que un cierre que
de verdad no barrió ninguna. Peor: si el mensajero acumula un cierre nuevo con barridas
nuevas, abrir el cierre **viejo** le atribuiría órdenes que no son suyas. Y el cierre
aprobado es justo el que se audita, porque es el que ya movió dinero.

Es además el error que la feature 69 ya pagó una vez en esta misma pantalla (leer datos
**vivos** en el detalle de un cierre **congelado**). Repetirlo a sabiendas no es un atajo, es
deuda con fecha conocida.

### A2 — Reutilizar `cierre_detail` con una bandera `sin_gestion boolean`

Ahorra la tabla y ya congela los descriptivos.

**Descartada porque `cierre_detail` es la tabla de dinero del cierre.** Es de donde
`WalletFeedService`, `WalletTiendaFeedService` y `derivarIngresoOrden` sacan `monto_cobrar`,
`cobra_comision`, `es_central` y la tarifa congelada dentro de la transacción de aprobación.
Meter ahí filas de órdenes que no tienen tarifa ni monto obliga a que **cada uno de esos
consumidores** recuerde filtrar la bandera; el día que uno no lo haga, el fallo no es una
lista mal pintada: es dinero mal liquidado. Además `findCierreByIdEnAlcance` lanza
`CierreDetalleFaltanteError` cuando una gestión no encuentra su fila, y ahora habría filas sin
gestión: dos formas de emparejar en la misma tabla. **La tabla separada hace imposible el
fallo en vez de vigilarlo.**

### A3 — Sexta pestaña junto a las cinco de `CierreResultado`

Descartada por el §3: exigiría ensanchar `CierreResultado`, que es el enum
`gestion_resultado` de Postgres, y afirmaría que «sin gestionar» es un resultado de gestión.
Lo contamina todo aguas abajo (descargas, retornables 238, incidentes 158).

### A4 — Reconstruir la lista desde `orden_historial_estado` (`origen_tipo = corte_sin_gestionar`)

Tentadora para el backfill de los cierres ya aprobados: el choke point sí dejó rastro de cada
transición.

**Descartada porque el `join` sería por TIEMPO.** El historial guarda orden, origen, destino y
`created_at`, pero **no el cierre**; emparejarlo con el `cierre_dia` de esa corrida exige
una ventana temporal y la suposición de que no hubo dos corridas cerca. Un vínculo de
auditoría no se deduce con una heurística de minutos. Se prefiere no tener el dato a tenerlo
inventado (R26, CLAUDE.md regla 6).

**Matiz importante, y es lo que sí se usa:** el historial **por orden** sin ventana temporal
es fiable, y por eso §2.2 lo emplea para recuperar el `estatus_origen_id` de las filas del
backfill (R33). Lo descartado es reconstruir **a qué cierre** pertenecía una orden ya
liberada; para eso no hay dato y por eso existe la marca por cierre (R27/R28) en vez de una
lista inventada.

## 8. Verificación — dónde se prueba cada cosa, y qué NO prueba nada

Detalle ejecutable en `tasks.md`. Aquí, las tres reglas del diseño:

1. **Lo que llega a la pantalla se prueba contra Postgres.** Un test de servicio con dobles
   **no ve el SQL**: el `where: { cierreId }` de la consulta nueva es exactamente la clase de
   cláusula que este repo ya midió cuatro veces sobreviviendo a una mutación en verde. El
   test real va con el molde ya existente
   `tests/integration/db/cierres-admin-retornables-sql-real.test.ts` +
   `tests/integration/db/_postgres-real.ts` (`HAY_BASE_DE_DATOS`, `crearPrismaDeTest`,
   `enTransaccionRevertida`, `fksDeOrden`, `serializarEscriturasReales`).
   **Sin base alcanzable se SALTA (`describe.skip`), no pasa en verde**; con base y sin
   catálogo, **falla ruidosamente**.
2. **Toda cláusula se mata con una mutación.** Bloque M de `tasks.md`: cada mutación tiene
   nombre, archivo, línea y el test que **tiene que ponerse rojo**. Se pega la salida ROJA en
   `progress/impl_264.md`. Un arnés de mutaciones que reporta supervivientes sin haber
   ejecutado un test ya pasó en este repo: la evidencia es la salida, no el resumen.
3. **Lo que sólo puede dar verde, se declara.** Aviso explícito, porque en esta sesión ya
   aparecieron cuatro guardias incapaces de ponerse rojas:

   > ⚠️ **«Con la lista vacía los totales no cambian» es una aserción VERDE POR
   > CONSTRUCCIÓN.** Es el estado de hoy: si el implementer escribe ese test y lo da por
   > cobertura de R19/R20, la protección del dinero es **cero**. La versión que sí vale es la
   > del bloque M: el detalle se pinta **con una lista NO vacía** y los montos se comparan
   > contra sus **literales esperados**; luego se muta el componente para que sume esas
   > órdenes (a `ordenes`, a `grupos.entregada` o al pie) y el test **debe** ponerse rojo.
   > Si no se pone rojo, el test no protege nada y hay que reescribirlo antes de seguir.

   Segundo aviso, del mismo tipo: comparar un texto de la sección contra la propia constante
   que lo genera es una aserción contra su propia fuente y siempre está verde. Los rótulos se
   comprueban por **texto visible literal** en el test de componente.

4. **E2E:** `e2e/cierre-vencido-modelo.spec.ts` y `e2e/cierres-admin.spec.ts` existen pero
   **la suite del gate no los ejecuta** (no hay harness en `./init.sh`). Ampliarlos es
   opcional y **no cuenta como evidencia** para el mapa `R<n> → test`.

## 9. El gate de esta feature es el COMPLETO, y no es opcional

`./init.sh --rapido` **se niega solo** ante este diff y manda al completo, por tres razones a
la vez (`docs/verification.md`): toca `db/migrations/**`, toca `db/schema.prisma` y todos los
archivos tocados llevan `cierre` en el nombre, que está en la lista de nombres de dinero. No
hay que acordarse: es un `fail`. Planificar el tiempo con eso en mente.

## 10. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El `createMany` nuevo dentro de la tx del corte alarga la transacción del cron | Una sentencia por vuelta, con las filas ya en memoria del pre-`SELECT`; sin consultas extra |
| Backfill pesado en producción | Un solo `INSERT … SELECT` acotado a cierres abiertos (pocos por definición: uno por mensajero como máximo) |
| La guardia de contraste se pone roja por el color nuevo de la sección | Task F4: dar de alta el par (tinta, fondo) en el inventario cerrado |
| Un cierre con muchas órdenes barridas alarga la hoja | Se aceptan todas sin recorte (R34): una lista larga es un problema de lectura; una lista truncada en silencio es un dato falso |
| La marca por cierre se queda pegada a `true` para cierres futuros que no barran nada | Es lo correcto: «registrado y ninguna» ≠ «no registrado». El default `true` describe el hecho de que el registro ya existía cuando ese cierre nació |
