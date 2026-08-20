# Feature 238 — Diseño técnico

> Requisitos en `requirements.md` (R1-R44). Enfoque decidido por el humano en
> `progress/design_pila_ayuda_tienda.md` §F4: **tercera rama de `pedirAprobacion()`**, **parámetro con
> el patrón de `indemnizaciones`** (cobertura exacta validada en el servicio antes de tocar el repo) y
> **persistencia dentro de la transacción de `resolverCierre`**, junto al bloque que manda las
> `rechazada` a `por_devolver`.
>
> La forma exacta de lo que se persiste está **pendiente de firma (D1)**. En este documento se usa el
> nombre recomendado `gestion_orden.confirmada_fisica_at`; si la firma cambia la forma, cambia §1 y
> §4 y nada más.

---

## 0. El cambio, en una línea de causa y efecto

Hoy `CierresAdminService.aprobarCierre` valida cobertura **de indemnizaciones** y llama a
`resolverCierre`, que en una sola transacción mueve los cinco feeds de dinero, libera las
`sin_gestionar`, manda las `rechazada` a `por_devolver` y —desde la 239— **ancla las devoluciones a
`devuelta`**, que es lo que las hace visibles para la tienda y arranca su reloj.

Nada de eso comprueba que los paquetes estén en bodega. Esta feature añade una **segunda cobertura
exacta**, hermana de la de indemnizaciones y en el mismo sitio: el conjunto de gestiones confirmadas
tiene que ser **igual** al conjunto de gestiones del cierre que vuelven a bodega, o la aprobación no
ocurre.

---

## 1. Modelo de datos

### 1.1 Tablas nuevas: ninguna. RLS nueva: ninguna

Se reutiliza `gestion_orden`, que ya tiene RLS habilitada sin policies (sólo service role, desde
`20260711150000`; mismo patrón que `gestion_orden_evidencia` y `gestion_orden_pago`). No hay política
nueva que escribir ni superficie nueva que aislar.

### 1.2 Una columna nueva: `gestion_orden.confirmada_fisica_at`

```prisma
// Feature 238 (R17/R20/R21) — instante en que BODEGA confirmo tener el paquete delante, escrito
// DENTRO de la transaccion de aprobacion del cierre. NULL = gestion que no vuelve a bodega, o
// gestion de un cierre aprobado ANTES de esta feature (no se backfillea). Mismo patron
// escrito-despues que `indemnizacion` (158), `pago_mensajero` (39) e `ingreso_bodega_rechazo` (56).
confirmadaFisicaAt DateTime? @map("confirmada_fisica_at")
```

- **Nullable y sin default**, como el resto de campos por rama de esta tabla. La obligatoriedad vive
  en el servicio (cobertura exacta), **sin CHECK en la base**: mismo criterio declarado para
  `causa_devolucion` (73/F1.4-b), `causa_incidente` (158) y `monto_recibido`/`metodo_pago` (36).
- **Sin índice.** No hay consulta declarada que filtre por ella; se lee siempre por la gestión o por
  el cierre, que ya tienen los suyos (`@@index([cierreId])`).
- **NO se añade `confirmada_fisica_por`.** Quién confirmó es `cierre_dia.resuelto_por` del cierre
  aprobado en esa misma transacción; una segunda copia es una segunda verdad. Y con el cierre ya
  `aprobado` ese campo es estable: `ESTADOS_RESOLUBLES = ["solicitado"]`
  (`CierresAdminRepository.ts:51`), así que un cierre aprobado no vuelve a resolverse.
- **R21 — no es un reloj.** El instante coincide con `cierre_dia.resuelto_at` de la misma
  transacción; su valor informativo es el **hecho**, no la hora. Nada deriva plazos, vencimientos ni
  importes de esta columna, y `resuelto_at` en particular **no significa aprobado** (se escribe igual
  al rechazar, `resolverCierre:1002`, y `forzarSolicitudVencido` reabre sin limpiarla). Esa trampa,
  que la 239 documentó, se hereda tal cual: cualquier lectura de fecha lleva `estado = 'aprobado'`
  pegado o miente.

Migración `db/migrations/<ts>_gestion_orden_confirmacion_fisica/` (`<ts>` posterior a
`20260819160000`, el último aplicado):

- `migration.sql`: `ALTER TABLE "gestion_orden" ADD COLUMN "confirmada_fisica_at" TIMESTAMP(3);`
  Aditiva: no renombra, no reordena, no borra, no toca filas, no toca índices, no toca RLS. Patrón
  exacto de `20260730120000_incidente_indemnizacion` puntos 4 y 5.
- `down.sql`: `ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "confirmada_fisica_at";`
  **Pérdida de dato declarada** (se pierden las marcas), igual que el down de la 158 pierde los
  montos y el de la 73 las causas. R43 se cumple: el código anterior nunca leyó esta columna, así que
  la base revertida es exactamente la que ese código espera.

### 1.3 Enums nuevos: ninguno

