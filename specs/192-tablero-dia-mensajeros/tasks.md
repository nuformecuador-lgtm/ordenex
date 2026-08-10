# Feature 192 — Tasks

Convenciones: `[P]` = paralelizable con las demás `[P]` de su mismo bloque.
`dep:` = tasks que deben estar hechas antes. Cada task lleva su criterio de **hecho**.

**BACKEND** (B*) y **FRONTEND** (F*) van en bloques separados porque los implementan
agentes distintos. La única frontera entre ellos es el contrato de `§6` del design
(`lib/types/tablero-dia.ts` + la firma de `leerTableroDia`): **T0 lo fija primero y
después ninguno de los dos lo cambia sin avisar al otro.**

Nada de esto crea migraciones, tablas, columnas ni índices. Si alguna task te pide
escribir en `db/`, es que la leíste mal.

> **Revisión del 2026-08-08 (2.ª puerta).** Desglose de "sin resultado" en
> `sinRecoger`/`enReparto`/`otros` (B6, F5), tarjetas en vez de filas (F2), drill-down
> (B7, F6) e ítem de menú "Monitoreo" (F3). La ruta pasa a `/monitoreo`.
>
> **Revisión del 2026-08-08 (3.ª vuelta).** "Asignada hoy" pasa a tener **dos caminos**
> (opción C): `asignado_at` **o** una transición `asignacion_recoleccion` del día en el
> historial → bloque **B8**, con su guardia de que `asignado_at` NO se escribe jamás.
> Las tasks nuevas están marcadas **(nueva)**.
>
> **Revisión del 2026-08-08 (4.ª vuelta).** Sin índice nuevo (R37 intacto): el camino 2 se
> mitiga con una **caché de servidor de ~15 s** → bloque **B9**. B8.7 queda retirada.
>
> ⛔ **Dos reglas que atraviesan todo el bloque backend:**
> 1. Ninguna task escribe `orden.asignado_at`. Es sólo lectura. Si una task parece pedirlo,
>    la leíste mal.
> 2. Ninguna task crea migraciones ni índices. La caché de B9 es la mitigación acordada;
>    "ya que estamos, un índice" es exactamente lo que el humano descartó.

---

## T0 — Contrato compartido (bloqueante para los dos bloques)

- [x] **T0.1** Crear `lib/types/tablero-dia.ts` con `FilaTableroDia` (con los ocho
  contadores, incluidos `sinRecoger`/`enReparto`/`otros`), `TableroDia`,
  `OrdenDetalleDia`, `DetalleMensajeroDia`, `BucketSinResultado` y
  `MotivoTableroDia`/`ResultadoTableroDia` exactamente como en `design.md §6` y §3.4.
  El `MotivoDenegacion` se trae con `import type` de `lib/analytics/alcance`.
  **Hecho:** `pnpm typecheck` verde y el archivo no importa nada de `repositories/`,
  `services/`, `@/lib/db` ni `next/headers`.
- [x] **T0.2 (nueva)** En el mismo archivo, `BUCKET_POR_ESTATUS` (`design.md §1.bis`)
  declarado `satisfies` sobre `OrderStatusValue`, con `por_recoger` y `recolectando` →
  `sinRecoger`, `en_reparto` → `enReparto` y el resto → `otros` por defecto.
  **Hecho:** typecheck verde; el mapa es la ÚNICA declaración de esta clasificación en
  todo el árbol (lo verifica B6.2). dep: T0.1

---

## BACKEND

### B1 — Ventana del día

- [x] **B1.1** `lib/utils/ventana-dia-cr.ts`: `ventanaDelDiaEnCursoCR(now: Date)` →
  `{ fecha, desde, hasta }`, construido **sólo** con `fechaCalendarioCR`,
  `inicioDelDiaCREnUtc` e `inicioDelDiaSiguienteCREnUtc`. `now` obligatorio, sin default.
  **Hecho:** módulo puro (sin Prisma, sin `next/headers`, sin `new Date()` propio) y
  `pnpm typecheck` verde. dep: —
