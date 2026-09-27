# Ficha 461 — Diseño técnico

> **Búsqueda.** MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) para localizar los
> escritores y consumidores, y **cada símbolo confirmado en el archivo real** el 2026-09-25 sobre `dev`
> (`e33abeee`). Las referencias `archivo:línea` son de esa lectura. El índice del grafo está rancio para
> la 459 (no ve `invariante-tiendas.ts` ni los servicios nuevos); todo lo de la 459 se leyó del disco.
> Las cifras de producción son las de `progress/contraste_459.md` (línea base del 2026-09-24) y son una
> **foto**: el contraste de §13 las vuelve a medir.

## 0. En una frase

El cobro a una tienda deja de ser un débito huérfano y pasa a ser un **cargo** como los fletes de la 459:
una línea propia en la caja que **sube la ganancia y baja «De las tiendas» sin tocar «Entró»**; gana una
**anulación** uniforme (motivo, contra-asientos en los dos libros); la invariante R8 **pierde su
excepción**; los cobros ya registrados sin línea la reciben por una **migración de datos** idempotente y
reversible; y **todos los conceptos de la wallet se renombran** desde Ordenex diciendo quién le paga a
quién, con su lectura en segunda persona en `/mi-wallet`. La ayuda y el asistente se actualizan aquí.

**Principio rector:** arreglar lo evidenciado con las piezas que la 459 ya dejó (liquidez «cargo»,
documento con anulación propia, `down` dinámico, guardias de clasificación), no rediseñar el dinero. Los
saldos de las tiendas, los mensajeros y todos los caminos de escritura que no son el cobro quedan como están;
la fase 0 lo fija con literales y mutaciones antes de tocar nada.

## 1. Lo medido

### 1.1 El cobro hoy (código)

- `lib/services/CobroTiendaService.ts:115-141` escribe UNA fila `debito/cobro_manual` (origen `manual`,
  `origen_id: null`, `fechaMovimiento` solo si el día no es hoy) y su historial
  (`WalletTiendaMovimientoRepository.registrarCobroEnHistorial`, `:347-369`). El constructor (`:67-71`) no
  recibe ningún puerto de caja **a propósito** (comentario `:49-51`, D1/R24 de la 381), y el composition
  root `buildCobroTiendaService` (`lib/actions/wallet-tienda.ts:148-155`) tampoco lo inyecta.
- `lib/interfaces/services/ICobroTiendaService.ts:44-57`: un solo método; «no hay ni debe haber ningún
  método para editar, borrar ni reversar un cobro» (R22 de la 381, D3). Esta ficha lo reabre por decisión
  del humano (HD1).
- `lib/utils/invariante-tiendas.ts:69`: `cobro_manual: SIN_CONTRAPARTIDA` (HF6). La guardia
  `tests/unit/guards/caja-clasificacion-459.guardia.test.ts:95-101,145-153` fija como **contrato** que el
  conjunto sin contrapartida es exactamente `{ajuste_debito, cobro_manual}`.
- `lib/utils/caja-tesoreria.ts:110-134`: `LIQUIDEZ_POR_CATEGORIA` con exactamente seis `cargo_a_tienda`;
  `acumular` (`:156-192`) suma **todo** egreso a `salidas`. `derivarCaja` (`:272-323`): cuatro
  `derivarBalance`, `terceros = derivarBalance(ingT, egT + cargos)`.
- `tests/integration/db/caja-invariante-tiendas.test.ts:306-315`: afirma
  `Δ deTerceros = Σ saldos + cobrosNoReclasificados` (la excepción, con el cobro de la tienda B en
  `2500.50`) y reclasifica ese mismo cobro con el SQL real de la 459 en su paso 6.
- Textos: `CAJA_RESUMEN_AVISO_TERCEROS` (`wallet-labels.ts:154-155`) dice «Los cobros de un costo a una
  tienda bajan su saldo sin pasar por la caja»; `FRASE_DEL_EFECTO.cobro_tienda`
  (`wallet-conceptos-manuales.ts:234-235`) dice «No sale ni entra dinero… La caja y la ganancia no
  cambian»; el grupo del selector es «No mueve la caja» (`:110`); la ayuda lo repite
  (`docs/ayuda/oficina/wallet-caja.md:75-76,110-136`, `wallet-tiendas.md:45-59`, `tienda/mi-wallet.md:45,64`).

### 1.2 Producción (foto del 2026-09-24, `progress/contraste_459.md`)

Σ saldos −4.780.583,97 · cobros de un costo 203 / 25.769.034,50, **todos** en la lista aprobada de la 459
(su migración `20260925120300_reclasificar_cobros_459` los reclasifica al desplegar) · `diferencia_r8` y
`diferencia_r7` 0,00 · C2 sin filas. **Candidatos al backfill de esta ficha esperados en producción: 0.**
Cualquier cobro que se registre en producción entre hoy y el despliegue (la 459 no está desplegada, así
que el servicio viejo sigue vivo) SÍ será candidato; por eso R38 mide antes de desplegar y no da el cero por
supuesto (lección «una imposibilidad razonada no es medida»). En local y preview hay candidatos (el cobro de
42.000 del humano, los de los tests).

### 1.3 Lo que está bien y se conserva

Todo lo de la 459 salvo la excepción de R8 y los textos; el saldo de cada tienda (el cobro ya lo bajaba
bien); la ganancia, la composición y los mensajeros para conjuntos sin cobros; la reclasificación de los 203
(su migración está aplicada en `dev` y **no se edita**: lección «migración editada en sitio = drift»).

## 2. El modelo: el cobro es un cargo, su anulación es un reverso de cargo

### 2.1 Qué es cada cosa

| Movimiento | Libro | Tipo · categoría | Dueño | Liquidez | Entró | Salió | Ganancia | De las tiendas | Saldo tienda |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cobro (débito) | tienda | `debito · cobro_manual` (existe) | — | — | — | — | — | — | −M |
| **Línea del cobro** | caja | `ingreso · ingreso_cobro_tienda` **nuevo** | propio | **cargo** | 0 | 0 | **+M** | **−M** | — |
| Anulación (crédito) | tienda | `credito · cobro_tienda_anulado` **nuevo** | — | — | — | — | — | — | +M |
| **Reverso del cargo** | caja | `egreso · egreso_reverso_cobro_tienda` **nuevo** | propio | **cargo** | 0 | 0 | **−M** | **+M** | — |

Es exactamente el patrón del flete (débito espejo + ingreso propio «cargo»), con su reverso. El dinero no
entra ni sale de la caja: cambia de bolsillo dentro de ella (de las tiendas a Ordenex), o, si la tienda no
tenía saldo, nace una deuda de la tienda que se cobra reduciendo su saldo (HF3).

### 2.2 La derivación (`lib/utils/caja-tesoreria.ts`), sin una resta nueva

1. `LIQUIDEZ_POR_CATEGORIA` gana `ingreso_cobro_tienda: "cargo_a_tienda"` y
   `egreso_reverso_cobro_tienda: "cargo_a_tienda"`. **La liquidez «cargo» pasa a valer para egresos**: un
   egreso «cargo» es el reverso de un cargo (P1). `NATURALEZA_POR_CATEGORIA`: los dos `propio`.
2. `acumular` gana una cubeta `reversosDeCargos`. Solo suma:
   - ingreso + cargo → `cargosATiendas`; ingreso + efectivo → `entradasEfectivo`; ambos → dueño.
   - egreso + cargo → `reversosDeCargos` (**no** `salidas`); egreso + efectivo → `salidas`; ambos → dueño.
3. `derivarCaja` sigue con **cuatro** `derivarBalance` (la guardia `caja-derivaciones.guardia.test.ts` no
   cambia): `caja = (entradasEfectivo, salidas)`, `propio = (ingP, egP)`,
   **`terceros = (ingT + reversosDeCargos, egT + cargos)`**, `capital = (ingC, egC)`.
4. Identidad R7 por construcción: G + T + C = (ingP − egP) + (ingT + rev − egT − cargos) + (ingC − egC) =
   (ingP + ingT + ingC − cargos) − (egP + egT + egC − rev) = Entró − Salió. Vale con filtros o sin ellos.

### 2.3 La invariante R8, ahora sin excepción

Con S = Σ saldos y T = «De las tiendas»:

| Libro de tiendas | Contrapartida en la caja | S | T |
| --- | --- | --- | --- |
| `cod_recaudado` | `ingreso_cod_recaudado` | + | + |
| `ajuste_credito` | `ingreso_reverso_pago_tienda` | + | + |
| `pago_por_cuenta_anulado` | `ingreso_reverso_pago_por_cuenta_tienda` | + | + |
| **`cobro_tienda_anulado`** | **`egreso_reverso_cobro_tienda`** (reverso de cargo) | + | + |
| 6 cargos del feed | 6 `ingreso_*` cargos | − | − |
| **`cobro_manual`** | **`ingreso_cobro_tienda`** (cargo) | − | − |
| `pago_tienda` | `egreso_pago_tienda` | − | − |
| `pago_por_cuenta` | `egreso_pago_por_cuenta_tienda` | − | − |
| `ajuste_debito` | ninguna (sin productor en el árbol) | − | 0 |

