# Review — Feature 205 (pagar la cuenta por pagar del mensajero desde `/wallet/mensajeros`)

Rama `feature/205-pago-mensajero-desde-wallet`. Contrato:
`specs/205-pago-mensajero-desde-wallet/{requirements,design,tasks}.md` (58 requisitos, 8 tandas,
31 tareas). Bitácoras: `progress/impl_205_tanda0.md`, `impl_205_tandas1y2.md` (+ addendum),
`impl_205_tandas3y4.md` (+ ENMIENDA), `impl_205_tandas5y6.md`.

**Veredicto: RECHAZADO.** Dos bloqueantes, ninguno de código. El código de esta feature es de las
implementaciones más sólidas que ha pasado por este arnés; lo que falla es (a) una decisión de
negocio que cambió el comportamiento de R36 y **no se plegó al spec**, y (b) la tanda 7 (cierre)
sin hacer, que deja tres puntos de `CHECKPOINTS.md` verificablemente incumplidos.

---

## 1. Verificación ejecutable — hecha por mí, no leída

| Comando | Resultado |
| --- | --- |
| `./init.sh` (completo) | **`init OK`** — typecheck ✓, lint `0 errors, 58 warnings`, `Test Files 1066 passed · Tests 13346 passed (13346)`, 455 s |
| `vitest run` sobre los 13 archivos de la 205 | `13 passed · 254 passed (254)` |
| `vitest run` migración + módulo puro + config | `3 passed · 69 passed (69)`, **0 skipped** (el bloque B contra Postgres real SÍ corrió) |

El 13346 que reportaba la bitácora es cierto y lo reproduje **después** de mis mutaciones, con el
árbol restaurado (hash verificado; `git status` devuelve los mismos 65 ficheros del inicio). Gate y
mutaciones nunca en paralelo.

---

## 2. Trazabilidad R→test: **57 de 58 verificados**

No me apoyé en el mapa del spec. Para cada requisito abrí el test, comprobé que ejerce lo que el
requisito dice y —en once puntos— **lo puse rojo con una mutación mía**.

### Mis mutaciones (11, independientes de las 88 del implementer)

| # | Mutación | Veredicto |
| --- | --- | --- |
| M1 | previsualizar usa un `50` literal en vez del tope inyectado (R57) | **muerta** — 3 rojos |
| M2 | la ventana SE RELLENA desde la lectura fresca (§2.5.5 al revés) | **muerta** — 2 rojos |
| M3 | `restanteImputable` olvida los cierres recortados (R25) | **muerta** — 1 rojo |
| M4 | la fecha de pago sale del RELOJ en vez de la petición | **sobrevive** (ver menor m3) |
| M5 | los candados en orden INVERSO (R22) | **muerta** — 6 rojos |
| M6 | `pendienteDespues` no resta nada (R33) | **muerta** — 4 rojos |
| M7 | el sobrante se mide contra el imputable, no contra lo imputado (R13/R14) | **muerta** — 3 rojos |
| M8 | la referencia se inventa por cierre (R58) | **muerta** — 2 rojos |
| M9 | la fecha VARÍA por imputación (R58) | **muerta** — 2 rojos |
| M10 | la fecha es una constante ajena a la petición | **muerta** — 3 rojos |
| M11 | la nota se pierde en las imputaciones | **muerta** — 1 rojo |

### El requisito que NO queda verificado

- **R36** — el texto vigente de `requirements.md` dice: «DEBE informar de los cierres excluidos por
  no estar aprobados, **identificándolos** y diciendo su estado». La implementación **no los
  identifica**: devuelve un CONTEO por estado (`{estado, cantidad}`), y hay dos tests estructurales
  que se ponen rojos si alguien vuelve a emitir `cierreId`/`solicitadoAt`. Los tests de R36 son
  buenos, pero verifican **otra conducta** que la que R36 exige. Ver BLOQUEANTE 1.

### Cobertura por requisito (resumen de lo que abrí y corrí)

- **R1–R4**: rol antes de leer nada (4 roles × 2 métodos con **log vacío** como aserción, más el
  control positivo maestro/admin); `unauthenticated` antes de validar la forma, con el caso que
  fija el ORDEN (sin sesión + petición inválida ⇒ gana `unauthenticated`).
- **R5–R9**: el `WHERE` probado **donde vive** (`liquidacion-pago-repository.test.ts`:
  `{mensajeroId, estado:"aprobado"}`, `orderBy [{solicitadoAt:asc},{id:asc}]`, `JSON.stringify(arg)`
  sin `resueltoAt`, sin `take`/`skip`/`cursor`); `anulacion: {is:null}` en la Σ de vigentes
  (preexistente de la 172, **intacto**); `.strict()` que nombra la clave `cierreId` al rechazarla.