- [x] **B1.2** `tests/unit/utils/ventana-dia-cr.test.ts`: reloj congelado en los instantes
  frontera — 19:00 CR (R13), 23:00 CR del día anterior (R14), 00:30 CR (R15),
  `05:59:59.999Z` y `06:00:00.000Z` (R12). Asertar `desde === "<fecha>T06:00:00.000Z"` y
  `hasta = desde + 24 h`. **Hecho:** R12–R16 cubiertos y en verde. dep: B1.1

### B2 — Repositorio (la consulta agregada)

- [x] **B2.1** `lib/interfaces/repositories/ITableroDiaRepository.ts`:
  `contarPorMensajero(ventana, filtro): Promise<readonly FilaConteoMensajero[]>`, donde
  `filtro` es `{ tipo:"global" } | { tipo:"zona"; zonaId: string }`.
  **Hecho:** un archivo, una interfaz; typecheck verde. dep: T0.1
- [x] **B2.2** `lib/repositories/TableroDiaRepository.ts` con el SQL de `design.md §5`
  vía `$queryRaw` y cliente estrechado a `Pick<PrismaClient,"$queryRaw">`. Fragmento de
  zona con `Prisma.sql`/`Prisma.empty` y `zonaId` **parametrizado**. Los ocho contadores,
  incluidos los tres buckets del segundo eje, con las listas de estatus **derivadas de
  `BUCKET_POR_ESTATUS`** y pasadas como parámetros (nunca literales en la cadena SQL).
  `COUNT` (`bigint`) mapeado a `number`. Sin lógica de negocio, sin validación de permisos.
  **Hecho:** implementa la interfaz, typecheck verde, cero `any`. dep: B2.1, T0.2
- [x] **B2.3** `tests/unit/repositories/tablero-dia-sql.test.ts`: con un `$queryRaw`
  espiado, asertar (a) que el predicado lleva `asignado_at >= … AND asignado_at < …` y
  `mensajero_asignado_id` — el prefijo del índice existente (R37); (b) que con alcance
  zona el SQL incluye `o.zona_id = $` y el `zonaId` viaja como **parámetro**, no
  interpolado (R10); (c) que con alcance global ese fragmento **no** aparece; (d) que el
  `bigint` se convierte a `number`. **Hecho:** R10/R37 en verde. dep: B2.2
- [x] **B2.4 [P]** `tests/integration/tablero-dia-conteo.test.ts` (DB de test). Escenarios
  mínimos: orden con 3 gestiones vigentes el mismo día → aporta 1 (R20); orden sin
  gestión → pendiente (R21); orden cuyas gestiones están todas anuladas → pendiente
  (R22); gestión del día siguiente sobre orden de hoy → no cuenta (R23); gestión
  registrada por un usuario distinto del mensajero asignado → cuenta para el asignado
  (R26); órdenes sin gestión en estatus `por_recoger`, `en_reparto` y
  `por_recolectar_en_tienda` → `sinRecoger`, `enReparto` y `otros` respectivamente
  (R21/R43/R44); asserción de la **identidad de ocho sumandos** de R25 en cada escenario
  y en los totales (R18/R19).
  **Hecho:** R18–R23, R25, R26, R44 en verde. dep: B2.2
- [x] **B2.5 [P]** `tests/integration/tablero-dia-aislamiento.test.ts`: mensajero cuyo
  `usuario.zona_id` es la zona A con una orden de `zona_id` B; un `adminSatelite` de A
  **no** debe verla y el de B **sí** (R6). **Hecho:** R6 en verde. dep: B2.2

### B3 — Servicio (alcance, ventana, totales)

- [x] **B3.1** `lib/interfaces/services/ITableroDiaService.ts`: `obtener(actor, now)` →
  `ResultadoTableroDia`. **Hecho:** typecheck verde. dep: T0.1
