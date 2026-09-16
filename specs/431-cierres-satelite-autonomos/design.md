# Ficha 431 — diseño técnico

> Base: `progress/design_sf001_p1_cierres_satelite.md` (verificado contra el código el 2026-09-15).
> Aquí no se re-verifica nada de aquello: se construye encima.
> Lo que este documento decide es lo que el humano dejó abierto — dónde viven las columnas, qué pasa
> con `solicitado`, quién marca, cómo se deriva el saldo, qué se hace con los 32 históricos y cómo se
> actualiza la guardia de vocabulario.

---

## 0. El criterio que ordena el resto

Esta ficha **quita un control de dinero**. Por eso, entre dos formas de hacer lo mismo, gana siempre
la que **hace el estado malo imposible** en vez de la que confía en que nadie se equivoque:

1. Lo que se puede poner en la **base** (un `CHECK`, un todo-o-nada dentro de la transacción) no se
   deja en el servicio.
2. Lo que se puede hacer **derivado** no se guarda (el saldo).
3. Lo que **se retira** se retira de forma que no pueda volver por accidente ni escribirse por un
   camino lateral.
4. Lo que **no se sabe** se pregunta (`requirements.md § Preguntas abiertas`), no se rellena.

---

## 1. Modelo de datos

### 1.1 Dónde viven las columnas de la marca: en `cierre_bodega`

La marca cuelga de **la consolidación**, que es D1: el bulto de efectivo que viaja. No de la zona (una
zona tiene N bultos), no de una tabla nueva (sería el ledger que D5 descartó), no de `cierre_dia` (ese
es el nivel del mensajero y ya está conciliado contra el ledger de la tienda).

Cuatro columnas nuevas en `cierre_bodega` (`db/schema.prisma`, modelo `CierreBodega`):

| Columna (Postgres) | Campo Prisma | Tipo | Nulable | Por qué |
| --- | --- | --- | --- | --- |
| `conciliado_at` | `conciliadoAt` | `TIMESTAMP(3)` | **sí** | Es **el predicado**: `NULL` = sin conciliar. Un instante y no una fecha de calendario, porque el resto de marcas de tiempo de esta tabla (`solicitado_at`, `resuelto_at`) son instantes y compararlas contra una fecha suelta obligaría a convertir en dos sitios. |
| `conciliado_por` | `conciliadoPor` | `TEXT` FK → `usuario(id)` | **sí** | Quién marcó. FK y no un nombre suelto: es el mismo patrón que `resuelto_por`/`solicitado_por` en esta misma tabla. `ON DELETE RESTRICT` (por defecto), igual que sus hermanas. **Nunca `NULL` cuando `conciliado_at` no lo es** (lo impone el `CHECK`): no hay camino de sistema, siempre marca una persona. |
| `monto_recibido` | `montoRecibido` | `DECIMAL(12,2)` | **sí** | Cuánto llegó **de verdad**. Misma precisión y escala que los cinco importes que ya viven en la tabla: usar otra sería aritmética entre escalas distintas. Nulable **a propósito y no con `DEFAULT 0`**: `0` significaría «llegó cero», que no es lo mismo que «nadie lo ha mirado», y con un default la diferencia `total − recibido` mentiría en cada fila sin marcar. |
| `conciliado_nota` | `conciliadoNota` | `TEXT` | **sí** | Texto libre corto («faltaron ₡15.000, entran el lunes»). Opcional siempre. **No entra en el registro de acciones** (R5 de la ficha 362: el texto tecleado por una persona no va al historial) y **no entra en las descargas** que ya censan columnas sensibles. |

**No hay columnas de «quién deshizo».** Revertir **borra** las cuatro, así que una columna de reversión
se perdería en la siguiente marca — justo cuando más falta haría. El rastro de quién marcó y quién
deshizo vive en `historial_accion` (§4.2), que es el módulo que existe para eso, sobrevive al borrado y
se puede filtrar por «lo que mueve dinero». Las columnas dicen **el estado de hoy**; el historial dice
**la historia**.

### 1.2 El estado sigue siendo `estado`, y la coherencia la impone la base

D3 prohíbe tocar `cierre_estado`. Se mantiene por tanto lo que decidió D2: `solicitado` se **lee**
«Pendiente de conciliar» y `aprobado` se **lee** «Recibido». El estado no se congela ni se duplica en
una columna nueva, porque siete pantallas y `ConciliacionCierresAnaliticaRepository.contarCierresPorEstado`
ya lo leen y congelarlo dejaría todos los cierres de bodega como «no resueltos» para siempre en la
analítica.

Eso deja dos fuentes para la misma verdad (`estado = 'aprobado'` y `conciliado_at IS NOT NULL`), que es
exactamente la clase de cosa que un día diverge. **Se cierra en la base, no con disciplina:**