- **R10–R17**: 38 casos sobre la función pura, sin base de datos: el céntimo suelto, los tercios de
  `8000.01`, un `DECIMAL(12,2)` casi lleno, la propiedad «solo la última es parcial» sobre 7
  importes y los cinco bordes del tope (0, negativo, 1, =n, >n).
- **R18–R26**: el doble de transacción **modela el rollback de verdad** (lo escrito solo pasa a
  `confirmados` si la función no lanza), así que «todo o nada» es una aserción y no una promesa; la
  guardia de candados mide grano, orden fila a fila, repetibilidad entre ejecuciones y posición
  relativa respecto de la lectura que decide.
- **R27–R31**: la clave sobrevive al reintento por fallo de red **y** por rechazo de dominio, y
  reabrir el formulario acuña una nueva. Esto ningún test de servidor lo vería.
- **R32–R38**: las respuestas de prueba tienen **cifras que no cuadran a propósito** (se teclean
  9000 y el servidor reparte 4000+3000); si alguien metiera una suma en el cliente, caerían.
- **R39–R45**: el deep link se prueba con un cierre **ausente de las dos tablas**, que es lo que
  demuestra que la lectura es por id.
- **R46–R58**: estructural sobre los tipos (todo monto `string`, cardinales `number`), censo
  money-safe con las cuatro aserciones, migración ejercitada **contra Postgres real** sobre un clon
  de `liquidacion_pago`, y el `down.sql` ejecutado de verdad comparando la lista de columnas.

---

## 3. Hallazgos

### BLOQUEANTE 1 — R36: la decisión de la ENMIENDA no se plegó al spec

`impl_205_tandas3y4.md` documenta que el humano decidió cambiar el aviso de excluidos de LISTA a
CONTEO por estado. La decisión es buena y está bien implementada (`groupBy` en la base, acotado por
construcción, sin montos, con la consecuencia asumida escrita en dos docstrings y dos tests que
impiden revertirla). **Pero el spec no se tocó:**

- `requirements.md` R36 sigue diciendo «**identificándolos** y diciendo su estado».
- `design.md §7.2` sigue declarando `CierreExcluidoDTO = { cierreId; estado; solicitadoAt }`.
- `design.md §12` sigue mapeando R36 a «excluidos con su estado».

Las cinco decisiones anteriores (Q1–Q5) **sí** se plegaron: hay una sección «Enmienda del
2026-08-11» en `requirements.md` con R53–R58 y la nota de qué requisitos cambiaron. Ésta no.
Resultado: el reviewer lee R36, abre el test y encuentra que verifica otra cosa — que es
literalmente el caso que `docs/verification.md > Regla del reviewer` declara bloqueante.

**Qué falta (no toca código ni tests):** plegar la decisión igual que las otras cinco — reescribir
R36 en `requirements.md` para que diga «cuántos cierres quedan fuera y por qué estado», con el
porqué de renunciar a identificarlos, y actualizar `design.md §7.2` (`ExcluidosPorEstadoDTO`) y la
fila de R36 en `§12`.

### BLOQUEANTE 2 — La tanda 7 (cierre) no está hecha: tres puntos de `CHECKPOINTS.md` fallan

1. **`specs/205-.../tasks.md` no tiene ni una marca `[x]`** — 0 de 31. La convención existe y se usa
   (`specs/196-*/tasks.md` tiene 27 marcas, `specs/194-*` tiene 13).
   → `CHECKPOINTS > Especificación`: «todas las tasks están marcadas `[x]`». **Falla.**
2. **No existe `progress/impl_205*.md` con el mapa completo de los 58** (T7.1). El mapa está
   repartido en cuatro bitácoras, y la unión de las cuatro **no cubre R10, R11, R12, R13 ni R17**:
   la de la tanda 0 no tiene tabla de mapa. Los tests de esos cinco existen y los verifiqué uno a
   uno, pero el mapa que el arnés exige no los nombra.
   → `CHECKPOINTS > Trazabilidad`: «`progress/impl_<feature>.md` contiene el mapa `R<n> -> test`».
   **Falla.**
3. **Bookkeeping sin hacer** (T7.3): `feature_list.json` id 205 sigue con `"spec_path": null` pese a
   que la carpeta existe; `progress/current.md` y `progress/history.md` sin tocar.
   → `CHECKPOINTS > Verificación final`: «se añadió una entrada a `progress/history.md`». **Falla.**

**Qué falta:** correr la tanda 7 tal y como está escrita. Ninguno de los tres pide tocar código.

### menor m1 — R42 se mapea a un argumento, no al test que el design prometía

`design.md §12` prometía para R42 un caso en `CierresAdminDeepLink.test.tsx` («rol sin acceso ⇒ el
guard de la página manda»). Ese caso **no existe**; la bitácora lo sustituye por la afirmación «el
guard de `page.tsx` no cambia».