- [x] **B3.2** `lib/services/TableroDiaService.ts`: repositorio por constructor;
  `METRICA_ALCANCE_TABLERO` declarada una sola vez; llama a `resolverAlcance`; `switch`
  **exhaustivo sin `default`** sobre `AlcanceDatos` con la lista blanca de `design.md §3.3`;
  arma `fecha`/`generadoAt`, ordena las filas (R29) y suma los totales (R30).
  **Hecho:** testeable sin DB ni HTTP; no importa `next/headers`; typecheck verde.
  dep: B2.1, B3.1, B1.1
- [x] **B3.3** `tests/unit/services/tablero-dia-alcance.test.ts`: tabla por rol —
  `admin`/`maestro` → filtro global (R4); `adminSatelite` con zona → filtro de **esa**
  zona (R5); `adminSatelite` sin zona → denegado `sin_zona_asignada` (R7);
  `adminTienda`, `mensajero`, `apiKey`, rol inventado → denegado, con el repositorio
  **nunca llamado** (R1/R3/R9). **Hecho:** R1, R3, R4, R5, R7, R9 en verde. dep: B3.2
- [x] **B3.4 [P]** `tests/unit/services/tablero-dia-filas.test.ts`: orden determinista
  (R29) incluido el desempate por nombre, y totales = suma de las filas pintadas (R30).
  **Hecho:** R29, R30 en verde. dep: B3.2
- [x] **B3.5 [P]** `tests/unit/tablero-dia/resultados-exhaustivos.test.ts`: el mapa de
  columnas se declara `satisfies Record<GestionResultado, string>` y el test comprueba
  que cubre los 5 valores del enum; un sexto valor debe romper compilación o test
  (R24/R27). **Hecho:** R24, R27 en verde. dep: B3.2
- [x] **B3.6 [P]** Guardia de la métrica (`design.md §3.2`): test que verifica que
  `METRICA_ALCANCE_TABLERO` existe en `METRICAS` con `unidadDeConteo === "orden"` y grano
  `mensajero`. **Hecho:** en verde; renombrar la métrica lo pone rojo. dep: B3.2

### B4 — Borde (Server Action)

- [x] **B4.1** `lib/actions/tablero-dia.ts` (`'use server'`): `leerTableroDia()` sin
  parámetros; `resolveActorFromSession()`; si no hay actor → `denegado("sin_sesion")`;
  instancia el servicio con el cliente Prisma real y `new Date()` (**único** `new Date()`
  de la feature). Devuelve el resultado discriminado; nunca lanza con datos dentro; no
  loguea PII ni ids ajenos. **Hecho:** typecheck verde y devuelve el contrato de T0.1.
  dep: B3.2
- [x] **B4.2** `tests/unit/actions/tablero-dia-accion.test.ts`: sin cookie de sesión →
  denegado sin filas (R2); con sesión válida de `admin` → `estado:"ok"`. **Hecho:** R2 en
  verde. dep: B4.1

### B6 — Segundo eje: buckets por estatus (nueva, 2026-08-08)

- [x] **B6.1 (nueva)** `tests/unit/tablero-dia/buckets-estatus.test.ts`: tabla completa
  estatus → bucket sobre `ORDER_STATUS_SEED`, con los tres casos nombrados en R43 y con
  `por_recolectar_en_tienda` → `otros` (R44), y comprobando que ningún value no enumerado
  cae en `sinRecoger`/`enReparto` (R45). **Hecho:** R43, R44, R45 en verde. dep: T0.2
- [x] **B6.2 (nueva)** `tests/unit/tablero-dia/buckets-estatus.guardia.test.ts`: **todo**
  value de `ORDER_STATUS_SEED` tiene bucket asignado, y la clasificación no está declarada
  en ningún otro archivo del árbol (censo). Un value nuevo, renombrado o retirado deja
  esto rojo (R46). **Hecho:** R46 en verde y falla al añadir un value ficticio. dep: T0.2

### B7 — Detalle del mensajero (drill-down) (nueva, 2026-08-08)

- [x] **B7.1 (nueva)** Ampliar `ITableroDiaRepository` con
  `listarOrdenesDelDia(ventana, filtro, mensajeroId, pagina)` y su tipo de fila.
  **Hecho:** typecheck verde. dep: B2.1
