# Review — Feature 171 · Desglose del dinero por tienda en la wallet

> Revisor: `reviewer`. Fecha: 2026-08-01.
> Objeto: `origin/feature/171-desglose-por-tienda` @ `47fcc297`, diff completo contra `origin/dev`.
> Método: worktree propio y desechable en `.claude/worktrees/review-171` (detached @ `47fcc297`),
> `pnpm install --frozen-lockfile` + `prisma generate` con `DATABASE_URL` de marcador. **Todas las
> puertas se corrieron aquí, ninguna se dio por buena leyendo la bitácora.**

## Veredicto

**OK** — aprobado con notas. **Cero hallazgos bloqueantes.** 8 hallazgos menores, ninguno de ellos
en la ruta del dinero ni en el acotamiento por rol.

---

## 1. Verificación ejecutable (corrida por el revisor, no copiada)

| Puerta | Resultado medido | Lo que declaraba la bitácora | ¿Casa? |
| --- | --- | --- | --- |
| `pnpm test` | **719 archivos (715 pasan, 4 se saltan) · 8680 tests (8606 pasan, 74 se saltan) · 0 fallos** | 719 / 8680 / 8606 / 74 / 0 | **exacto** |
| `pnpm run typecheck` | sin salida, exit 0 | verde | sí |
| `pnpm run lint` | `18 problems (0 errors, 18 warnings)` | 0 errores / 18 warnings | sí |
| `./init.sh` | lint paso · test paso · todas las migraciones tienen down.sql · aviso de `.env` ausente · **`== init OK ==`** | idem | sí |

Los 18 warnings son variables `_prefijadas` sin usar en tests ajenos a esta feature: preexistentes,
ninguno nuevo.

Delta declarado contra la baseline de `dev` (711 / 8537): **+8 archivos, +143 tests**. Cuadra con los
8 archivos de test nuevos (4 backend + 4 frontend) y ninguno borrado — verificado en el `git diff`,
que no elimina ni renombra ningún archivo de test.

---

## 2. Checklist de CHECKPOINTS.md, punto por punto

### Especificación
- [x] `requirements.md` con EARS numerados — **49** (R1–R49), sin huecos.
- [x] `design.md` con alternativas descartadas y su porqué — **cinco** (§8 A–E), cada una con motivo.
- [ ] **`tasks.md` con todas las tasks `[x]` — NO.** T0.1 sigue en `[ ]`. Ver hallazgo **m1**.
      Es el **único checkpoint formalmente incumplido de toda la lista**, y es de bitácora del
      leader, no de código.

### Trazabilidad
- [x] Cada R<n> mapea a al menos un test concreto — **49/49**. Comprobado por muestreo leyendo
      los asserts, no la tabla. Ver §3.
- [x] `progress/impl_171-desglose-por-tienda.md` contiene el mapa R<n> → test (dos secciones,
      backend y frontend, sin solapes ni huecos).

### Calidad de código
- [x] `typecheck` sin errores. `lint` sin errores. `pnpm test` en verde.
- [~] **E2E: checkpoint declarado INAPLICABLE**, con motivo. Los 18 specs de `e2e/` están
      "WRITTEN but NOT EXECUTED" (así lo dicen ellos mismos) y no hay harness enganchado a `pnpm
      test` ni a CI; añadir un spec 19 que nadie ejecuta no es cobertura, es decoración. El riesgo
      se cubre por otra vía y es real: el test de pantalla monta la `SaldosTiendasTable`
      **verdadera** (no el desglose suelto) y hay un test que atraviesa la cadena de servidor
      completa WalletTiendaService → WalletTiendaMovimientoRepository → Prisma falseando solo la
      última capa.

### Datos y seguridad (Supabase)
- [x] **Tabla nueva: ninguna.** No aplica RLS nueva. `wallet_tienda_movimiento` ya la tiene desde
      la 43.
- [x] **Migraciones: ninguna.** `git diff --stat origin/dev...HEAD -- db/ prisma/` está **vacío**.
      Verificado por el revisor, no aceptado del log. R48 cumplido.