Lo verifiqué y **el requisito se cumple de hecho**, por dos tests preexistentes que sí se pondrían
rojos: `tests/components/CierresAdminPage.test.tsx:223` («roles sin acceso NO ven el módulo,
`notFound`») y `tests/unit/repositories/cierres-admin-repository.test.ts:260`
(`findCierreByIdEnAlcance` con `ALCANCE_SAT` sobre un cierre ajeno). Es decir: un `adminSatelite`
que teclee `?cierre=<uuid de otra zona>` cae en `no_encontrada` por el `WHERE` del repositorio, no
por el enlace. Lo cuento como cubierto, pero por herencia y no por evidencia nueva.

### menor m2 — un archivo de la feature que pinta importes queda fuera del censo money-safe

`app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` gana con la 205 **cinco
bloques de rótulos que formatean dinero** (`money(totalImputado)`, `money(montoFuera)`,
`money(pendienteDespues)`…) y **no está en `ARCHIVOS_DE_LA_FEATURE`**. Los tres componentes que lo
consumen sí lo están, así que la red cubre a los lectores pero no al sitio donde hoy vive el
formateo. Hoy es inocuo (`money` opera sobre STRING y no convierte a número, `lib/config/moneda.ts`)
y el archivo tampoco estaba censado antes de la 205 porque es de otra feature; pero el criterio de
T5.4 —«los archivos de cliente que pintan importes del servidor entran»— apunta a él.

### menor m3 — coincidencia en el fixture: el reloj y la fecha de pago valen lo mismo

En `liquidacion-reparto-service.test.ts` el reloj inyectado es `2026-07-30T15:04:05Z` y
`INPUT.fechaPago` es `"2026-07-30"`. Por eso **mi mutación M4 sobrevive**: cambiar `fechaPago` por
`medianocheUtcDelDia(this.ahora()…)` produce exactamente el mismo valor y ningún caso lo nota. R58
sigue verificado (M8/M9/M10 mueren: la referencia inventada por cierre, la fecha que varía por
imputación y una fecha constante ajena caen las tres); lo que queda sin medir es que en el camino
del reparto la fecha venga **de la petición** y no del servidor. Se cierra moviendo el reloj del
fixture un día. Es la misma familia que la cicatriz `a3` que el propio implementer documenta en la
tanda 0 (ids elegidos de modo que dos reglas distintas daban la misma respuesta).

### menor m4 — desviación de T5.1, declarada: una SEGUNDA prop en el diálogo compartido

`RegistrarPagoDialog` recibe `renderPrevisualizacion` (lo que T5.1 pedía) **y** `mensajeSinSaldo`.
Está justificada (el texto de `sin_saldo` de la 172 dice literalmente «esta **tienda**» y hay un
test ajeno que lo fija palabra por palabra) y reportada como desviación en la bitácora. La anoto
para el registro, no para que se cambie: el tipo del resultado también se ensanchó a
`RegistrarPagoResult | RegistrarRepartoResult`, y `RegistrarPagoDialog.test.tsx` **no se tocó** —
que es el mejor argumento de que la ampliación es aditiva de verdad.

---

## 4. Lo que revisé de lo ajeno (y no se aflojó nada)

Los 25 tests de otras features que la 205 toca, uno a uno:

| Archivo | Veredicto |
| --- | --- |
| `pago-mensajero-filtro-cierre.test.ts` (172) | **AFILADO.** El caso pasó de `not.toHaveBeenCalled()` a afirmar la forma exacta de la consulta (`where: {id:{in:[…]}}, select:{id,cierreId}`), conservó la propiedad que protegía («el FILTRO no cuesta nada cuando no se filtra») y ganó **dos** casos: sin filas de pago no hay consulta, y con filtro son dos y no una por fila. El mini-motor del doble pasó a honrar el `select`, que es lo que impide que el test mienta sobre cuál de los dos caminos pide qué. |
| `liquidacion-caja-puerto.test.ts` (173) | **AFILADO.** Contaba 5 dependencias; ahora cuenta 6 **y además lee el constructor** para exigir que la sexta sea `repartoRepo: ILiquidacionRepartoRepository`. Antes solo contaba; ahora dice qué cuenta. |
| `liquidacion-anulacion.test.ts` (172) | **AFILADO.** La lista CERRADA de métodos sube de 11 a 17 con el porqué de cada nombre nuevo; el barrido `desanular\|borrar\|editar` sigue intacto. El doble del reparto **escribe en el log**, así que si anular tocara un reparto las comparaciones de log lo dirían. |
| `liquidacion-action.test.ts` (172) | **AFILADO.** La lista exacta de exportaciones sube de 5 a 7, ordenada; sigue siendo el mecanismo que impide que aparezca un `editarRepartoAction`. |
| `liquidacion-money-safe.test.ts` (172) | **AFILADO.** +6 entradas al censo, cada una con su porqué; la cláusula de auto-captura no se tocó. La bitácora deja la salida del **rojo previo** las tres veces que la auto-captura disparó, con la línea exacta del `expect`. |
| `liquidacion-pago-repository.test.ts` (172) | **AFILADO.** +12 casos que prueban el `WHERE` donde se ejecuta, incluidos «`groupBy` sí y `findMany` ni una vez» y «el complemento exacto de los imputables». |
| `liquidacion-service.test.ts`, `caja-cadena-pago-anulacion.test.ts`, `liquidacion-idempotencia.test.ts` | **SOLO cableado.** Ni un assert. En los dos primeros los dobles nuevos además loguean, así que una llamada colada desde un camino de la 172 los pondría rojos. R51 se sostiene. |
| 8 tests que montan `CierresAdminModule` | **SOLO el doble de `next/navigation`** (+`usePathname`, +`useSearchParams`). Verificado línea a línea con `git diff`: ni una aserción tocada. |
| 6 fixtures del DTO del desglose | **SOLO el campo nuevo.** En `wallet-mensajero-descarga-columnas.test.ts` el fixture ahora lleva un uuid en `cierreId`, lo que **refuerza** la aserción de que ningún uuid sobrevive a la proyección de descarga. |