- [x] **B7.2 (nueva)** Implementarlo con el SQL de `design.md §5.bis`: `LATERAL … LIMIT 1`
  con la **misma** definición de "resultado del día" que el tablero, `WHERE` con
  mensajero + ventana + recorte de zona, `LIMIT/OFFSET`. Comentario en el código que ate
  las dos consultas: tocar una obliga a tocar la otra.
  **Hecho:** typecheck verde, cero `any`. dep: B7.1
- [x] **B7.3 (nueva)** `tests/unit/repositories/tablero-dia-detalle-sql.test.ts`: el SQL
  lleva `LIMIT`/`OFFSET` (R55), el `mensajeroId` y el `zonaId` viajan como parámetros, y
  con alcance global no aparece el fragmento de zona. **Hecho:** R55 en verde. dep: B7.2
- [x] **B7.4 (nueva)** `TableroDiaService.detalle(actor, now, mensajeroId, pagina)`:
  **repite** `resolverAlcance` + lista blanca (no recibe filtro del cliente) y delega en
  B7.2. **Hecho:** typecheck verde; el test de B7.5 lo verifica. dep: B7.2, B3.2
- [x] **B7.5 (nueva)** `tests/unit/services/tablero-dia-detalle-alcance.test.ts`: el
  detalle llama a `resolverAlcance` (R40) y deniega para los mismos roles que el tablero.
  **Hecho:** R40 en verde. dep: B7.4
- [x] **B7.6 (nueva)** `lib/actions/tablero-dia.ts`: añadir
  `leerDetalleMensajeroDia(input)` con **zod** en el borde (uuid + página entera acotada).
  Un id inválido o un mensajero fuera de alcance devuelve vacío/denegado sin revelar
  existencia. **Hecho:** typecheck verde. dep: B7.4, B4.1
- [x] **B7.7 (nueva, ampliada en la 3.ª vuelta)** `tests/unit/actions/tablero-dia-detalle-accion.test.ts`
  — los **tres** casos malos (id inexistente, mensajero fuera del alcance, mensajero sin
  órdenes hoy) devuelven la MISMA respuesta vacía, sin distinguirse por mensaje ni por
  código (R42/R63) +
  `tests/integration/tablero-dia-detalle-aislamiento.test.ts` (R41: satélite pidiendo un
  mensajero con órdenes de otra zona recibe **sólo** las de la suya) +
  `tests/integration/tablero-dia-detalle-cuadre.test.ts` (R51: `total` del detalle ==
  `asignadas` de la tarjeta sobre el mismo dataset).
  **Hecho:** R41, R42, R51 en verde. dep: B7.6

### B8 — Segundo camino de "asignada hoy" (nueva, 3.ª vuelta)

> Va **antes** que B2.4/B7 en el orden de lectura, pero después de B2.2 en el de
> ejecución: es una ampliación del SQL ya escrito.

- [x] **B8.1 (nueva)** Extraer a un fragmento `Prisma.sql` **único** los CTE
  `ids_reparto` / `ids_recoleccion` / `ids_del_dia` de `design.md §5`, con `UNION` (de
  conjuntos) y **nunca** `UNION ALL`. Lo consumen tanto el tablero como el detalle.
  **Hecho:** un solo sitio declara los dos caminos; typecheck verde. dep: B2.2
- [x] **B8.2 (nueva)** Cablearlo en la consulta del tablero: el recorte por zona y el
  `mensajero_asignado_id IS NOT NULL` se aplican **después** de la unión, sobre `orden`.
  **Hecho:** el SQL resultante es el de `design.md §5`. dep: B8.1
- [x] **B8.3 (nueva)** Cablearlo en la consulta del detalle (B7.2) con `o.id IN (SELECT id
  FROM ids_del_dia)` en lugar del predicado de `asignado_at`.
  **Hecho:** tablero y detalle comparten literalmente el mismo fragmento. dep: B8.1, B7.2
