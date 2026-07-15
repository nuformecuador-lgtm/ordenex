# Feature 69 — `cierre_detail`: congelar el detalle y la tarifa del cierre

> Requisitos en notación EARS. Sin detalles de implementación (el CÓMO vive en `design.md`).
> Cada `R<n>` debe mapear a un test concreto (`docs/specs.md` §Trazabilidad).
>
> **Gate F1.4: APROBADA por el humano el 2026-07-15.** Las decisiones (a)–(g) de §7 son **firmes**
> y este documento es su fuente de verdad. No quedan preguntas abiertas.
> Rama: `feature/69-cierre-detail` (desde `origin/dev` `14f6548`, ya con el PR #75).

## Contexto (hechos verificados, no supuestos)

- La relación `cierre_dia` ↔ `orden` YA EXISTE (`gestion_orden.orden_id` + `gestion_orden.cierre_id`,
  `db/schema.prisma:382,391`) y `CierreDiaRepository.crearCierre` (`lib/repositories/CierreDiaRepository.ts:152-239`)
  ya la puebla en una `$transaction` guardada. Esta feature NO crea una relación: crea un **snapshot**.
- **Bug money-critical destapado:** `WalletFeedService.ts:26-39` lee `orden.{zonaId, montoCobrar,
  cobraComision, zona.esCentral}` **vivos** y `WalletFeedService.ts:46` resuelve la **tarifa viva**,
  todo dentro de la tx de aprobación (`CierresAdminRepository.resolverCierre:167-191`).
  `WalletTiendaFeedService.ts:59-74` lee además `orden.tiendaId` (a quién se acredita/debita).
  Esos feeds escriben a libros **append-only inmutables** (`wallet_movimiento`,
  `wallet_tienda_movimiento`). `OrdenRepository.update:442-459` no tiene guarda contra cierres
  (`WHERE { id, deletedAt: null }`). → Editar `monto_cobrar` o la tarifa entre SOLICITAR y APROBAR
  descuadra en silencio los `total_*` snapshot (37/R14) contra los movimientos de wallet.
- `WalletMensajeroFeedService.ts:31-33` es el modelo sano: consume solo snapshots del `cierre_dia`.
- **Punto de escritura único (verificado):** los dos únicos llamadores de `crearCierre` son
  `CierreDiaService.ts:244` (solicitud del mensajero) y `CorteDiarioService.ts:80` (corte diario, 41).
  `CorteDiarioRepository` NO crea cierres (solo consulta). No hay un segundo punto de escritura.
- **`dev` NO COMPILA** (baseline: 2 errores de `pnpm typecheck`, `pnpm build` rojo, `./init.sh` rojo):
  `TarifaVigentePorZonaRepository.ts:22` usa `where: { zonaId }` sobre `tarifa`, columna que PR #64
  eliminó al remodelar la tarifa a **por tienda** (`db/schema.prisma:522-543`: `tarifas` tiene
  `tienda_id` y `status`, no `zona_id`); y `scripts/seed-zonas.ts:257` escribe `distrito.zonaId`,
  columna dropeada por `20260713000000_drop_distrito_zona_id`. Esta feature **absorbe la 68** y es la
  que devuelve el árbol a verde.

---

## 1. El snapshot (`cierre_detail`)

- **R1.** El sistema DEBE persistir, por cada cierre del día, un registro de detalle congelado por
  cada orden incluida en ese cierre, independiente de las filas vivas de `orden`, `zona` y `tarifas`.

- **R2.** El sistema DEBE mantener el grano **(cierre, orden)**: para un mismo cierre y una misma
  orden DEBE existir a lo sumo un registro de detalle, aunque esa orden tenga varias gestiones
  vigentes en el cierre.

- **R3.** CUANDO se crea un cierre del día (solicitud del mensajero o corte diario), el sistema DEBE
  poblar el detalle congelado de todas las órdenes de las gestiones vinculadas a ese cierre, en la
  MISMA transacción en la que inserta el cierre y vincula las gestiones.

- **R4.** SI la creación del cierre falla en cualquier paso, ENTONCES el sistema DEBE no dejar ningún
  registro de detalle congelado (todo-o-nada, sin efectos parciales).

- **R5.** CUANDO el sistema puebla el detalle congelado, DEBE incluir únicamente órdenes de gestiones
  **vigentes** (no anuladas) vinculadas a ese cierre.

- **R6.** El sistema DEBE congelar, por orden, los datos **money-critical**: monto a cobrar, si cobra
  comisión, la zona, la tienda y si la zona es central.

- **R7.** El sistema DEBE congelar, por orden, los datos **descriptivos**: número de guía, número de
  remisión, destinatario, dirección, producto y los nombres de tienda, zona, provincia, cantón y
  distrito vigentes en el instante del cierre.

- **R8.** El sistema DEBE congelar, por orden, la **tarifa vigente** de su tienda en el instante del
  cierre: valor de flete, valor de flete GAM, valor de flete devuelto, valor de flete devuelto GAM,
  porcentaje de comisión COD, porcentaje de IVA de flete y porcentaje de IVA de comisión COD.

- **R9.** SI la tienda de una orden NO tiene tarifa vigente en el instante del cierre, ENTONCES el
  sistema DEBE registrar el detalle de esa orden con la tarifa congelada ausente y DEBE crear el
  cierre igualmente (el gap NO bloquea; ver pregunta abierta (c)).

- **R10.** El sistema DEBE tratar el registro de detalle congelado como **inmutable**: ninguna
  operación posterior a la creación del cierre DEBE modificar ni eliminar sus filas.

- **R11.** El sistema DEBE exponer y persistir todo importe del detalle congelado con escala 2 y sin
  aritmética de punto flotante (money-safe: `Decimal` en DB, `string` al cruzar la frontera).

## 2. Los lectores pasan al snapshot

- **R12.** CUANDO se aprueba un cierre y se construyen los movimientos de la caja principal, el
  sistema DEBE derivar los conceptos a partir del detalle congelado del cierre y de la tarifa
  congelada, y NO DEBE leer `orden`, `zona` ni `tarifas` vivas.

- **R13.** CUANDO se aprueba un cierre y se construyen los movimientos del ledger por tienda, el
  sistema DEBE tomar la tienda destinataria y los datos de derivación del detalle congelado, y NO
  DEBE leer `orden`, `zona` ni `tarifas` vivas.

- **R14.** MIENTRAS un cierre existe, SI al aprobarlo falta el registro de detalle congelado de
  alguna de sus órdenes, ENTONCES el sistema DEBE abortar la aprobación con error (sin fallback a
  datos vivos y sin emitir movimientos de wallet).

- **R15.** CUANDO un administrador consulta el detalle de un cierre ya creado, el sistema DEBE
  mostrar los datos congelados de ese cierre y NO los valores vivos de la orden.

- **R16.** MIENTRAS un cierre no ha sido creado (gestiones sin `cierre_id`), el sistema DEBE seguir
  mostrando el detalle en vivo resuelto por relación, sin depender del snapshot.

## 3. La propiedad de negocio (lo que el humano pidió)

- **R17.** CUANDO se edita una orden (monto a cobrar, cobro de comisión, zona, tienda o datos
  descriptivos) DESPUÉS de solicitar su cierre y ANTES de aprobarlo, el sistema DEBE aprobar el
  cierre con los valores congelados al solicitar, y los movimientos de wallet resultantes DEBEN
  cuadrar con los totales snapshot del cierre.

- **R18.** CUANDO cambia la tarifa de una tienda (alta, edición o borrado lógico) DESPUÉS de
  solicitar un cierre y ANTES de aprobarlo, el sistema DEBE aprobar el cierre con la tarifa
  congelada al solicitar.

- **R19.** CUANDO se borra lógicamente una orden después de crearse su cierre, el sistema DEBE seguir
  mostrando y liquidando esa orden en el cierre con sus datos congelados.

## 4. Resolución de la tarifa (absorbe la feature 68)

- **R20.** El sistema DEBE resolver la tarifa vigente de una orden por la **tienda** de la orden
  (`orden.tienda_id` → `tarifas.tienda_id`), no por su zona.

- **R21.** El sistema DEBE seguir usando el carácter central/GAM de la zona de la orden para elegir
  la **columna** de la tarifa (flete GAM vs flete, flete devuelto GAM vs flete devuelto), sin alterar
  las fórmulas de derivación existentes.

- **R22.** SI una tienda tiene varias tarifas candidatas, ENTONCES el sistema DEBE resolver de forma
  determinista, excluyendo las borradas lógicamente y eligiendo la más reciente. El sistema **NO DEBE**
  filtrar por el estado (`tarifas.status`) de la tarifa: una tarifa `inactivo` no borrada **sigue
  siendo candidata**, igual que hoy. *Decisión (g), override consciente del humano (§7-(g)): NO es un
  olvido — se conserva el comportamiento actual del resolver para no mezclar dos cambios de dinero en
  el mismo PR.*

- **R23.** El sistema DEBE cubrir con test la **implementación real** del resolver de tarifa
  (la consulta efectiva, no un doble de la interfaz), de modo que un cambio de columna del modelo de
  `tarifas` haga fallar la suite.

- **R30.** El sistema DEBE dejar en el código del resolver de tarifa un marcador `TODO:` **localizable
  por grep** que declare la deuda conocida de (g): que `tarifas.status` existe desde el PR #64, que hoy
  NO entra en el `WHERE`, que en consecuencia una tarifa `inactivo` puede resolverse como vigente y
  liquidar dinero, cuál es la salida prevista, y la referencia a esta feature.

## 5. Migración y datos existentes

- **R24.** El sistema DEBE crear el detalle congelado mediante una migración versionada con `UP` y
  `DOWN`, y el `DOWN` DEBE revertir exactamente lo que el `UP` crea.

- **R25.** El sistema DEBE habilitar Row Level Security sobre la tabla nueva sin definir policies
  (acceso sólo por service role), como el resto de tablas de operación.

- **R26.** CUANDO se aplica la migración, el sistema DEBE poblar el detalle congelado de los cierres
  ya existentes a partir de las relaciones vivas, de modo que no queden cierres sin detalle
  congelado (ver pregunta abierta (a)).

- **R27.** El sistema DEBE garantizar que todo cierre existente en base de datos tiene detalle
  congelado para cada una de sus órdenes con gestión vigente (invariante que hace innecesario
  cualquier fallback a datos vivos, R14).

## 6. Verificación (criterio de aceptación, no deuda)

- **R28.** El sistema DEBE quedar con `pnpm typecheck` en **0 errores** (baseline actual = 2, ambos
  de la 68), incluyendo la corrección de `scripts/seed-zonas.ts`, que NO DEBE escribir la columna
  `zona_id` del distrito (eliminada por `20260713000000_drop_distrito_zona_id`; la zona del distrito
  vive en la relación N:M `zona_distrito`).

- **R29.** El sistema DEBE terminar con `pnpm test`, `pnpm lint` y `pnpm build` en **verde**, sin
  regresión de la suite baseline (~2764 tests / 296 archivos / 0 fallos). El sistema DEBE dejar
  `./init.sh` en verde **salvo** por fallos de test que se demuestren **no deterministas y ajenos al
  alcance de la feature**, en cuyo caso la excepción DEBE registrarse con la evidencia que lo
  demuestra (ver enmienda R29.1).

- **R29.1 — Enmienda a R29 (2026-07-15, decidida por el humano). Excepción REGISTRADA, no maquillada.**

  R29 exigía `./init.sh` **VERDE** sin matices, y `tasks.md` T21 lo llamaba *"la definición de hecho
  aquí"*. **`./init.sh` sale ROJO y la feature se cierra igual.** El porqué, con la evidencia y no con
  una promesa:

  - **Lo medido** (por implementer, leader y **re-medido por el reviewer de forma independiente**):
    `pnpm test --testTimeout=30000` ⇒ **301/301 archivos · 2842/2842 tests · 0 fallos · exit 0**.
    `pnpm typecheck` = 0 errores · `pnpm lint` = 0 errores · `pnpm build` VERDE. Las **otras** puertas
    de `init.sh` (`typecheck`, `lint`) pasan: el rojo es **sólo** el `pnpm test` con el `testTimeout`
    default de 5000ms (`init.sh:80-82`).
  - **Por qué es flaky y no un fallo real — la prueba, no la intuición:** el conjunto de archivos que
    falla **cambia entre corridas del MISMO commit** (el leader midió 1–3, el implementer 12–15).
    **Eso es no-determinismo demostrado.** Un fallo real es determinista y **no se arregla subiendo el
    timeout**; éste no lo es y se arregla. Todos los fallos son `Test timed out in 5000ms`.
  - **Por qué es ajeno a la 69:** los archivos que fallan son de **UI** (`HomePage*`, `LoginForm`,
    `OrdenesPagination`, `zona-form`, `recuperar-contrasena-form`, `OrdenesModuleReuse`) y **ninguno
    importa nada que la 69 toque** (verificado por grep). El alcance de la 69 es **backend**.
  - **Lo que la 69 SÍ aporta al síntoma, dicho sin excusas:** la suite creció (+55 tests) y es más
    lenta, así que la ventana de 5000ms se desborda **en más sitios**. La 69 **no introduce** el flaky
    (es preexistente y ambiental), pero **lo hace más visible**. Eso no es regresión de código; es una
    puerta mal calibrada que ya estaba mal calibrada.

  **Criterio real con el que se cierra la 69** (éste, y no otro): `pnpm typecheck` = 0, `pnpm lint`
  verde, `pnpm build` verde, y **`pnpm test --testTimeout=30000` = 2842/2842, exit 0**, medido de
  forma independiente por el reviewer.

  **Lo que esta excepción NO es:** no es una licencia para dar por bueno un `init.sh` rojo. La
  advertencia del reviewer se acepta tal cual y queda escrita aquí: *"mantener un init.sh rojo 'que ya
  sabemos por qué es' es cómo se pierde la única puerta que queda."* La calibración del `testTimeout`
  en la config de vitest **queda como deuda de arnés con dueño** (leader), **fuera del alcance de la
  69** (su alcance es backend; el flaky es de UI). Mientras no se haga, `init.sh` es **no
  interpretable** — y ése es el coste que se está aceptando a sabiendas, por esta feature y una sola
  vez.

---

## Trazabilidad `R<n>` → test

> El mapa definitivo lo escribe el implementer en `progress/impl_69-cierre-detail.md`
> (`docs/specs.md` §Trazabilidad). Este es el destino previsto por el spec.

| R | Test previsto |
| --- | --- |
| R1 | `tests/integration/db/cierre-detail-migration.test.ts` — `CREATE TABLE "cierre_detail"` con sus columnas |
| R2 | `tests/integration/db/cierre-detail-migration.test.ts` — `UNIQUE ("cierre_id", "orden_id")` |
| R3 | `tests/unit/repositories/cierre-dia-repository.test.ts` — `crearCierre` invoca `cierreDetail.createMany` dentro de la misma `$transaction` |
| R4 | `tests/unit/repositories/cierre-dia-repository.test.ts` — fallo del `createMany` ⇒ rollback, cero efectos |
| R5 | `tests/unit/repositories/cierre-dia-repository.test.ts` — una gestión `anulada_at != null` NO produce fila de detalle |
| R6 | `tests/unit/repositories/cierre-dia-repository.test.ts` — payload con `montoCobrar`/`cobraComision`/`zonaId`/`tiendaId`/`esCentral` |
| R7 | `tests/unit/repositories/cierre-dia-repository.test.ts` — payload con guía/remisión/destinatario/dirección/producto + nombres desnormalizados |
| R8 | `tests/unit/repositories/cierre-dia-repository.test.ts` — payload con los 7 valores de tarifa congelados |
| R9 | `tests/unit/repositories/cierre-dia-repository.test.ts` — tienda sin tarifa ⇒ fila con tarifa nula y cierre creado |
| R10 | `tests/unit/repositories/cierre-detail-inmutable.test.ts` — ningún repo emite `cierreDetail.update*`/`delete*` (test estructural sobre el código) |
| R11 | `tests/unit/utils/…` + `cierre-dia-repository.test.ts` — `Decimal`/`string` escala 2; cero `parseFloat`/`Number(` sobre montos |
| R12 | `tests/unit/services/wallet-feed-service.test.ts` — deriva desde `cierreDetail`; `orden`/`tarifa` vivas nunca consultadas |
| R13 | `tests/unit/services/wallet-tienda-feed-service.test.ts` — ídem + `tiendaId` desde el snapshot |
| R14 | `tests/unit/services/wallet-feed-service.test.ts` + `wallet-tienda-feed-service.test.ts` — falta la fila ⇒ throw, sin movimientos |
| R15 | `tests/unit/repositories/cierres-admin-repository.test.ts` — el detalle admin sale de `cierre_detail` · **+ `tests/unit/repositories/cierres-bodega-admin-repository.test.ts` — el detalle de bodega (40) también sale del snapshot** (T23: R15 alcanza **las dos** vistas de admin; el censo de `design.md` §4.4 que lo acotaba a una era falso — ver §4.4.1) |
| R16 | `tests/unit/repositories/cierre-dia-repository.test.ts` — `findGestionesPendientes` sigue resolviendo en vivo |
| R17 | `tests/integration/db/cierre-detail-congelado.test.ts` — editar la orden entre solicitar y aprobar NO cambia los movimientos; cuadran con `total_*` |
| R18 | `tests/integration/db/cierre-detail-congelado.test.ts` — cambiar la tarifa entre solicitar y aprobar NO cambia los movimientos |
| R19 | `tests/unit/repositories/cierres-admin-repository.test.ts` — orden con `deleted_at` sigue en el detalle del cierre |
| R20 | `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` — `where.tiendaId` |
| R21 | `tests/unit/utils/ingreso-ordenex.test.ts` (existente) — `esCentral` elige columna GAM (sin cambio de fórmula) |
| R22 | `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` — `deletedAt: null` + `orderBy createdAt desc` **+ `where` NO contiene `status`** (fija el override (g): si alguien "arregla" el filtro sin gate, el test lo delata) |
| R23 | `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` — ejercita la CLASE real contra un doble de `PrismaClient` y afirma los argumentos exactos de `tarifa.findFirst` |
| R24 | `tests/integration/db/cierre-detail-migration.test.ts` — `migration.sql` + `down.sql`; el DOWN dropea la tabla |
| R25 | `tests/integration/db/cierre-detail-migration.test.ts` — `ENABLE ROW LEVEL SECURITY` y `not.toMatch(/CREATE POLICY/i)` |
| R26 | `tests/integration/db/cierre-detail-migration.test.ts` — el UP contiene el `INSERT … SELECT` de backfill |
| R27 | `tests/integration/db/cierre-detail-migration.test.ts` — backfill sin `WHERE` que excluya cierres; verificación real de round-trip a cargo del implementer (`docs/verification.md`) |
| R28 | `pnpm typecheck` = 0 errores (evidencia en `progress/impl_69-cierre-detail.md`) + `tests/unit/scripts/seed-zonas.test.ts` (existente) verde |
| R29 | `pnpm typecheck` = 0 · `pnpm lint` verde · `pnpm build` verde · **`pnpm test --testTimeout=30000` = 2842/2842 exit 0** (evidencia en `progress/impl_69-cierre-detail.md`, re-medida por el reviewer). **`./init.sh` ROJO: excepción registrada en R29.1** (flaky ambiental de UI, no determinista y ajeno a la 69) |
| R30 | `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` — test estructural: el fuente del resolver contiene un `TODO:` que menciona `status` y la feature 69 (falla si alguien lo borra al refactorizar) |

---

## 7. Decisiones F1.4 — **APROBADAS por el humano el 2026-07-15**

> **Esto ya no son preguntas abiertas: es la gate F1.4 aprobada.** Se conserva el porqué de cada una
> porque es el registro de la decisión, no una propuesta. El alcance (1)–(4) de `feature_list.json`
> ya venía aprobado.
>
> - **(a)–(f): aprobadas TAL CUAL** las recomendaciones del spec_author.
> - **(g): OVERRIDE del humano** — se decide lo CONTRARIO a la recomendación. Ver (g).
>
> Cualquier desviación respecto de lo escrito aquí exige una nueva gate: no se decide en implementación.

### (a) Cierres ya existentes: backfill vs `cierre_detail` vacía con fallback — **DECIDIDO**

**BACKFILL en el `UP` de la migración, y lectores SIN fallback (R14/R26/R27).** Aprobado tal cual;
coincidía con el sesgo del leader. Porqué:

1. **Una sola fuente de verdad.** Un fallback `cierre_detail → si no hay, `g.orden.*`` deja vivos los
   dos caminos de lectura money-critical para siempre; el bug que esta feature mata seguiría
   alcanzable por el camino B, y ningún test podría demostrar que el camino B ya no se toma.
2. **El backfill no puede empeorar nada.** Para un cierre `solicitado`/`vencido` aún abierto, el
   valor que congela el backfill es **exactamente el que el feed leería hoy** al aprobarlo: congelarlo
   es estrictamente mejor (deja de moverse). Para un cierre ya `aprobado`, los movimientos ya están
   escritos en los libros inmutables y los feeds son idempotentes (`skipDuplicates`, 42/R6/R13): el
   backfill no reescribe dinero, sólo documenta.
3. **Sin fallback, `falta la fila` puede ser un error duro (R14)** en vez de un silencio. Es la
   diferencia entre "descuadre invisible" y "la aprobación aborta y alguien lo ve".

**Riesgo aceptado y explícito:** el backfill congela el valor **actual**, que para un cierre ya
descuadrado puede no ser el que estaba al solicitarlo (el dato original ya se perdió: no hay
historial de `monto_cobrar`). El backfill NO repara descuadres pasados; los detiene desde hoy.
Corolario para la tarifa: como `tarifas.zona_id` ya no existe, la tarifa backfilleada se resuelve con
la regla NUEVA (por tienda, R20) — es la única resolución posible y es la misma que se aplicaría hoy.

### (b) Grano del snapshot de tarifa: columnas, fila por (cierre, tienda), o conceptos derivados — **DECIDIDO**

**Columnas de tarifa (las ENTRADAS) en `cierre_detail`.** Aprobado tal cual. **El humano dejó
constancia de que este análisis corrigió un sesgo suyo**: la sugerencia inicial era congelar los
CONCEPTOS YA DERIVADOS, y el argumento de abajo (dependen del `resultado` de la GESTIÓN,
`lib/utils/ingreso-ordenex.ts:62,82`, no de la orden ⇒ exigirían el grano que se descartó) lo
revirtió. Registro completo de la alternativa evaluada y descartada en `design.md` §7.1.
Las tres se evaluaron en serio; el desempate es el **grano aprobado**:

- **(b3) Congelar los CONCEPTOS YA DERIVADOS** (flete/IVA/comisión) es atractivo y es el patrón de los
  `*_movimiento`… pero los conceptos derivados dependen del **`resultado` de la GESTIÓN**
  (`derivarIngresoOrden`: `entregada` → flete + comisión; `devuelta`/`rechazada` → flete de
  devolución), **no de la orden**. Congelarlos exige grano **gestión**, que es justo el grano que el
  humano descartó para `cierre_detail` (y con razón: una orden puede tener más de una gestión vigente
  en el mismo cierre tras un reintento 46/47). Además perdería la auditabilidad de "con qué tarifa se
  calculó" y **no simplifica**: la 43 necesita el desglose por concepto igual (interruptor Q3,
  43/R28) y el ancho de columnas sería equivalente. Nota: el paralelismo con los `*_movimiento` es
  aparente — esos son la **salida** del cierre APROBADO; el hueco a tapar está entre SOLICITAR y
  APROBAR, y ahí lo que hay que fijar son las **entradas**.