- [x] Sin secretos hardcodeados. Nada nuevo en variables de entorno.
- [x] Webhooks: no aplica (feature de solo lectura).

### Patrón de capas
- [x] **Action** (`lib/actions/wallet-tienda.ts`): resuelve actor, valida schema, delega. Cero SQL,
      cero negocio.
- [x] **Service** (`WalletTiendaService`): cero Request/Response/headers. Recibe el repo por
      inyección.
- [x] **Repository**: `agregarDesglosePorTienda` es **un** `groupBy`. No clasifica ni resta — la
      cubeta la decide `lib/utils/desglose-tienda.ts`. Sin lógica de negocio.
- [x] Interfaces en `lib/interfaces/{repositories,services}/`, separadas por categoría.

### Permisos
- [x] `wallet/tiendas/page.tsx` valida en el servidor vía `resolveActorFromSession` + `esAccesoTotal`
      → `notFound`, y además comprueba el `status` de la action (defensa en profundidad).
- [x] El componente cliente recibe los saldos **por props ya serializados** (STRING); el desglose lo
      pide por Server Action, no por API route.
- [x] Sin mutaciones: R47 se cumple por construcción y está probado.

### Multi-país / configuración
- [~] No se hardcodea país ni cuenta. La **moneda** sí (símbolo fijo en `money()`), pero eso es deuda
      preexistente de la 43 y la 171 hace lo correcto: **reusar** ese helper en vez de duplicarlo.
      Ver hallazgo **m8**.

### Verificación final
- [x] `./init.sh` en verde.
- [x] `progress/review_171-desglose-por-tienda.md` existe (este archivo).
- [ ] Entrada en `progress/history.md` — pendiente; la escribe el leader al cerrar la ficha.

---

## 3. Trazabilidad: los 49 requisitos, comprobados leyendo asserts

Recorridos uno a uno contra el código de test, no contra la tabla de la bitácora. Ninguno apoyado en
un test vacío, ninguno huérfano. Muestreo profundo de los que se juegan dinero:

| Requisito | Test que lo prueba de verdad | Qué afirma realmente |
| --- | --- | --- |
| R8/R9 | `tests/unit/utils/desglose-tienda.test.ts` | Recorre el SEED de categorías en **runtime** y exige cubeta para cada valor **y** que el mapa no tenga claves de más (las dos direcciones). El `Record` exhaustivo rompe además el typecheck. R9 cerrado por partida doble. |
| R10 | idem | saldo = aFavor − cargos − pagado en positivo, negativo y cero, con cifras concretas. |
| R11 | `wallet-tienda-desglose.test.ts` + `desglose-tienda.test.ts` (4 conjuntos) + UI | Compara las **dos derivaciones independientes** del mismo conjunto: la de la cabecera (por `categoria`) contra `derivarSaldoTienda` (por `tipo`). |
| R23 | `desglose-tienda.test.ts` | 0.10 + 0.20 = 0.30 exacto y 98765432109.87 sin perder céntimos. Regex de dos decimales sobre los cuatro importes. |
| R24 | servicio + repositorio + schema + action | Cuatro tests distintos. El del servicio inyecta `todasLasTiendas: true` y `tienda_id: "tienda-B"` y comprueba que el repositorio recibe `tiendaId: "tienda-A"` y **ninguna** clave extra. |
| R26/R27/R28 | `wallet-tienda-desglose.test.ts` | Ver §4: es el punto más verificado de la feature. |
| R34/R35 | servicio + repositorio | Exactamente **2** llamadas al repositorio por lectura, con pageSize 20 y 100, y con 1 tienda y con 50. `usuario.findMany` nunca llamado. |
| R41 | `desglose-tienda-descarga-columnas.test.ts` + `columnas-sensibles.guardia.test.ts` | Barre las celdas con una regex de UUID; la guardia de la 170 descubrió el módulo **sola** por convención de nombre. |
| R43 | 4 tests en 3 niveles | Ver §6. |
| R48 | verificado por el revisor | `git diff --stat -- db/ prisma/` vacío. |

