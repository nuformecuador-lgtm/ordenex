# Ficha 451 — Diseño

> **Arreglo mínimo, no modelo nuevo.** Los datos ya están persistidos (`cierre_sin_gestion`, feature
> 264, con `num_guia` congelado). La maquinaria de confirmación ya existe (238). Lo que falta es
> **conectar el segundo origen** al conjunto esperado y a la guardia del servidor, sin partir en dos
> la regla de «qué vuelve a bodega».

---

## 1 · Qué hay hoy, verificado en el archivo real

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Punto único de «qué vuelve» | `lib/types/gestion-retorno.ts` | `RETORNA_A_BODEGA` es `Record<GestionResultado, boolean>` con `as const satisfies`; `RESULTADOS_QUE_VUELVEN` se **deriva** de él (líneas 48-50); `vuelveABodega(resultado)` lo consulta |
| Conjunto esperado (servidor) | `CierresAdminRepository.findGestionesRetornablesDelCierre` (994-1012) | `where: { cierreId, resultado: { in: [...RESULTADOS_QUE_VUELVEN] }, anuladaAt: null, cierre: alcanceWhere(alcance) }`; proyecta `orden.numGuia` **viva** |
| Guardia de cobertura | `CierresAdminService.validarConfirmacionFisica` (1186-1255) | R8-R13 de la 238; devuelve `fieldErrors` **por gestión** antes de abrir la tx |
| Escritura de la marca | `CierresAdminRepository.resolverCierre` (2186-2208) | `updateMany` guardado por `{ id in ids, cierreId, resultado in RESULTADOS_QUE_VUELVEN }`, `data: { confirmadaFisicaAt: new Date() }`, fallo cerrado si `count !== ids.length` |
| Ventana de confirmación | `cierre-confirmacion-fisica.tsx` | `retornablesDelCierre(grupos)` (156-158) sale de **gestiones**; `agruparRetornables` (323-330) deriva las secciones de `RESULTADOS_QUE_VUELVEN` |
| Las barridas | `db/schema.prisma:2457` `model CierreSinGestion` | grano `@@unique([cierreId, ordenId])`; descriptivos congelados; `numGuia Int?` **sin `@unique`: es copia, no identidad** |
| Las barridas, en el contrato | `CierreOrdenSinGestion` (`ICierreDiaService.ts:315-325`) | `ordenId`, `numGuia`, `numRemision`, `destinatario`, `producto`, `tiendaNombre`, `zonaNombre`, `estatusOrigen`. **Ya viaja al detalle del admin** (`ordenesSinGestion`, `CierresAdminService.ts:889`) y ya está en el estado del módulo (`CierresAdminModule.tsx:670`) |
| La liberación al aprobar | `resolverCierre`, bloque `liberacionSinGestionar` (1892-2000+) | lee `cierre_sin_gestion` para acotar a ESTE cierre (271/R35) y parte el destino en dos: por debajo del umbral → bodega; en el tope → `rechazada` (276) |
| Sólo los vencidos barren | `ICierreDiaRepository.ts:223-225` | `corteSinGestionar` «presente SOLO en el corte diario… Ausente en `solicitarCierre` (37)» |

**Consecuencia que es el corazón del defecto:** la liberación de arriba corre **dentro de la misma
transacción de aprobación** y sin haber pedido ninguna prueba. El sistema ya las da por recibidas.

**Los dos conjuntos son disjuntos por construcción, y está medido.** Una orden barrida no puede tener
gestión vigente en el cierre que la barrió (para ser barrida tuvo que estar en `en_reparto` /
`ayuda_tienda`, o sea sin desenlace registrado). Lo afirma el comentario de `resolverCierre`
(1969-1974) y lo **mide contra Postgres** el caso 3 de
`tests/integration/db/cierre-sin-gestion-tope-sql-real.test.ts`. De ahí se sigue que **ninguna guía
puede casar a la vez una gestión y una barrida del mismo cierre** —`orden.numGuia` es `@unique`—, que
es lo que permite fundir las dos listas en una sin ambigüedad de lectura.

---

## 2 · El punto único, extendido a DOS orígenes (la decisión estructural)

El problema: una barrida **no es** un `GestionResultado`, así que no cabe dentro de
`Record<GestionResultado, boolean>`. Y la red de exhaustividad de ese `Record` es buena: no se rompe
para que quepa lo nuevo.