**Censo money-safe — ¿escapó algo por el nombre?** Los cuatro módulos nuevos de `lib/**` con
`liquidacion` en la ruta están censados (y entraron por rojo, no a mano).
`lib/config/reparto-mensajero.ts` queda fuera **a propósito y con la medida escrita**: su
`Number.parseInt` casaría con `/\bparseInt\s*\(/` y pondría el barrido rojo por un falso positivo
sobre un cardinal; lo verifiqué leyendo el archivo —no importa `Prisma`, no nombra ningún monto— y
hay un test que lo fija. `app/(app)/cierres-admin/_components/cierre-enlace.ts` tampoco maneja
dinero. El único hueco es el de rótulos (m2).

---

## 5. Las decisiones del design, comprobadas en el código

| Decisión | Estado |
| --- | --- |
| **Todo o nada en UNA transacción** | ✓ `registrarRepartoMensajero` abre una sola `runTransaction`; la fila del acto va dentro; una excepción en la imputación N no deja ni la primera. El choque de la clave derivada **revierte el reparto entero** (`ImputacionRepetidaError`) en vez de saltarse la imputación — rama que nació de una mutación superviviente y que hoy tiene caso. |
| **N candados en el ORDEN determinista del reparto** | ✓ y es la parte mejor defendida: bucle **secuencial** sobre `ventana` (test estructural: hay `for (const … of ventana)` y **no** hay `Promise.all/allSettled/race`), orden fijado por `ordenarCierresFifo` —la función pura, no un comparador del servicio ni el `ORDER BY`—, medido con la entrada desordenada a propósito y comprobado fila a fila contra las imputaciones. Mi M5 (orden inverso) muere con 6 rojos. |
| **La ventana ENCOGE y no se rellena** | ✓ `ventanaBajoBloqueo` itera `ventana` y usa la lectura fresca como consulta. Hay test estructural (`for … of ventana` sí, `for … of frescos` no) **y** de comportamiento (con `tope: 2`, si el segundo cierre se cae se responde `excede` y el recortado no aparece en ninguna llamada), con su control. Mi M2 muere. |
| **La clave viene del CLIENTE y NO se deriva por cierre** | ✓ la barrera es la fila de `liquidacion_reparto` insertada **la primera**, con `UNIQUE` real probado contra Postgres; cero `SELECT` previo (R29); la relectura ocurre **fuera** de la transacción abortada; y hay un caso que mata explícitamente la alternativa §5.2 («la reconstrucción NO depende de que el FIFO vuelva a dar el mismo resultado»). La clave por imputación es `<clave>:<cierreId>`: auditable y segunda red, no la barrera. |
| **La previsualización es advertencia, no reserva** | ✓ no abre transacción, no toma un solo candado y no llama a ningún método de escritura; medido con el log entero. Y lo que se pinta al terminar es el reparto **aplicado**, con un fixture donde aplicado ≠ previsualizado a propósito. |
| **Money-safe** | ✓ cero `Number(` / `parseFloat(` / `parseInt(` / `.toFixed(` en los archivos de cliente; el reparto se deriva entero con `Prisma.Decimal`; `toFixed(2)` solo como serialización final y con un test que exige que TODO `toFixed` del servidor sea de escala 2. El `Number.isFinite` del comparador mira un epoch, no un monto. |

---

## 6. `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `requirements.md` con EARS numerados R1–R58.
- [x] `design.md` con alternativa descartada y su porqué — ocho decisiones (D-A…D-H), cada una con
      su descarte razonado; §2.5.3 y §2.5.4 descartan dos formas del tope, no una.