**Dos coberturas indirectas** (no huecos, pero conviene decirlo): el **nombre del archivo** de R38 y
el **texto del mensaje de tope** de R39 se apoyan en infraestructura compartida de la 170
(`nombreArchivoDescarga(titulo, …)` y `mensajeLimite`), que tiene sus propias suites. El `titulo` que
la 171 pasa **sí** lleva el nombre de la tienda ("Desglose de Tienda Norte"), y la cadena
titulo → slug → nombreArchivo está probada allí. La cobertura es real; la aserción no es local.
Ver hallazgo **m5**.

---

## 4. Acotamiento por rol — el punto crítico, contrastado

El backend afirma haberlo verificado de cuatro formas, **una en negativo**. **Contrastado: la prueba
existe, y prueba lo que dice.**

`tests/unit/services/wallet-tienda-desglose.test.ts:152-163` define `repoQueExplota()`: todos los
métodos del doble **lanzan** el error "el guard de rol NO se evaluo antes de la base: se llamo a
<metodo>", y el test de la línea 244 pide el desglose con los cinco roles sin acceso esperando
`forbidden`. Si alguien mueve el `if (!esAccesoTotal(...))` detrás del `Promise.all`, el `await`
rechaza con ese mensaje exacto en vez de devolver `forbidden`. **Es exactamente la contraprueba que
la bitácora describe** ("30 verdes a 3 rojos"): no es una afirmación, es una propiedad del archivo.

Las otras tres, también contrastadas:

1. **Contraprueba de acceso** (línea 214): `maestro` y `admin` reciben filas **concretas**
   (`["A-cod","A-flete"]`), `total: 2` y cabecera no nula. Un guard que negara a todos haría caer
   este test — el test de R27 no puede pasar por vacío.
2. **Denegación con cero consultas** (línea 230): `adminTienda`, `adminSatelite`, `mensajero`,
   `apiKey` y un rol inventado devuelven `forbidden`, sin propiedad `data`, y con **cero** llamadas a
   `listarPorTienda` y `agregarDesglosePorTienda`.
3. **Contraprueba de R28** (línea 253): `adminTienda` con usuarioId "tienda-A" pidiendo
   tiendaId "tienda-A" —su propia tienda— recibe `forbidden`. El test afirma primero
   `expect(propia.tiendaId).toBe(TIENDA_A.usuarioId)`, o sea: el caso es el que se cree que es. Y a
   continuación comprueba que **no se le quita nada**: su `listarMisMovimientos` le sigue devolviendo
   lo suyo.

**El export NO se salta el acotamiento.** Es lo que había que mirar, y está cerrado:
`listarMovimientosDeTiendaCompleto` lleva **el mismo guard**, evaluado antes del repositorio,
probado con los cinco roles (línea 649), con `tiendaId` escrito al final del objeto que va al
repositorio, y con un test que descarga la tienda A y la B **en las dos direcciones y con las dos no
vacías**, afirmando que ningún id se cruza (línea 660). El `.strict()` del schema del modo completo
rechaza además cualquier clave extra en el borde, con test propio.

**Página:** `tests/integration/wallet-tiendas-page.test.tsx` (nuevo; la página nunca había tenido
test) afirma que `mensajero`, `adminTienda`, `adminSatelite` y la falta de sesión acaban en
`notFound` **y que la action de saldos no se llega a llamar** — el dato no sale de la base, no es que
no se pinte.

---

## 5. Money-safe — verificado por lectura del árbol, no por el comentario

Un `grep` de `Number(`, `parseFloat`, `parseInt`, `toFixed` y `Math.round` sobre
`app/(app)/wallet/tiendas/**` devuelve **cuatro coincidencias, las cuatro dentro de comentarios**
que explican por qué no se hace. **Cero aritmética real sobre importes en el frontend.**

- Los cinco importes (aFavor, cargos, pagado, saldo + el monto de cada fila) llegan como STRING
  escala 2 ya con signo, calculados con `Prisma.Decimal` en `derivarDesgloseTienda`.
- Se pintan con `money()`, que solo antepone el símbolo y no toca el valor. Y el test lo prueba por
  **identidad de referencia** (`toBe`, no `toEqual`) con el `money` de `/mi-wallet`: no puede
  divergir porque es el mismo objeto.