No hace falta un enum: con el bloqueo duro (D2 = «no hay faltantes declarados») el estado es binario
y `NULL` / `NOT NULL` lo expresa. Si D2 se firma al revés, esto pasa a ser un enum
(`confirmada` / `faltante`) y su `down.sql` tiene que **recrear el tipo con la lista vigente**, como
hizo `20260819110000_orden_historial_origen_anclaje_devolucion`.

### 1.4 Índices: ninguno nuevo

- La lectura del conjunto esperado filtra `gestion_orden` por `cierre_id` (`@@index([cierreId])`,
  existente — el mismo apoyo que usan los cinco feeds de dinero de la misma transacción) y por
  `resultado` como residual sobre el puñado de filas de ese cierre.
- La escritura filtra por `id IN (…)` (PK) más las mismas guardas.

---

## 2. El punto único de «qué vuelve a bodega» (R1/R3/R5)

Módulo **puro** nuevo: `lib/types/gestion-retorno.ts`. Sin Prisma (sólo el `type` del enum, borrado
en compilación), sin servicios, sin `next/*`: lo importan el cliente, el servicio y el repositorio.

```ts
/**
 * R1/R3/R5 — que resultado de gestion devuelve el PAQUETE a bodega. PUNTO UNICO DE LA REGLA.
 *
 * `Record<GestionResultado, boolean>` es exhaustivo A PROPOSITO: si el enum gana un sexto
 * resultado, esto NO COMPILA hasta que alguien decida si su paquete vuelve. Sin esa red, un
 * resultado nuevo caeria en `undefined` -> falsy -> se excluiria del bloqueo EN SILENCIO, que es
 * justo la forma que tiene este fallo de aparecer.
 *
 * `incidente: false` esta DECLARADO CON SU RAZON, no omitido: el paquete perdido, robado o danado
 * NO vuelve — se indemniza (feature 158). Es la decision humana firmada del 2026-08-19
 * (`progress/design_pila_ayuda_tienda.md`, decision 3). NO "arreglar" poniendolo a `true`: eso
 * bloquearia el cierre exigiendo escanear un paquete que no existe.
 */
export const RETORNA_A_BODEGA = {
  entregada: false,     // se quedo con el cliente
  reprogramada: true,   // vuelve a bodega y espera su fecha (liberacion_reprogramada)
  devuelta: true,
  rechazada: true,
  incidente: false,     // perdido / robado / danado: no vuelve, se indemniza (158)
} as const satisfies Record<GestionResultado, boolean>;

export const RESULTADOS_QUE_VUELVEN = (
  Object.keys(RETORNA_A_BODEGA) as GestionResultado[]
).filter((r) => RETORNA_A_BODEGA[r]);

export function vuelveABodega(resultado: GestionResultado): boolean {
  return RETORNA_A_BODEGA[resultado];
}
```

**Por qué un `Record` total y no una lista.** Una lista (`["devuelta","rechazada","reprogramada"]`)
expresa lo que entra y **calla lo que queda fuera**; ese silencio es exactamente lo que hace que la
exclusión de los incidentes «parezca un olvido» (R34) y lo que deja pasar un resultado nuevo. El
`Record` obliga a nombrar los cinco y a poner el `false` **con su comentario**, y la lista se deriva
de él. Es el mismo movimiento que la 239 hizo con `ESTATUS_POR_RESULTADO`.

Consumidores del módulo, los tres desde el mismo sitio y sin copia:
`CierresAdminRepository` (el WHERE de la lectura y el de la escritura), `CierresAdminService` (la
cobertura) y `CierresAdminModule` (qué filas pinta la ventana).

---

## 3. Contratos I/O

**Rutas nuevas: ninguna.** Ni endpoint, ni página, ni Server Action nueva. Cambia el contenido de
`aprobarCierre`, que es donde vive la decisión.

### 3.1 Borde (zod) — `lib/types/cierres-admin.ts`

```ts
/**
 * Feature 238 (R7/R12) — UNA gestion confirmada fisicamente. `numGuia` es lo que bodega LEYO
 * (camara o teclado); el servicio comprueba que casa con la guia de la orden de esa gestion
 * (R12), de modo que un fallo de mapeo del cliente sea un `validation_error` y no una
 * confirmacion falsa.
 */
export const confirmacionFisicaSchema = z.object({
  gestionId: z.string().uuid(),
  numGuia: z.number().int().positive(),
});

export const aprobarCierreSchema = z.object({
  cierreId: z.string().uuid(),
  indemnizaciones: z.array(indemnizacionSchema).default([]),
  // `.default([])` NO abre ningun agujero (R15): un cierre CON retornables y lista vacia cae en
  // la guardia de cobertura del servicio. Lo que el default preserva es R16: un cierre sin nada
  // que devolver se aprueba con el MISMO payload de siempre.
  confirmacionFisica: z.array(confirmacionFisicaSchema).default([]),
});
```