`T − S = Σ ajuste_debito (0 en producción) + (Σ cargos de la tienda − Σ cargos de la caja)`. El único
término de la 459 que desaparece es «Σ cobros sin reclasificar»: (a) los cobros nuevos escriben su cargo en
la misma transacción; (b) los 203 reclasificados tienen su `egreso_pago_por_cuenta_tienda` (mismo efecto
−M en T); (c) los demás cobros previos reciben su cargo por la migración de §12. **Ese es todo el
argumento**, y lo comprueban: la guardia de §14.3 (por categoría), el test de integración de la invariante
(por filas, tras cada paso) y el contraste de §13 (en producción).

### 2.4 Demostración con la foto de producción

Sin candidatos al backfill (esperado), ninguna cifra de producción cambia al desplegar esta ficha sobre la
459: cifra −9.186.220,50 · ganancia −4.405.636,53 · «De las tiendas» −4.780.583,97 = Σ saldos ·
`diferencia_r8` 0,00.

Con K candidatos por Σ (cobros registrados con el servicio viejo entre la foto y el despliegue), **antes**
de esta ficha: sus débitos ya bajaron Σ saldos (S = S₀ − Σ) y la caja no los tiene, así que T − S = Σ (la
excepción de la 459, todavía válida). **Después** del backfill: cada cargo aporta +Σ a la ganancia y −Σ a
«De las tiendas», y nada a «Entró»/«Salió»:

| | Antes (459) | Después (461) |
| --- | --- | --- |
| Ganancia | G₀ | **G₀ + Σ** |
| «De las tiendas» | S₀ | **S₀ − Σ = S** (= Σ saldos) |
| Σ saldos de tiendas | S₀ − Σ | S₀ − Σ |
| Cifra principal, «Entró», «Salió», capital | sin cambio | **sin cambio** |
| `diferencia_r8` = T − S | Σ | **0,00** |
| `diferencia_r7` | 0,00 | **0,00** |

Eso es lo que el contraste de §13 exige: `ganancia_despues = ganancia_antes + Σ`, `de_tiendas_despues =
suma_saldos`, `cifra_despues = cifra_antes`, `diferencia_r7 = 0,00`. Con Σ = 0 todo es idéntico.

### 2.5 Ejemplo del humano (42.000 en preview)

Cobro de 42.000 a una tienda con saldo a favor 100.000: saldo → 58.000; línea de caja «Ordenex le cobra a
una tienda» 42.000 (Ingreso, dueño Ordenex); ganancia +42.000; «De las tiendas» −42.000; «Entró» y la
cifra principal iguales. Anularlo: crédito 42.000 a la tienda («Cobro de Ordenex a la tienda anulado»),
egreso 42.000 en la caja («Cobro a una tienda anulado»), ganancia −42.000, «De las tiendas» +42.000,
«Salió» igual.

## 3. Modelo de datos y migraciones

Todas a mano (`db:migrate:create` falla con P3006). **Antes de fijar los timestamps mirar `origin/dev`**
(colisión de ids entre sesiones); el último conocido es `20260925120300_reclasificar_cobros_459`. Nombres
propuestos (posteriores a todo lo de `dev` el día que se escriban):

1. `20260926120000_cobro_tienda_461_enums`
2. `20260926120100_cobro_tienda_461_anulacion_y_checks`
3. `20260926120200_cobro_tienda_461_completar_caja` (datos)

El reparto es obligatorio: Postgres prohíbe usar un valor de enum en la transacción que lo añade (55P04) y
los CHECK y el backfill nombran los valores nuevos. Orden de reversión: 3 → 2 → 1.

### 3.1 Migración 1 — valores de enum

| Enum | Valor nuevo |
| --- | --- |
| `wallet_movimiento_categoria` | `ingreso_cobro_tienda`, `egreso_reverso_cobro_tienda` |
| `wallet_tienda_movimiento_categoria` | `cobro_tienda_anulado` (crédito) |
| `wallet_origen_tipo` | `cobro_tienda` (las líneas del servicio, cargo y reverso), `cobro_tienda_completado` (las del backfill) |
| `historial_accion_tipo` | `cobro_tienda_anulado` |

`ALTER TYPE … ADD VALUE IF NOT EXISTS`. **`down.sql`:** la función dinámica de la 459
(`db/migrations/20260925120000_caja_459_enums/down.sql:35-146`, `quitar_valores_de_enum_459`) copiada tal
cual y renombrada `_461`, aplicada a los **cuatro** tipos con sus valores. Ya cubre la precondición ruidosa
(una fila que use un valor → RAISE sin borrar), los CHECK e índices que nombran el tipo por texto y los
DEFAULT. Ningún `down.sql` previo se toca.

### 3.2 Migración 2 — la tabla de anulación y los dos CHECK

**`cobro_tienda_anulacion`** (molde: `pago_por_cuenta_tienda_anulacion`,
`20260925120200_pago_por_cuenta_y_capital/migration.sql:35-43,73,80-81,95-96,111`):

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | text PK | uuid |
| `cobro_id` | text NOT NULL **UNIQUE** FK → `wallet_tienda_movimiento(id)` RESTRICT | el débito `cobro_manual` |
| `motivo` | text NOT NULL | CHECK `btrim(motivo) <> ''` |
| `anulado_por` | text NOT NULL FK → `usuario(id)` RESTRICT | |
| `created_at` | timestamp(3) DEFAULT now() | |

«Anulado» se deriva de que exista la fila. RLS habilitada sin policies (R64). La FK apunta a una fila del
libro (inmutable, nunca se borra): no hay documento aparte del cobro porque el cobro **es** la fila del
libro (381, D2), y crear uno ahora obligaría a un backfill de documentos para los cobros viejos.

**Los dos CHECK tipo↔categoría**, recreados como ampliación (la lista nueva contiene a la vieja; ninguna
fila previa puede fallar). Listas de partida: las de la 459 (`…_pago_por_cuenta_y_capital/migration.sql:117-138`):

```sql
-- caja
("tipo" = 'ingreso' AND "categoria" IN (…los once de la 459…, 'ingreso_cobro_tienda'))
OR ("tipo" = 'egreso' AND "categoria" IN (…los diez de la 459…, 'egreso_reverso_cobro_tienda'))
-- tienda
("tipo" = 'credito' AND "categoria" IN ('cod_recaudado','ajuste_credito','pago_por_cuenta_anulado','cobro_tienda_anulado'))
OR ("tipo" = 'debito' AND "categoria" IN (…los diez de la 459…))
```

**`down.sql`:** `DO` que hace RAISE si `cobro_tienda_anulacion` tiene filas o si algún movimiento usa una
categoría nueva (los CHECK viejos fallarían igual, pero el mensaje debe decir qué pasa); los dos CHECK
vuelven a las listas de la 459; `DROP TABLE cobro_tienda_anulacion`.

### 3.3 Migración 3 — completar la caja de los cobros previos (datos)

Plantilla (molde: `20260925120300_reclasificar_cobros_459/migration.sql`, un solo bloque `DO`):

```sql
DO $$
DECLARE
  n_candidatos integer; suma_candidatos numeric(14,2);
  n_escritas integer;   suma_escrita numeric(14,2);
BEGIN
  DROP TABLE IF EXISTS pg_temp.candidatos_461;
  CREATE TEMP TABLE candidatos_461 ON COMMIT DROP AS
  SELECT m.id, m.tienda_id, m.monto, m.descripcion, m.registrado_por, m.fecha_movimiento
  FROM wallet_tienda_movimiento m
  WHERE m.categoria::text = 'cobro_manual' AND m.tipo::text = 'debito'
    -- R32: ni los reclasificados por la 459…
    AND NOT EXISTS (SELECT 1 FROM wallet_movimiento w
                    WHERE w.origen_id = m.id AND w.origen_tipo::text = 'cobro_manual_reclasificado')
    -- …ni los que ya tienen su cargo, con cualquiera de los dos origenes.
    AND NOT EXISTS (SELECT 1 FROM wallet_movimiento w
                    WHERE w.origen_id = m.id AND w.categoria::text = 'ingreso_cobro_tienda');

  SELECT count(*), coalesce(sum(monto), 0) INTO n_candidatos, suma_candidatos FROM candidatos_461;
  IF n_candidatos = 0 THEN
    RAISE NOTICE '461: ningun cobro sin linea de caja; no se escribe nada';   -- R35
    RETURN;
  END IF;

  INSERT INTO wallet_movimiento
    (id, tipo, categoria, monto, origen_tipo, origen_id, descripcion, registrado_por, fecha_movimiento, created_at)
  SELECT gen_random_uuid()::text, 'ingreso', 'ingreso_cobro_tienda', c.monto,
         'cobro_tienda_completado', c.id,
         concat_ws(' · ', <nombre de la tienda, misma composicion que la migracion de la 459>, c.descripcion),
         c.registrado_por,                     -- la persona que registro el cobro
         c.fecha_movimiento,                   -- R31: el mismo instante
         CURRENT_TIMESTAMP
  FROM candidatos_461 c JOIN usuario u ON u.id = c.tienda_id
  ON CONFLICT ("origen_tipo", "origen_id", "categoria") WHERE "origen_id" IS NOT NULL DO NOTHING;  -- R33

  SELECT count(*), coalesce(sum(w.monto), 0) INTO n_escritas, suma_escrita
  FROM wallet_movimiento w JOIN candidatos_461 c ON c.id = w.origen_id
  WHERE w.origen_tipo::text = 'cobro_tienda_completado' AND w.categoria::text = 'ingreso_cobro_tienda';
  IF n_escritas <> n_candidatos OR suma_escrita <> suma_candidatos THEN
    RAISE EXCEPTION '461: escritas % por %, candidatos % por %', n_escritas, suma_escrita, n_candidatos, suma_candidatos;  -- R34
  END IF;
  RAISE NOTICE '461: % cobros completados en la caja por %', n_escritas, suma_escrita;
END $$;
```