- [x] **B8.4 (nueva)** `tests/integration/tablero-dia-recoleccion.test.ts` (DB de test):
  (a) orden con `asignado_at` NULL + fila `asignacion_recoleccion` de **hoy** → cuenta
  (R57); la misma fila con fecha de **ayer** → no cuenta;
  (b) orden alcanzable por los **dos** caminos → aporta **1**, con la identidad de R25
  intacta (R58);
  (c) el `actor_usuario_id` del historial es un maestro distinto del mensajero asignado →
  la orden cuenta en la tarjeta del **mensajero** (R60);
  (d) recolección en `recolectando` → `sinRecoger`; recolección ya gestionada hoy → su
  resultado (R61);
  (e) dos transiciones de recolección de la misma orden el mismo día (reasignación) →
  sigue aportando 1 (R58).
  **Hecho:** R57, R58, R60, R61 en verde. dep: B8.2
- [x] **B8.5 (nueva)** `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts`:
  censo del árbol de la feature — ningún archivo escribe `asignadoAt`/`asignado_at`
  (ni `update`, ni `updateMany`, ni SQL), y la feature no añade ninguna migración que
  toque esa columna (R59).
  **Hecho:** R59 en verde; el guardia falla si se introduce una escritura. dep: B8.2
- [x] **B8.6 (nueva)** Ampliar `tests/unit/repositories/tablero-dia-sql.test.ts`: el
  predicado del historial lleva `origen_tipo` **y** el rango de `created_at` en el mismo
  `WHERE` (R65), y todo se resuelve en **una sola** llamada a `$queryRaw` (R64).
  **Hecho:** R64, R65 en verde. dep: B8.2
- [x] ~~**B8.7** Índice parcial del camino 2.~~ **RETIRADA** (humano, 2026-08-08, 4.ª
  vuelta): se eligió la opción 2 — **sin índice**, R37 intacto. La mitigación es la caché
  del bloque **B9**. No crear ninguna migración en esta feature.

### B9 — La caché de servidor (nueva, 4.ª vuelta)

> **Leé `design.md §5.quater` antes de escribir una línea.** La clave de esta caché es una
> frontera multi-tenant: mal claveada no rompe, responde rápido y con los datos de otro.

- [x] **B9.1 (nueva)** `lib/interfaces/external/ITableroDiaCache.ts` con **un solo**
  método: `envolver<T>(clave, producir): Promise<T>`. **Sin** `tags`, **sin** `invalidar`
  (R71: lo que no existe no se puede enganchar a una escritura).
  **Hecho:** typecheck verde; el archivo no declara ninguna operación de invalidación.
  dep: T0.1
- [x] **B9.2 (nueva)** `lib/config/tablero-dia-cache.ts`: TTL (~15 s) como configuración,
  no como literal esparcido (R72). **Hecho:** un único sitio declara el TTL. dep: —
- [x] **B9.3 (nueva)** Adaptadores: `lib/cache/next-tablero-dia-cache.ts` (dos líneas
  sobre `unstable_cache(producir, [clave], { revalidate: TTL })`, **único** archivo de la
  feature que importa `next/cache`) y, para tests, una caché **nula** y una **en memoria
  con reloj inyectado**. **Hecho:** la suite unitaria del servicio corre sin runtime de
  Next. dep: B9.1, B9.2
- [x] **B9.4 (nueva)** `claveDeTablero(alcance, fechaCR)` en el servicio, **reutilizando**
  `claveDeAlcance` de `lib/analytics/cache-clave.ts` (no reescribir la codificación del
  alcance), con prefijo `tablero-dia` + `v1` y el separador `US`.
  **Hecho:** typecheck verde; la clave no contiene `usuarioId` ni rol (R68). dep: B9.1
- [x] **B9.5 (nueva)** Cablear en `TableroDiaService.obtener`: alcance → lista blanca →
  clave → `cache.envolver`. El `generadoAt` se estampa **dentro** de `producir` y viaja
  dentro del valor cacheado (R34). El detalle **no** pasa por la caché (R73).
  **Hecho:** el orden de operaciones es el de `design.md §5.quater`. dep: B9.3, B9.4, B3.2