Es un **objeto y no un `string[]` de ids** por dos motivos: lleva el dato que R12 verifica, y puede
crecer (D7) sin romper el contrato.

### 3.2 Servicio — `lib/services/CierresAdminService.ts`

```ts
async aprobarCierre(
  cierreId: string,
  actor: Actor,
  indemnizaciones: ReadonlyArray<IndemnizacionCapturadaInput> = [],
  confirmacionFisica: ReadonlyArray<ConfirmacionFisicaInput> = [],   // ← feature 238
): Promise<AprobarCierreServiceResult>
```

Cuarto parámetro posicional con default, exactamente como la 158 añadió el tercero. Se descarta pasar
a un objeto de opciones (§10-E).

El orden dentro del método es **el que ya hay, con una guardia más delante**:

```
1. resolveAlcance                                            (sin cambios)
2. validarConfirmacionFisica(cierreId, alcance, confirmacionFisica)   ← NUEVA, R14
     -> validation_error  => return, cierre intacto
3. validarCoberturaIndemnizaciones(...)                      (sin cambios)
4. resolver ids de catalogo del anclaje (239)                (sin cambios)
5. repo.resolverCierre({ ..., confirmacionFisica })
```

**La confirmación va ANTES de las indemnizaciones** por la misma razón que R37 la pone antes en la
pantalla: si falta un paquete, no tiene sentido validar montos que se van a descartar. Las dos
guardias son independientes y las dos devuelven antes de tocar el repo.

`validarConfirmacionFisica` es el **espejo** de `validarCoberturaIndemnizaciones`:

```ts
const esperadas = await this.repo.findGestionesRetornablesDelCierre(cierreId, scope.alcance);
if (esperadas.length === 0 && confirmacionFisica.length === 0) return null;   // R16

const porId = new Map(esperadas.map((g) => [g.gestionId, g]));
const vistos = new Set<string>();
for (const { gestionId, numGuia } of confirmacionFisica) {
  if (vistos.has(gestionId))       -> MSG_CONFIRMACION_DUPLICADA        // R10
  vistos.add(gestionId);
  const esperada = porId.get(gestionId);
  if (!esperada) {
    // R11: distinguir el incidente de la gestion ajena. Los incidentes de ESTE cierre ya se
    // leen para la cobertura de la 158; no cuesta una consulta mas.
    -> esIncidenteDeEsteCierre ? MSG_CONFIRMACION_INCIDENTE : MSG_CONFIRMACION_AJENA
    continue;
  }
  if (esperada.numGuia === null)   -> MSG_CONFIRMACION_SIN_GUIA          // R13
  else if (esperada.numGuia !== numGuia) -> MSG_CONFIRMACION_GUIA_DISTINTA  // R12
}
for (const g of esperadas) if (!vistos.has(g.gestionId)) -> MSG_CONFIRMACION_FALTANTE  // R9
```

**Las claves de `fieldErrors` no colisionan con las de indemnización** aunque las dos sean
`gestionId`: los conjuntos son disjuntos por construcción (`incidente` no vuelve a bodega). Se
afirma con un test, no se confía en el razonamiento.

Mensajes (constantes con nombre, junto a las de la 158):

| Constante | Texto |
| --- | --- |
| `MSG_CONFIRMACION_FALTANTE` | «Falta confirmar la recepción de este paquete.» |
| `MSG_CONFIRMACION_AJENA` | «Esta gestión no pertenece a lo que vuelve en este cierre.» |
| `MSG_CONFIRMACION_DUPLICADA` | «Este paquete se confirmó dos veces.» |
| `MSG_CONFIRMACION_INCIDENTE` | «Los incidentes no se confirman: el paquete no vuelve a bodega.» |
| `MSG_CONFIRMACION_GUIA_DISTINTA` | «La guía leída no es la de este paquete.» |
| `MSG_CONFIRMACION_SIN_GUIA` | «Este paquete no tiene número de guía y no se puede confirmar. Avisá a un administrador.» |

### 3.3 Repositorio — lectura

```ts
// lib/interfaces/repositories/ICierresAdminRepository.ts
export interface GestionRetornableDelCierre {
  gestionId: string;
  numGuia: number | null;      // `orden.num_guia` es NULLABLE (schema.prisma:484) — ver D3/R13
  resultado: GestionResultado; // para el mensaje y para el agrupado de la pantalla
}

findGestionesRetornablesDelCierre(
  cierreId: string,
  alcance: Alcance,
): Promise<GestionRetornableDelCierre[]>;
```

Implementación, **molde literal de `findGestionesIncidenteDelCierre` (`CierresAdminRepository:669`)**:

```ts
where: {
  cierreId,
  resultado: { in: RESULTADOS_QUE_VUELVEN },
  anuladaAt: null,
  cierre: alcanceWhere(alcance),   // R6: el alcance en el WHERE, nunca en memoria
},
select: { id: true, resultado: true, orden: { select: { numGuia: true } } },
```