- La descarga emite el monto **crudo**, sin símbolo (para que la hoja pueda sumar) y sin parsear. El
  test lo remacha con la evidencia: `String(Number("1000.10"))` da `"1000.1"` — el céntimo que se
  habría perdido.
- Acierto deliberado que merece decirse: antes de la primera carga los importes muestran **"—", no
  cero**. Un cero mientras carga sería una cifra falsa en una pantalla de saldos, y además haría
  indistinguible "cargando" del cero verdadero de "Pagado a la tienda".

---

## 6. «Pagado a la tienda» = 0,00 — leído del libro, no fijado a mano

Contrastado en los tres niveles, y el que importa es el tercero:

| Nivel | Test | Qué demuestra |
| --- | --- | --- |
| Derivación | `desglose-tienda.test.ts` "(c) CON un movimiento pago_tienda sembrado a mano" | El **mismo** conjunto con y sin el pago: `pagado` pasa de 0.00 a 4000.00, `cargos` **no cambia** y el saldo baja de 9000.00 a 5000.00. |
| Repositorio | `wallet-tienda-movimiento-repository.test.ts` "R43: una fila pago_tienda llega TAL CUAL" | La fila se propaga sin filtrarse ni reclasificarse, y afirma que el WHERE es solo `tiendaId` — **no excluye ninguna categoría**. |
| **Cadena servicio a repositorio a Prisma** | `wallet-tienda-desglose.test.ts:567` | **Es el test que la consigna pedía verificar, y está.** Construye el servicio con el repositorio REAL y solo dobla el cliente Prisma; siembra el groupBy con una fila `debito / pago_tienda / 4000.00` y exige la cabecera `aFavor 10000.00, cargos 1000.00, pagado 4000.00, saldo 5000.00`. **Un "0.00" fijo en el servicio haría caer este test.** |

`CUBETA_POR_CATEGORIA` manda pago_tienda a la cubeta "pagado" y un test afirma que es la **única**
categoría de esa cubeta.

**El frontend lo pinta sin ocultarlo**, y con dos tests que se apoyan mutuamente: uno afirma que el
tercer bloque de la cabecera dice "Pagado a la tienda" con cifra 0.00 **y que ahí no queda un "—"**
(o sea: cero verdadero, no "sin datos"); otro le da al **mismo** componente una respuesta con
`pagado: "4000.00"` y comprueba que la cabecera lo refleja y que el saldo baja a 5000.00. Si el cero
estuviera escrito a mano en el cliente, el segundo caería.

---

## 7. Coste por apertura

- **Listar N tiendas da 0 lecturas de desglose.** Probado con 4 tiendas en el test de pantalla y otra
  vez desde el test de página. La razón estructural está bien elegida: el `useSWR` vive **dentro** de
  `DesgloseMovimientosTienda`, y `DataTable` solo **monta** el `renderExpanded` de la fila abierta.
  Sin el test "sin abrir nada", una implementación que precargara todo pasaría el otro.
- **Abrir una fila da exactamente 1 llamada, con el tiendaId de esa fila**, y ninguna llamada pidió
  la otra tienda (contraprueba explícita).
- **Abrir la segunda cuesta 1 llamada más**, y no se relee la primera. Cerrar y reabrir no acumula.
- **En el servidor: 2 llamadas al repositorio constantes** (página + cabecera, en `Promise.all`),
  probadas con pageSize 20 y 100 y con 1 y 50 tiendas en el libro. En sentencias SQL son 3
  (findMany + count + groupBy), y ninguna crece con nada.
- **Ninguna consulta del nombre de la tienda** (R35): baja por props desde la fila. Afirmado tanto en
  el servicio (`usuario.findMany` no llamado) como en la respuesta (no lleva `tiendaNombre`).
- **Filtrar o paginar reconsulta solo esa tienda** (R36), y hay un test que lo mira desde la pantalla
  con dos filas abiertas: filtrar en Norte no añade ni una llamada de Sur, y Sur conserva sus cifras.

---

## 8. El censo del export