```sql
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_conciliacion_coherente" CHECK (
  ("conciliado_at" IS NULL     AND "conciliado_por" IS NULL     AND "monto_recibido" IS NULL
                               AND "conciliado_nota" IS NULL    AND "estado" <> 'aprobado')
  OR
  ("conciliado_at" IS NOT NULL AND "conciliado_por" IS NOT NULL AND "monto_recibido" IS NOT NULL
                               AND "estado" = 'aprobado')
);
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_monto_recibido_no_negativo"
  CHECK ("monto_recibido" IS NULL OR "monto_recibido" >= 0);
```

Tres consecuencias buscadas, y las tres son requisitos:

- **R15 se cumple por construcción**, incluido «por SQL a mano».
- **El camino viejo de aprobar queda imposible**, no solo oculto: `CierresBodegaAdminRepository.resolverCierreBodega`
  con `nuevoEstado: 'aprobado'` pondría `estado='aprobado'` sin datos de marca y la base lo rechaza.
  Es mejor que borrarlo: si alguien lo vuelve a montar, se entera con un error, no con una fila muda.
  Rechazar (`estado='rechazado'`) sigue siendo legal para la base y sigue sin estar en ninguna pantalla.
- **El `CHECK` valida el backfill**: si la migración dejara una sola fila `aprobado` sin marcar, no
  termina (§1.5).

`monto_recibido` **puede superar** al total consolidado (llegó de más): solo se prohíbe el negativo. La
diferencia entonces resta del saldo y se enseña tal cual, sin recortar a cero — mismo criterio con el
que la ficha 393 decidió enseñar «Para la central» en negativo en vez de maquillarlo.

### 1.3 El índice único parcial se cae — y esto es el corazón de «cierra sola»

Hoy existe `cierre_bodega_zona_solicitado_uq` (`UNIQUE (zona_id) WHERE estado='solicitado'`, feature 40):
**una sola consolidación pendiente por zona**. Con la aprobación como puerta, eso duraba 34 minutos de
mediana. Con la marca de conciliación —que ocurre cuando el efectivo llega físicamente, no cuando
alguien mira la pantalla— ese índice **sería el mismo bloqueo mudado de sitio**: la satélite podría
asignar, pero **no podría volver a consolidar** hasta que la central marcara. Justo lo que dice el
título de la ficha que no puede pasar.

Por eso:

1. **Se borra el índice único parcial**, y con él el gate `existeCierreBodegaSolicitado` del servicio
   (`CierreBodegaService.solicitarCierreBodega`, hoy `MSG_DUPLICADO`) y el `catch` de `P2002` que lo
   traducía. `ICierreBodegaRepository.existeCierreBodegaSolicitado` y su implementación se retiran con
   ellos; **sus tests no se borran a ciegas**: los casos que cubren otra cosa se conservan (ver
   `tasks.md` T12).
2. **El índice normal `(zona_id, estado)` entra en su lugar** para las lecturas de §2.
3. **Lo que ese índice protegía de verdad —que dos envíos simultáneos no partan la cola en dos— pasa a
   la transacción de escritura**, que es donde vive la carrera:

```ts
// CierreBodegaRepository.crearCierreBodega, dentro del $transaction que ya existe
const linkeados = await tx.cierreDia.updateMany({ where: { id: { in: cierreDiaIds }, cierreBodegaId: null, ... } });
if (linkeados.count !== cierreDiaIds.length) {
  throw new ConsolidacionParcialError(...); // aborta la tx: no queda ni la fila ni los enlaces
}
```

No es una precaución genérica: los totales snapshot (`total_general`, `total_pago_mensajero`,
`total_ingreso_bodega_rechazos`) se calculan **sobre el conjunto entero** antes de escribir, así que
una consolidación que enlace menos cierres de los que sumó **declara más dinero del que lleva**. El
patrón es el de `OrdenRepository.asignarRecoleccionLote` (`result.count !== ordenIds.length` → throw),
que ya vive en este repositorio. El servicio traduce el error a `conflict` con el motivo que ya existe
(`MSG_VACIO`), sin inventar un desenlace nuevo.

### 1.4 Las migraciones (dos, en este orden)

**A · `20260916120000_historial_accion_conciliacion_bodega`** — solo el enum, sola, porque Postgres no
deja usar un valor de enum añadido en la misma transacción en que se añade (mismo motivo por el que la
ficha 429 partió la suya):

```sql
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'cierre_bodega_conciliado';
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'cierre_bodega_conciliacion_revertida';
```

Su `down.sql` recrea el tipo con la lista **previa** (los 53 de hoy) y recastea
`historial_accion.accion`, que es la única columna que lo usa — patrón idéntico al de
`20260907120100_historial_accion_nodo_geografico_renombrado/down.sql`. Dos avisos que el `down.sql`
debe llevar escritos:

- **Precondición ruidosa:** si queda una fila con uno de los dos valores nuevos, el `USING` falla y el
  rollback aborta. Eso es lo correcto: esa fila es el rastro de quién dijo que el dinero llegó.
- **La lista es una foto de esta rama.** Revertir esto sobre una base que ya avanzó con otros valores
  **los borraría en silencio**. Ningún `down.sql` anterior se toca: son fotos históricas.

**B · `20260916120100_cierre_bodega_conciliacion`** — todo lo demás, en este orden y por este motivo:

```sql
-- 1) columnas (aditivas, nulables: no reescriben ninguna fila)
ALTER TABLE "cierre_bodega"
  ADD COLUMN "conciliado_at"   TIMESTAMP(3),
  ADD COLUMN "conciliado_por"  TEXT,
  ADD COLUMN "monto_recibido"  DECIMAL(12,2),
  ADD COLUMN "conciliado_nota" TEXT;
ALTER TABLE "cierre_bodega" ADD CONSTRAINT "cierre_bodega_conciliado_por_fkey"
  FOREIGN KEY ("conciliado_por") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) BACKFILL antes de los CHECK (§1.5)
UPDATE "cierre_bodega"
   SET "conciliado_at"   = "resuelto_at",
       "conciliado_por"  = "resuelto_por",
       "monto_recibido"  = "total_general",
       "conciliado_nota" = 'Conciliación retroactiva (ficha 431): aprobado bajo el régimen anterior.'
 WHERE "estado" = 'aprobado' AND "conciliado_at" IS NULL;

-- 3) los dos CHECK (§1.2) — si el backfill dejó una fila fuera, la migración NO TERMINA
-- 4) fuera el índice único parcial; dentro el de lectura
DROP INDEX IF EXISTS "cierre_bodega_zona_solicitado_uq";
CREATE INDEX "cierre_bodega_zona_estado_idx" ON "cierre_bodega"("zona_id", "estado");
CREATE INDEX "cierre_bodega_conciliado_at_idx" ON "cierre_bodega"("conciliado_at");
```

`updated_at` **no se toca** en el backfill (es `@updatedAt` de Prisma, no un trigger de Postgres): que
siga igual al de antes es la prueba medible de que no se modificó nada más (R30, ver `tasks.md` T25).

Su `down.sql` deshace en orden inverso: suelta los dos `CHECK` y los dos índices nuevos, **recrea
`cierre_bodega_zona_solicitado_uq`** y borra las cuatro columnas con su FK. Aviso obligatorio en la
cabecera: **la recreación del índice único falla si en ese momento alguna zona tiene dos
consolidaciones `solicitado`** — que es justamente lo que esta ficha hace posible. El rollback aborta
ruidosamente y eso es lo correcto: revertir con la cola partida en dos exige decidir antes qué se hace
con la segunda.

### 1.5 Los 32 históricos: se dan por recibidos, con su fecha original

**Decisión (R30).** Las consolidaciones ya `aprobado` quedan **conciliadas por su importe total**, con
`conciliado_at = resuelto_at` y `conciliado_por = resuelto_por`.

- **Fecha original, no la de la migración.** Si se pusiera `now()`, la antigüedad de R21 arrancaría
  falseada y el historial diría que 32 cierres se recibieron el mismo segundo.
- **La nota lo dice en la pantalla.** No es un backfill mudo: cada una de esas filas enseña por qué
  está marcada. Quien mire la del 2026-09-01 sabrá que nadie contó ese dinero hoy.
- **Consecuencia el primer día:** el saldo de las 5 satélites arranca en **₡0,00** en vez de en
  ₡4.196.897. El número se mide en producción **antes** de desplegar (`tasks.md` T0) y se vuelve a
  medir después (T25).
- **Lo que esto afirma sin haberlo medido** —que ese dinero llegó— está escrito en Q1, y es la única
  pregunta de este spec que el humano tiene que contestar antes de implementar.

---

## 2. El saldo, derivado (D5)

### 2.1 La fórmula, una sola vez

```
saldoSinConciliar(zona) = Σ ( total_general − COALESCE(monto_recibido, 0) )
                          sobre cierre_bodega de esa zona con estado <> 'rechazado'
```

Una sola expresión cubre los tres casos, sin un `if` que los separe: sin marcar aporta su total
íntegro; marcada completa aporta `0`; marcada por menos aporta **la diferencia** (R18, el caso de los
₡485.000 de ₡500.000). Los `rechazado` quedan fuera porque el estado está retirado (D2) y en
producción hay **cero**; queda declarado como límite.