- **(b2) Fila por (cierre, tienda)** normaliza (una tienda con 40 órdenes no repite 7 decimales), pero
  añade una segunda tabla, un join y un segundo punto de escritura en la tx, para ahorrar bytes en
  una tabla de detalle que ya desnormaliza 5 nombres. No lo vale.
- **(b1) Columnas en `cierre_detail`** encaja en el grano aprobado, mantiene `derivarIngresoOrden`
  como fuente única de la fórmula (sin tocar 42/43), y hace la fila **auditable y re-derivable**:
  entradas + fórmula ⇒ salida reproducible.

### (c) Tienda sin tarifa vigente al solicitar: conservar el gap vs bloquear — **DECIDIDO**

**Se conserva el gap (R9), sin bloquear.** Aprobado tal cual. Porqué:

1. **A quién castiga.** El cierre lo solicita el **mensajero**; la tarifa es configuración de la
   **tienda**. Bloquear el cierre le impide cerrar su día por un dato que no controla ni puede
   arreglar.
2. **Rompe el corte diario.** `CorteDiarioService` (41) crea cierres `vencido` de forma automática y
   masiva. Un bloqueo ahí convierte una tienda mal configurada en un cron caído para todos.
3. **Fuera de alcance.** Cambiarlo altera el comportamiento aprobado de 42/R9 y 43/R14.