**Decisión: se añade un SEGUNDO eje, exhaustivo igual que el primero, en el MISMO módulo.** El
módulo sigue siendo puro (sólo el `type` del enum de Prisma, que se borra en compilación) y se sigue
pudiendo importar desde un Client Component.

```ts
// lib/types/gestion-retorno.ts  — se AÑADE; nada de lo existente se toca

/** Ficha 451 — de dónde sale una fila que el cierre pone delante de bodega. */
export type OrigenDelPaquete = "gestion" | "barrida";

/**
 * Ficha 451 — QUÉ VUELVE, POR ORIGEN. Hermano de `RETORNA_A_BODEGA` y con su misma red:
 * `satisfies Record<OrigenDelPaquete, ...>` es exhaustivo A PROPÓSITO. Un tercer origen NO COMPILA
 * hasta que alguien decida si su paquete vuelve.
 *
 * `gestion: "segun_resultado"` NO duplica la regla: delega en `RETORNA_A_BODEGA`, que sigue siendo
 * el único sitio donde se decide resultado por resultado. `"nunca"` existe declarado aunque hoy no
 * lo use nadie: es el hueco donde un origen futuro que NO vuelva se escribe con su razón, en vez de
 * caer en un `undefined` falsy — el mismo argumento con el que la 238 eligió `Record` sobre lista.
 */
export const RETORNO_POR_ORIGEN = {
  // depende del resultado; lo decide RETORNA_A_BODEGA, no esta tabla
  gestion: "segun_resultado",
  // SIEMPRE. La orden estaba `en_reparto`/`ayuda_tienda` cuando venció el cierre: el bulto está
  // físicamente en manos del mensajero y vuelve, vaya luego a bodega (109) o a `rechazada` (276).
  // Decisión humana firmada el 2026-09-21 (ficha 451).
  barrida: "siempre",
} as const satisfies Record<OrigenDelPaquete, "siempre" | "nunca" | "segun_resultado">;

/** Una fila del cierre, identificada por su ORIGEN. Union discriminada: no hay tercer estado. */
export type PaqueteDelCierre =
  | { readonly origen: "gestion"; readonly resultado: GestionResultado }
  | { readonly origen: "barrida" };

/** ¿Este paquete vuelve a bodega? LOS DOS orígenes, una sola función. */
export function vuelveABodegaElPaquete(p: PaqueteDelCierre): boolean {
  switch (p.origen) {
    case "gestion":
      return vuelveABodega(p.resultado); // RETORNO_POR_ORIGEN.gestion === "segun_resultado"
    case "barrida":
      return RETORNO_POR_ORIGEN.barrida === "siempre";
  }
}
```

**Las tres propiedades que esto conserva, y por qué importan:**

1. **R2** — `RETORNA_A_BODEGA` y su `as const satisfies Record<GestionResultado, boolean>` quedan
   **intactos, byte a byte**. Un sexto resultado del enum sigue sin compilar. La guardia
   `confirmacion-incidentes-excluidos.guardia.test.ts` que lo atornilla (caso «R5: el punto único
   conserva la red de compilación») **no se toca y sigue verde**.
2. **R3** — el eje nuevo trae su propia red. Un tercer origen (p. ej. los rechazos de tienda de la
   425, hoy fuera de alcance por decisión) no compila hasta que alguien escriba su línea con su
   razón.
3. **R4** — no hay segunda lista. La rama `gestion` **delega**; no reescribe los tres valores. La
   guardia de censo sigue siendo válida sin cambios: su detector busca literales con los tres
   resultados, y aquí no aparece ninguno.

**Lo que SÍ hay que añadir a la guardia** (`confirmacion-incidentes-excluidos.guardia.test.ts`, dos
casos nuevos): que el punto único conserva **también** la red del eje nuevo
(`satisfies Record<OrigenDelPaquete,`) y que ningún archivo de producción fuera del registro declara
su propia regla de origen. Detector: un literal que contenga `"barrida"` junto a `vuelve`/`retorna`
fuera de `PUNTO_UNICO`. Con su autocomprobación, como el resto del archivo.

---

## 3 · Modelo de datos — UNA columna, sin tabla nueva