- [x] **B9.6 (nueva)** `tests/unit/services/tablero-dia-cache.test.ts` (caché en memoria +
  reloj inyectado, sin dormir el test): acierto dentro del TTL y producción nueva al
  expirar (R66/R72); dos usuarios distintos con el **mismo** alcance → una sola producción
  (R68); reloj cruzando medianoche CR → clave distinta (R70); un acierto conserva el
  `generadoAt` original (R34). **Hecho:** R66, R68, R70, R72 y la mitad de R34 en verde.
  dep: B9.5
- [x] **B9.7 (nueva, ES EL TEST DE SEGURIDAD)**
  `tests/unit/services/tablero-dia-cache-aislamiento.guardia.test.ts`:
  (a) un `maestro` (global) y un `adminSatelite` de zona X, uno tras otro **dentro** de la
  ventana de vida, reciben **conjuntos de filas distintos** — se asserta el CONTENIDO
  devuelto, no el número de llamadas (R67);
  (b) satélite de zona X y satélite de zona Y tampoco comparten entrada (R67);
  (c) con una entrada caliente de alcance global, un `adminTienda` y un satélite **sin
  zona** reciben **denegado** y la caché ni se consulta (R69).
  **Hecho:** R67 y R69 en verde. Este test es el que impide que la mitigación de
  rendimiento se convierta en una fuga entre inquilinos. dep: B9.5
- [x] **B9.8 (nueva)** `tests/unit/tablero-dia/cache-sin-invalidacion.guardia.test.ts`:
  censo del árbol — el puerto no declara `invalidar`, ningún archivo de la feature importa
  `revalidateTag`/`revalidatePath`/`updateTag`, y sólo el adaptador de producción importa
  `next/cache` (R71). **Hecho:** R71 en verde. dep: B9.3

### B5 — Guardias de frontera del backend

- [x] **B5.1** `tests/unit/tablero-dia/frontera.guardia.test.ts` — censa **el árbol** de
  los archivos de la feature (no el diff, para que sobreviva al merge):
  (a) ningún archivo de la feature importa `startOfDayCR` (R17);
  (b) ningún archivo de la feature importa `lib/analytics/rollup-dia`, `analytics_daily`
  ni el caché de analítica (R38);
  (c) el recorte por rol se obtiene de `resolverAlcance` y no hay una segunda lista de
  roles con alcance declarada en la feature (R8);
  (d) ninguna capa de la feature usa `prisma.orden.findMany` ni `gestionOrden.findMany`
  sin límite — el único acceso por orden admisible es la consulta **paginada** del detalle
  (R36/R39/R55);
  (e) esta feature **no modifica** ningún archivo de `lib/analytics/`;
  (f) *(nueva)* ningún archivo de la feature declara un segundo mapa de estatus → etiqueta
  ni un segundo juego de colores de estatus: se importan de
  `app/(app)/ordenes/_components/EstatusBadge` (R48).
  **Hecho:** R8, R17, R36, R38, R39, R48 en verde y el guardia falla si se introduce
  cualquiera de esos imports o declaraciones. dep: B2.2, B3.2, B4.1, B7.2

---

## FRONTEND

> El frontend puede arrancar en cuanto T0.1 esté hecha, mockeando `leerTableroDia` y
> `leerDetalleMensajeroDia`. No necesita esperar al backend salvo en F4.

### F1 — Ruta y gate de rol

- [x] **F1.1** `app/(app)/monitoreo/page.tsx` — Server Component: `resolveActorFromSession()`
  y `notFound()` si el rol no está en `{admin, maestro, adminSatelite}`. **No** fetchea
  datos ni importa repositorios/servicios. **Hecho:** typecheck verde. dep: T0.1
- [x] **F1.2** `tests/components/TableroDiaPage.test.tsx`: `adminTienda`, `mensajero` y
  sin sesión → `notFound()`; los tres roles de R1 → renderiza el módulo (R11).
  **Hecho:** R11 en verde. dep: F1.1