- [ ] **`tasks.md` con todas las tasks marcadas `[x]` — FALLA: 0 de 31.** (BLOQUEANTE 2.1)

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto — **57/58 verificados ejecutando**; R36 tiene
      test pero verifica otra conducta que la que su texto exige (BLOQUEANTE 1).
- [ ] **`progress/impl_<feature>.md` contiene el mapa `R<n> → test` — FALLA:** no existe el fichero
      consolidado y la unión de las cuatro bitácoras no nombra R10–R13 ni R17. (BLOQUEANTE 2.2)

### Calidad de código
- [x] `pnpm run typecheck` sin errores — corrido por mí.
- [x] `pnpm run lint` sin errores (58 warnings, todas preexistentes; la única nueva de la 205 es un
      `'_args' is defined but never used` idéntico al del molde del que hereda el patrón).
- [x] `pnpm test` — 13346/13346.
- [~] **E2E de flujo crítico — INAPLICABLE**, ver §7.

### Datos y seguridad (Supabase)
- [x] RLS en la tabla nueva — `ALTER TABLE liquidacion_reparto ENABLE ROW LEVEL SECURITY` sin
      policies, y **medido en el motor** (`pg_class.relrowsecurity = true`), no solo en el DDL.
- [x] Migración versionada y reversible — `migration.sql` + `down.sql` en orden inverso, sin
      `CASCADE` deliberadamente, los dos ejercitados contra Postgres real sobre un clon.
- [x] Ningún secreto hardcodeado.
- [~] **Webhooks — INAPLICABLE**, ver §7.

### Patrón de capas
- [x] Las dos Server Actions no tienen queries ni lógica: actor → `UnauthenticatedError` →
      `schema.parse` → servicio bajo `withErrorHandler`. Molde idéntico a las cinco existentes.
- [x] El servicio no conoce HTTP.
- [x] `LiquidacionRepartoRepository`: dos métodos, cero lógica de negocio, cliente Prisma acotado
      con `Pick<PrismaClient, "liquidacionReparto">`.
- [x] Interfaces en `lib/interfaces/repositories/` y `lib/interfaces/services/`.

### Permisos
- [x] `/wallet/mensajeros` valida en servidor; el servicio aplica `esAccesoTotal` **antes de leer
      nada** en los dos métodos, con contraprueba de que ocultar el control no es la única barrera
      (4 roles × 2 métodos con log vacío).
- [x] Los `_components` reciben datos por props y piden lo suyo por Server Action.
- [x] Sin rutas API nuevas: mutaciones y lecturas internas por Server Action.

### Multi-país / configuración
- [x] Ni país ni moneda ni cuenta hardcodeados: el importe se formatea con `money` de
      `lib/config/moneda.ts` y el tope vive en `lib/config/reparto-mensajero.ts`
      (`REPARTO_MENSAJERO_MAX_CIERRES`, defecto 50), con test de que el número no se repite en
      ningún otro archivo.

### Verificación final
- [x] `./init.sh` en verde — corrido por mí en esta rama.
- [ ] `progress/review_205.md` con veredicto OK — **este informe dice RECHAZADO.**
- [ ] **Entrada en `progress/history.md` — FALLA:** el fichero no se tocó. (BLOQUEANTE 2.3)

---

## 7. Checkpoints que declaro INAPLICABLES (y por qué)

1. **«Si la feature toca flujos críticos hay al menos un test E2E (Playwright) que lo cubre».**
   **Inaplicable en este repo.** Existe `playwright.config.ts` y 19 ficheros en `e2e/`, pero
   **ninguno se ejecuta**: llevan escrito «NOT EXECUTED» y dependen de un seed que no existe;
   `init.sh` corre `pnpm test` (vitest) y **no** invoca Playwright, y no hay CI que lo haga (el
   único check es el build de Vercel). Exigir aquí un E2E sería exigir un fichero que nadie corre —
   verde permanente por no ejecutarse, que es peor que no tenerlo.
   **Cómo queda cubierto el riesgo:** 44 tests de componente sobre el diálogo, la previsualización,
   el aviso de excluidos y el enlace por fila, con 13 mutaciones que mueren; más la guardia de
   candados y la migración ejercitada contra Postgres real.
   **Y el hueco, dicho:** la verificación visual **no pudo ejercer** el diálogo de pago, la
   previsualización, el aviso de excluidos ni el enlace por fila, porque la base local no tiene
   ningún mensajero con cuenta por pagar. Esa cobertura me parece **suficiente para aprobar el
   código y NO suficiente para dar por vista la pantalla**: los 44 casos prueban la lógica de
   pintado contra respuestas fijas, no que la pantalla se monte con datos reales. Recomiendo sembrar
   un mensajero con un cierre aprobado en local y ejercer el camino una vez antes de desplegar.