```prisma
model CierreSinGestion {
  // ... todo lo existente, intacto ...

  // FICHA 451 (R20/R23/R24) — el instante en que bodega declaró tener ESTE paquete delante al
  // aprobar el cierre. MISMO nombre que `gestion_orden.confirmada_fisica_at` (238) a propósito:
  // es el MISMO hecho sobre el otro origen, y reusar el nombre hace que la guardia
  // `confirmacion-sin-lectores.guardia.test.ts` lo cubra sin tocar su registro.
  //
  // NO CONTRADICE la inmutabilidad declarada arriba: lo inmutable son los DESCRIPTIVOS CONGELADOS
  // —la foto de la orden al barrerla—, y ésos no se tocan (R22). Esto es un hecho NUEVO sobre la
  // fila, escrito UNA vez, dentro de la transacción que aprueba. Sigue sin haber `updated_at` ni
  // `deleted_at`: la fila no se edita ni se borra.
  confirmadaFisicaAt DateTime? @map("confirmada_fisica_at")
}
```

**Migración** `db/migrations/<ts>_cierre_sin_gestion_confirmacion_fisica/`:

- `migration.sql`: `ALTER TABLE "cierre_sin_gestion" ADD COLUMN "confirmada_fisica_at" TIMESTAMP(3);`
  Aditiva: no renombra, no reordena, no borra, no toca filas, no toca índices, no toca RLS. Patrón
  exacto de `20260819170000_gestion_orden_confirmacion_fisica`.
- `down.sql`: `ALTER TABLE "cierre_sin_gestion" DROP COLUMN IF EXISTS "confirmada_fisica_at";`
  **R40 se cumple** por el mismo argumento que la 238: la columna **nace sin lectores** (no se
  proyecta en ningún `select`, no viaja a ningún DTO), así que la base revertida es exactamente la
  que el código anterior espera. Pérdida de dato declarada: las marcas de la ventana revertida.
  `IF EXISTS` para que el rollback sea idempotente.

**Nullable, sin default, sin CHECK, sin índice**, por las mismas razones que la 238: `NULL` significa
las dos cosas correctas («aprobado antes de esta ficha» y «todavía sin confirmar»), la obligatoriedad
vive en el servicio, y no hay ninguna consulta declarada que filtre por ella.

**RLS:** ninguna superficie nueva. `cierre_sin_gestion` ya existe con su RLS; se le añade una columna.
No hay tabla nueva que aislar ni policy nueva que escribir.

**No hay backfill.** Los 14 cierres ya aprobados se quedan con `NULL` — que es exactamente lo que
R23 pide poder distinguir. Inventar una confirmación que nunca ocurrió sería mentir en el sitio donde
esta ficha viene a dejar de mentir.

---

## 4 · La clave de una fila: `ordenId`, y por qué no hace falta nada más

`fieldErrors` es `Record<string, string[]>` y hoy se indexa por `gestionId`. Para las barridas se usa
**`ordenId`**, y no hay que añadir ningún campo:

- El grano de `cierre_sin_gestion` es `@@unique([cierreId, ordenId])`, así que **dentro de un cierre
  el `ordenId` identifica la fila sin ambigüedad**.
- `CierreOrdenSinGestion` **ya lo lleva** (`ICierreDiaService.ts:316`) y ya llega a la pantalla.
- Los dos espacios de claves son uuid y los conjuntos son disjuntos (§1), así que un `ordenId` nunca
  colisiona con un `gestionId` en el mismo `fieldErrors`.

No se expone el `id` de la fila de `cierre_sin_gestion`: no aporta nada que `(cierreId, ordenId)` no
dé, y añadirlo al DTO sería superficie nueva por gusto.

---

## 5 · Contratos I/O

### 5.1 · Borde (zod) — `lib/types/cierres-admin.ts`

`confirmacionFisicaSchema` pasa a ser una **union discriminada por `origen`**. La forma vive en el
borde; la **cobertura** sigue viviendo en el servicio (el borde no sabe qué tiene ese cierre).

```ts
export const confirmacionFisicaSchema = z.discriminatedUnion("origen", [
  z.object({
    origen: z.literal("gestion"),
    gestionId: z.string().uuid(),
    numGuia: z.number().int().positive(),
  }),
  z.object({
    origen: z.literal("barrida"),
    ordenId: z.string().uuid(),
    numGuia: z.number().int().positive(),
  }),
]);
```

**Retrocompatibilidad:** el `.default([])` de `aprobarCierre` se conserva y sigue sin abrir agujero
(R17/R18). El discriminante es **obligatorio**: una entrada sin `origen` es un error de forma, no un
`gestion` implícito. Un default aquí sería exactamente la clase de silencio que esta ficha cierra.