Contrastado leyendo la guardia entera (`cobertura-tablas.guardia.test.ts`), no solo los números.

- **Los totales se incrementaron desde los REALES** (24/29/24/30, tras el borrado de
  `OrdenesApartado.tsx` con la vista legacy) a **25/30/25/31**, con `fuera` en 6. No desde los del
  spec de la 170 (25/30/25/31 a 26/31/26/32), que estaban obsoletos. La cabecera del test lo explica
  y avisa de que coincidir con el total del spec es **casualidad aritmética**, porque el reparto no
  es el mismo. Correcto y bien documentado.
- **La guardia sigue fallando en los dos sentidos**, verificado en el código:
  - tabla en el árbol **sin registrar** da fallo ("hay tablas sin registrar en censo-tablas.ts");
  - entrada del registro **de un archivo que ya no monta DataTable** da fallo;
  - número de tablas registradas distinto del de instancias reales del archivo da fallo;
  - **estado declarado distinto del estado real del código** (prop `descarga` presente o no) da
    fallo, tabla a tabla;
  - los cuatro totales duros fallan si el árbol crece o encoge sin pasar por el registro.
- La bitácora documenta haberla visto caer en los dos sentidos antes de actualizarla, incluida la
  contraprueba de declararla `fuera` (cae por tres sitios a la vez). **Coherente con lo que hace el
  código.**
- La guardia de datos sensibles descubrió el módulo nuevo **sola** (convención de nombre
  `*-descarga-columnas.ts`) y sigue verde. El módulo exporta **exactamente dos cosas**, con un test
  que lo afirma, porque la guardia ejecuta con una sonda toda función exportada.

---

## 9. Las dos declaraciones que había que juzgar

### A) `categoria` vs `tipo` sin restricción en la base — ACEPTABLE hoy. No bloqueante. Con una condición para la 172.

**Acepto la decisión.** Motivos, en orden de peso:

1. **R48 prohíbe expresamente la migración** en esta feature. Añadir un CHECK aquí sería el
   implementer decidiendo por su cuenta ampliar el alcance sobre una tabla append-only con datos en
   producción. Habría sido peor.
2. **Hoy solo hay un escritor.** `wallet_tienda_movimiento` la escribe únicamente el feed del cierre
   (`WalletTiendaFeedService` a `crearMovimientos`), y `tipo`/`categoria` son enums nativos de
   Postgres. Una fila incoherente solo puede nacer de un bug en ese único camino o de un INSERT
   manual.
3. **Está declarado en el código**, no escondido en una bitácora: el comentario de
   `derivarDesgloseTienda` explica el límite y por qué no se cierra.

**Pero matizo la mitigación, porque el log la vende más fuerte de lo que es.** Dice que "el test de
R11 compara ambas derivaciones para que la divergencia, si apareciera, salga por ahí". Eso es cierto
para una **regresión de código** y falso para una **incoherencia de datos**: el test corre sobre
fixtures sintéticos coherentes, nunca sobre la base. Ninguna fila incoherente de producción
dispararía nada, y no hay ningún test con una fila incoherente que demuestre siquiera qué pasaría.
No cambia el veredicto —el riesgo hoy es teórico—, pero conviene no creerse protegido.

**Condición para la 172, y es la parte que importa:** la 172 añade un **segundo escritor** a esta
tabla (pago_tienda, débito). Ahí es exactamente donde el invariante deja de tener un solo guardián, y
donde una fila con categoria pago_tienda y tipo credito haría que la fila de saldos y su propio
desglose mostraran **cifras distintas para la misma tienda**. Recomendación (no bloqueante aquí): que
la 172 lleve el CHECK categoria/tipo en su migración, o que registre ficha propia antes de emitir el
primer pago.

### B) Una tienda sin movimientos no aparece — de acuerdo, y con menos consecuencia de la que se teme.

**Comparto la decisión.** Las filas salen de un groupBy sobre el propio libro
(`listarSaldosTodasTiendas`), así que sin movimientos no hay fila. Cambiar el origen de las filas
habría **violado R6** ("conservar la tabla de saldos con el mismo contenido y alcance"), y eso es una
feature aparte, no una nota al pie de esta.