- **El alcance va en el WHERE.** Fuera de alcance o cierre inexistente ⇒ `[]`, sin distinguir: no se
  revela nada del cierre (misma propiedad que R25 de la 158).
- **`anuladaAt: null` es defensa explícita, no filtro necesario.** Una gestión con `cierre_id`
  poblado no puede anularse: el vínculo sólo lo reciben gestiones vigentes
  (`CierreDiaRepository:491-494`, «PUNTO MONEY-CRITICAL» de la 67) y `deshacerGestion` exige
  `cierre_id IS NULL`. Se escribe igual, por simetría con el bloque de anclaje de la 239, que lo
  lleva.
- **Mismo predicado que la escritura y que la pantalla.** Que los tres coincidan es lo que impide
  exigir la confirmación de una gestión que la escritura después no encontraría — la propiedad que el
  comentario de `findGestionesIncidenteDelCierre` reclama para sí.

### 3.4 Repositorio — el input de la transacción

```ts
export interface ConfirmacionFisicaGestion { gestionId: string; }

export type ResolverCierreInput =
  | (ResolverCierreBase & {
      nuevoEstado: "aprobado";
      anclajeDevolucion: AnclajeDevolucionConfig;                 // 239, OBLIGATORIO
      /** Feature 238 (R17): OBLIGATORIO. Puede ser `[]` (cierre sin nada que devolver). */
      confirmacionFisica: ReadonlyArray<ConfirmacionFisicaGestion>;
    })
  | (ResolverCierreBase & {
      nuevoEstado: "rechazado";
      anclajeDevolucion?: never;
      /** R24: un rechazo no confirma nada. `never` para que pasarlo NO compile. */
      confirmacionFisica?: never;
    });
```

**Obligatorio en la rama `aprobado`, no opcional.** Se sigue el precedente que la 239 acaba de
establecer y por el mismo motivo: si el composition root lo olvida, la aprobación ocurre y la marca
no se escribe — degradación silenciosa de un registro de auditoría que nadie va a echar de menos
hasta que haga falta en una disputa. Un olvido de cableado tiene que romper el **typecheck**. Coste
conocido y aceptado: todos los dobles de `resolverCierre` tienen que pasarlo (la 239 ya les hizo
pagar este peaje una vez; el segundo es la misma línea).

`numGuia` **no viaja al repositorio**: ya se verificó en el servicio (R12) y el repo no lo persiste.
Lo que el repo necesita es el conjunto de ids.

---

## 4. El bloque dentro de `resolverCierre`

### 4.1 Dónde va, exactamente

**Dentro del `if (res.count === 1 && nuevoEstado === "aprobado")`, después del bloque
`devolucionRechazadas` (139) y antes del bloque de anclaje (239).**

Es lo que pide §F4 («junto al bloque que manda las `rechazada` a `por_devolver`») y además se lee en
el orden operativo: se confirma que el paquete está, y a continuación la devolución se ancla y se
vuelve visible para la tienda.

**No mueve ninguna aserción de orden.** `cierres-admin-caja-cod.test.ts` **mide el orden de las
llamadas** dentro de la transacción porque los feeds se leen unos a otros (la caja lee lo que el
ledger acaba de escribir); esos feeds están **todos por delante** de este punto y este bloque es
money-neutral. Un rojo ahí significa que el bloque aterrizó mal: es **regresión, no aserción a
actualizar**.

> **Aviso medido, heredado y vigente.** `cierres-admin-caja-cod.test.ts` **pasa de largo** por el
> bloque de órdenes: su doble devuelve vacío para esa parte. Quien de verdad ejercita esta zona junto
> al dinero es `tests/integration/db/wallet-idempotencia.test.ts`, cuyo store honra el `where` como
> lo haría Postgres. Por eso el test de idempotencia de esta feature vive **allí**, y no en la suite
> de la caja. No re-descubrir esto: ya costó una escritura sin aserción durante toda su vida.

### 4.2 Forma

```
si (aprobado):
  ...
  bloque 139 (devolucionRechazadas)
  ------------------------------------------------------------------ feature 238
  si (confirmacionFisica.length > 0):
    ids = confirmacionFisica.map(c => c.gestionId)
    aplicado = tx.gestionOrden.updateMany({
      where: { id: { in: ids }, cierreId, resultado: { in: RESULTADOS_QUE_VUELVEN } },
      data:  { confirmadaFisicaAt: new Date() },        ← R19: SOLO esta clave
    })
    si (aplicado.count !== ids.length) throw ConfirmacionFisicaNoAplicableError(cierreId)
  ------------------------------------------------------------------
  bloque 239 (anclaje)
```

- **UNA consulta, no N.** A diferencia del bucle de indemnizaciones —que escribe un valor distinto
  por fila— aquí el valor es el mismo para todas, así que un solo `updateMany` con `id: { in: ids }`
  hace el trabajo. `count !== ids.length` es la comprobación equivalente a su `count !== 1`.