### F2 — Módulo cliente con SWR y TARJETAS

- [x] **F2.1** `app/(app)/monitoreo/_components/TableroDiaModule.tsx` (`'use client'`):
  `useSWR("tablero-dia", leerTableroDia, { refreshInterval: 30_000, keepPreviousData: true })`.
  Maneja `estado:"denegado"` mostrando un aviso, nunca un tablero vacío que parezca
  "0 órdenes". **Hecho:** typecheck verde, sin `fetch` a rutas API internas. dep: T0.1
- [x] **F2.2 (reescrita)** `MensajeroCard.tsx` sobre `components/ui/card` (shadcn; **no**
  crear primitiva nueva): nombre + `asignadas` en cabecera y los siete contadores
  restantes en el cuerpo, con `sinRecoger`/`enReparto`/`otros` visualmente separados de
  los cinco resultados (R28). La tarjeta entera es clicable y **operable por teclado**
  (`button`/`role="button"` + `tabIndex`, foco visible). Rejilla ordenada por R29 con el
  orden independiente del ancho. **Hecho:** render correcto con datos de ejemplo y
  navegable con Tab+Enter. dep: F2.1
- [x] **F2.3 [P]** Estados: skeleton de carga, **vacío explícito** cuando no hay tarjetas
  (R33), aviso de fallo de refresco que **conserva** las tarjetas anteriores (R32),
  bloque de totales (R30) y cabecera con fecha CR + "actualizado ..." (R34).
  **Hecho:** los estados distinguibles en el DOM. dep: F2.1
- [x] **F2.4** `tests/components/TableroDiaModule.test.tsx` + `TableroDiaTarjetas.test.tsx`:
  con temporizadores falsos, re-consulta a los 30 s (R31); error en la segunda consulta
  mantiene visibles los datos de la primera (R32); estado vacío (R33); los ocho contadores
  y los totales (R28/R30); orden determinista (R29); y que **no** se pide ningún detalle
  sin click (R56).
  **Hecho:** R28–R33 y R56 en verde. dep: F2.2, F2.3
- [x] **F2.5 (nueva, 4.ª vuelta)** La antigüedad de R34 se calcula contra
  `tablero.generadoAt` (el instante en que el dato se leyó de la base), **nunca** contra
  `Date.now()` de la respuesta ni contra el momento del render: con caché de 15 s sobre
  refresco de 30 s el peor caso real es ~45 s y la pantalla debe decirlo. Test en
  `TableroDiaModule.test.tsx` con un `generadoAt` viejo → la UI anuncia el desfase.
  **Hecho:** R34 en verde. dep: F2.3

### F5 — Etiquetas de los buckets (nueva, 2026-08-08)