### 2.2 Las dos consultas, y por qué son dos

En `lib/repositories/SaldosSatelitesRepository.ts` (nuevo, solo lecturas):

```ts
// (a) el dinero: una fila por zona
prisma.cierreBodega.groupBy({
  by: ["zonaId"],
  where: { estado: { not: "rechazado" } },
  _sum: { totalGeneral: true, montoRecibido: true },
});
// (b) la cola: una fila por zona, SOLO lo que sigue sin marcar
prisma.cierreBodega.groupBy({
  by: ["zonaId"],
  where: { conciliadoAt: null, estado: { not: "rechazado" } },
  _count: { _all: true },
  _min: { solicitadoAt: true },
});
```

Son dos porque **preguntan cosas distintas sobre poblaciones distintas**: (a) incluye lo ya conciliado
—sin ello la diferencia parcial de R18 desaparecería del saldo— y (b) solo lo pendiente, que es lo que
se cuenta y de lo que se mide la antigüedad. Un `groupBy` no hace agregados condicionales, y meterlo en
un `$queryRaw` con `FILTER (WHERE …)` cambiaría una consulta legible por una cadena SQL a mano en un
camino de dinero.

La resta se hace en el repositorio con `Prisma.Decimal` y sale como `.toFixed(2)` (money-safe: ni
`Number`, ni `parseFloat`, ni aritmética en el navegador — R20). `_sum.montoRecibido` ignora los `NULL`,
que es justo lo que la fórmula quiere. Los nombres de zona se resuelven en una tercera lectura sobre
`zona` (o un `include`), nunca en el cliente.

**Índices:** `cierre_bodega_zona_estado_idx (zona_id, estado)` sirve a las dos (§1.4). Volumen real:
32 filas en dos semanas, ~800 al año entre 5 satélites; el conjunto entero cabe de sobra.

### 2.3 Antigüedad (R21)

`diasSinConciliar = ` días naturales entre `_min.solicitadoAt` y hoy, calculado **en el servidor** con
el helper de calendario de Costa Rica que ya existe (`lib/utils/fecha-cr`). El DTO lleva el número y la
fecha; la pantalla no resta fechas. **Sin umbral, sin color, sin alerta** (Q6).

---

## 3. El bloqueo: la línea que cambia y el aviso que queda

### 3.1 La línea (D4)

`lib/repositories/OrdenRepository.ts`, `existeBodegaSateliteBloqueada`:

```ts
- bloqueada: porCierreBodega,
+ // FICHA 431: la consolidación pendiente de conciliar NO bloquea. `porCierreBodega` VIAJA IGUAL,
+ // como AVISO — el mismo trato que `porMensajeros` desde la 241.
+ bloqueada: false,
```

`porCierreBodega` se sigue calculando (`count` de `cierre_bodega` de la zona sin conciliar) y se sigue
devolviendo, más ahora su **número** (`consolidacionesSinConciliar`) para que el aviso pueda contar
(R2). **No viaja dinero por este contrato**: el importe vive en la pantalla propia de la satélite
(§6), y meter un `Decimal` en un DTO de bloqueo abriría una superficie de dinero donde no hace falta.

`bloqueada` **se conserva en `BodegaBloqueoResult`** aunque hoy sea siempre `false`, y el `if` de
`AsignacionSateliteService.asignar` con su desenlace `bodega_bloqueada` también. Es la lectura literal
de D4 —«se quita en UN solo sitio»— y deja el punto de entrada por si vuelve una causa. Para que un
campo constante no se convierta en un mentiroso mudo, el cambio se ancla con un test que afirma que
**hoy ninguna combinación de causas produce `bloqueada: true`** (`tasks.md` T9). El destino final de esa
rama muerta es Q4.

### 3.2 El aviso que queda

`app/(app)/recepcion-satelite/_components/asignacion-satelite-bloqueo.ts` gana un texto informativo, en
el molde del que ya existe para `porMensajeros`:

- se retira de la superficie del satélite `BODEGA_BLOQUEADA_POR_CIERRE_BODEGA`
  («Tu cierre de bodega hacia la central está pendiente de aprobación»), que ya no es cierto en ninguno
  de sus dos extremos;
- entra `CONSOLIDACIONES_SIN_CONCILIAR_TITULO(n)` — «Tenés N consolidaciones que la central todavía no
  marcó como recibidas.» — con el detalle «Podés seguir asignando órdenes con normalidad.»

Es el mismo patrón de `bodegaCierresAbiertosTitulo` + `BODEGA_CIERRES_ABIERTOS_DETALLE`: un aviso que
cuenta y no frena.

---

## 4. La escritura de la marca

### 4.1 Dos métodos, y por qué no uno