- **`cierreId` y `resultado` son GUARDIA del WHERE, no filtro cosmético.** Sin `cierreId`, aprobar un
  cierre podría marcar gestiones de otro; sin `resultado`, podría marcar un incidente. Las dos
  condiciones se afirman con un caso testigo cada una.
- **Fallo cerrado (R18).** Se lanza, y la `$transaction` revierte **todo**: la aprobación, los cinco
  feeds, la liberación, la devolución de rechazadas y el anclaje. Es un error de programación o de
  carrera (el servicio ya validó la cobertura), no un resultado de dominio; el mensaje lleva **sólo
  el id del cierre**, sin PII, patrón `IndemnizacionNoAplicableError` (`CierresAdminRepository:346`).
- **Idempotencia por construcción (R22).** No hay código de idempotencia y no hace falta: el bloque
  vive dentro del `res.count === 1 && aprobado`, y el `updateMany` del cierre está guardado por
  `estado IN ESTADOS_RESOLUBLES = ["solicitado"]`. Un cierre ya aprobado devuelve `count = 0` y la
  rama entera no se ejecuta. Es el mismo argumento con el que la 158 sostiene el suyo — **no** se
  añade `confirmadaFisicaAt: null` al WHERE: haría que un reintento legítimo tras un rollback
  lanzara por `count !== ids.length`.
- **Money-neutral (R19).** El `data` lleva **exactamente** `confirmadaFisicaAt`. Ningún feed lee esta
  columna (nace sin lectores, como `causa_devolucion` en su día) y ninguno lee `orden.estatus_id`
  —verificado por la 239 en su T2.4—, así que no hay ruta por la que esto toque un importe.

### 4.3 La invariante que cruza 238 y 239 (R23)

Con el bloqueo duro, **toda gestión que el bloque de anclaje mueve a `devuelta` acaba de ser
confirmada** en la misma transacción, unas líneas antes. No es una coincidencia que haya que
mantener a mano: se sigue de que las gestiones anclables son un subconjunto de las gestiones
`devuelta` del cierre, y todas ellas están en el conjunto esperado.

Se afirma con un test explícito (no se deduce del código en una revisión), y **el bloque de anclaje
no se toca**: no se le añade una guarda por `confirmada_fisica_at`. Acoplarlos daría un segundo
criterio que puede divergir, y el primero ya es imposible de saltarse.

---

## 5. La pantalla

### 5.1 La tercera rama de `pedirAprobacion()`

`CierresAdminModule.pedirAprobacion()` (`:640`) hoy tiene dos ramas: con incidentes abre el sub-modal
de montos, sin incidentes aprueba directo. Pasa a tener tres:

```
pedirAprobacion():
  si (retornables.length > 0)  -> abrir ventana de CONFIRMACION FISICA        ← R7
  si no y (incidentes.length > 0) -> abrir sub-modal de INDEMNIZACIONES        (como hoy)
  si no                        -> confirmarAprobacion()                        (como hoy, R16)

al completar la confirmacion fisica:
  si (incidentes.length > 0)   -> abrir sub-modal de INDEMNIZACIONES           ← R37
  si no                        -> confirmarAprobacion(confirmadas)
```

`retornables` sale del **mismo detalle que ya se pidió al servidor**
(`detalle.grupos.devuelta` + `.rechazada` + `.reprogramada`, filtrados por `vuelveABodega`), no de una
consulta aparte: el conjunto que la pantalla pide confirmar es exactamente el que el servicio exige
cubrir. Es la propiedad que la 158 declaró para los incidentes, aplicada al conjunto hermano.

`confirmarAprobacion` gana el segundo payload opcional y conserva R16: sin retornables y sin
incidentes manda `{ cierreId }` y nada más.

### 5.2 La ventana de confirmación

Un `Modal` (el compartido), hermano del sub-modal de indemnizaciones:

- **Título:** «Confirmar los paquetes que vuelven». **Descripción:** qué se pide y por qué.
- **La tarjeta de escaneo:** `EscanerGuiaCard` con `manual` (`submitLabel: "Confirmar"`), montada
  **directamente** dentro del `Modal`. **No** se usa `EscanerModal`: ese envoltorio aporta su propio
  botón disparador y su propio diálogo, y aquí ya estamos dentro de uno.
- **R36 — la cámara.** `EscanerGuiaCard` se monta condicionalmente (`{confirmando ? <…/> : null}`), no
  se oculta por CSS. Así la propiedad no depende del `keepMounted` interno de la primitiva de
  diálogo, y se puede afirmar con un test. (`QrScanner` además sólo enciende la cámara con un clic
  explícito, así que son dos candados, no uno.)
- **La lista**, agrupada por resultado (Devoluciones / Rechazos / Reprogramadas), una fila por
  gestión con `Nº Guía · Nº Remisión · destinatario · tienda` y su estado (pendiente / confirmada)
  (R33). El error del servidor de esa gestión se pinta **en su fila**, como los montos.