### 5.2 · Servicio — `ICierresAdminService` / `CierresAdminService`

`aprobarCierre` **conserva sus cuatro parámetros**; sólo cambia el tipo del elemento del cuarto
(`ConfirmacionFisicaInput` pasa a ser la union). No se añade un quinto parámetro: una lista paralela
partiría la cobertura en dos bucles, dos conjuntos de `fieldErrors` y dos números de «faltan», que es
justo la divergencia que la ficha existe para evitar.

`validarConfirmacionFisica` (privado) pasa a:

1. leer **las dos** fuentes — `findGestionesRetornablesDelCierre` (intacta) y la nueva
   `findBarridasDelCierre(cierreId, alcance)`;
2. montar **un solo** `Map<clave, FilaEsperada>` con `clave = gestionId | ordenId`;
3. recorrer las entradas recibidas con el **mismo** bucle de hoy (duplicada → `MSG_..._DUPLICADA`; no
   esperada → `MSG_..._AJENA` o `MSG_..._INCIDENTE`; sin guía → `MSG_..._SIN_GUIA`; guía distinta →
   `MSG_..._GUIA_DISTINTA`);
4. cerrar con el **mismo** barrido de faltantes sobre todo el conjunto (R12).

**El atajo de R18 se conserva y se amplía:** `if (esperadasGestiones.length === 0 && barridas.length === 0 && confirmacionFisica.length === 0) return null;`
Un cierre sin nada que devolver se aprueba con el mismo payload de siempre y sin una consulta de más.
**La lectura de barridas es perezosa**: sólo se paga si hay algo que validar.

Los seis mensajes de `CierresAdminService` se reusan **tal cual**. Sólo uno es nuevo y es opcional:
si se quiere distinguir «esta orden no la barrió este cierre» de «esta gestión no vuelve», basta el
`MSG_CONFIRMACION_AJENA` existente, que ya dice lo correcto.

### 5.3 · Repositorio — lectura

`findBarridasDelCierre(cierreId, alcance): Promise<BarridaDelCierre[]>`, molde literal de
`findGestionesRetornablesDelCierre`:

```ts
where: { cierreId, cierre: alcanceWhere(alcance) },
select: { ordenId: true, numGuia: true },
```

**El alcance va en el `WHERE`, por la relación al cierre (R8)**: nunca se filtra en memoria, y un
cierre fuera de alcance devuelve `[]` sin distinguirse de uno inexistente. Sin `anuladaAt` (la tabla
no tiene bajas) y **sin mirar `sin_gestion_registrado`**: R7 sale gratis porque un cierre sin filas
devuelve `[]`. Un `if` sobre esa bandera sería un camino que no hace falta y que podría, mal escrito,
saltarse el bloqueo.

### 5.4 · Repositorio — escritura

`ResolverCierreInput` (rama `aprobado`) conserva `confirmacionFisica: ReadonlyArray<ConfirmacionFisicaGestion>`
y gana **`confirmacionBarridas: ReadonlyArray<{ ordenId: string }>`**, igual de **obligatorio** (puede
ser `[]`, pero tiene que estar) y con `?: never` en la rama `rechazado` (R27). Es el mismo criterio
que la 238 y la 239 declararon: **un olvido de cableado tiene que romper el typecheck**, no dejar la
marca sin escribir.

```ts
// PEGADO al updateMany de la 238, dentro del MISMO bloque
if (confirmacionBarridas.length > 0) {
  const ordenIds = confirmacionBarridas.map((c) => c.ordenId);
  const aplicado = await tx.cierreSinGestion.updateMany({
    where: { cierreId, ordenId: { in: ordenIds } }, // `cierreId` es GUARDIA, no filtro (R9)
    data: { confirmadaFisicaAt: new Date() },       // R22: una sola clave, money-neutral
  });
  if (aplicado.count !== ordenIds.length) throw new ConfirmacionFisicaNoAplicableError(cierreId);
}
```

**Dónde va, y por qué exactamente ahí (R39).** Inmediatamente **después** del `updateMany` de la 238 y
**dentro de su mismo bloque comentado**, es decir entre la devolución de las `rechazada` (139) y el
anclaje (239). Tres razones: (a) es money-neutral y **todos** los feeds de dinero quedan por delante;
(b) `tests/unit/repositories/cierres-admin-caja-cod.test.ts` **mide el orden de las llamadas** dentro
de la transacción, y pegarlo a su hermana inserta **una** llamada en un punto ya neutral; (c) se lee
en el orden operativo. **Un rojo en esa suite significa que el bloque aterrizó mal: es regresión, no
una aserción que actualizar.**