**Mejora que sí trae la 69:** hoy el gap es **invisible** (conceptos 0.00 y nadie se entera). Con el
snapshot, `tarifa_* IS NULL` en `cierre_detail` deja **rastro explícito y consultable** de qué
órdenes se cerraron sin tarifa. El aviso/reporte sobre ese rastro queda **fuera del alcance** de la 69
(feature aparte).

### (d) Cobertura del resolver real de tarifa — **DECIDIDO**

**El spec lo exige (R23)**, con una precisión importante. Verificado: **no hay
tests contra Postgres real** en este repo — `tests/integration/db/*` son estáticos (regex sobre el
SQL) o usan tiendas en memoria (`wallet-idempotencia.test.ts`), y el round-trip real lo corre el
implementer. Así que "test real" aquí significa: **unit test de la CLASE del repositorio**
(`TarifaVigentePorTiendaRepository`), no del doble de `ITarifaVigente…`, afirmando los argumentos
exactos que le pasa a `prisma.tarifa.findFirst` (`where.tiendaId`, `deletedAt: null`, `orderBy`).
Matiz honesto: la red que **realmente** habría atrapado la 68 es `pnpm typecheck` — y lo hizo; el
fallo fue de **proceso** (2 errores tolerados como baseline durante varias features), no de tests.
Por eso R28 exige typecheck en **0**, no "sin errores nuevos".