- **Los incidentes (R34):** si `incidentes.length > 0`, una línea propia y visible —no un tooltip—:
  «N incidentes de este cierre **no se escanean**: el paquete no vuelve, se indemniza.»
- **El bloqueo (R27):** `confirmDisabled` mientras falte alguna, **más** texto:
  «Faltan N paquetes por confirmar. Si alguno no llegó, rechazá el cierre indicando cuál falta.»
  El motivo del bloqueo se dice con palabras, no sólo con un botón apagado — es la regla que el
  sub-modal de la 158 ya sigue, y aquí además **nombra la salida**, que es lo que evita que alguien
  busque una puerta trasera.
- **`confirmLabel`:** «Continuar» si el cierre tiene incidentes (queda un paso), «Confirmar y
  aprobar» si no. **`closeOnConfirm={false}`**, para poder pintar los `validation_error` del servidor
  sin perder lo hecho.

### 5.3 Los dos caminos de captura (R28-R32)

Reuso literal del patrón de `RecogerPaqueteCard`, que es el que ya resuelve esto en el repo:

- **Cámara:** `extractNumGuiaFromScan(texto)` (`lib/utils/paquete-url.ts`). `null` ⇒ «Código
  inválido» y no se marca nada (R29).
- **Tecleado:** lo tecleado **es** el número; `/^\d+$/`, y si no casa se deja en el campo para
  corregir (devolver `false` desde `onSubmit`).

La resolución `numGuia → gestión` se hace **en el cliente contra el detalle ya cargado**, y produce
uno de cuatro desenlaces, cada uno con su mensaje.

> ⚠️ **CORREGIDO el 2026-08-19, tras verlo bloquear un cierre en pantalla (T5.6).** Esta tabla decía
> «casa **una** gestión», y una guía puede casar **varias**: una orden puede tener **dos gestiones
> vivas en el mismo cierre**. Medido en producción por MCP: **1 par (cierre, orden) sobre 48**, y
> justo del tipo cuyo paquete vuelve.
>
> Con la resolución a **una** —un `find`, que devuelve siempre la primera— la segunda fila quedaba
> **inalcanzable**: la primera lectura la confirmaba, la segunda respondía «ya está confirmada», el
> contador se clavaba en `11 de 12` y **el cierre no se podía aprobar por ninguna vía**, sin ningún
> mensaje que lo explicara. El servidor **no** tenía ese candado (su regla de duplicado es por
> `gestionId`, no por guía), así que era un bloqueo puramente de pantalla.
>
> **Se lee ahora en plural**, y los cuatro desenlaces se evalúan sobre **todas** las filas de esa
> guía. Hay **un solo paquete físico**: pedir dos lecturas de la misma caja es pedir que se
> atestigüe dos veces un único acto.

| Desenlace | Mensaje | Req |
| --- | --- | --- |
| Casan **una o más** gestiones que vuelven y **alguna** estaba pendiente | se marcan confirmadas **todas** las pendientes de esa guía (+ confirmación persistente bajo el formulario, como la última recogida) | R28 |
| Casan gestiones que vuelven y **todas** estaban ya confirmadas | «Esa guía ya está confirmada.» | R32 |
| Casan gestiones del cierre y **ninguna** vuelve (`entregada` / `incidente`) | «Esa guía es de este cierre, pero ese paquete no vuelve a bodega.» | R31 |
| No casa ninguna gestión del cierre | «Esa guía no pertenece a este cierre.» | R30 |

Los cuatro mensajes son distintos **a propósito**: son cuatro correcciones distintas para quien está
en el mostrador con el paquete en la mano.

**Consecuencia en el contador:** cuenta **paquetes** (guías distintas), no filas — 12 filas pueden ser
11 paquetes—, y cada fila sin número de guía cuenta aparte para no rebajar el bloqueo. El rótulo ya
decía «paquetes»; lo que mentía era el número.

### 5.4 Estado de la ventana

- Cerrar la ventana sin completar: **no se envía nada** (R35). Lo confirmado se conserva mientras el
  detalle siga abierto (reabrir no obliga a re-escanear lo ya leído) y se descarta en `cerrarDetalle`,
  junto a `montos` y `montoErrores`. Mismo criterio que la 158.
- No hay estado servidor parcial: **no existe** una confirmación a medias persistida. O se aprueba
  con la lista completa, o no hay nada.

---

## 6. Rechazo, vencidos y re-aprobación (R24-R26)

Los tres se resuelven **sin código nuevo**, y por eso se documentan aquí en vez de implementarse:

- **Rechazo (R24):** `confirmacionFisica` es `never` en la rama `rechazado` de la unión, así que ni
  siquiera se puede pasar. `rechazarCierre` no cambia una línea.
- **Re-aprobación (R25):** imposible por construcción. `ESTADOS_RESOLUBLES = ["solicitado"]`
  (`CierresAdminRepository:51`): un cierre `aprobado` devuelve `count = 0` ⇒ `conflict`, y la rama
  entera no corre. **No hace falta idempotencia explícita, y añadirla sería un segundo mecanismo que
  puede divergir del primero.**