**R25 (idempotencia) sale por construcción, sin una línea de código de idempotencia:** el bloque vive
dentro del `res.count === 1 && aprobado`, y el `updateMany` del cierre está guardado por
`estado IN ["solicitado"]`. Un cierre ya aprobado devuelve `count = 0` y la rama entera no se ejecuta.
**No** se añade `confirmadaFisicaAt: null` al `WHERE`: haría que un reintento legítimo tras un
rollback lanzara por `count !== ordenIds.length`. Es el mismo razonamiento, palabra por palabra, que
la 238 dejó escrito para su hermana.

**R26 sale de la tx, no de una comprobación.** La liberación (109/276) ya corre dentro de esta misma
transacción y ya está acotada a las barridas de **este** cierre desde la 271. Como la cobertura
exacta se verificó antes de abrirla (R16), toda orden que la liberación mueva tiene su marca escrita
en la misma transacción. Se **mide** contra Postgres, no se razona: ver §11.

---

## 6 · La pantalla — dónde se pintan las filas nuevas, y por qué ahí

**Esta ficha no crea pantalla**, así que no pasa por `/design`. Cambia el cuerpo de la ventana que ya
existe (`cierre-confirmacion-fisica.tsx`).

### 6.1 · Dónde

**En la MISMA lista del conjunto esperado, como una CUARTA sección, rotulada «Sin gestionar (N)», al
final de las tres que ya hay** (Devoluciones / Rechazos / Reprogramadas), dentro del mismo contenedor
con desplazamiento acotado, con **la misma fila** (guía · remisión, destinatario · tienda, badge
`Pendiente`/`Confirmada`) y contando en el **mismo** contador.

### 6.2 · Por qué ahí, y no en los otros dos sitios plausibles

- **Mezcladas con las de gestión, sin distinguirlas: no.** Una barrida no tiene `resultado`, así que
  el badge `RESULTADO_FILA_LABEL[g.resultado]` no tendría qué imprimir y habría que inventarle uno.
  Peor: quien escanea perdería la única información que explica por qué ese paquete está ahí. En su
  lugar llevan un badge propio, **«Sin gestionar»**, que ocupa el mismo hueco que el del resultado.
- **En un panel aparte, o en un segundo paso: tampoco.** El único bloque separado que hoy tiene esta
  ventana es la caja de **incidentes excluidos** (`textoIncidentesExcluidos`, líneas 409-426), y dice
  literalmente «esto **no** se escanea». Poner las barridas en una caja hermana las leería como
  opcionales — que es exactamente el estado del que esta ficha viene a sacarlas. Y un segundo paso
  produciría **dos contadores y dos «faltan N»**, con el fallo obvio: terminar el primero y ver
  «Están todos. Ya se puede aprobar» con 13 barridas pendientes detrás.
- **Al final y no al principio:** el orden de las tres secciones existentes **se deriva** de
  `RESULTADOS_QUE_VUELVEN` (`agruparRetornables`, 326-329) para que añadir un resultado retornable al
  `Record` lo haga aparecer sin tocar el archivo. Esa derivación se conserva intacta y la sección
  nueva se **concatena** después; intercalarla obligaría a inventar un orden que hoy nadie escribe.

### 6.3 · Qué cambia por dentro

Las funciones puras del componente dejan de operar sobre `CierreDetalleGestion` y pasan a operar
sobre una **vista unificada**, que es lo que permite un solo contador y un solo intérprete de lectura:

```ts
export type FilaAConfirmar =
  | { origen: "gestion"; clave: string; numGuia: number | null; numRemision: string;
      destinatario: string; tiendaNombre: string; resultado: CierreResultado }
  | { origen: "barrida"; clave: string; numGuia: number | null; numRemision: string;
      destinatario: string; tiendaNombre: string };
```

- `filasAConfirmar(grupos, ordenesSinGestion)` — sustituye a `retornablesDelCierre`. Sale del **mismo
  detalle ya cargado**: `grupos` (238) y `detalle.ordenesSinGestion` (264, ya en el estado del módulo,
  `CierresAdminModule.tsx:670`). **Ni una consulta nueva en el cliente**, que es la propiedad que hace
  cierto que el conjunto que la ventana pide sea exactamente el que el servidor exige.