### (e) Guarda al UPDATE de `orden` como complemento del snapshot — **DECIDIDO**

**NO se añade en esta feature.** Aprobado tal cual. El humano ya eligió snapshot; añadir la guarda:

1. **No cubre el vector de la tarifa.** Cambiar una tarifa no toca `orden`: la guarda no lo ve. El
   snapshot cubre ambos vectores; la guarda cubre uno a medias.
2. **Rompe ediciones legítimas.** `OrdenRepository.update` mueve también `notas`, `estatus_id`,
   `mensajero_asignado_id`… Una guarda "orden con cierre ⇒ no editable" bloquearía flujos vivos
   (46/47/67). Una guarda selectiva por campo money-critical es una feature con su propia gate.
3. **Con el snapshot, la edición ya es inofensiva** para el dinero: el cierre no la mira (R17).

**Nota que sobrevive a la decisión:** el histórico de `monto_cobrar` NO existe (la 49 sólo historiza
estados), y por eso el backfill de (a) no puede reparar el pasado. Si algún día se quiere la guarda,
va en feature aparte con su propio análisis de los call-sites de escritura de `orden`.

### (f) Segundo punto de escritura de cierres — **DECIDIDO (confirmación, no pregunta)**

**Verificado: NO existe.** Los únicos llamadores de `ICierreDiaRepository.crearCierre` son
`CierreDiaService.ts:244` y `CorteDiarioService.ts:80`; `CorteDiarioRepository` sólo consulta
(`findMensajerosConActividadSinCierre`). `CierreBodegaRepository.crearCierreBodega` es otro nivel
(consolida cierres ya existentes, no crea `cierre_dia`). **Conclusión:** poblar `cierre_detail` dentro
de `crearCierre` cubre los dos caminos por construcción — se deja como task de regresión (`T13`: test
que falla si aparece un tercer llamador).