**`down.sql`** (R36): `DO` que hace RAISE si alguna línea `cobro_tienda_completado` tiene un
`egreso_reverso_cobro_tienda` con el mismo `origen_id` (ya se anuló: borrar el original dejaría el reverso
huérfano y rompería R8); si no, `DELETE FROM wallet_movimiento WHERE origen_tipo = 'cobro_tienda_completado'
AND categoria = 'ingreso_cobro_tienda'`. Es la segunda excepción a «el libro no se borra», y existe solo como
reverso de esta migración (la primera es la de la 459).

**Sin historial:** una migración no tiene actor; el rastro es el origen `cobro_tienda_completado`, el
`NOTICE` con número y suma (el leader lo copia a `progress/contraste_461.md`) y esta cabecera.

**`db/schema.prisma`:** los cuatro enums, el modelo `CobroTiendaAnulacion` (relación `cobro` →
`WalletTiendaMovimiento`, `anulador` → `Usuario`), la inversa opcional en `WalletTiendaMovimiento` y en
`Usuario`. Sin drift (procedimiento de la 381). **Migraciones y `schema.prisma` obligan al gate completo.**

## 4. Clasificación de los conceptos nuevos (todos los `Record` y listas)

| Concepto | Libro / tipo | Dueño | Liquidez | Composición | `aporte-por-orden` | Cubeta tienda |
| --- | --- | --- | --- | --- | --- | --- |
| `ingreso_cobro_tienda` | caja / ingreso | propio | cargo | fila de ingresos (`WALLET_INGRESO_PROPIO_SEED` +1 → 8) | `sin_reparto / no_nace_de_un_cierre` | — |
| `egreso_reverso_cobro_tienda` | caja / egreso | propio | cargo | fila de egresos nombrada (`WALLET_EGRESO_NOMBRADO_SEED` +1 → 3) | idem | — |
| `cobro_tienda_anulado` | tienda / crédito | — | — | — | idem | `aFavor` (como `ajuste_credito`) |
| origen `cobro_tienda` | caja y tienda | | | | | |
| origen `cobro_tienda_completado` | caja | | | | | |

Lista de lo que se toca (el compilador obliga en los marcados con *; los demás llevan test porque no obligan):

- `lib/types/wallet.ts` — `WALLET_MOVIMIENTO_CATEGORIA_SEED`*, `WALLET_ORIGEN_TIPO_SEED`*,
  `WALLET_INGRESO_PROPIO_SEED` (+`ingreso_cobro_tienda`; la guardia de composición exige que sea
  exactamente los ingresos propios), `WALLET_EGRESO_NOMBRADO_SEED` (+`egreso_reverso_cobro_tienda`),
  `DocumentoCajaDTO.tipo` (+`"cobro_tienda"`). **`WALLET_INGRESO_CONCEPTO_SEED` NO cambia**: son los seis
  del feed del cierre y `MAPEO_CONCEPTO_TIENDA` depende de él.
- `lib/types/wallet-tienda.ts` — `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`*.
- `lib/utils/caja-tesoreria.ts` — `NATURALEZA_POR_CATEGORIA`*, `LIQUIDEZ_POR_CATEGORIA`*, `acumular`,
  `derivarCaja` (§2.2).
- `lib/utils/invariante-tiendas.ts` — `TIPO_POR_CATEGORIA_TIENDA`*, `CONTRAPARTIDA_EN_CAJA`*:
  `cobro_manual: "ingreso_cobro_tienda"`, `cobro_tienda_anulado: "egreso_reverso_cobro_tienda"`.
- `lib/utils/desglose-tienda.ts` — `CUBETA_POR_CATEGORIA`*. `lib/utils/aporte-por-orden.ts` —
  `FUENTE_CAJA`*, `FUENTE_TIENDA`*.
- `lib/utils/finanzas-diarias.ts` — `salidas` del día solo si liquidez `efectivo` (R30); ganancia del día
  ya incluye los propios.
- `lib/analytics/metrics.ts` — `dinero_en_caja` (+2 → 23), `ganancia_ordenex` (+2 → 16), `egresos` **no**,
  `cuenta_por_pagar_tienda` (+`cobro_tienda_anulado`). La guardia `metrics-caja-naturaleza` cambia sus
  literales 21→23 y 14→16 (la diferencia entre las dos listas sigue siendo las siete de terceros y capital).
- `lib/types/historial-accion.ts` — tipo `cobro_tienda_anulado` («mueve dinero»), 59→60 y 37→38 en
  `catalogo-y-choke-point.test.ts`; entidad: **`wallet_tienda_movimiento`** (el cobro), sin entidad nueva.