- `clavePaquete` — sin cambio de criterio: `guia:<numGuia>`, y `sin-guia:<origen>:<clave>` cuando no
  hay guía. La premisa sigue siendo `orden.numGuia` `@unique`, y sigue vigilada por el caso «PREMISA»
  de `tests/components/CierresAdminConfirmacionFisica.test.tsx`. **Nota:** `cierre_sin_gestion.num_guia`
  es una **copia** sin `@unique`; la unicidad la aporta la orden de la que se copió, y dos barridas
  del mismo cierre son dos órdenes distintas.
- `interpretarLectura` — recorre `todasLasFilas` (las cinco secciones de gestión **más** las
  barridas). R33 sale solo: una guía que no casa ninguna de las dos fuentes sigue dando «no pertenece
  a este cierre». R31 de la 238 (`lecturaNoVuelve`) sólo puede dispararlo una gestión, porque
  `RETORNO_POR_ORIGEN.barrida === "siempre"`.
- `progresoDePaquetes` / `textoFaltan` / `textoCompleta` — **sin tocar la lógica**: reciben la lista
  unificada y el número que dicen pasa a ser el número real. R31 se cumple por no haber escrito un
  segundo contador.
- `pedirAprobacion` (`CierresAdminModule.tsx:862`) — la condición de abrir la ventana pasa de
  `retornables.length > 0` a `filasAConfirmar.length > 0`. Sin esto, un cierre **sólo** con barridas
  se seguiría aprobando de un click contra un servidor que ahora lo rechaza: bloqueo mudo.
- `repartirErroresDelServidor` (836) — el conjunto de claves «de confirmación» pasa a ser
  `gestionIds ∪ ordenIds`. El bolsón de los montos no cambia.

---

## 7 · Lo que NO se toca

`retornablesDelCierre`, `agruparRetornables`, `gestionesDelCierre`, `RESULTADOS_QUE_VUELVEN`,
`RETORNA_A_BODEGA`, `vuelveABodega`, `findGestionesRetornablesDelCierre`, el `updateMany` de
`gestion_orden`, los cinco feeds de dinero, el anclaje de la 239, la liberación de la 109/276, el
barrido del corte diario, y el contrato `CierreOrdenSinGestion`. Las funciones del componente que
dejan de usarse tras unificar la vista **se borran en su tarea**, no se quedan muertas.

---

## 8 · `num_guia` puede ser NULL — el punto delicado

`cierre_sin_gestion.num_guia` es `Int?`. Hoy hay **0 de 185** en producción, pero si apareciera una,
ese cierre sería **imposible de aprobar** — y sin tratamiento, nadie sabría por qué.

**No se inventa nada: se reusa el precedente ya resuelto de la 238 (R13), que tiene dos mitades.**

1. **Servidor (R15):** la barrida **no se omite** del conjunto esperado —omitirla dejaría un paquete
   aprobado sin que nadie lo tuviera delante, que es el defecto que la ficha cierra— y se bloquea
   nombrando el motivo con el `MSG_CONFIRMACION_SIN_GUIA` que ya existe. El servidor es el que decide.
2. **Cliente (R34):** se avisa **antes de empezar a escanear**, no al final. La 238 lo hace con
   `FILA_SIN_GUIA` en la propia fila (494-498). Esta ficha **añade la misma advertencia en la barra de
   estado**, arriba y pegada, diciendo **cuántas** filas no se pueden confirmar y que ese cierre no se
   va a poder aprobar.

**Por qué el aviso de arriba cubre los DOS orígenes y eso no es rediseño.** Al unificar la lista en un
solo contador (§6), un aviso que contara sólo un origen sería precisamente la divergencia que la
unificación viene a impedir; y con la lista ahora más larga y desplazable, una advertencia que vive
sólo dentro de una fila puede no verse nunca. La advertencia por fila de la 238 **se conserva**: la
nueva la resume, no la sustituye.

**Cómo se llega a esa fila, dicho en voz alta:** el corte barrió una orden que llegó a reparto sin
guía. La copia congelada refleja ese hecho. La salida operativa **no** es aprobar a medias (R19): es
**rechazar el cierre** — y el texto de `textoFaltan` ya nombra esa salida.

---

## 9 · Alternativas descartadas