- **`vencido → solicitado` (R26):** `forzarSolicitudVencido` **no** es una resolución: sólo cambia
  `estado`, no corre en `$transaction`, no alimenta wallets y no mueve órdenes. No confirma nada. El
  cierre reabierto queda `solicitado` y su aprobación posterior pasa por la puerta completa, igual
  que cualquier otra. Lo mismo vale para un `rechazado` reabierto.

---

## 7. Alcance: satélite y cierre de bodega

- **adminSatélite (R38):** misma exigencia, sin excepción. El alcance ya lo resuelve
  `resolveAlcance` y viaja al WHERE de la lectura; el satélite confirma los paquetes que llegan a su
  bodega, que es exactamente donde llegan.
- **Cierre de bodega, nivel 2 (R39): queda FUERA, por decisión y con evidencia.**
  `CierreBodegaRepository` **no toca `orden` ni `appendCambioEstado`** (comprobado: cero apariciones
  de `orden.`, `estatusId` y `appendCambioEstado` en ese archivo); agrega el dinero de `cierre_dia`
  **ya aprobados**, y esos ya pasaron por la confirmación física en el nivel 1. Pedirla otra vez sería
  pedir escanear dos veces el mismo paquete. Se afirma con un test para que la ausencia sea una
  decisión y no un olvido.

---

## 8. Rojos esperados, y rojos que son regresión

**Rojos POR DISEÑO** (se actualizan con nota fechada, y ninguno se «arregla» tocando el código):

- **Todo doble de `resolverCierre`** deja de compilar hasta que pase `confirmacionFisica` en la rama
  `aprobado`. **Esa es la señal buscada** (§3.4).
- `tests/unit/repositories/cierres-admin-indemnizacion.test.ts`: ahora hay **dos** llamadas a
  `tx.gestionOrden.updateMany` en la misma transacción. Las aserciones que identifiquen la llamada
  **por índice** caen. Se re-apuntan identificándola **por su significado** (`where.resultado ===
  "incidente"`), nunca por presencia o ausencia de una clave — eso es lo que R42 prohíbe y lo que la
  guardia `aprobacion-escrituras-cubiertas` detecta.
- `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts`: la entrada de
  `tx.gestionOrden.updateMany` describe hoy sólo la indemnización; pasa a describir **dos** bloques,
  con las dos suites que los nombran (R40).
- Cualquier test de la pantalla que apruebe un cierre con devoluciones «de un click»: ahora hay una
  ventana en medio. Es el cambio de producto.

**Rojos que son REGRESIÓN** (si aparecen, el código aterrizó mal):

- `tests/unit/repositories/cierres-admin-caja-cod.test.ts` (mide el orden de las llamadas).
- Los cinco feeds de dinero y sus suites de idempotencia (R41).
- `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` (el bloque de la 239 no cambia).
- Las guardias money-safe (`ordenes-columnas-money-safe`, `dinero-sin-centimos`) y las dos del
  criterio de intento.

---

## 9. Consulta de verificación (solo lectura)

Antes de desplegar (T0.1) y después, para ver la feature funcionando en datos reales:

```sql
-- Cierres SOLICITADO y cuanto tendria que escanear bodega para aprobarlos, mas la poblacion
-- que R13 bloquearia (gestiones que vuelven sin numero de guia). Cero en la ultima columna =
-- D3 se puede firmar como esta.
SELECT c."id"                                                        AS cierre_id,
       c."solicitado_at",
       count(*) FILTER (WHERE g."resultado" IN ('devuelta','rechazada','reprogramada'))  AS a_escanear,
       count(*) FILTER (WHERE g."resultado" = 'incidente')                               AS incidentes_excluidos,
       count(*) FILTER (WHERE g."resultado" IN ('devuelta','rechazada','reprogramada')
                          AND o."num_guia" IS NULL)                                      AS sin_guia
FROM "cierre_dia" c
JOIN "gestion_orden" g ON g."cierre_id" = c."id" AND g."anulada_at" IS NULL
JOIN "orden" o        ON o."id" = g."orden_id"
WHERE c."estado" = 'solicitado'
GROUP BY c."id", c."solicitado_at"
ORDER BY a_escanear DESC;
```

---

## 10. Alternativas descartadas

### A · Una pantalla de «recepción de retorno», separada del cierre

Bodega escanearía los paquetes que van llegando durante el día en una superficie propia, y el cierre
sólo comprobaría que estén todos recibidos.

**Descartada por dos razones independientes.** (i) **Duplica la fuente de verdad**: habría un registro
de recepción por paquete *y* el conjunto de gestiones del cierre, y los dos pueden divergir (un
paquete recibido cuya gestión luego se deshace, una gestión sin recepción). Reconciliarlos es una
feature entera. (ii) **La puerta que importa es la aprobación**, no la recepción: desde la 239 es la
aprobación la que mete la devolución en `/novedades`, arranca el reloj y mueve los cinco feeds. Poner
el control en otra pantalla lo deja **fuera de la transacción** que hace el daño, que es justo el
error que la 239 vino a corregir en su propia mitad.

