# Round-trip real de la migración de la 155 — `20260729140000_order_status_retiro_en_fulfillment`

> **Ejecutado el 2026-07-29 por el leader**, en el worktree `.claude/worktrees/lote-135`
> (rama `feature/155-creacion-bifurcada`), contra **Postgres local**: `localhost:5432`, base
> `ordenex`. **Producción no se tocó en ningún momento.**
>
> Esto **no** es un resultado reportado por un tercero: los números de abajo se midieron aquí,
> con los comandos que se citan. El destino se verificó antes de ejecutar nada con
> `prisma migrate status` (solo lectura), que imprime el host sin exponer la credencial.
>
> Corrió **en paralelo** a la fase frontend, que por eso declara esta deuda como viva en
> `progress/impl_155.md` §7.4. Esa entrada queda reconciliada contra este archivo.

## Por qué esta migración y no otra

Es la única del lote que **mueve datos**: reasigna las órdenes que sigan en `en_fulfillment` a
`en_preparacion`, deja un rastro de historial por orden y retira el value del catálogo de forma
condicional. Las demás del lote son DDL o aditivas. Cierra la deuda que `progress/current.md`
declaraba así: *«el round-trip real de migraciones contra Postgres NO EXISTE (…) los cuatro
`.sql` están leídos y asertados por regex, nunca ejecutados»*.

## La base local resultó ser el escenario correcto

| dato de partida | valor |
|---|---|
| órdenes en `en_fulfillment` | **47** (0 borradas lógicamente) |
| órdenes en `en_preparacion` | 3 |
| filas de historial que referencian `en_fulfillment` como destino | 47 |
| historial total | 108 |
| filas del catálogo `order_status` | 21 (20 del código + `pendiente`, huérfano ya documentado por la 154) |

Dos consecuencias que hacen que este round-trip valga:

1. **El backfill tiene trabajo real que hacer** (47 órdenes). Es exactamente la mitad de datos
   que al round-trip de la 159 le faltó y que dejó su T4 sin marcar.
2. **El paso 3 del UP es NO-OP**: hay 47 filas de historial referenciando el value, así que el
   `DELETE` condicional no lo borra y la fila **sobrevive**, inalcanzable desde la aplicación.
   Es la rama que se dará en **producción** — no la de base limpia.

## Fase 1 — ensayo con aserciones, dentro de una transacción revertida

UP y DOWN ejecutados **de verdad** contra el esquema real (el planificador los valida y los
aplica), en una transacción con `ROLLBACK` al final: nada persistió. `UP = 3` sentencias,
`DOWN = 3` sentencias — coincide con lo que declaran sus cabeceras.

| | base | tras UP | tras 2.º UP | tras DOWN |
|---|---|---|---|---|
| órdenes en `en_fulfillment` | 47 | 0 | 0 | 47 |
| órdenes en `en_preparacion` | 3 | 50 | 50 | 3 |
| filas de rastro | 0 | 47 | 47 | 0 |
| historial total | 108 | 155 | 155 | 108 |
| catálogo (total / tiene `en_fulfillment`) | 21 / sí | 21 / **sí** | 21 / sí | 21 / sí |

Aserciones que pasaron, con el requisito que cubren:

- **R34** — ninguna orden queda en `en_fulfillment`; las 47 llegan a `en_preparacion`.
- **R35** — una fila de rastro por orden movida (47), y **bien formada**: sin actor
  (`actor_usuario_id IS NULL`, R21 de la feature 49), familia `ajuste_estado`, origen
  `en_fulfillment` → destino `en_preparacion`.
- **R37** — con historial real el value **sobrevive** y el catálogo no pierde ninguna fila.
- **Idempotencia (T5.1)** — la segunda pasada del UP afecta **0 filas en los tres pasos** y el
  rastro no se duplica. Medido, no leído.
- **R38 (T5.2)** — el DOWN devuelve las 47 órdenes a `en_fulfillment`, `en_preparacion` a 3, borra
  el rastro y deja el historial en 108.
- **R34/R40** — **ninguna columna de `orden` cambió salvo `estatus_id`**, ida y vuelta. Se midió
  con `md5(string_agg((to_jsonb(o) - 'estatus_id')::text, ',' ORDER BY o.id))` sobre **toda** la
  tabla: cubre todas las columnas de todas las filas sin nombrarlas una a una, así que también
  cubre `num_guia`, `mensajero_asignado_id`, `prioridad` y `updated_at`.
- **R38** — el historial **preexistente** quedó intacto (checksum de los ids que no son rastro).

## Fase 2 — verificación por mutación

Un round-trip que solo sale verde no demuestra que **discrimine**. Tres mutaciones, aplicadas
**en memoria** (los `.sql` del repo no se tocaron):