### (g) `tarifas.status = 'inactivo'` como tarifa vigente — **DECIDIDO: OVERRIDE DEL HUMANO**

> **El humano decidió lo CONTRARIO a la recomendación del spec_author.** Queda escrito así a
> propósito: la recomendación descartada es parte del registro de la decisión.

**DECISIÓN: NO se filtra `status = 'activo'` en esta feature.** Se **conserva el comportamiento actual**
del resolver: `tienda_id` + `deletedAt: null` + la más reciente (R20/R22). Una tarifa `inactivo` no
borrada **sigue siendo candidata**, exactamente como hoy.

**Razón del humano:** no mezclar **dos cambios de dinero en un mismo PR**. La 69 ya cambia *qué tarifa
se resuelve* (por tienda en vez de por zona) y *cuándo se lee* (al solicitar en vez de al aprobar).
Añadir *qué filas son candidatas* sería un tercer cambio de comportamiento monetario en el mismo
merge, con los tres efectos superpuestos e indistinguibles si algo descuadra.

**Deuda conocida y ACEPTADA, sin maquillar:** mientras `status` no entre en el `WHERE`, **el dinero
puede derivarse de una tarifa `inactivo`** — incluida la de una tienda que dejó de ser `adminTienda`
(que es justo lo que `status` marca, `db/schema.prisma:533`). La 69 no lo introduce (es el
comportamiento vigente desde el PR #64) pero tampoco lo arregla, y ahora además lo **congela**: el
snapshot registrará fielmente la tarifa inactiva que se eligió.

**Contrapartida real:** el `tarifa_id` congelado en `cierre_detail` (design §2.1) hace esta deuda
**auditable por primera vez** — se puede consultar qué cierres liquidaron contra una tarifa hoy
inactiva. Antes no quedaba rastro de qué fila se usó.

**Salida prevista:** R30 exige un `TODO:` localizable por grep en el resolver. **Ver `design.md` §6.1
para qué queda realmente pendiente** — no es el congelado (R8 ya lo cubre), es la **regla de selección
de la fila vigente**. Esa precisión está reportada al humano y el texto exacto del `TODO` queda sujeto
a su confirmación (`design.md` §6.1).