Y la consecuencia para la 172 es **menor de lo que sugiere el planteamiento**: la tienda que no
aparece es la que **nunca tuvo un movimiento**, y a esa no hay nada que pagarle. Una tienda ya pagada
del todo sigue teniendo movimientos, así que sigue apareciendo con saldo 0.00 — que es lo correcto.
El único caso perdido es "pagar a alguien a quien no se le debe nada", que no es un caso.

Lo único que pediría: que el spec de la 172 **no asuma** que toda tienda del sistema es alcanzable
desde esta pantalla, y lo diga.

---

## 10. Hallazgos

### BLOQUEANTES: ninguno.

### Menores

**m1 — menor — tasks.md T0.1 sin marcar y sin la línea del leader.**
T0.1 ("resolver el conflicto de calendario con la 170", P5) sigue sin marcar, y
`progress/current.md` no lleva la línea que la task exige ("el leader deja escrito si la 171
arranca"). Es el **único checkpoint de CHECKPOINTS.md formalmente incumplido**. De hecho el conflicto
está resuelto: la 170 ya entró en `dev` (PR #242, `a3a45402`, "el ranking cierra la FASE 1"), y los
archivos que se solapaban no colisionaron. *Para cumplirlo:* una línea en `current.md` y marcar la
casilla. No toca código.

**m2 — menor — Ocho tests que podrían pasar en vacío.**
En `tests/unit/services/wallet-tienda-desglose.test.ts` el patrón `if (r.status !== "ok") return;`
aparece **sin** un `expect(r.status).toBe("ok")` previo en las líneas **369, 386, 407, 434, 468, 545,
558 y 643** (R16, R17, R11, R12, "tienda sin movimientos", los dos de R43 y R37). Si el servicio
regresara a `forbidden`, esos ocho pasarían sin afirmar nada. **No es fatal** porque "CONTRAPRUEBA
R26" sí afirma `ok` con el mismo fixture y caería primero, pero cada uno de los ocho pierde su
aserción. Una línea `expect(r.status).toBe("ok")` antes del return lo cierra.

**m3 — menor — La cabecera mezcla una cifra sin filtrar con tres marcadores de carga.**
`DesgloseMovimientosTienda.tsx:346` pinta el saldo como `desglose?.saldo ?? resumen.saldo`. Al
aplicar un filtro cambia la clave SWR, `data` pasa a `undefined` y durante el vuelo la cabecera
muestra **el saldo TOTAL de la fila** junto a un guion largo en los otros tres. Es una pantalla de
dinero: por un instante convive una cifra del conjunto **sin filtrar** con tres marcadores de carga.
Los otros tres importes resuelven esto bien; el saldo es la excepción. *Sugerencia:* caer a `null`
también cuando ya hay filtros aplicados. No lo cubre ningún test, y no debería, salvo que se corrija.

**m4 — menor — Comentario que sobredimensiona las barreras en el camino paginado.**
`WalletTiendaService.listarMovimientosDeTienda` (comentario, líneas 166-168) dice que `.strict()` en
el borde es una de las tres barreras. **`listarMovimientosDeTiendaSchema` NO es `.strict()`** — solo
lo es `listarMovimientosDeTiendaCompletoSchema`. En el paginado las claves extra se **descartan**
(comportamiento por defecto de zod), no se **rechazan**. El efecto de seguridad es equivalente y está
probado (el test de R24 inyecta `todasLasTiendas` y `tienda_id` y el repositorio recibe solo el
`tiendaId` correcto), pero la descripción no es exacta y en un archivo de dinero los comentarios se
leen como garantías.

**m5 — menor — R38 (nombre del archivo) y R39 (mensaje del tope) sin aserción local.**
Ambos se apoyan en infraestructura compartida de la 170: titulo a slugTitulo a
`nombreArchivoDescarga`, y `mensajeLimite(total, limite)`. El titulo que pasa la 171 sí lleva el
nombre de la tienda, y ambas piezas tienen suites propias, así que la cobertura existe. Pero **la
mitad "nombre del archivo" de R38 y la mitad "indica total, tope y qué hacer" de R39 no se afirman en
ningún test de la 171**. Una aserción sobre `nombreArchivoDescarga` con el título del desglose
cerraría la primera.

**m6 — menor — Aritmética de coma flotante dentro del test money-safe.**
`tests/unit/utils/desglose-tienda.test.ts:288-299` calcula el valor **esperado** del bloque de R11
sumando con `Number(f.total)` y cerrando con `toFixed(2)`. Con los fixtures actuales no falsea nada,
pero es exactamente el patrón que el código de producción prohíbe, dentro del test que verifica que
no se hace. Con `Prisma.Decimal` sería equivalente y coherente.

**m7 — menor — status_note de la 171 desbordada.**
Un párrafo enorme en `feature_list.json`, que además arrastra los totales de censo obsoletos
(25/30/25/31 a 26/31/26/32) y los corrige al final del mismo texto. El detalle ya vive en
`progress/impl_171-desglose-por-tienda.md`; la ficha debería quedar en 3-6 líneas técnicas.

**m8 — menor (deuda preexistente, NO introducida aquí) — Moneda hardcodeada.**
`money()` fija el símbolo de colón (`mi-wallet-labels.ts`, feature 43). El checkpoint "no se
hardcodeó moneda" sigue incumplido en el módulo wallet. **La 171 hace lo correcto**: reutiliza el
helper —probado por identidad de referencia— en vez de duplicar un segundo símbolo que divergiría.
Se anota para que no se pierda, no como reproche a esta feature.

---

## 11. Lo que está bien, dicho con la misma claridad

- **El acotamiento por rol es el punto mejor cerrado de la feature.** Guard antes de la base
  demostrado **en negativo** con un doble que revienta con mensaje explícito; contraprueba de acceso
  para que la denegación no pase por vacío; `adminTienda` bloqueado incluso pidiendo lo suyo, con la
  comprobación de que su superficie propia sigue intacta; y el **export con el mismo guard**, probado
  en las dos direcciones y con las dos tiendas no vacías. No encontré ninguna vía por la que el
  dinero de una tienda salga hacia otra.
- **Money-safe de punta a punta, sin excepciones.** Cero `Number`/`parseFloat`/`toFixed` en el
  frontend; `Prisma.Decimal` en la derivación; STRING en la frontera; el helper de moneda compartido
  **por identidad**, no copiado.
- **"Pagado a la tienda" está resuelto como debía**: leído de la categoría real, probado con la
  cadena de servidor completa, y pintado como cero verdadero y no como "sin datos". La 172 lo
  encontrará funcionando sin tocar una línea, y eso está demostrado, no prometido.
- **El coste por apertura está resuelto en el sitio correcto** —el `useSWR` dentro del desplegable— y
  probado con las **dos** mitades: la que cuenta al abrir y la que cuenta **sin** abrir nada. Sin la
  segunda, una implementación que precargara todo pasaría la primera.
- **Cero duplicación de etiquetas**, comprobada con `toBe` y no con `toEqual`. Es la diferencia entre
  "hoy dicen lo mismo" y "no pueden divergir".
- **Ninguna suite existente alterada.** Verificado con `git diff`: los siete archivos de test previos
  que aparecen en el diff añaden **solo** el miembro que faltaba a un doble para seguir implementando
  la interfaz ampliada. **Ni una aserción borrada, cambiada ni añadida.** La afirmación de las dos
  fases es exacta.
- **La página `/wallet/tiendas` gana su primer test**, que no existía. Se toca una pantalla de dinero
  dejando atrás más red de seguridad de la que había.

---

## Veredicto final

# OK

Cero bloqueantes. Los 49 requisitos tienen test que existe, pasa y afirma lo que dice. Las cuatro
puertas corridas por el revisor coinciden **exactamente** con lo declarado. Las dos limitaciones
declaradas por el backend son aceptables y están bien documentadas, con la matización de la §9.A
sobre la 172.

Los ocho hallazgos menores no bloquean el merge. **m1** debería cerrarse antes de pasar la ficha a
`done` (es un checkpoint). **m2** y **m3** merecen entrar como deuda anotada; el resto son notas.