2. **«Webhooks nuevos validan firma/token y son idempotentes».** **Inaplicable:** la 205 no añade
   ningún webhook ni ningún endpoint HTTP. La idempotencia que sí aporta —la del reparto— está
   verificada por otra vía (el `UNIQUE` de `liquidacion_reparto` probado contra el motor).
3. **«El script `pnpm run db:rollback` funciona».** **Parcialmente inaplicable como comprobación
   mía:** no lo ejecuté contra la base local para no dejarla en un estado distinto del que me la
   encontré (la migración **está aplicada en local y no en preview ni en producción**). Lo que sí
   verifiqué es más fuerte que el script: el test de integración ejecuta el `down.sql` **real** sobre
   un clon de `liquidacion_pago` y compara la lista de columnas contra la de antes —idéntica, no
   «parecida»— y el bloque corre verde con la migración aplicada y sin aplicar.

---

## 8. Qué falta para que esto sea OK

Nada de código. Tres cosas, en este orden:

1. **Plegar la ENMIENDA de R36 al spec**: reescribir R36 en `requirements.md` (conteo por estado,
   con el porqué de renunciar a identificar cada cierre) y actualizar `design.md §7.2`
   (`ExcluidosPorEstadoDTO`) y la fila de R36 de `§12`. Es el mismo trabajo que ya se hizo con
   Q1–Q5; ésta se quedó solo en la bitácora.
2. **Correr la tanda 7**: marcar las 31 tareas de `tasks.md`, escribir
   `progress/impl_205-pago-mensajero-desde-wallet.md` con el mapa completo de los **58** —R10, R11,
   R12, R13 y R17 tienen test y hoy no aparecen en ningún mapa— y hacer el bookkeeping (`spec_path`
   de la ficha 205, `progress/current.md`, entrada en `progress/history.md`).
3. Recomendaciones, no bloqueos: mover un día el reloj del fixture del servicio (m3) y meter
   `wallet-mensajeros-labels.ts` en el censo money-safe (m2).

Los hallazgos ya con ficha propia —el falso positivo del censo de tablas (207) y la anulación
agrupada fuera de alcance (206)— no se cuentan aquí.

---

**Veredicto: RECHAZADO** — 2 bloqueantes, ambos documentales; 4 hallazgos menores; 57 de 58
requisitos con test verificado ejecutándolo; gate completo verde medido por el reviewer
(13346/13346).

---
---

# SEGUNDA REVISIÓN — 2026-08-12

**Veredicto: APROBADO CON RESERVAS.** Los dos bloqueantes están **cerrados y verificados
ejecutando**, no leyendo. Lo que queda son pasos de cierre y cinco cosas menores, una de ellas
nueva y encontrada por mí en esta ronda.

## Verificación ejecutable de esta ronda

| Comando | Resultado |
| --- | --- |
| `./init.sh` (completo, corrido por mí tras todos los cambios) | **`init OK`** · `Test Files 1066 passed · Tests 13348 passed (13348)` · 255 s |
| 7 mutaciones propias nuevas (ver abajo) | 6 muertas, **1 superviviente** |

## BLOQUEANTE 1 — R36 plegado al spec: **CERRADO**

El spec ya describe lo implementado, y lo comprobé cláusula por cláusula: R36 exige ahora (a)
**cuántos** quedan fuera, (b) **por qué estado**, (c) que **NO** se identifiquen ni se fechen, (d)
que **NO** se emita importe de ellos y (e) que el tamaño del aviso **no crezca** con el número de
cierres. Las cinco tienen test:

- (a)(b) `svc` «R36: los excluidos llegan CONTADOS por estado…» + `prev` «dice cuántos hay de cada
  estado, con su rótulo».
- (c) `schema` «R36 — ESTRUCTURAL: el aviso de excluidos es un CONTEO por estado, no una lista» y
  `svc` «…sin nombrar ningún cierre».
- (d) `pagoRepo` «R36/§7.2 — la consulta NO pide ningun monto».
- (e) `pagoRepo` «ACOTADO POR CONSTRUCCION: nunca mas entradas que valores tiene `CierreEstado`»
  (sin `take`) + `svc` «la respuesta NO crece con el historial — dos años de rechazos son UNA
  entrada».

**Ninguna frase huérfana.** Barrí `specs/205-*/{requirements,design,tasks}.md` por
`CierreExcluidoDTO`, `identificándolos`, `identificarlos`, `excluid*` y `lista`: `CierreExcluidoDTO`
**ya no aparece en ningún sitio**; la única ocurrencia de «identificarlos» es la nota que dice que
el enunciado *anterior* lo exigía; `tasks.md` T5.2 y T5.5 también se corrigieron a «contados por
estado». §0 lleva la fila **D-I** con su alternativa descartada, §6.4 explica la cronología, el
precio y por qué no se revierte, §7.2 declara `ExcluidosPorEstadoDTO` y §12 parte la fila en
R36/R37. Está plegado con el mismo estándar que Q1–Q5.