En `lib/repositories/CierresBodegaAdminRepository.ts` —donde ya viven **todas** las escrituras de
`cierre_bodega`; un segundo escritor de la misma tabla es como aparecen dos guardas que divergen—:

```ts
marcarConciliado(input: MarcarConciliadoInput): Promise<"updated" | "conflict" | "fuera_de_alcance">
revertirConciliacion(input: RevertirConciliacionInput): Promise<"updated" | "conflict" | "fuera_de_alcance">
```

**Dos métodos y no uno con un booleano**, y el motivo es una lección medida en este repo: la guardia
del censo de historial **mide por MÉTODO, no por escritura** (fichas 376 y 380). Con las dos acciones
dentro del mismo método, borrar uno de los dos `appendAccion` dejaría la guardia verde.

Cada uno abre su `$transaction` y va guardado por estado en el `WHERE` (patrón exacto de
`resolverCierreBodega`):

| | `WHERE` de la guarda | Escribe |
| --- | --- | --- |
| `marcarConciliado` | `{ id, estado: 'solicitado', conciliadoAt: null }` | `estado='aprobado'`, `conciliadoAt=now`, `conciliadoPor`, `montoRecibido`, `conciliadoNota`, **y `resueltoAt`/`resueltoPor` con los mismos valores** |
| `revertirConciliacion` | `{ id, estado: 'aprobado', conciliadoAt: { not: null } }` | `estado='solicitado'` y las seis columnas anteriores a `NULL` |

`count !== 1` → se distingue «ya estaba así» (`conflict`, R11) de «no existe» (`fuera_de_alcance`),
igual que hoy.

**Por qué `resuelto_at`/`resuelto_por` se mantienen en espejo:**
`ConciliacionCierresAnaliticaRepository.contarCierresPorEstado` selecciona los cierres **aprobados por
`resuelto_at`** dentro del rango. Si la marca no los rellenara, los cierres de bodega desaparecerían de
la analítica financiera sin que nada se pusiera rojo (R32 del listado de verificación). Son el espejo
heredado del acto; las columnas nuevas son las que llevan el **significado** y el monto.
**Consecuencia honesta y declarada:** revertir una marca **cambia hacia atrás** lo que la analítica
cuenta en ese periodo. Es lo correcto —no se recibió— y se escribe aquí para que no sorprenda.

### 4.2 La fila del historial, y la trampa que no caza ningún test de integración

Dentro de la **misma** `$transaction`, con `tx` y nunca con `this.prisma`:

```ts
const actor = await resolverActorCongelado(tx, input.actorUsuarioId);
await appendAccion(tx, [{
  accion: "cierre_bodega_conciliado",            // o "cierre_bodega_conciliacion_revertida"
  entidadTipo: "cierre_bodega",
  entidadId: id,
  entidadEtiqueta: etiquetaDeEntidad("cierre_bodega", { zonaNombre, fecha: solicitadoAt }),
  monto: montoRecibido,                          // Decimal
  ...actor,
}]);
```

⚠️ **`appendAccion(this.prisma, …)` en vez de `appendAccion(tx, …)` NO lo caza ningún test de
integración** —ahí `this.prisma` *es* el cliente de la transacción del test—. Lo único que lo caza es
la guardia estática `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`, que
exige forma `abre_tx` y que el `appendAccion` esté **dentro** del callback. Por eso los dos métodos
entran en su censo con entrada propia:

| tipos | archivo | método | forma | mutación exigida |
| --- | --- | --- | --- | --- |
| `cierre_bodega_conciliado` | `lib/repositories/CierresBodegaAdminRepository.ts` | `marcarConciliado` | `abre_tx` | `/tx\.cierreBodega\.updateMany\(/` |
| `cierre_bodega_conciliacion_revertida` | idem | `revertirConciliacion` | `abre_tx` | `/tx\.cierreBodega\.updateMany\(/` |

**El `monto` de la reversión es el monto que se está borrando.** Al revertir, la fila del historial es
el **único** sitio donde sobrevive cuánto se había dado por recibido: las columnas se vacían. Sin él, el
rastro diría «alguien deshizo algo» y no «alguien deshizo un recibido de ₡500.000».

**Catálogo** (`lib/types/historial-accion.ts`): los dos tipos entran en **`mueve_dinero`** (R17 de la
362 exige exactamente una categoría). No hacen un asiento, pero declaran que ₡X llegó o dejó de
haber llegado, y cambian el saldo que la central usa para perseguir efectivo; las otras dos categorías
—«hace desaparecer algo», «cambia quién puede hacer qué»— no describen esto en ningún sentido.
Etiquetas propuestas: **«Marcó recibida una consolidación de bodega»** y **«Revirtió la conciliación de
una consolidación de bodega»**. La nota **no entra** (R5 de la 362: texto libre).