**A · Que `RETORNA_A_BODEGA` gane una clave `sin_gestionar`.** Es lo más corto de escribir y está mal:
el `Record` está tipado `satisfies Record<GestionResultado, boolean>`, y `sin_gestionar` **no es un
`GestionResultado`** — es un `OrderStatusValue`. Para que compilara habría que relajar el `satisfies`
a un `Record<string, boolean>` o meter el valor en el enum de Prisma. Lo primero **destruye la red de
exhaustividad** (un resultado nuevo volvería a caer en `undefined` → falsy → excluido del bloqueo en
silencio, que es el modo de fallo que el módulo entero existe para cerrar). Lo segundo es una
migración de enum que contaminaría `gestion_orden.resultado` con un valor que ninguna gestión puede
tener. **Descartada: paga el arreglo con la garantía que lo protege.**

**B · Una segunda lista `SIN_GESTION_VUELVE` / un flag suelto en el servicio.** Es el «segundo
literal» que la guardia `confirmacion-incidentes-excluidos` existe para impedir, aplicado al eje
nuevo: dos verdades que pueden divergir, y el día que divergen la pantalla pide confirmar un conjunto
distinto del que el servidor exige y el botón se queda bloqueado sin explicación posible. **Descartada
por el mismo argumento que la 238 ya escribió, que aquí sigue valiendo.**

**C · No persistir nada: sólo bloquear.** Tentadora —evita la migración y, con ella, la corrida
completa del gate—. Descartada porque deja **la mitad del defecto abierta**: un cierre aprobado
seguiría sin poder demostrar que alguien tuvo esos bultos delante, que es justo lo que no se puede
demostrar hoy de los 185 medidos. Y la asimetría con la 238 se leería, meses después, como «las
barridas no se confirman». El coste real es **una columna aditiva y nullable**; el beneficio es que el
rastro existe.

**D · Una tabla nueva de confirmaciones (una fila por paquete confirmado, con su origen).** Uniformaría
los dos orígenes bajo un mismo registro. Descartada por dos motivos: (a) **superficie nueva** —tabla,
RLS, policies, índices, guardias— para un dato que cabe en una columna de una tabla que ya existe y
ya está aislada; (b) es **rediseñar en vez de arreglar lo evidenciado**, y en este repo ya se
descartaron dos specs por ahí. La 238 evaluó y descartó esta misma alternativa (su §10-C) cuando el
problema era la mitad de grande.

**E · Renombrar el punto único a `lib/types/retorno-bodega.ts`.** El nombre `gestion-retorno` pasa a
quedarse corto cuando el módulo cubre dos orígenes. Descartada: toca el registro `PUNTO_UNICO` de una
guardia, el texto del spec de la 238, sus cinco importadores y `lib/types/**` (que ya fuerza el gate
completo), para **cero** cambio de comportamiento. Se paga con un comentario de cabecera que dice qué
cubre el módulo hoy. Si algún día entra un tercer origen, el rename se hace entonces y con motivo.

**F · Un quinto parámetro `confirmacionBarridas` en `aprobarCierre`.** Es el patrón que siguieron la
158 (tercer parámetro) y la 238 (cuarto), así que tiene precedente. Descartada aquí porque esas dos
añadían conjuntos **con reglas distintas** (montos de incidente vs. paquetes que vuelven), mientras
que esto es **el mismo conjunto** con otro origen: partirlo produce dos bucles de cobertura, dos
espacios de `fieldErrors` y dos números de «faltan», y la ficha existe justo para que haya **uno**.
Sí se parte en el **repositorio** (§5.4), donde son dos tablas y dos `updateMany` — ahí la separación
la impone Postgres, no el diseño.

---

## 10 · Riesgos y límites, declarados

| Riesgo | Mitigación / decisión |
| --- | --- |
| El bloqueo crece de golpe: en los 14 cierres medidos el conjunto esperado pasa de 50 a 235 filas | Medir T0.1 (cierres `vencido` sin resolver y sus barridas) y **avisar a bodega antes**. Q4 de `requirements.md`: la decisión sobre la cola es del humano |
| Un cierre con una barrida sin guía queda inaprobable | Hoy 0 de 185. R15 + R34 lo convierten en un bloqueo **con nombre** en vez de mudo. Sin salida de emergencia, por decisión firmada |
| Más cierres inaprobables ⇒ más devoluciones congeladas en `devolucion_por_confirmar` (239) | Declarado en `requirements.md`. La consulta de población atascada de `specs/239/design.md` §12 pasa a vigilar también esta ficha |
| Tocar `db/schema.prisma` y `lib/types/**` | `./init.sh --rapido` **se niega solo** (docs/verification.md). El gate de esta ficha es el **completo**, y no es opcional |
| La columna nueva podría ganar lectores y convertirse en un reloj | Reusar el nombre `confirmada_fisica_at` hace que `confirmacion-sin-lectores.guardia.test.ts` la cubra **sin tocar su registro**: `db/schema.prisma` y `CierresAdminRepository.ts` ya están permitidos, y su caso «ningún repositorio la PROYECTA en un select» se aplica igual |
| Migración corriendo contra una base local compartida entre worktrees | Conocido: pone rojo el gate de las otras features. Se aplica en el worktree propio y se avisa |