- `app/(app)/wallet/_components/wallet-labels.ts` — `CATEGORIA_LABEL`*, `ORIGEN_LABEL`*,
  `DOCUMENTO_CAJA_NOMBRE`*, textos de §7. `ComposicionGananciaCard.tsx` (`INGRESO_ICONO`*) y
  `DesgloseEgresosLista.tsx` (`NOMBRADO_ICONO`*).
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` y
  `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts` — §9.
- `WalletService.tipoDeDocumentoOriginal` (`lib/services/WalletService.ts:59-67`) y `LectoresDocumentosCaja`
  (`lib/interfaces/services/IWalletService.ts`) — §5.4.

## 5. Servicios

### 5.1 `CobroTiendaService` (existente, ampliado)

```ts
constructor(
  tiendaRepo: IWalletTiendaMovimientoRepository,                 // como hoy: asiento + historial del registro
  usuarioRepo: Pick<IUserRepository, "obtenerCuentaTienda">,
  caja: ICajaCobroTiendaFeedService,                              // NUEVO y OBLIGATORIO (R9): sin caja no se construye
  anulaciones: ICobroTiendaAnulacionRepository,                   // NUEVO: la constancia y su historial
  runTransaction: CobroTiendaTxRunner,                            // el tx gana `walletMovimiento` y `cobroTiendaAnulacion`
  ahora: () => Date = () => new Date(),                           // NUEVO: el MISMO instante para las dos filas (R3)
)
```

**`registrarCobro(input, actor)`** — los pasos de hoy (`CobroTiendaService.ts:73-89`) más dos:

1. Rol antes de leer nada (R8). 2. Escala 2 una vez (`montoStr`). 3. Tienda (mismos tres mensajes, R6).
4. `const ahora = this.ahora(); const fechaMovimiento = instanteDelMovimientoManual(input.fecha, ahora) ?? ahora;`
   — la misma corrección que hizo la 459 en el pago por cuenta (`PagoPorCuentaTiendaService.ts:161-167`):
   Prisma rellena `@default(now())` fila a fila en el cliente y las dos filas quedarían con instantes
   distintos (medido: 4 ms). **Cambio respecto de hoy:** el débito con «hoy» ya no usa el DEFAULT de la
   columna; lleva el instante del servicio. Es el mismo día CR y el rollup diario no lo nota.
5. Transacción: `tiendaRepo.crearMovimientos` (débito, igual que hoy) → `tiendaRepo.registrarCobroEnHistorial`
   (igual) → **`caja.emitirCargoDeCobro(tx, { cobroId: id, monto: montoStr, descripcion:
   descripcionCobroEnCaja(tienda, input.descripcion), registradoPor, fechaMovimiento })`**.
6. Releer por id y tienda; saldo derivado después; `ok { cobro, saldo }` (R5). Sin candado (P11).

**`anular({ cobroId, motivo }, actor)`** (nuevo, R10–R18): rol → `tiendaRepo.obtenerCobroPorId(cobroId)`
(lee **solo** filas `debito/cobro_manual`, con `tiendaId`, nombre de la tienda, `monto`, `descripcion`; otra
categoría → `null`) → `no_encontrado` → `anulaciones.estadoDelCobro(cobroId)` fuera de la transacción:
`{ reclasificado, tieneCargo }`; reclasificado o sin cargo → `no_anulable` (R17, P12) → transacción:
`anulaciones.anular(tx, { cobroId, motivo, anuladoPor })` (fila + historial `cobro_tienda_anulado`; choque del
UNIQUE → `ya_anulado`, R15) → crédito `cobro_tienda_anulado` en la tienda por **el monto del cobro**
(origen `cobro_tienda`, `origenId = cobroId`: idempotente por `wallet_tienda_movimiento_origen_uq`) →
`caja.emitirReversoDeCobro(tx, …)` (`egreso_reverso_cobro_tienda`, mismo origen). Las dos filas con el mismo
`instante = this.ahora()` (hoy CR, R11). Descripciones: «Anulación · {descripción}» en la tienda y
«Anulación · {Tienda} · {descripción}» en la caja. Devuelve `ok { saldo }`.

`ICobroTiendaService` gana `anular`; el docstring de la 381 («no hay ni debe haber…») se reescribe citando
HD1: la ausencia deja de ser el requisito.

### 5.2 `CajaCobroTiendaFeedService` (nuevo, molde `CajaPagoPorCuentaFeedService.ts`)

Dos métodos con tipo, categoría y origen como **literales** dentro de la clase: `emitirCargoDeCobro` →
`ingreso / ingreso_cobro_tienda / cobro_tienda`; `emitirReversoDeCobro` → `egreso /
egreso_reverso_cobro_tienda / cobro_tienda`. Las dos filas comparten `(cobro_tienda, cobroId)` y se
distinguen por la categoría: el índice único parcial `wallet_movimiento_origen_categoria_uq` las hace
idempotentes (R2). Las guardias de la 173 que fijan la lista exacta de `CajaPagoTiendaFeedService` no se tocan.

### 5.3 `CobroTiendaAnulacionRepository` (nuevo, molde `PagoPorCuentaTiendaRepository.anular`)

`anular(tx, …)` (fila + `appendAccion` con `cobro_tienda_anulado`, entidad `wallet_tienda_movimiento`,
etiqueta = nombre de la tienda, `monto` del cobro; **un tipo por método**, la guardia del censo mide por
método) · `estadoDelCobro(cobroId)` (`{ anulado, reclasificado, tieneCargo }`: tres `EXISTS` en una
consulta) · `estadoDeDocumentos(ids)` (para el libro: `{ id, anulado, tieneComprobante: false }`).
`WalletTiendaMovimientoRepository` gana `obtenerCobroPorId`.

### 5.4 El libro de la caja: `documento` para el cobro

`tipoDeDocumentoOriginal` (`WalletService.ts:59-67`) devuelve `"cobro_tienda"` para
`categoria === "ingreso_cobro_tienda"` con origen `cobro_tienda` **o** `cobro_tienda_completado` (R37).
`LectoresDocumentosCaja` gana `cobros`. El reverso (`egreso_reverso_cobro_tienda`) y las salidas
reclasificadas siguen con `documento: null` (R20). `DocumentoCajaDTO` no cambia de forma:
`tieneComprobante` vale `false` (un cobro no lleva comprobante; P-alternativa: añadirlo es de la 458).

### 5.5 Descripciones puras (`lib/utils/descripcion-cobro-tienda.ts`, R7)

`descripcionCobroEnCaja(tiendaNombre, descripcion)` → «{Tienda} · {descripción}»;
`descripcionAnulacionCobro(original)` → «Anulación · {original}». Test que prohíbe forma de uuid.

## 6. Server Actions y contratos

En `lib/actions/wallet-tienda.ts` (P8), junto a `registrarCobroTiendaAction`:

| Acción | Entrada (`.strict()`) | Salida (`status`) |
| --- | --- | --- |
| `registrarCobroTiendaAction` (existe) | sin cambios | sin cambios: `ok {cobro, saldo}` · `validation_error` · `forbidden` · `unauthenticated` |
| `anularCobroTiendaAction({ cobroId, motivo })` **nuevo** | `cobroId` uuid, `motivo` recortado no vacío; **sin monto** (R13) | `ok {saldo}` · `ya_anulado` · `no_encontrado` · `no_anulable {motivo: "reclasificado" \| "sin_linea_de_caja"}` · `forbidden` · `validation_error` · `unauthenticated` |

`buildCobroTiendaService` (`wallet-tienda.ts:148-155`) inyecta el puerto de caja **real**
(`new CajaCobroTiendaFeedService(new WalletMovimientoRepository(prisma))`) y el repositorio de anulaciones;
su comentario («lo que NO se inyecta es parte del contrato») se reescribe: ahora lo que **sí** se inyecta es
el contrato (R9), y un test de integración que pasa **por la action** encuentra las tres filas en Postgres
(lección «el composition root que no inyecta»). `CobroTiendaTxRunner` amplía su `tx` con `walletMovimiento`
y `cobroTiendaAnulacion`. Schema zod nuevo en `lib/types/wallet-tienda.ts`: `anularCobroTiendaSchema`.

## 7. Los nombres (textos exactos, aprobados en su forma por el humano; ajustables línea a línea, P16)

Regla: **desde Ordenex, diciendo quién le paga a quién**; sin siglas («contra-entrega», no «COD»); sin
jerga («corrección», no «ajuste»; «cobro», no «cargo manual»). Los seis cargos del cierre dicen a quién se
le cobran. Cada texto vive en su diccionario (fuera del JSX) y un test lo fija como literal.

### 7.1 Conceptos manuales del diálogo (`CONCEPTOS_MANUALES`, orden y grupos)

| Grupo (encabezado) | Concepto (`id`) | Nombre |
| --- | --- | --- |
| «Sale dinero de Ordenex» | `gasto_variable` | «Gasto de Ordenex» |
| | `sueldo` | «Sueldo» |
| | `pago_por_cuenta_tienda` | «Ordenex paga un gasto de una tienda» |
| | `ajuste_egreso` | «Corrección de caja (resta)» |
| «Llega dinero a la caja» | `aporte_capital` | «Aporte de dinero a la caja» |
| | `ajuste_ingreso` | «Corrección de caja (suma)» |
| «Se descuenta del saldo de una tienda» | `cobro_tienda` | «Ordenex le cobra a una tienda» |

`GRUPO_CONCEPTO_LABEL`: `sale: "Sale dinero de Ordenex"`, `entra: "Llega dinero a la caja"`,
`no_mueve: "Se descuenta del saldo de una tienda"` (la clave interna `no_mueve` puede renombrarse a
`descuenta`; es un token, no un texto). `TIPO_EGRESO_MANUAL_LABEL.gasto_variable = "Gasto de Ordenex"`.
`DESCRIPCION_EGRESO_LABEL`/`PLACEHOLDER` no cambian.

### 7.2 Conceptos del libro de la caja (`CATEGORIA_LABEL`; tabla, filtro y descarga)

| Categoría | Nombre desde Ordenex |
| --- | --- |
| `ingreso_flete` | «Flete cobrado a la tienda» |
| `ingreso_flete_devolucion` | «Flete por rechazo cobrado a la tienda» |
| `ingreso_comision_cod` | «Comisión de contra-entrega cobrada a la tienda» |
| `ingreso_iva_flete` | «IVA del flete cobrado a la tienda» |
| `ingreso_iva_flete_devolucion` | «IVA del flete por rechazo cobrado a la tienda» |
| `ingreso_iva_comision_cod` | «IVA de la comisión cobrado a la tienda» |
| **`ingreso_cobro_tienda`** | **«Ordenex le cobra a una tienda»** |
| **`egreso_reverso_cobro_tienda`** | **«Cobro a una tienda anulado»** |
| `ingreso_cod_recaudado` | «Contra-entrega cobrado a los clientes de la tienda» |
| `egreso_pago_tienda` | «Ordenex le paga a una tienda» |
| `ingreso_reverso_pago_tienda` | «Pago a una tienda anulado» |
| `egreso_pago_por_cuenta_tienda` | «Ordenex paga un gasto de una tienda» |
| `ingreso_reverso_pago_por_cuenta_tienda` | «Pago de un gasto de una tienda anulado» |
| `egreso_pago_mensajero` | «Ordenex le paga a un mensajero» |
| `egreso_sueldo` | «Sueldo» |
| `egreso_gasto_variable` | «Gasto de Ordenex» |
| `egreso_gasto_fijo` | «Gasto fijo de Ordenex» |
| `egreso_gasto` | «Otro gasto de Ordenex» (categoría reservada, sin escritor) |
| `egreso_indemnizacion` | «Indemnización que Ordenex paga por un incidente» |
| `ingreso_ajuste` | «Corrección de caja (suma)» |
| `egreso_ajuste` | «Corrección de caja (resta)» |
| `ingreso_aporte_capital` | «Aporte de dinero a la caja» |
| `egreso_reverso_aporte_capital` | «Aporte de dinero a la caja anulado» |

### 7.3 Orígenes (`ORIGEN_LABEL` en la caja; `ORIGEN_TIENDA_LABEL` en la tienda, mismos textos)

| Origen | Nombre |
| --- | --- |
| `cierre_dia` | «Cierre del día» (sin cambio) |
| `gestion_orden` | «Gestión de orden» (sin cambio) |
| `manual` | «Registrado a mano» |
| `gasto` | «Gasto o sueldo registrado a mano» |
| `pago_tienda` | «Pago de Ordenex a una tienda» |
| `pago_mensajero` | «Pago de Ordenex a un mensajero» |
| `orden_incidente` | «Incidente de orden» (sin cambio) |
| `ranking_snapshot_fila` | «Premio del ranking» (sin cambio) |
| `pago_por_cuenta_tienda` | «Pago de un gasto de una tienda» |
| `aporte_capital` | «Aporte de dinero a la caja» |
| `cobro_manual_reclasificado` | «Cobro reclasificado como pago de un gasto de la tienda» |
| **`cobro_tienda`** | **«Cobro de Ordenex a una tienda»** |
| **`cobro_tienda_completado`** | **«Cobro de Ordenex a una tienda (línea de caja completada al corregir)»** |

`ORIGEN_TIENDA_LABEL` gana `cobro_tienda` (el crédito de la anulación escribe en la tienda con ese origen);
la lista `ESCRIBEN_EN_LA_TIENDA` de `mi-wallet-labels.test.ts:110-124` gana `cobro_tienda` y la otra
`cobro_tienda_completado`.

### 7.4 Conceptos del libro de la tienda, desde Ordenex (`/wallet/tiendas`, el diálogo)

| Categoría | Nombre desde Ordenex |
| --- | --- |
| `cod_recaudado` | «Contra-entrega cobrado a los clientes de la tienda» |
| `flete` … `iva_comision_cod` | los seis de §7.2, mismo texto |
| `cobro_manual` | «Ordenex le cobra a la tienda» |
| **`cobro_tienda_anulado`** | **«Cobro de Ordenex a la tienda anulado»** |
| `pago_tienda` | «Ordenex le paga a la tienda» |
| `pago_por_cuenta` | «Ordenex paga un gasto de la tienda» |
| `pago_por_cuenta_anulado` | «Pago de un gasto de la tienda anulado» |
| `ajuste_credito` | «Corrección a favor de la tienda» |
| `ajuste_debito` | «Corrección en contra de la tienda» |

### 7.5 Lectura desde la tienda (`/mi-wallet`: tabla, filtro y descarga)

| Categoría | Lectura desde la tienda |
| --- | --- |
| `cod_recaudado` | «Cobrado a tus clientes en contra-entrega» |
| `flete` | «Ordenex te cobró el flete» |
| `flete_devolucion` | «Ordenex te cobró el flete por rechazo» |
| `comision_cod` | «Ordenex te cobró la comisión de contra-entrega» |
| `iva_flete` | «Ordenex te cobró el IVA del flete» |
| `iva_flete_devolucion` | «Ordenex te cobró el IVA del flete por rechazo» |
| `iva_comision_cod` | «Ordenex te cobró el IVA de la comisión» |
| `cobro_manual` | «Ordenex te cobró» |
| `cobro_tienda_anulado` | «Ordenex anuló un cobro y te lo devolvió» |
| `pago_tienda` | «Ordenex te pagó» |
| `pago_por_cuenta` | «Ordenex pagó un gasto por ti» (el origen añade «A Facebook · motivo · método», P5) |
| `pago_por_cuenta_anulado` | «Ordenex anuló un pago hecho por ti» |
| `ajuste_credito` | «Corrección a tu favor» |
| `ajuste_debito` | «Corrección en tu contra» |

Cabeceras: `/mi-wallet` — `aFavorHint`: «Lo cobrado a tus clientes, las correcciones a tu favor y lo que
Ordenex te devolvió al anular» · `cargosHint`: «Fletes, comisión, IVA y lo que Ordenex te cobró» ·
`pagadoHint`: «Lo que Ordenex te pagó o pagó por ti». `/wallet/tiendas` — `aFavorHint`: «Contra-entrega
cobrado, correcciones a favor y devoluciones por anulaciones» · `cargosHint`: «Fletes, comisión, IVA y los
cobros de Ordenex a la tienda» · `pagadoHint`: «Lo que Ordenex le pagó a la tienda o pagó por ella».

### 7.6 Frases de efecto del diálogo (`FRASE_DEL_EFECTO`, una línea cada una, R41)

| Concepto | Frase |
| --- | --- |
| Gasto de Ordenex | «Sale dinero de Ordenex y baja su ganancia.» |
| Sueldo | «Sale dinero de Ordenex para pagar un sueldo y baja su ganancia.» |
| Ordenex paga un gasto de una tienda | «Sale dinero de Ordenex hacia un tercero (Facebook, Jet Cargo…) y se descuenta del saldo de la tienda; la ganancia no cambia.» |
| Corrección de caja (resta) | «Sale dinero de la caja para corregir un descuadre y baja la ganancia de Ordenex.» |
| Aporte de dinero a la caja | «Llega dinero de Ordenex a la caja; no es ganancia, la ganancia no cambia.» |
| Corrección de caja (suma) | «Llega dinero a la caja para corregir un descuadre y sube la ganancia de Ordenex.» |
| Ordenex le cobra a una tienda | «No llega dinero nuevo: se descuenta del saldo a favor de la tienda y pasa a ser ganancia de Ordenex; si la tienda no tiene saldo, queda en contra.» |

Frase del libro (`FRASE_DEL_LIBRO`, R46): para el cobro, «Se registra en la caja como «Ordenex le cobra a
una tienda» y en el libro de la tienda como «Ordenex le cobra a la tienda».» (`LibroDestino` del cobro pasa
de `tienda` a `caja_y_tienda`; `CABECERA_POR_LIBRO.caja_y_tienda` pasa a ser por concepto: título = nombre
del concepto; la descripción del cobro conserva la de hoy sustituyendo «no se puede editar ni deshacer» por
«no se edita: si hay un error, se anula desde el libro de la caja con un motivo»).

### 7.7 Historial (`HISTORIAL_ACCION_TIPO_LABEL` y etiquetas de entidad; P15)

`cobro_tienda_registrado` → «Le cobró a una tienda» · **`cobro_tienda_anulado`** → «Anuló un cobro a una
tienda» · `pago_por_cuenta_tienda_registrado` → «Pagó un gasto de una tienda» ·
`pago_por_cuenta_tienda_anulado` → «Anuló el pago de un gasto de una tienda» · `aporte_capital_registrado`
→ «Registró un aporte de dinero a la caja» · `aporte_capital_anulado` → «Anuló un aporte de dinero a la
caja». Entidades: `pago_por_cuenta_tienda` → «Pago de un gasto de una tienda»; `aporte_capital` → «Aporte
de dinero a la caja»; `wallet_tienda_movimiento` sigue «Movimiento de tienda».

### 7.8 Nombres reservados (457; R48)

«Una tienda le paga a Ordenex» (caja), «La tienda le paga a Ordenex» (desde Ordenex, libro de la tienda),
«Le pagaste a Ordenex» (`/mi-wallet`), «Pago de una tienda a Ordenex anulado» / «Pago a Ordenex anulado».
Ningún diccionario de hoy puede contenerlos; el leader anota en el spec de la 457 (su Q6 decía «Pago
recibido de tienda») que estos son los textos.

### 7.9 Nombres retirados (R47; guardia con contraprueba)

Como **nombre completo** de un concepto, origen, grupo o acción: «Cobrar un costo a una tienda», «Cobro de
Ordenex», «Cobro de un costo», «Pago por cuenta de una tienda», «Pago por cuenta de la tienda», «Pago por
cuenta anulado», «Pago por cuenta de tienda», «Gasto variable», «Saldo inicial o aporte de capital», «Saldo
inicial o aporte», «Saldo inicial o aporte anulado», «Ajuste que suma dinero», «Ajuste que resta dinero»,
«Ajuste (ingreso)», «Ajuste (egreso)», «Ajuste (crédito)», «Ajuste (débito)», «Comisión COD», «COD
recaudado», «Contra-entrega cobrado» (a secas), «Pago a tienda», «Pago a mensajero», «Pago a la tienda»,
«Manual», «Gasto» (a secas), «No mueve la caja», «Cobro reclasificado como pago por cuenta». Y las frases
«bajan su saldo sin pasar por la caja», «no mueve la caja», «La caja y la ganancia no cambian» en
`app/(app)/wallet/**`, `app/(app)/mi-wallet/**`, `lib/types/historial-accion*.ts` y `docs/ayuda/**`.

**Lo que NO se retira:** «Saldo inicial» y «Aporte» como clases del aporte (radio del diálogo, etiqueta de la
tarjeta «Saldo inicial y aportes», P6); las palabras sueltas «cobro», «ajuste» en prosa.

### 7.10 Choques con la 455 (R49)

Comparados a mano contra `NOMBRE_ESTADO` (`lib/types/order-status.ts:132-153`) y `NOMBRES_RETIRADOS`
(`tests/fixtures/nombres-retirados-455.ts`): ningún texto de §7 coincide con un nombre de estado vigente ni
retirado, ninguno va entre «» en la ayuda como estado, y todos los `Record` de esta ficha se indexan por
categorías de la wallet, no por códigos de estado (G3 de la 455 solo denuncia mapas con ≥2 claves que sean
códigos o nombres de estado). «Flete por rechazo» contiene «rechazo» pero no «Rechazada»; «Devolución» no se
usa. La tarea T C.9 corre las tres guardias como comprobación, no como fe.

## 8. El diálogo (`RegistrarMovimientoCajaDialog.tsx`, `wallet-conceptos-manuales.ts`)

Sin campos nuevos para el cobro (R53): tienda, monto, fecha, motivo; el payload de
`registrarCobroTiendaAction` no gana ni una clave. Cambian: el catálogo (§7.1), `GRUPO_CONCEPTO_LABEL`,
`FRASE_DEL_EFECTO` (§7.6), `libroDelConcepto(cobro) = "caja_y_tienda"` y su `FRASE_DEL_LIBRO`, la cabecera.
`TEXTO_COBRO_TIENDA.hint` pasa a «El cobro se descuenta del saldo a favor de la tienda y pasa a ser
ganancia de Ordenex. Si la tienda no tiene saldo, queda en contra y se cobra cuando la gestión le vuelva a
generar dinero a favor.» El aviso de éxito conserva su forma (R54) y añade « La tienda le debe ese dinero a
Ordenex.» cuando el signo es negativo, como el pago de un gasto (`:125-127`).

## 9. Libros, descargas y los dos diccionarios del libro de la tienda (P4)

- `app/(app)/wallet/tiendas/_components/desglose-tienda-labels.ts` deja de reexportar `CATEGORIA_TIENDA_LABEL`
  y `CATEGORIA_TIENDA_OPTIONS` desde `/mi-wallet` y define **`CATEGORIA_TIENDA_LABEL`** (§7.4, desde
  Ordenex) y sus opciones. Sigue reexportando `ORIGEN_TIENDA_LABEL`, `origenLabel`, `TIPO_TIENDA_LABEL` y
  `money`. El diálogo (`wallet-conceptos-manuales.ts:9`) importa el diccionario de `/wallet/tiendas`, no el
  de `/mi-wallet`.
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` define **`CATEGORIA_MI_WALLET_LABEL`** (§7.5) y sus
  opciones; `DesgloseTiendaLedger.tsx`, `MiWalletFiltros.tsx`, `mi-wallet-descarga-columnas.ts` y
  `DetalleMiMovimientoCierre` (el nombre accesible) lo usan. Un test recorre el seed y exige que los dos
  diccionarios sean totales y que difieran en todo concepto donde una parte actúa sobre la otra (R44).
- `WalletLedger.tsx`: sin cambios de forma; `DocumentoCajaAcciones.tsx` gana la rama `cobro_tienda` en
  `ACCIONES` (`anular` → `anularCobroTiendaAction({ cobroId, motivo })`; `comprobante` → nunca se ofrece:
  `tieneComprobante` es `false`) y `DOCUMENTO_CAJA_NOMBRE.cobro_tienda = "el cobro de Ordenex a una tienda"`;
  `avisoDeAnulacion` gana `no_anulable` → «Este cobro no se puede anular desde aquí: {motivo legible}.» con
  los dos motivos («se reclasificó como pago de un gasto de la tienda» / «no tiene su línea en la caja»).
- Las descargas no ganan columnas (R52); los rótulos salen de los mismos diccionarios que la tabla.

## 10. Analítica

`lib/analytics/metrics.ts` según §4. La descripción de `dinero_en_caja` ya dice que los cargos no entran
aparte; gana «ni el cobro de Ordenex a una tienda ni su anulación». `ganancia_ordenex` gana en su descripción
«incluye lo que Ordenex les cobra a las tiendas». `egresos` no cambia (P14). La serie diaria (R30) y los KPIs
sin superficie no cambian de forma. Las etiquetas de las métricas no se tocan (P7).

## 11. La ayuda y el contexto del asistente (HD4)

`docs/ayuda/oficina/wallet-caja.md`, `docs/ayuda/oficina/wallet-tiendas.md`, `docs/ayuda/tienda/mi-wallet.md`
(y `docs/ayuda/oficina/historico-acciones.md` si nombra las acciones): nombres de §7, el cobro explicado como
cargo (se descuenta del saldo a favor de la tienda y es ganancia; no llega dinero nuevo; puede dejar el saldo
en contra), su anulación (motivo, contra-asientos, «Anular…» en el libro de la caja), la tabla «Ordenex paga
un gasto de una tienda» frente a «Ordenex le cobra a una tienda» reescrita (la fila «La caja»: «Baja: sale
dinero» / «No cambia el dinero: pasa del saldo de la tienda a la ganancia de Ordenex»), la sección «Los
cobros que eran pagos de un gasto» con el nombre nuevo, y **fuera** «bajan su saldo sin pasar por la caja».
Frontmatter: `actualizado` y `fuentes` (+ `CobroTiendaService.ts`, `CajaCobroTiendaFeedService.ts`,
`descripcion-cobro-tienda.ts`, `desglose-tienda-labels.ts`). Frases literales que el test
`contexto-461.test.ts` exige en el contexto de maestro/admin (`oficina/wallet-caja`): «## Ordenex le cobra
a una tienda: se descuenta de su saldo y es ganancia», «**No llega dinero nuevo**», «pasa a ser **ganancia
de Ordenex**», «**Anular…**»; en `oficina/wallet-tiendas`: «**Ordenex le cobra a la tienda**», «**Cobro de
Ordenex a la tienda anulado**»; en `tienda/mi-wallet` para adminTienda: «**Ordenex te cobró**», «**Ordenex
anuló un cobro y te lo devolvió**», «**Ordenex pagó un gasto por ti**». `contexto-460.test.ts` se reescribe
donde cita nombres retirados («**Cobro de Ordenex**», «Pago por cuenta de una tienda, o cobrar un costo…»),
listando cada literal sustituido. Las guardias `ayuda-*` y `asistente-*` no cambian.

## 12. La migración de datos: proceso

1. Leader, producción, solo lectura: C461-0 de §13 (candidatos: número, suma, por tienda, primer y último
   día). Se anota en `progress/contraste_461.md`. Esperado 0; si no es 0, se listan fila a fila para que el
   humano vea qué cobros van a pasar a ganancia (son suyos: no hace falta aprobación fila a fila como en la
   459, porque no se reclasifica nada; se completa lo que la app debió escribir).
2. Se escribe la migración de §3.3 (sin lista: el criterio es por datos, no por ids).
3. Test de integración (§14.4) con las mutaciones «escribe para un reclasificado» y «sin `ON CONFLICT`» en rojo.
4. Despliegue; contraste después (C461-1, C461-2).

## 13. Contraste en producción (solo lectura, lo corre el leader por el MCP de Supabase)

```sql
-- C461-0 — candidatos al backfill (se espera 0 filas / 0,00)
SELECT u.nombre AS tienda, count(*) AS filas, sum(m.monto) AS total,
       min((m.fecha_movimiento - interval '6 hours')::date) AS desde,
       max((m.fecha_movimiento - interval '6 hours')::date) AS hasta
FROM wallet_tienda_movimiento m JOIN usuario u ON u.id = m.tienda_id
WHERE m.categoria::text = 'cobro_manual' AND m.tipo::text = 'debito'
  AND NOT EXISTS (SELECT 1 FROM wallet_movimiento w WHERE w.origen_id = m.id AND w.origen_tipo::text = 'cobro_manual_reclasificado')
  AND NOT EXISTS (SELECT 1 FROM wallet_movimiento w WHERE w.origen_id = m.id AND w.categoria::text = 'ingreso_cobro_tienda')
GROUP BY u.nombre;

-- C461-1 — la caja con la formula de esta ficha, R7 y R8 SIN excepcion (antes y despues)
WITH caja AS (
  SELECT categoria::text AS cat, tipo::text AS tipo, SUM(monto) AS total FROM wallet_movimiento GROUP BY 1, 2
), clas AS (
  SELECT cat, tipo, total,
         CASE WHEN cat IN ('ingreso_cod_recaudado','ingreso_reverso_pago_tienda','egreso_pago_tienda',
                           'egreso_pago_por_cuenta_tienda','ingreso_reverso_pago_por_cuenta_tienda') THEN 'terceros'
              WHEN cat IN ('ingreso_aporte_capital','egreso_reverso_aporte_capital') THEN 'capital'
              ELSE 'propio' END AS dueno,
         cat IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod','ingreso_iva_flete',
                 'ingreso_iva_flete_devolucion','ingreso_iva_comision_cod',
                 'ingreso_cobro_tienda','egreso_reverso_cobro_tienda') AS es_cargo,
         CASE WHEN tipo = 'ingreso' THEN total ELSE -total END AS con_signo
  FROM caja
), cifras AS (
  SELECT COALESCE(SUM(total) FILTER (WHERE tipo = 'ingreso' AND NOT es_cargo), 0) AS entro,
         COALESCE(SUM(total) FILTER (WHERE tipo = 'egreso'  AND NOT es_cargo), 0) AS salio,
         COALESCE(SUM(con_signo) FILTER (WHERE NOT es_cargo), 0)                  AS cifra,
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'propio'), 0)              AS ganancia,
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'terceros'), 0)
           - COALESCE(SUM(con_signo) FILTER (WHERE es_cargo), 0)                  AS de_tiendas,
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'capital'), 0)             AS capital,
         COALESCE(SUM(total) FILTER (WHERE cat = 'ingreso_cobro_tienda'), 0)      AS cobros_en_caja,
         COALESCE(SUM(total) FILTER (WHERE cat = 'egreso_reverso_cobro_tienda'), 0) AS cobros_anulados
  FROM clas
), tiendas AS (
  SELECT COALESCE(SUM(CASE WHEN tipo::text = 'credito' THEN monto ELSE -monto END), 0) AS suma_saldos
  FROM wallet_tienda_movimiento
)
SELECT c.*, t.suma_saldos,
       c.de_tiendas - t.suma_saldos                       AS diferencia_r8,   -- se espera 0,00, SIN excepcion
       c.cifra - (c.ganancia + c.de_tiendas + c.capital)  AS diferencia_r7    -- se espera 0,00
FROM cifras c CROSS JOIN tiendas t;

-- C461-2 — cada cobro tiene EXACTAMENTE una linea de caja (cargo propio o salida reclasificada): se esperan 0 filas
SELECT m.id, m.monto, count(w.id) AS lineas
FROM wallet_tienda_movimiento m
LEFT JOIN wallet_movimiento w ON w.origen_id = m.id
  AND w.categoria::text IN ('ingreso_cobro_tienda','egreso_pago_por_cuenta_tienda')
WHERE m.categoria::text = 'cobro_manual'
GROUP BY m.id, m.monto HAVING count(w.id) <> 1;

-- C461-3 — catalogos (para los down) y la tabla nueva
SELECT t.typname, COUNT(*) AS n, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname IN ('wallet_movimiento_categoria','wallet_tienda_movimiento_categoria','wallet_origen_tipo','historial_accion_tipo')
GROUP BY t.typname ORDER BY 1;
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'cobro_tienda_anulacion';

-- C5 de la 459 (mensajeros) se repite antes y despues: debe ser identico.
```

**Regla (R38):** antes, `de_tiendas` = `suma_saldos` + Σ candidatos (la excepción de la 459 vale hasta
aplicar); después, `diferencia_r8` = 0,00, `diferencia_r7` = 0,00, `ganancia_despues` = `ganancia_antes` +
Σ candidatos, `cifra` idéntica, C461-2 sin filas, C5 idéntico. Si algo no cuadra, no se sigue.

## 14. Fase 0, mutaciones y guardias

### 14.1 Fotografía

`tests/integration/db/caja-caracterizacion-459.test.ts` y su fixture (`_fixtures/caja-459.ts`) ya ejercen
todos los caminos, incluido el cobro (`cobroCostoB`, 2.500,50). **Se corre verde antes de tocar nada** y sus
literales no se tocan salvo un bloque nuevo con nombre propio «lo que la 461 cambia a propósito»: la
ganancia de la foto sube 2.500,50 (−89.874,84 → −87.374,34), «De las tiendas» baja 2.500,50 (15.546,32 →
13.045,82 = Σ saldos 7.530,70 + 5.515,12), la cifra principal y `entradas` no cambian; y el libro de la caja
gana una fila `ingreso|ingreso_cobro_tienda|2500.50|cobro_tienda`. Los literales se calculan **a mano en un
comentario**, nunca con la función probada (lección «aserción contra su propia fuente»). El bloque «a
propósito» de la 459 se reescribe **solo** en esas dos cifras, con el mismo criterio.

### 14.2 Mutaciones (una a una, con autocomprobación: diff de una línea → rojo con el nombre del caso y el
número de tests ejecutados ≠ 0 → `git checkout` → verde). Informe en `progress/fase0_461.md`.

1. Quitar `emitirCargoDeCobro` del servicio (el fallo que motiva la ficha) → rojo en R1/R4/R25.
2. `ingreso_cobro_tienda` como `efectivo` → rojo (R22, R24; sube «Entró»).
3. `egreso_reverso_cobro_tienda` como `efectivo` → rojo (R22; sube «Salió»).
4. `egreso_reverso_cobro_tienda` como `terceros` → rojo (guardia (4) y R12).
5. `cobro_tienda_anulado` con cubeta `cargos` → rojo (desglose ≠ saldo).
6. Anular sin el crédito de la tienda → rojo (R10, R25).
7. Anular con el monto de la petición en vez del del cobro → rojo (R13).
8. La migración de datos escribe también para un reclasificado → rojo (R32, R25).
9. La migración sin `ON CONFLICT` → rojo (R33).
10. El `down` de la migración de datos borra aunque haya reverso → rojo (R36).
11. `DUENO_LABEL`/`CATEGORIA_LABEL` con un nombre retirado → rojo (guardia de nombres).
12. `CATEGORIA_MI_WALLET_LABEL.cobro_manual` igual al nombre desde Ordenex → rojo (R44).
13. `FRASE_DEL_EFECTO.cobro_tienda` con la frase vieja → rojo (R41, guardia).
14. `tipoDeDocumentoOriginal` sin el origen `cobro_tienda_completado` → rojo (R37).

### 14.3 Guardias

- `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` (contrato nuevo, mismo archivo; cada literal
  cambiado se anota en `progress/impl_461.md`): (1) sin contrapartida = **`["ajuste_debito"]`**; (4) cargos =
  los seis del feed + `ingreso_cobro_tienda` + `egreso_reverso_cobro_tienda`, todos `propio`, y **el signo
  del efecto en «De las tiendas» de un cargo lo da el prefijo** (`ingreso_` −1, `egreso_` +1); (2) y (3)
  como hoy. Contraprueba nueva: «un reverso de cargo como efectivo → `cobro_tienda_anulado (1) ↔
  egreso_reverso_cobro_tienda (0)`».
- `caja-composicion-exhaustiva.guardia.test.ts`: ingresos propios 7→8; nombrados 2→3; «otros» sigue
  `["egreso_gasto"]`.
- `metrics-caja-naturaleza.guardia.test.ts`: 21→23, 14→16; `egresos` sigue con 10.
- `caja-derivaciones.guardia.test.ts`: cuatro llamadas, sin cambio.
- **`tests/unit/guards/nombres-wallet-461.guardia.test.ts`** (nueva, R47/R48/R50): barre los diccionarios
  de la wallet (`CATEGORIA_LABEL`, `ORIGEN_LABEL`, `CATEGORIA_TIENDA_LABEL`, `CATEGORIA_MI_WALLET_LABEL`,
  `ORIGEN_TIENDA_LABEL`, `CONCEPTOS_MANUALES[].label`, `GRUPO_CONCEPTO_LABEL`, `FRASE_DEL_EFECTO`,
  `HISTORIAL_ACCION_TIPO_LABEL`) y los archivos de `app/(app)/wallet/**`, `app/(app)/mi-wallet/**` y
  `docs/ayuda/**`: ningún valor es un nombre retirado (§7.9), ninguno es un nombre reservado (§7.8), ninguna
  frase retirada aparece; con contraprueba (la fuente de hoy la pone roja) y control de no-vacuidad (número
  mínimo de archivos y de claves).
- `caja-textos-459.guardia.test.ts`: `TEXTOS_RETIRADOS` gana «bajan su saldo sin pasar por la caja».

### 14.4 Tests de integración nuevos o cambiados

- `tests/integration/db/cobro-tienda-461.test.ts`: por la action; las tres filas; mismo instante; saldo
  negativo; anulación (contra-asientos, fecha de hoy, `ya_anulado`, `no_encontrado`, `no_anulable` sobre un
  cobro reclasificado y sobre uno sin línea); R4/R12 sobre `derivarCaja` con filas reales.
- `tests/integration/db/cobro-tienda-461-concurrencia.test.ts`: dos anulaciones a la vez → una.
- `tests/integration/db/cobro-tienda-461-migration.test.ts`: enums valor a valor contra el estado previo
  reconstruido; CHECK rechazan los pares invertidos (23514); RLS; `down` con filas falla sin borrar; sin
  filas vuelve al estado previo (R62–R64).
- `tests/integration/db/cobro-tienda-461-completar-migration.test.ts`: lee el `migration.sql` real; siembra
  cobros legados **sin** línea (insert directo, como hace `reclasificacion-459-migration.test.ts:86`), uno
  reclasificado y uno con cargo propio; R31–R36; R8 antes (con excepción) y después (sin excepción).
- `tests/integration/db/caja-invariante-tiendas.test.ts`: la afirmación de R8 pierde el término
  `cobrosNoReclasificados` (queda `Δ deTerceros = Σ saldos` tras cada paso); su paso 6 («cobro
  reclasificado») deja de reclasificar `cobroCostoB` —que ahora trae su cargo— y siembra un **cobro legado**
  con insert directo para reclasificarlo con el SQL real de la 459; gana los pasos «anulación del cobro» y
  «cobro completado por la migración de esta ficha».
- `reclasificacion-459-migration.test.ts` y `reclasificacion-459-lista.guardia.test.ts`: **no se tocan** (R61).

## 15. Acoples (lo que el leader actualiza en otros specs)

**457 (va después):** su Q6 y su §4 toman los nombres reservados de §7.8; sus categorías entran en
`LIQUIDEZ_POR_CATEGORIA` (`efectivo`) y en `CONTRAPARTIDA_EN_CAJA`; su R64 («el cobro manual conserva sin
cambios su asiento, su historial, su efecto en el saldo y sus textos») queda **superado**: el cobro escribe
en la caja y tiene anulación, y sus textos son los de §7; su fase 0 parte de la fórmula de §2.2 (23
categorías; historial 60/23); su `/mi-wallet` usa `CATEGORIA_MI_WALLET_LABEL` («Le pagaste a Ordenex»).
**458:** sus etiquetas, su glosario («Cobrar un costo…», «Pago por cuenta…») y su §4.4 («Así queda»)
adoptan §7 y §2.2; su R49/R78 se leen sobre la derivación de esta ficha. **459:** L4 y P3 quedan cerradas
por esta ficha; su `design.md` §2.3 y su glosario («Cobrar un costo a una tienda… no mueve la caja») se
anotan como superados, sin reescribir la historia.

## 16. Recorrido por rol (guion; sin arnés E2E, Playwright ad hoc en local sembrado)

**Maestro** — 1. `/wallet`: «Registrar movimiento» ofrece los siete nombres de §7.1 en sus tres grupos; al
pasar por cada concepto cambia la frase de una línea. 2. «Ordenex le cobra a una tienda» 42.000 a una tienda
con saldo: aviso con el saldo resultante; tarjeta: ganancia +42.000, «De las tiendas» −42.000, «Entró» y la
cifra principal iguales; libro: fila «Ordenex le cobra a una tienda», Tipo Ingreso, Dueño Ordenex, origen
«Cobro de Ordenex a una tienda · {Tienda} · {motivo}», con «Anular…». 3. Composición de la ganancia: fila
«Ordenex le cobra a una tienda» 42.000. 4. «Anular…» con motivo: contra-asiento «Cobro a una tienda
anulado» fechado hoy, la original dice «Anulado», las tres cifras vuelven; segundo intento → «Ya estaba
anulado». 5. Un cobro completado por la migración (local): su fila con el origen «(línea de caja
completada al corregir)» y «Anular…». 6. La salida reclasificada de la 459 (local, sembrada): sin acciones.
7. Filtro por concepto: los nombres nuevos; descarga: mismos rótulos, sin uuids. 8. `/wallet/tiendas`:
desglose con «Ordenex le cobra a la tienda» / «Cobro de Ordenex a la tienda anulado», pistas de §7.5;
«Registrar pago» intacto. **Admin:** 1–8 igual. **adminTienda:** `/mi-wallet` lee «Ordenex te cobró» y
«Ordenex anuló un cobro y te lo devolvió», «Ordenex pagó un gasto por ti · … · A Facebook…»; filtro y
descarga con esas lecturas; ninguna acción; `anularCobroTiendaAction` con un id → `forbidden`.
**Mensajero:** `/wallet` → no encontrado; las dos actions → `forbidden`. **Tras desplegar:** §13.

## 17. Trazabilidad R → test

| R | Test |
| --- | --- |
| R1–R9 | `tests/unit/services/cobro-tienda-service.test.ts` (orden de pasos, mismo `montoStr` e instante, rol antes de leer, tienda, sin candado), `tests/integration/db/cobro-tienda-461.test.ts` (por la action) |
| R10–R19 | `cobro-tienda-service.test.ts`, `tests/unit/types/cobro-tienda-anulacion-schema.test.ts` (`.strict()`, sin monto), `cobro-tienda-461.test.ts`, `cobro-tienda-461-concurrencia.test.ts`; R19 = lista de métodos de `ICobroTiendaService` (registrar, anular; nada más) |
| R20, R21, R37 | `tests/components/WalletLedgerAcciones461.test.tsx` (acciones solo en originales propias y completadas; rótulos literales; filtro) |
| R22–R24, R28 | `tests/unit/utils/caja-derivacion-461.test.ts` (M6 idéntico sin cobros; identidad sobre subconjuntos con semilla fija; cargo y reverso no tocan Entró/Salió), `caja-derivaciones.guardia.test.ts` |
| R25 | `tests/integration/db/caja-invariante-tiendas.test.ts` (sin excepción, tras cada paso) |
| R26 | `caja-clasificacion-459.guardia.test.ts` (contrato nuevo + contraprueba) |
| R27 | `caja-composicion-exhaustiva.guardia.test.ts`, `tests/components/ComposicionGananciaCard.test.tsx` |
| R29 | `metrics-caja-naturaleza.guardia.test.ts`, `analitica-financiera-service.test.ts` |
| R30 | `tests/unit/analytics/finanzas-diario.test.ts` |
| R31–R36 | `cobro-tienda-461-completar-migration.test.ts` |
| R38 | `progress/contraste_461.md` (leader) |
| R39–R41, R46, R53, R54 | `wallet-conceptos-manuales.test.ts`, `wallet-registrar-movimiento-dialog.test.tsx` |
| R42 | `tests/unit/components/wallet-labels.test.ts` (nuevo: literales de §7.2/§7.3), `WalletLedgerAcciones461.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx` |
| R43, R45 | `desglose-tienda-labels.test.ts`, `desglose-movimientos-tienda.test.tsx`, `desglose-tienda-descarga-columnas.test.ts` |
| R44, R45 | `mi-wallet-labels.test.ts` (dos diccionarios totales y distintos), `tests/integration/mi-wallet-page.test.tsx`, `wallet-tienda-descarga-columnas.test.ts` |
| R47–R50 | `tests/unit/guards/nombres-wallet-461.guardia.test.ts`; `fuente-unica-nombre-estado`, `nombres-estado-retirados`, `sin-estados-retirados`, `caja-textos-459` (verdes) |
| R51, R55 | `catalogo-y-choke-point.test.ts` (60/23/38), `historial-accion-escrituras-cubiertas.guardia`, `historial-accion-sin-datos-cliente.guardia` |
| R52 | `columnas-sensibles.guardia.test.ts`, `wallet-page.test.tsx` (barrido STRING) |
| R56–R58 | `tests/unit/asistente/contexto-461.test.ts`, `contexto-460.test.ts` (reescrito), `ayuda-pantalla-ruta-existe`, `ayuda-md-viajan-a-produccion` |
| R59, R60 | `caja-caracterizacion-459.test.ts` (bloque «lo que la 461 cambia a propósito») + `progress/fase0_461.md` |
| R61 | `reclasificacion-459-migration.test.ts`, `reclasificacion-459-lista.guardia.test.ts` (sin tocar, verdes) |
| R62–R64 | `cobro-tienda-461-migration.test.ts` |
| R65 | `progress/recorrido_461.md` + `progress/recorrido_461/` |

## 18. Alternativas descartadas

- **A1 — Dejar el cobro como estaba y documentar la excepción de R8.** Es la P3 de la 459, la que el
  humano ha rechazado en preview: un cobro que baja el saldo de la tienda y no aparece en la caja ni en la
  ganancia es un fallo mudo de dinero.
- **A2 — El cobro como `ingreso_ajuste` (propio, efectivo).** Subiría «Entró» y la cifra principal con
  dinero que no entró; rompe R7/R8 y contradice HD1.
- **A3 — El cobro como egreso de terceros (como el pago de un gasto).** Baja la cifra principal como si
  saliera dinero y no toca la ganancia: es exactamente al revés de lo que pasa.
- **A4 — Anular con un `egreso_ajuste` (propio, efectivo).** Bajaría «Salió»/la cifra por dinero que no
  salió y no devolvería nada a la tienda; el reverso de un cargo tiene que ser un cargo (P1).
- **A5 — Un documento aparte para el cobro (`cobro_tienda`, como `pago_por_cuenta_tienda`).** El cobro ya
  es la fila del libro (381): un documento nuevo exigiría un backfill de documentos para los cobros viejos y
  duplicaría el monto y la fecha en dos sitios. La anulación cuelga de la fila del libro.
- **A6 — Reclasificar los cobros previos como pagos de un gasto (reusar la migración de la 459).** Son
  cobros de verdad (no salió dinero); reclasificarlos negaría la decisión del humano y bajaría la cifra
  principal.
- **A7 — Backfill con el mismo origen que el servicio (`cobro_tienda`).** La reversión no podría distinguir
  lo suyo de lo que escribió el servicio después (P2).
- **A8 — Un solo diccionario para el libro de la tienda.** No puede decir «Ordenex te cobró» y «Ordenex le
  cobra a la tienda» a la vez (P4).
- **A9 — Renombrar también las métricas de la analítica.** Otra pantalla, otras guardias, otro alcance (P7).
- **A10 — Un tipo «cargo» en la caja además de ingreso/egreso.** Enum, CHECK, `derivarBalance`, descargas y
  guardias de la 173/231: un rediseño para arreglar un rótulo (P17).
- **A11 — Editar la migración de reclasificación de la 459 para que rechace cobros con cargo.** Ya está
  aplicada en `dev`: editarla es drift. Si algún día hace falta otra, será nueva y llevará esa comprobación.

## 19. Riesgos y límites declarados

- **L1 — Cobros registrados en producción antes del despliegue** (con el servicio viejo): entran por el
  backfill y suben la ganancia en su suma; se miden antes (R38) y se dicen.
- **L2 — La columna «Tipo» dice «Ingreso» en la línea del cobro** (P17), como en los fletes.
- **L3 — Interruptor `TIENDA_DEBITA_FLETE_DEVOLUCION`** apagado rompería R8 (L1 de la 459); C2 lo vigila.
- **L4 — Base local compartida:** las migraciones ponen rojo el gate de otras sesiones hasta que migren.
- **L5 — Tests ajenos que fijan los nombres viejos** (≈97 literales en 14 archivos, medido con `grep`):
  se reescriben en el mismo commit que el diccionario, cada uno listado en `progress/impl_461.md` con el R
  que lo sustituye; ninguno desaparece sin reemplazo.
- **L6 — Sale con la release completa:** ningún bloque de esta ficha se despliega solo; el contraste de §13
  se corre una vez sobre el conjunto.