- [x] **F5.1 (nueva)** Etiquetas visibles de los tres buckets ("Sin recoger", "En
  reparto", "Otros") declaradas junto al componente, derivadas del tipo
  `BucketSinResultado` con un `Record` exhaustivo. **Hecho:** un bucket nuevo no compila
  sin etiqueta. dep: T0.2, F2.2
- [x] **F5.2 (nueva)** El bucket `otros` se pinta SIEMPRE, aunque valga 0, con ayuda que
  explique qué contiene (R45). **Hecho:** visible en el DOM con dato 0. dep: F5.1

### F6 — Detalle del mensajero (drill-down) (nueva, 2026-08-08)

- [x] **F6.1 (nueva)** `DetalleMensajeroPanel.tsx` con `components/ui/sheet` (shadcn),
  abierto desde la tarjeta y con la selección en la URL (`?mensajero=<id>`) vía
  `useSearchParams` + `router.replace` (sin recargar el tablero). Cerrar limpia el param.
  **Hecho:** abrir/cerrar no desmonta el módulo del tablero (R47/R50). dep: F2.2
- [x] **F6.2 (nueva)** Lista de órdenes con `components/ui/table`, reutilizando
  **`EstatusBadge`** y `estatusLabel` de `app/(app)/ordenes/_components/` (R48). Columnas:
  guía, estatus, resultado del día, cliente/destino (R49). Paginación como el listado.
  **NO** montar `OrdenesListado` (ver `design.md §7.3` y alternativa 11).
  **Hecho:** render correcto; cero mapas de estatus propios. dep: F6.1
- [x] **F6.3 (nueva)** Coherencia con el refresco: mientras el panel está abierto, el
  tablero sigue refrescándose y el panel no puede quedar apuntando a una tarjeta que ya no
  existe (se cierra con aviso) (R52). **Hecho:** comportamiento verificado en test.
  dep: F6.1
- [x] **F6.4 (nueva)** `tests/components/DetalleMensajeroPanel.test.tsx`: abre por click y
  por teclado (R47), la URL lleva `?mensajero=` (R50), usa `EstatusBadge` (R48), muestra
  las cuatro columnas del listado y **ninguna más** (R49), estado vacío (R33) y el caso de
  R52. **Hecho:** R47–R50, R52 en verde. dep: F6.2, F6.3
- [x] **F6.5 (nueva, 3.ª vuelta)** Entrada por URL: al cargar `/monitoreo?mensajero=<id>`
  el panel se abre pidiendo el detalle a la Server Action (el param **no** es una
  autorización, R62), y con un id inexistente / de otra zona / sin órdenes muestra el
  **mismo** aviso genérico y un panel vacío (R63). Test en el mismo archivo.
  **Hecho:** R62, R63 en verde. dep: F6.1

### F3 — Navegación: ítem "Monitoreo"

- [x] **F3.1 (reescrita)** `lib/auth/menu-visibility.ts`: añadir `IconKey` propio (p. ej.
  `"gauge"`) y el ítem `{ label: "Monitoreo", href: "/monitoreo",
  roles: ["admin","maestro","adminSatelite"], destinoInicial: false }`. Mapear el icono en
  el Sidebar cliente. **Hecho:** typecheck verde y el ítem aparece para los tres roles
  (R53). dep: F1.1
- [x] **F3.2 (ampliada)** Ampliar `tests/unit/auth/menu-visibility.test.ts`: el ítem sólo
  lo ven los tres roles (R35/R53) **y** `primerDestino` devuelve para **cada** rol lo
  mismo que antes de añadirlo — en particular `adminSatelite` sigue aterrizando en
  `/recepcion-satelite` y `mensajero` en `/mis-asignaciones/reparto` (R54).
  **Hecho:** R35, R53, R54 en verde. dep: F3.1

### F4 — Integración con el backend real

- [ ] **F4.1** Sustituir los mocks por las Server Actions reales y comprobar a mano el
  ciclo: carga inicial, refresco a los 30 s, apertura del detalle desde una tarjeta y
  cuadre de su total con `asignadas`, sesión de `adminSatelite` (ve sólo su zona, también
  en el detalle) y de `adminTienda` (no entra).
  **Hecho:** los cinco casos verificados. dep: B4.1, B7.6, F2.4, F6.4

---

## Cierre

- [x] ~~**C0** Confirmar la respuesta a la pregunta abierta 1.~~ **RESUELTA** (humano,
  2026-08-08): sin índice, con caché (B9). `requirements.md` ya no tiene preguntas
  abiertas: no hay ninguna puerta pendiente antes de implementar.
- [x] **C1** Completar el mapa `R<n> → test` en `progress/impl_192.md` con los **73**
  requisitos, cada uno apuntando a un archivo::test real. **Hecho:** ningún requisito sin
  test (el reviewer rechaza si falta uno). dep: todas las anteriores
- [x] **C2** `./init.sh --rapido` verde al cerrar cada tanda. **Hecho:** typecheck + lint
  + tests relacionados + todas las guardias en verde.
- [ ] **C3** `./init.sh` completo verde antes del PR, sin excepción. **Hecho:** gate
  completo en verde y delta de rojos respecto del baseline de `dev` = 0. dep: C1, C2