Y una cosa que conviene decir: la cronología de §6.4 y de la sección J **admite por escrito que el
desfase existió y de quién fue el encargo**. Eso vale más que el plegado en sí — es lo que impide
que se repita.

## BLOQUEANTE 2 — Tanda 7: **CERRADO en lo sustantivo**

- **`progress/impl_205_mapa.md`**: los 58 con archivo y caso. **Verifiqué 19 filas por muestreo con
  `grep -F` sobre los ficheros de test**, incluidas las cinco que faltaban: R10, R11, R12, R13 y
  R17 quedan nombradas con casos que existen literalmente («repartirEntreCierres — troceo FIFO (R10,
  R11, R13)», «R11: en ningun reparto hay mas de UNA imputacion parcial, y es la ULTIMA»,
  «repartirEntreCierres — nada de ceros (R12)», «…money-safe al centimo (R13, R16)», «el modulo del
  reparto es PURO (R17, R53)»). 18 de 19 coinciden carácter a carácter; la 19ª
  (`cierres-admin-repository.test.ts`, R42) normaliza un `->` a `→` — el caso existe y dice lo que
  el mapa cita.
- El mapa además **declara quién midió qué** y que no re-ejecuta la suite. Es la forma correcta de
  escribirlo.
- **`tasks.md` 29/31**, con las dos sin marcar declaradas: T7.2 (gate) y T7.3 (bookkeeping). Me
  vale: el gate está corrido —dos veces, por mí— y el precedente que cita (`specs/196-*`) es real.
- **`feature_list.json`**: `spec_path` puesto; `progress/current.md` con la entrada de la jornada.

**Lo único que falta de este bloqueante:** la entrada en `progress/history.md`, que `CHECKPOINTS.md`
pide y que hoy no existe. No lo bloqueo porque es circular —la misma lista exige que este informe
diga OK antes de cerrar—, pero queda como reserva explícita.

## Los menores, comprobados con mutaciones mías

| # | Mutación (mía, segunda ronda) | Veredicto |
| --- | --- | --- |
| N1 | la pantalla **propone** `imputableTotal` en vez del `imputable` de la ventana | **muerta** — 3 rojos |
| N1b | la previsualización pinta `imputableTotal` donde va el máximo de la ventana | **muerta** — 1 rojo |
| N2 | un `Number(monto)` plantado en `wallet-mensajeros-labels.ts` | **muerta** — 1 rojo, **y nombra el archivo** |
| N3 | (= mi `M4` de la primera ronda) la fecha de pago sale del **reloj** y no de la petición | **muerta** — 4 rojos |
| N4 | el default del tope se escribe como literal `50` en el constructor | **muerta** — 1 rojo |
| O1 | el aviso del recorte pinta `recorte.tope` donde va `recorte.enVentana` | **SOBREVIVE** — hallazgo nuevo n1 |
| O2 | *(control de O1)* el aviso pinta `recorte.fuera` donde va `enVentana` | **muerta** — 1 rojo |

- **m2 — CERRADO.** `wallet-mensajeros-labels.ts` está en el censo, y con las **cuatro** aserciones
  por ser cliente. Mi N2 lo confirma: el barrido cae **nombrando la ruta**. La entrada lleva escrito
  el porqué y la medición del antes/después, así que nadie la borrará por «cosmética».
- **m3 — CERRADO, y bien.** El caso nuevo «R58: esa fecha viene de la PETICIÓN y no del reloj del
  servidor» prueba **dos** fechas distintas —y ninguna es la del reloj— para que una implementación
  que devolviera una constante no pase; comprueba documento **y** libro; y lleva una
  autocomprobación (`expect(esperada).not.toBe(día del reloj)`) que impide que el caso degenere si
  alguien toca el fixture. Mi mutación superviviente de la primera ronda ahora muere con 4 rojos.
- **La coincidencia grave que apareció al arreglar m3 — CERRADA, y confirmo la gravedad.** Los tres
  fixtures de componente ya discriminan con aritmética que cuadra (`21.150 = 18.850 + 2.300`,
  `18.850 = 12.400 + 6.450`), y mi N1 muere. El razonamiento es correcto y merece quedar escrito:
  `imputable` es **la cifra que la pantalla propone como monto**, así que con el tope recortando, la
  versión anterior habría propuesto un importe que el servidor rechaza con `excede` — un callejón
  visible solo para el operador con más deuda acumulada, que es el usuario de esta feature. Es el
  hallazgo con más consecuencia de las dos rondas y no lo encontró un test: lo encontró **volver a
  mirar los fixtures después de un hallazgo del mismo tipo**.