| mutación | resultado | qué demuestra |
|---|---|---|
| el DOWN deja de filtrar por el rastro | **ROJO** (vuelven 50 en vez de 47; `en_preparacion` queda en 0 en vez de 3) | El filtro del rastro es la razón de ser del paso 2 del DOWN, y el arnés lo caza. Sin rastro, el rollback arrastraría las 3 órdenes que ya estaban en `en_preparacion` antes de la migración. |
| el UP también pisa `updated_at` | **ROJO** en el checksum | El checksum de «solo cambió `estatus_id`» **es sensible**; no es una aserción vacía. |
| el UP también pisa `num_guia` | **SOBREVIVIÓ** | **Mutación vacía, no agujero.** Las 47 órdenes tienen `num_guia` y `mensajero_asignado_id` en NULL (medido: 0 de 47 con valor), así que `SET num_guia = NULL` no cambia dato. No confirma ni desmiente nada; se registra para que nadie la cuente como cobertura. Que estén en NULL es coherente con el dominio: `en_fulfillment` es anterior a la guía. |

## Fase 3 — round-trip PERSISTIDO, por la herramienta real del repo

Es el tramo que ejercita el bookkeeping de `_prisma_migrations` — exactamente donde falló el
primer intento del round-trip de la 159.

```
npx prisma migrate deploy --schema db/schema.prisma   # UP real
pnpm db:rollback                                       # DOWN real (scripts/db-rollback.ts)
npx prisma migrate deploy --schema db/schema.prisma   # re-aplicación
```

| estado persistido | `en_fulfillment` | `en_preparacion` | rastro | historial | catálogo | `_prisma_migrations` | checksum vs base |
|---|---|---|---|---|---|---|---|
| 0. base | 47 | 3 | 0 | 108 | 21 / sí | 0 | — |
| 1. tras UP real | **0** | **50** | **47** | **155** | 21 / **sí** | **1** | **igual** |
| 2. tras `pnpm db:rollback` | **47** | **3** | **0** | **108** | 21 / sí | **0** | **igual** |
| 3. tras re-aplicar | **0** | **50** | **47** | **155** | 21 / sí | **1** | **igual** |

Los tres pasos dieron **exactamente** los números que el ensayo había predicho. Tras el paso 2,
`prisma migrate status` volvía a listar la migración como pendiente (el rollback borra su fila de
`_prisma_migrations`, como documenta `scripts/db-rollback.ts`); tras el paso 3, **«Database schema
is up to date!»**.

**Estado final de la base local: migración APLICADA.** No es una preferencia: el código de esta
rama ya no conoce `en_fulfillment`, y la guardia de transiciones de la feature 140 falla
**CERRADO**, así que una orden que se quedara en ese estado no tendría **ninguna** salida legal.
Dejarla sin aplicar rompe el desarrollo local.

## Lo que este round-trip NO demuestra

Dicho para que nadie lo lea como más de lo que es:

1. **La rama de base limpia del paso 3 del UP no se ejercitó.** Aquí el `DELETE` del catálogo fue
   NO-OP por el historial. En una base sin ese historial (CI, dev recién sembrada) sí borraría la
   fila, y ese camino no se corrió. Es la rama *menos* riesgosa de las dos, y la que no aplica a
   producción, pero no está medida.
2. **No se probó contra el volumen de producción.** 67 órdenes y 108 filas de historial en local;
   producción tiene más. No es un problema de correctitud —el UP es un `UPDATE` por `estatus_id` y
   un `INSERT ... SELECT`—, pero el tiempo de ejecución real allí no se conoce.
3. **`num_guia` / `mensajero_asignado_id` en filas con valor:** el checksum los cubre y salió
   igual, pero el dataset no tiene ninguna orden en `en_fulfillment` con esos campos poblados, así
   que la combinación no se ejercitó. Por dominio no debería existir.
4. **R40 (efectos de negocio) no se midió aquí.** Que el backfill no encole webhooks ni jobs lo
   sostiene T5.4 por test, más el argumento estructural de que es SQL puro que no pasa por
   `appendCambioEstado`. Este round-trip no consultó las colas.

## Efecto en el tren 154 + 155 + 156

La deuda que `progress/current.md` declaraba —*«el round-trip real de migraciones contra Postgres
NO EXISTE (…) se salda antes de que el tren suba a `prod`»*— queda **saldada para la migración de
la 155**, que es la única del tren que mueve datos. Las de la 154 son aditivas de catálogo y enum.

**Ya no es un estreno en producción:** el UP y el DOWN de esta migración se han aplicado de verdad,
por el camino de deploy real, sobre 47 órdenes, y el rollback devolvió la base al estado de
partida, checksum incluido.