### 4.3 Servicio y borde

- `lib/services/ConciliacionSatelitesService.ts` (nuevo) + `lib/interfaces/services/IConciliacionSatelitesService.ts`.
  Recibe por constructor un `Pick` de `ICierresBodegaAdminRepository` (las dos escrituras) y el
  `ISaldosSatelitesRepository` (las lecturas). Gate de rol **antes** de tocar el repo (`esAccesoTotal`),
  igual que `CierresBodegaAdminService`.
- Server Actions en `lib/actions/conciliacion-satelites.ts` (`'use server'`): mutaciones internas, no
  route handlers (`docs/architecture.md`).
- Validación zod en el borde reutilizando **`montoPositivoSchema`** de `lib/types/wallet.ts` relajado a
  `>= 0`… **no**: se usa `montoPositivoSchema` tal cual (**> 0**) y se declara: marcar «recibí ₡0» no
  es una marca, es no marcar. Reescribir la pieza de «cuánto dinero es válido» aquí sería la segunda
  definición que un día diverge (lección de la ficha 381). Si el humano quiere admitir `0`, se cambia
  la pieza compartida, no esta.

---

## 5. Permisos

| Quién | Ve `/wallet/satelites` | Marca / revierte | Ve el estado de SUS consolidaciones |
| --- | --- | --- | --- |
| `maestro`, `admin` (`esAccesoTotal`) | sí | sí | — |
| `adminSatelite` | **no** (`notFound`) | **no** | **sí**, solo lectura, solo su zona |
| resto | no | no | no |

- Las dos mitades del control, como en `/wallet/tiendas`: la página resuelve el rol server-side y hace
  `notFound()`, **y** el servicio responde `forbidden` por su cuenta (R27). Ocultar el botón no es un
  control por sí solo.
- `adminSatelite` ve sus consolidaciones **donde ya las ve hoy** —la pestaña de cierres de bodega de su
  propia pantalla, alimentada por `findCierresBodegaByZona`, acotada por zona en el `WHERE`—, con el
  vocabulario nuevo y dos columnas más (monto recibido, falta por recibir). No se le abre ninguna ruta
  nueva: quien entregó el dinero tiene derecho a saber si la central dijo que llegó, y esa asimetría
  de información es parte de lo que la ficha corrige.
- **No se cambia quién puede** respecto de hoy (Q3).

---

## 6. Rutas y contratos

### 6.1 Rutas

| Ruta | Quién | Qué hace |
| --- | --- | --- |
| `/wallet/satelites` | `esAccesoTotal` | Tabla de saldos por bodega satélite (R23) |
| `/wallet/satelites` → fila desplegada | `esAccesoTotal` | Desglose de consolidaciones de esa bodega + acciones (R24/R25) |

Ítem de menú en `lib/auth/menu-visibility.ts`, como tercer hijo de **Wallet** (`Caja principal`,
`Tiendas`, `Mensajeros`, **`Satélites`**), heredando `roles: ["maestro","admin"]` del padre.
**La pantalla pasa por `/design` antes de implementarse (D8).** Aquí se fija lo que hace; no cómo se ve.

### 6.2 Contratos de entrada/salida

Todo importe es **`string` de escala 2** en las dos direcciones. Ningún `number` de dinero cruza.

| Acción (`lib/actions/conciliacion-satelites.ts`) | Entrada (zod, `.strict()`) | Salida |
| --- | --- | --- |
| `listarSaldosSatelitesAction` | `{ page?, pageSize?, orden? }` | `{status:'ok', items: SaldoSateliteDTO[], total, page, pageSize}` \| `forbidden` \| `unauthenticated` \| `validation_error` |
| `listarConsolidacionesSateliteAction` | `{ zonaId: uuid, page?, pageSize?, soloSinConciliar?: boolean }` | `{status:'ok', items: ConsolidacionSateliteDTO[], total, …}` \| idem |
| `marcarConsolidacionRecibidaAction` | `{ cierreBodegaId: uuid, montoRecibido: string, nota?: string }` | `{status:'ok'}` \| `conflict` \| `no_encontrada` \| `forbidden` \| `validation_error` |
| `revertirConciliacionAction` | `{ cierreBodegaId: uuid }` | idem |
| `…CompletoAction` (×2, descarga) | los mismos filtros, sin paginar | `{status:'ok', items}` \| `limite_excedido` \| idem |