- **El default duplicado del tope — CERRADO.** Mi N4 muere. Y el test que lo mata está escrito con
  el cuidado que le faltaba al que se cita como deuda: ancla en `export class LiquidacionService`
  (no en el primer `constructor(` del archivo, que es el de una clase de error), lleva **cuatro
  autocomprobaciones** del corte y afirma **de dónde sale** el default, no su valor —«el 50 del
  literal y el 50 de la config valen lo mismo HOY»—. Además cierra la puerta entera:
  `expect(constructor).not.toMatch(/=\s*-?\d/)`.
- **m1 (R42) — me vale así.** La cobertura heredada es real y la verifiqué ejecutándola; el mapa la
  documenta como heredada, cita los dos tests y dice que el caso propio que `design §12` prometía no
  se escribió. Prefiero eso a un caso nuevo escrito para tapar una fila del mapa.
- **m4** — sin cambios, ya estaba justificada.

## Hallazgo NUEVO de esta ronda

### n1 (menor) — queda una coincidencia de fixture de la misma familia: `tope === enVentana`

En **los cuatro** fixtures de componente con `recorte.aplicado: true`, `tope` y `enVentana` valen lo
mismo (`3/3` en tres sitios, `50/50` en el otro). El único fixture donde difieren (`tope: 3`,
`enVentana: 0`) lleva `aplicado: false`, así que el aviso ni se pinta. Consecuencia medida: **mi
mutación O1 sobrevive** — el componente puede pintar `recorte.tope` donde va `recorte.enVentana` y
los 34 casos siguen verdes. El control O2 (pintar `fuera`) muere, así que la aserción no está hueca:
son esos dos campos concretos los que hoy son indistinguibles.

**Qué se rompería en producción:** el texto dice «Este pago alcanza a los {enVentana} cierres más
antiguos». Cuando la ventana **encoge** —el escenario que `design §2.5.5` construye a propósito: un
cierre de la ventana deja de ser imputable bajo bloqueo— la pantalla diría 50 donde el pago alcanza
a 49. Es un cardinal informativo: no cambia el importe propuesto ni el aplicado, por eso es **menor**
y no bloqueante. Se cierra con un `tope: 4` en el fixture que hoy tiene `tope: 3, enVentana: 3`.

## Deuda que confirmo (fuera de alcance, para quien la recoja)

`tests/unit/services/liquidacion-caja-puerto.test.ts:105` — **confirmado y medido**:
`codigo.indexOf("constructor(")` ancla en el constructor de `ClaveRepetidaError`
(`LiquidacionService.ts:64`), no en el de la clase; por delante hay **cuatro** clases de error con
su propio constructor. El corte se salva hoy por accidente —`indexOf(") {}")` cae en el cierre del
constructor bueno y las dos cadenas buscadas solo existen ahí—, así que **no hay falso verde hoy**,
pero la aserción está mirando ~170 líneas de más y el día que alguien mueva una declaración a ese
rango pasaría sin comprobar lo suyo. La receta ya existe en el repo y es la de
`reparto-mensajero-config.test.ts:104-113`: anclar en `export class …` y autocomprobar el corte.

## Reservas (lo que falta para un OK limpio)

1. **`progress/history.md` sin entrada** — `CHECKPOINTS > Verificación final`. Va con el cierre.
2. **T7.2 y T7.3 por marcar** en `tasks.md` cuando el leader cierre. El gate ya está corrido: `init
   OK`, **13348/13348**, medido por mí sobre este árbol.
3. **n1** — un número del fixture (una línea).
4. Dos frases del mapa quedaron **obsoletas** al cerrarse m3: la cabecera y la fila de R58 dicen que
   `M4` «sobrevive… en curso por otro encargo», y la propia fila cita ya el test que la mata. Vale la
   pena corregirlas: un mapa que se contradice a sí mismo es lo que hace que el siguiente lector deje
   de creerlo.
5. Nit: `status_note` de la ficha 205 son ~7.300 caracteres; `T7.3` pide **3-6 líneas técnicas** y
   que el detalle viva en `progress/`. El contenido es bueno; el sitio, discutible.
6. Sigue en pie el hueco declarado: **la pantalla no se ha visto**. No cambia el veredicto —está
   asumido y documentado en tres sitios— pero es lo primero que haría antes del merge.

---

**Veredicto de la segunda revisión: APROBADO CON RESERVAS.** Bloqueante 1 cerrado. Bloqueante 2
cerrado salvo la entrada de `history.md`, que es circular con este informe. 58/58 requisitos con
test nombrado y verificado —los cinco que faltaban en el mapa, comprobados uno a uno—, gate completo
verde medido por el reviewer (13348/13348), y 7 mutaciones nuevas de las que solo sobrevive una, que
queda declarada como hallazgo menor con su consecuencia escrita.