---

## 11 · Trazabilidad `R<n> → test`

`[E]` = suite **existente** que se extiende · `[N]` = archivo **nuevo** · `[=]` = existente que debe
quedar verde **sin modificarse**.

| R | Test |
| --- | --- |
| R1, R2, R3 | `[E]` `tests/unit/types/gestion-retorno.test.ts` — `RETORNO_POR_ORIGEN` nombra los dos orígenes; `vuelveABodegaElPaquete` para `barrida` y para los cinco resultados; `RETORNA_A_BODEGA` sigue exhaustivo |
| R4 | `[E]` `tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts` — censo existente + red del eje nuevo (`satisfies Record<OrigenDelPaquete,`) + ningún archivo de producción declara su propia regla de origen, con autocomprobación |
| R5, R6, R8, R9 | `[E]` `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` — `findBarridasDelCierre`: el `WHERE` lleva `cierreId` y `cierre: alcanceWhere(alcance)`; fuera de alcance → `[]`; no devuelve barridas de otro cierre |
| R7, R18 | `[E]` `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` — cierre sin gestiones que vuelvan ni barridas: aprueba sin consultas extra y con el payload de la 38 |
| R10, R11, R12, R13, R14, R15, R16, R17 | `[E]` `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` — un caso por regla, con el error en **su** clave y `repo.resolverCierre` **no llamado** |
| R17 (forma) | `[E]` `tests/unit/types/cierres-admin-confirmacion-schema.test.ts` — la union discriminada acepta las dos ramas, rechaza `origen` ausente y rechaza `ordenId` en la rama `gestion` |
| R19 | `[E]` `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` (lista parcial → rechazo) **+** `[E]` `tests/components/CierresAdminConfirmacionFisica.test.tsx` (no existe control de «aprobar de todas formas»; el botón sigue bloqueado con una barrida pendiente) |
| R20, R21, R22, R25, R27, R28 | `[E]` `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` — el `updateMany` sobre `cierreSinGestion` con su `WHERE` guardado y su `data` de una sola clave; `count` corto → lanza; rechazo → no llama; segunda aprobación → rama no ejecutada |
| R22 (dinero) | `[=]` `tests/unit/guards/cierre-sin-gestion-sin-dinero.guardia.test.ts` |
| R23, R40 | `[N]` `tests/integration/db/cierre-sin-gestion-confirmacion-migration.test.ts` — la columna existe, es nullable, sin default; el `down.sql` existe, la suelta y es idempotente. Molde: `tests/integration/db/confirmacion-fisica-migration.test.ts` |
| R24 | `[=]` `tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts` |
| R11 (sin efectos parciales), R21, R26 | `[N]` `tests/integration/db/cierre-sin-gestion-confirmacion-sql-real.test.ts` — contra Postgres: aprobar con la lista incompleta deja el cierre `solicitado`, las órdenes **sin liberar** y cero marcas; aprobar completo marca **todas** las barridas liberadas |
| R26 | `[E]` `tests/unit/services/cierres-admin-service.aprobar.sin-gestion.test.ts` |
| R29, R30, R31, R32, R33, R34, R35, R36 | `[E]` `tests/components/CierresAdminConfirmacionFisica.test.tsx` — sección «Sin gestionar» con sus filas y su badge; contador único que las incluye; leer la guía de una barrida la confirma; guía ajena avisa; aviso de «sin guía» en la barra de estado |
| R37 | `[E]` `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` — mismo bloqueo con alcance `adminSatelite` |
| R38, R39 | `[=]` `tests/unit/repositories/cierres-admin-caja-cod.test.ts` — **verde sin tocar**. Si se pone rojo, el bloque aterrizó mal |