```ts
interface SaldoSateliteDTO {
  zonaId: string; zonaNombre: string;
  saldoSinConciliar: string;        // R17, ya cuadrado
  totalConsolidado: string;         // Σ total_general (no rechazadas)
  totalRecibido: string;            // Σ monto_recibido
  consolidacionesSinConciliar: number;      // R21
  diasDeLaMasAntigua: number | null;        // R21; null si no hay ninguna pendiente
  fechaDeLaMasAntigua: string | null;       // ISO
}

interface ConsolidacionSateliteDTO {
  cierreBodegaId: string;
  solicitadoAt: string;             // ISO
  totales: { efectivo: string; simpe: string; transferencia: string; general: string }; // R22
  montoRecibido: string | null;     // null = sin conciliar
  faltaPorRecibir: string;          // general − COALESCE(recibido,0), derivado en el servidor
  conciliado: boolean;              // = conciliadoAt !== null (R28 lo presenta con el vocabulario)
  conciliadoAt: string | null;
  conciliadoPorNombre: string | null;
  nota: string | null;
  cantidadCierres: number;
}
```

`faltaPorRecibir` **llega derivado del servidor** y no se resta en la pantalla: la identidad
`general − recibido = falta` es exactamente la clase de resta que la ficha 359 encontró rota en
13 pantallas, y por eso este par de cifras entra en
`tests/components/DineroIdentidadesEnPantalla.test.tsx` (`tasks.md` T22).

### 6.3 Descargas y censo

Las dos tablas nuevas son `<DataTable>` y por tanto **entran en el censo**
(`tests/unit/descarga/censo-tablas.ts`) como **`con_descarga`**, con el precedente literal de sus
gemelas de tiendas (`SaldosTiendasTable` y `DesgloseMovimientosTienda`): son libros de dinero paginados
en el servidor, y declararlas `fuera` exigiría un motivo que no existe. La nota (texto libre) **no baja
a la descarga**.

---

## 7. Vocabulario, y cómo se actualiza la guardia **aportando el dato**

`tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts` vigila las seis superficies del cierre
de bodega. La ficha **no afloja ninguna de sus afirmaciones**: le añade una cuarta y amplía las
anclas.

1. **Rótulos nuevos en `cierre-labels.ts`**, y su valor **escrito a mano** en el bloque
   «el VALOR de los rótulos» —nunca comparado contra su propia constante, que es siempre verde—:
   `PENDIENTE_CONCILIAR_LABEL` = «Pendiente de conciliar», `RECIBIDO_LABEL` = «Recibido»,
   `MONTO_RECIBIDO_LABEL` = «Monto recibido», `FALTA_POR_RECIBIR_LABEL` = «Falta por recibir»,
   `SIN_CONCILIAR_LABEL` = «Sin conciliar».
2. **Censo nuevo: el vocabulario de la aprobación no vuelve.** Un detector
   `APROBACION = /(?:Esperando aprobación|pendiente de aprobación|Aprobar cierre|Rechazar cierre|APROBAR_LABEL|RECHAZAR_LABEL|\bAprobado\b|\bRechazado\b)/u`
   aplicado a las mismas superficies, que debe salir **vacío**. Con su canario y su contraprueba en el
   caso «el detector marca el literal y NO marca el comentario», igual que `AJUSTES`.
3. **Autocomprobación ampliada:** `ROTULOS_NUEVOS` incorpora `PENDIENTE_CONCILIAR_LABEL` y
   `RECIBIDO_LABEL` y sigue exigiendo que el extractor los **encuentre** en más de una superficie. Si
   el barrido dejara de leer, el censo vacío del punto 2 sería un verde falso.
4. **Los cuatro archivos censados no se renombran** en esta ficha: un renombrado obligaría a tocar la
   lista `SUPERFICIES_ENTERAS` y esa es una discusión que no aporta nada aquí.

Las superficies nuevas de `/wallet/satelites` **no entran** en esta guardia (no son superficies del
cierre de bodega: son del wallet) y sí en la money-safe general y en el censo de tablas.

---

## 8. Alternativas descartadas

**A · Un ledger propio de satélites (`wallet_satelite_movimiento`), como el de tiendas.**
Descartada por el humano el 2026-09-15 y se respeta: 2 consolidaciones al día entre 5 satélites y cero
rechazos en dos semanas no describen un problema de asientos. Si las diferencias resultan ser
habituales, el ledger se añade **después sin rehacer las pantallas**, porque la vista ya estará hecha y
el DTO ya distingue total, recibido y diferencia.

**B · Un estado `conciliado` en el enum `cierre_estado`.**
Es la forma «natural» y es la que D3 prohíbe: el enum lo comparten `cierre_dia` y `cierre_bodega`, así
que inventarle un estado a la consolidación **se lo inventa también al cierre del mensajero**, donde no
significa nada, y obliga a revisar cada `WHERE` que hoy enumera estados en los dos niveles.