Coste que sí tiene descartarla, y se declara: el escaneo se concentra en el momento de aprobar en vez
de repartirse a lo largo del día.

### B · Marcar cada fila con un checkbox, sin escáner

Un «recibido» por fila y a correr.

**Descartada: no comprueba nada.** El valor entero de esta feature es que el gesto exija tener la
etiqueta delante. Un checkbox es el mismo click de hoy, repartido en N clicks. Y el escáner **ya
existe y lo usan seis pantallas** (`QrScanner`, `EscanerGuiaCard`, `EscanerModal`,
`extractNumGuiaFromScan`): reusarlo cuesta menos que escribir la lista de checkboxes.

### C · Una fila por cierre en una tabla nueva (`cierre_confirmacion_fisica`)

`{ cierre_id, confirmado_por, confirmado_at, esperadas, confirmadas }`.

**Descartada por tres cosas, cualquiera de las tres basta.** (i) **Quién y cuándo ya existen**:
`cierre_dia.resuelto_por` / `resuelto_at` del cierre aprobado en esa misma transacción; la tabla
nueva sería una copia que puede divergir. (ii) **Los contadores son derivables** de las gestiones, y
un contador persistido es un contador que se queda desfasado. (iii) **Superficie nueva**: tabla nueva
⇒ RLS nueva que declarar y vigilar, frente a una columna en una tabla que ya la tiene. Y no puede
expresar *qué* paquete falta, que es justo lo que haría falta si D2 se firmara al revés.

### D · No persistir nada: usar la confirmación sólo como puerta

**Descartada porque borra la única diferencia que hace falta poder ver.** Sin marca, «gestión
confirmada» y «gestión de un cierre aprobado antes de que esto existiera» son indistinguibles (R20),
y la feature no deja rastro auditable de que bodega declaró tener el paquete — que es el dato que
alguien va a pedir el día que una tienda reclame una devolución que nunca llegó. Además contradice
§F4, que dice explícitamente que se persiste dentro de la transacción.

### E · Pasar `aprobarCierre` a un objeto de opciones

`aprobarCierre({ cierreId, actor, indemnizaciones, confirmacionFisica })` en vez de un cuarto
parámetro posicional.

**Descartada por relación coste/beneficio.** Toca todos los call sites y todos los dobles del
servicio para ganar legibilidad en una firma que ya tiene un precedente idéntico (la 158 añadió el
tercero así). Un cambio de forma de firma que no arregla ningún fallo es diff que hay que revisar
sin nada que ganar. Si algún día aparece un quinto parámetro, esa es la conversación.

### F · Validar la cobertura en el borde (zod)

**Descartada por lo mismo que la 158 la descartó, literalmente:** el borde no sabe qué gestiones tiene
ese cierre. La cobertura sólo se puede comprobar leyendo el cierre dentro del alcance del actor, y eso
es lógica de negocio. Lo que sí vive en el borde es la **forma** (uuid, entero positivo).

---

## 11. Riesgos

1. **Aumenta la probabilidad del riesgo aceptado de la 239.** Aprobar cuesta más ⇒ más cierres sin
   aprobar ⇒ más devoluciones congeladas en `devolucion_por_confirmar`, invisibles y sin reloj. La
   consulta de población atascada (`specs/239/design.md` §12) pasa a vigilar las dos fichas.
2. **Día del despliegue.** Los cierres ya `solicitado` exigirán escaneo de paquetes que llegaron
   horas antes. No hace falta migración —están en el estante—, pero **sin aviso previo a bodega el
   primer síntoma es «el botón Aprobar dejó de funcionar»** (D8).
3. **`num_guia` nullable (D3).** Si existe esa población, R13 deja cierres imposibles de aprobar. Se
   mide antes de escribir código, no después.
4. **La cámara en el mostrador.** Es la sexta superficie que usa `QrScanner`; si el escáner tiene un
   fallo de ciclo de vida, esta feature lo hereda. Mitigación: montaje condicional (§5.2) y
   reutilización sin bifurcar el componente.
5. **El pre-vuelo caduca.** `dev` se mueve; comparar el SHA medido contra `origin/dev` justo antes de
   abrir el PR.

---

## 12. Documentación que esta feature deja al día

- `progress/design_pila_ayuda_tienda.md` §F4 → anotar que la ficha aterrizó, con fecha y PR, y con
  las respuestas a D1-D3.
- `specs/239-devolucion-espera-cierre/design.md` §13 (riesgos) → anotar que la 238 añade una
  condición más a la aprobación y por tanto refuerza el riesgo 1 de esa ficha.
- El comentario de `RETORNA_A_BODEGA` es la documentación de la exclusión de los incidentes; no se
  duplica en ningún otro sitio.