**C · Dejar el índice único parcial y que la satélite espere para volver a consolidar.**
Es el cambio más pequeño posible y **reintroduce el mismo bloqueo en otro sitio**: la satélite podría
asignar pero no cerrar, que es literalmente el título de la ficha. Además, la espera pasaría de 34
minutos (mirar una pantalla) a lo que tarde el efectivo en viajar. Descartada; §1.3.

**D · Reusar `resuelto_at`/`resuelto_por` como «cuándo/quién marcó» y añadir solo `monto_recibido`.**
Dos columnas menos y ninguna duplicación aparente. Descartada por dos motivos: (i) en los 32 históricos
`resuelto_*` guarda un acto que **no era** una conciliación, y confundirlos borra la única forma de
distinguir «aprobado bajo el régimen anterior» de «alguien contó el dinero»; (ii) la reversión tendría
que vaciar `resuelto_*`, que es lo que la analítica usa para fechar el cierre, y el efecto colateral
quedaría escondido en una columna que significa otra cosa. Con columnas propias, el espejo de §4.1 es
**explícito y está escrito**.

**E · Que consolidar cree la consolidación ya marcada como recibida (auto-conciliada) y la central solo
corrija las que no cuadren.**
Quita trabajo a la central y **pone el saldo en cero por defecto**: el día que un bulto no llega, no hay
ninguna señal, porque nadie tiene que hacer nada para que el sistema diga que llegó. Descartada: el
valor entero de esta ficha es que el dinero en tránsito **se vea**, y un valor por defecto optimista lo
hace invisible.

**F · Retirar el desenlace `bodega_bloqueada` y el campo `bloqueada` del contrato.**
Dejaría el árbol sin código muerto y el compilador haría la migración por nosotros. Descartada **en
esta ficha** porque D4 dice «se quita en UN solo sitio» y porque el diff se comería cinco archivos de
frontend y siete de test en una ficha de dinero. Queda como Q4, anclada con el test de §3.1 para que el
`false` constante no pase por una verdad medida.

---

## 9. Estrategia de verificación (condición D9)

**Nada de esto se da por bueno con dobles.** Lo que vive en el `WHERE`, en un `CHECK` o en una
migración se prueba donde vive:

| Qué | Cómo | Por qué no basta lo de siempre |
| --- | --- | --- |
| R15 (el estado incoherente) | Integración contra Postgres: intentar `estado='aprobado'` sin marca, y marca sin `aprobado`; las dos deben fallar | Un `CHECK` no existe para los dobles de test |
| R7 (consolidación parcial) | Integración: dos consolidaciones concurrentes sobre la misma cola | El servicio con dobles pasa en verde con la carrera perdida |
| R17/R18 (el saldo) | Integración con filas reales: sin marcar, marcada completa, marcada por menos, rechazada | «Probar el `WHERE` donde vive»: una mutación del `where` pasa los tests de servicio |
| R30 (el backfill) | Medición en producción **en solo lectura antes** de desplegar (T0) y después (T25), comparando `updated_at` | Un backfill se mide, no se razona |
| R13 (el rastro) | Guardia estática del censo + integración | `this.prisma` en vez de `tx` **no lo caza la integración** |
| R1/R4 (el bloqueo) | Unitario en repo y servicio, **más** la mutación que lo mata | El test que hoy fija el bloqueo hay que cambiarlo a propósito, no de pasada |
| R28 (vocabulario) | Guardia de vocabulario ampliada (§7) | El compilador no ve literales ni ausencias |

Además, y porque esto **quita un control de dinero**:

1. **Las mutaciones obligatorias** (`tasks.md` T24): cinco, cada una con su rojo esperado escrito. Un
   arnés de mutaciones que reporta supervivientes sin haber ejecutado un test ya pasó en este repo: se
   exige la salida del test, no el veredicto.
2. **Los cinco archivos de test que hoy fijan el bloqueo** se enumeran en `tasks.md` T9 y se tocan
   **uno a uno, a propósito**. Si durante la implementación cambia alguno que no está en esa lista, se
   tocó lo que no era.
3. **`./init.sh` completo, con `.env`**, y se miran los `skipped`: un gate sin base salta 78 archivos
   de `integration/db` y aun así dice «OK».
4. **Ver la aplicación** con las dos pantallas y los dos roles antes de dar la ficha por cerrada.

---

## 10. Lo que este diseño NO toca

`cierre_estado` · `cierre_dia` y todo el nivel 1 · los totales snapshot y las cascadas de las fichas
393/396 · `wallet_movimiento`, `wallet_tienda_movimiento` y `pago_mensajero_movimiento` ·
`CuentasPorPagarAnaliticaRepository` y `RecaudoAnaliticaRepository` (medido: **no** referencian el
nivel 2) · el gate de nivel 1 que impide consolidar con cierres de mensajero sin resolver · el CRUD de
zonas · los `down.sql` anteriores.
