# Feature 172 — Liquidación · REVIEW

> Revisor: agente `reviewer`. Fecha: 2026-08-02. Rama `feature/172-liquidacion`,
> worktree `lote-135`. Alcance revisado: los 11 commits desde `92b25440`
> (`dd0902ee` … `5d9f1446`), el spec (`requirements` 85 R / `design` / `tasks` 9 tandas),
> `progress/impl_172-liquidacion.md` y el contrato del arnés.
>
> **VEREDICTO: RECHAZADO.** Dos bloqueantes, los dos estrechos y baratos de cerrar.
> El trabajo es, por lo demás, de calidad muy alta: ninguna regresión, ninguna aserción
> ajena debilitada, y lo money-critical **aguanta mutaciones que este revisor introdujo por
> su cuenta**. Los dos bloqueantes no ponen en duda el código: ponen en duda que un futuro
> cambio se note.

---

## 1. Método — qué se verificó de primera mano

No se dio nada por bueno por estar escrito en la bitácora. Lo ejecutado:

- `./init.sh` completo, corrido por este revisor: **`== init OK ==`, 793 archivos /
  9857 tests, 0 fallos** (lint: 0 errores, 27 warnings preexistentes). Coincide con lo
  medido por el leader y con el baseline declarado (772 / 9257 ⇒ +21 archivos, +600 tests).
- `prisma migrate status` contra `ordenex @ localhost:5432`: **105 migraciones,
  «Database schema is up to date!»**. Confirma que la migración de T A.1 aplica de verdad.
- **Seis pruebas por mutación propias**, independientes de las 13 del implementer, sobre
  código REAL, con restauración verificada por `git status` tras cada una:

| # | Mutación introducida | Resultado |
| --- | --- | --- |
| 1 | Quitar ` FOR UPDATE` del SQL crudo de `bloquearBeneficiario` | **38 de 39** tests de `liquidacion-idempotencia` caen. El store no pasa de largo: lanza si la sentencia no lleva `FOR UPDATE` |
| 2 | `VIGENTE = {}` (las sumas dejan de excluir anulados) | **2** en el repositorio (forma del `where`) **+ 5** de comportamiento en la cadena pagar→anular→volver a pagar |
| 3 | `if (false)` en las DOS ramas del tope `[P1]` | **9** caen: R25, R31, R46 y los tres de carrera |
| 4 | `esAccesoTotal` devuelve `true` para `adminSatelite` | **7** caen (pagar mensajero, pagar tienda, anular, los dos listados) |
| 5 | Contraasiento del mensajero con **signo invertido** (`pago`/`ajuste_pago`, par que el CHECK de la base SÍ acepta) | **5** caen, incluida «el pendiente vuelve a su valor» |
| 6 | `Number(value).toFixed(2)` en `liquidacion-labels.ts` | el barrido money-safe de T H.2 cae |

  La mutación 5 es la que más dice: es un bug de dinero que la base **no** habría
  atrapado, y lo atrapa el test de comportamiento.
- **Barrido money-safe independiente** sobre los **44** archivos de código tocados
  (`lib/`, `app/`, `components/`): **cero** `Number(` / `parseFloat(` / `parseInt(`
  ejecutables (los 5 aciertos del grep son comentarios) y **cero** `.toFixed(` fuera de
  `lib/`. Confirmado sin depender de la guardia de la propia feature.
- **Auditoría del radio de TODAS las tandas**, no solo la C: se listaron las líneas
  ELIMINADAS de los 17 archivos de test preexistentes modificados.

---

## 2. Verificación ejecutable — checklist

- [x] `pnpm run typecheck` sin errores (dentro de `./init.sh`).
- [x] `pnpm run lint` sin errores.
- [x] `pnpm test` verde: 793 / 9857, 0 fallos.
- [x] `./init.sh` termina en `== init OK ==`.
- [x] Suite corrida por el revisor, no leída de la bitácora.

---

## 3. CHECKPOINTS.md, punto por punto

### Especificación
- [x] `requirements.md` con EARS numerados `R1`…`R85`. **85 declarados, verificado por conteo.**
- [x] `design.md` con alternativas descartadas y su porqué (K/L para el candado, H para la
      marca de anulado, G para `cierre_id` en el libro, A para la aprobación atómica).
- [x] `tasks.md` con **43 tasks, las 43 en `[x]`**. Cero pendientes.

### Trazabilidad
- [x] La tabla `§ Trazabilidad` tiene **85 filas, una por cada R1–R85**, sin huecos ni
      sobrantes (verificado programáticamente contra `requirements.md`).
- [x] Los **19** archivos de test citados con ruta completa **existen todos**.
- [x] `progress/impl_172-liquidacion.md` contiene el mapa `R<n> → test`.
- [ ] **`R61` no tiene ningún test.** Único de los 85. → **BLOQUEANTE 1.**
- [ ] **`R6` tiene su mitad de pantalla medida contra una prop, no contra el rol.**
      → **BLOQUEANTE 2.**
- [~] Tres punteros incorrectos en la tabla (R26 y R67). La cobertura real existe y se
      verificó; el defecto es documental. → **menor 4.**

### Calidad de código
- [x] TypeScript strict, lint y tests en verde.
- [n/a] **E2E: INAPLICABLE por decisión vigente del humano** («no más e2e, pruebas básicas
      nada más»). `CHECKPOINTS.md` lo pediría por ser flujo de pagos. Se acepta la
      sustitución declarada en `design.md §13` y **se comprobó que sustituye de verdad**:
      `liquidacion-idempotencia.test.ts` recorre la cadena de servidor completa (servicio
      real + 3 repositorios reales + SQL crudo real) contra un store que implementa la
      semántica del `FOR UPDATE`, del `UNIQUE` y de los dos índices únicos parciales, y la
      mutación 1 demuestra que ese store no perdona la ausencia del candado. Es una
      sustitución honesta, no una excusa. Lo que queda descubierto y está declarado: nadie
      ejercita el navegador real contra Postgres real de extremo a extremo.

### Datos y seguridad (Supabase)
- [x] **RLS**: `ENABLE ROW LEVEL SECURITY` en las dos tablas nuevas, **sin políticas** (solo
      service role), igual que `wallet_movimiento` / `wallet_tienda_movimiento` /
      `cierre_dia`. Afirmado por test estático y **medido contra Postgres** en T H.3
      (`relrowsecurity=true`, `policies=0`).
- [x] **Migración reversible**: `down.sql` presente, en orden inverso, con los dos
      `DROP CONSTRAINT`. `./init.sh` valida que toda migración tiene su `down.sql`.
      Round-trip up→down→up ejecutado contra Postgres local con salida pegada;
      `migrate status` limpio verificado ahora por el revisor.
- [x] **Cero sentencias de tipos** en la migración ⇒ ningún `down.sql` previo tocado. Es la
      cicatriz «enum nuevo ⇒ recrear el enum en los down anteriores», correctamente evitada
      reutilizando `metodo_pago_value` y las categorías de ajuste ya reservadas.
- [x] **Los dos CHECK son exhaustivos** sobre los enums reales: `wallet_tienda_movimiento`
      **10/10** categorías clasificadas, `pago_mensajero_movimiento` **5/5**. Verificado por
      el revisor leyendo `db/schema.prisma` y contando contra el SQL. Y **fallan cerrado**
      (disyunción de listas cerradas, no negación), que es R60.
- [x] **Ningún secreto hardcodeado**: barrido sobre el diff completo, cero.
- [n/a] Webhooks: la feature no añade ninguno.

### Patrón de capas
- [x] **Controller sin DB ni negocio**: `lib/actions/liquidacion.ts` solo resuelve sesión,
      hace `schema.parse` y delega. Cero Prisma.
- [x] **Service sin HTTP**: `LiquidacionService` no conoce `Request`/`Response`/`headers`;
      recibe repositorios y el runner de transacciones por constructor.
- [x] **Repository solo Prisma**: `LiquidacionPagoRepository` no tiene guardias de rol ni
      decide si el pago cabe.
- [x] **Interfaces en `lib/interfaces/`** separadas por categoría.
- [x] Detalle que merece nota: `CierresAdminService` recibe la dependencia como
      `Pick<…, "sumarVigentesPorCierre" | "obtenerCierreParaPago">`. El typecheck impone que
      esa pantalla pueda **derivar** el pendiente y **no pueda** escribir un pago. Es la
      forma correcta de expresar «aprobar y pagar son dos escrituras distintas».

### Permisos
- [x] Páginas protegidas validan en servidor; `puedeRegistrarPago` y `puedeAnular` se
      resuelven server-side con `esAccesoTotal`.
- [x] **Falla cerrado**: `puedeRegistrarPago = false` y `puedeAnular = false` por defecto en
      los tres componentes. Un montaje que se olvide de pasarlo no ofrece pagar a nadie.
- [x] Componentes compartidos reciben datos por props.
- [x] **Mutaciones por Server Action**, no por Route Handler. Cinco acciones, ninguna de
      editar (R65) ni de desanular (R82); hay test que afirma la lista EXACTA de exports.
- [ ] El cableado `page → prop` está afirmado para `/wallet/tiendas` y **no** para
      `/cierres-admin`. → **BLOQUEANTE 2.**

### Multi-país / configuración
- [~] `₡` aparece literal en 4 sitios nuevos. Es la convención viva del repo
      (`PriceLabel.tsx`, `cierre-detalle-shared.tsx`, `CierreDiaModule.tsx`) y **no había
      alternativa usable**: `lib/config/moneda.ts` expone `formatMonto(monto: number)`, que
      recibe un `number` y por tanto es inutilizable en un camino money-safe (R14). No se
      cuenta como regresión de la 172; se anota abajo como observación.
- [x] Ningún país ni cuenta hardcodeados. La hora de Costa Rica se resuelve por
      `fechaCalendarioCR`, utilidad preexistente.

### Verificación final
- [x] `./init.sh` verde.
- [x] `progress/review_172-liquidacion.md` existe (este archivo).
- [ ] **No hay entrada de la 172 en `progress/history.md`.** → menor 6 (tarea de cierre).
- [~] `feature_list.json` sigue en `in_progress`, que es lo correcto mientras no pase el review.

---

## 4. Las tres respuestas del humano — ¿implementadas de verdad?

### P1 — el pago que excede se RECHAZA, bajo candado. **SÍ.**

El orden en `LiquidacionService` es el correcto, y es el orden lo que importa:
candado → lectura del disponible → tope → escritura, todo dentro de la misma transacción.
El candado es `SELECT "id" FROM … FOR UPDATE` con el id **parametrizado**, sobre la fila del
`cierre_dia` (mensajero) o del `usuario` (tienda) — el grano exacto de lo que se consume, no
una tabla entera.

Lo verificado por el revisor, no leído:
- Mutación 1 (quitar `FOR UPDATE`): 38/39 caen. El store no puede pasar sin candado.
- Mutación 3 (desactivar el tope): 9 caen, entre ellas las tres de carrera.
- El test de R85 incluye además la **contraprueba** que suele faltar: una carrera de pagos
  que SÍ caben entra entera, así que el candado no está aprobando los tests convirtiendo
  toda concurrencia en rechazo.
- R83 se mide leyendo el log que escribe el **store en el borde de la sentencia**, no lo que
  el servicio dice que hace.

Merece quedar registrado el hallazgo de proceso que el implementer declaró y que sostiene
todo lo demás: la **primera** versión del store fotografiaba las filas después de ceder el
turno, y con eso el test de carrera pasaba SIN candado. Lo detectó él y lo corrigió a
instantánea al inicio de la sentencia (`READ COMMITTED`). Es exactamente el fallo del que
este repo tiene cicatriz, encontrado y cerrado antes de la revisión.

### P3 — pagan `maestro` y `admin`; `adminSatelite` fuera, pero aprueba cierres. **SÍ en el servidor; a medias en la pantalla.**

- Servidor: los **cinco** puntos de entrada (`registrarPagoMensajero`,
  `registrarPagoTienda`, `anularPago` y los dos listados) llaman a `esAccesoTotal` **antes
  de tocar datos**, con el log de llamadas vacío como aserción. Verificado por la mutación
  4: abrir `esAccesoTotal` a `adminSatelite` rompe 7 tests.
- `adminSatelite` sigue aprobando: `CierresAdminService.aprobarCierre` no cambió su
  autorización, y la suite de cierres pasa sin una sola aserción debilitada.
- Anular hereda el mismo gate (R81), no uno paralelo.
- **Lo que falta**: ver BLOQUEANTE 2.

### P4 — anular es contraasiento sobre fila inmutable. **SÍ.**

- `liquidacion_pago` no tiene `updated_at` ni `deleted_at`; **no existe ni un `update` ni un
  `delete`** sobre ella en todo el repositorio. «Anulado» se DERIVA de que exista fila en
  `liquidacion_anulacion`, así que no hay dos sitios que puedan desincronizarse.
- El monto del reverso se lee **del pago, en el servidor**; `.strict()` impide que un
  `monto` colado llegue siquiera al servicio (dos barreras, no una).
- Una sola vez, por **restricción de datos** (`UNIQUE(pago_id)`), no por comprobación
  previa; el 23505 se midió contra Postgres real en T H.3.
- El contraasiento se fecha el día de la anulación (R77) y toma **el mismo candado** que
  tomaría su pago (R84), no uno distinto.
- La mutación 5 confirma que el signo del contraasiento está medido por comportamiento y no
  solo por la forma de la fila.

---

## 5. «Aprobar un cierre no se puede tumbar por un fallo del pago»

Es la propiedad de mayor consecuencia de la feature (por la 111, un cierre sin resolver
bloquea al mensajero) y **está bien resuelta**:

- **Servidor**: el pendiente se deriva en `pendienteTrasAprobar`, **después** de que
  `resolverCierre` haya devuelto `"updated"`, fuera de su transacción. No hay forma de que
  la derivación revierta la aprobación.
- **Cliente**: en `CierresAdminModule`, el `toast.success` + `cerrarDetalle()` +
  `router.refresh()` ocurren **antes** de plantear la oferta de pago. El diálogo se monta
  **fuera** del modal de detalle. Ni «Ahora no», ni Escape, ni el overlay, ni un pago
  fallido tocan el cierre; un pago fallido deja el diálogo abierto **conservando la clave de
  idempotencia** y avisa de que el cierre sigue aprobado.
- Está medido: 37 casos en `CierresAdminPagoMensajero.test.tsx` con 5 mutaciones del
  implementer, y la suite de la 158 sigue verde sin editarse.

Queda un flanco menor, no de reversión sino de apariencia: ver menor 1.

---

## 6. Regresiones — la 170, la 171 y el radio de las 9 tandas

Se listaron las líneas **eliminadas** de los 17 archivos de test preexistentes modificados.
Resultado completo:

- **7** `expect(r).toEqual({status:"ok", cierreId, estado})` sustituidos por el **mismo
  `toEqual`** extendido con `pendientePagoMensajero`. Cero degradaciones a `toMatchObject`.
- **4** contadores del censo, todos **subidos** (25→26, 6→7, 31→33, 5→6) tras ver la guardia
  fallar en dos etapas.
- **1** título de test de la 171 renombrado
  (`pago-mensajero-movimiento-repository.test.ts`, «R22») porque su aserción se **reforzó**:
  ahora exige la forma exacta del `OR` **y** que la lectura de ids esté acotada por
  `cierre_id`.
- **2** líneas de `import` en los dos archivos de la Tanda G. **`mis-pagos-page.test.tsx` y
  `mi-wallet-page.test.tsx` son puramente aditivos**: +293 y +276 líneas, **cero** aserciones
  existentes tocadas. La Tanda G, que era la sospechosa, está limpia.
- **Cero** `it.skip` / `.only` / `.todo`, **cero** `@ts-expect-error`, **cero**
  `eslint-disable` añadidos.
- **R34 verificado**: `wallet-tiendas-desglose.test.tsx` y `wallet-tiendas-page.test.tsx`
  existen y **no están entre los archivos modificados** de la rama.
- La guardia del censo no solo se actualizó: se **amplió** para recorrer `components/`
  además de `app/`, lo que destapó una tabla preexistente de la 130 que el censo nunca había
  visto, y se le añadió una comprobación de «montajes» en los dos sentidos que antes no
  existía. Eso es dejar el arnés mejor de como se lo encontró.

**Conclusión: cero regresiones y cero aserciones ajenas debilitadas.** Se buscó
específicamente y no aparece.

---

## 7. Money-safety

- `Prisma.Decimal` en todo el cálculo; escala fijada **una sola vez** por operación
  (`toDecimalPlaces(2, ROUND_HALF_UP)` → `toFixed(2)`), y el mismo STRING va al documento, al
  libro y a la resta del restante, así que documento y libro no pueden discrepar por un
  redondeo.
- STRING en la frontera en las dos direcciones; los schemas **no coercionan**, así que un
  `monto: 15000` numérico muere en el borde.
- Tope del monto **derivado de la columna** (`DECIMAL(12,2)` ⇒ 10 dígitos enteros), no
  elegido a ojo.
- `derivarPendienteCierre` **no reimplementa** `min(P,E)`: reutiliza `calcularSplitPago` de
  la 44, y hay un test que compara las dos salidas sobre 6 pares.
- Barrido independiente del revisor sobre los 44 archivos: **cero conversiones**.

---

## 8. Juicio sobre los huecos YA declarados

### R61 / preview sin verificar — de acuerdo con la lectura, el hueco está bien acotado, y le falta una mitad

La lectura del riesgo es **correcta y honesta**: producción está medida y limpia (39+7 filas,
cero incoherentes, CHECK exhaustivos 10/10 y 5/5), el riesgo que la task existía para cerrar
—tumbar el despliegue de producción— **está cerrado**, y lo que queda es un PR en rojo más
una fila fallida en el `_prisma_migrations` de preview que bloquearía los despliegues de
preview siguientes hasta repararla a mano. La descripción del radio de daño es exacta y no
omite nada.

Dos matices que el revisor añade:

1. **La bitácora se queda corta a su propio favor.** Hoy el **único emisor** de filas en los
   dos libros es el feed de la aprobación del cierre, que escribe pares `(tipo, categoria)`
   fijos; las categorías `ajuste_*` no las emite nadie. Para que preview tuviera una fila
   incoherente, alguien habría tenido que insertarla a mano. Sumado a que los CHECK cubren el
   100 % de los valores de los enums, el riesgo residual es **bajo**, no solo «detectable».
   Eso refuerza la decisión de haber seguido adelante con el código.
2. **Pero R61 tiene una mitad que vive en el repo y NO se cerró.** «La restricción NO DEBE
   poder añadirse si algún dato existente la incumple» es una propiedad **del SQL**: que
   ninguno de los dos `ADD CONSTRAINT … CHECK` lleve `NOT VALID`. Es una aserción de una
   línea en `liquidacion-migration.test.ts` (que tiene 11 casos y ninguno la cubre) y no
   depende de alcanzar preview. Sin ella, mañana alguien puede añadir `NOT VALID` «para que
   el deploy no falle» y ni un test se entera — que es justo la protección que R61 pide.

Por eso R61 va como bloqueante: no por preview (eso es del humano, antes de mergear), sino
porque la mitad testeable no se testeó.

### Los tres punteros mal en `tasks.md § Trazabilidad` — el spec debería corregirse

Verificado: los dos defectos son reales y la cobertura también.

- **R26**: la fila apunta a `CierresAdminModule.test.tsx (ampliado)`. Ese archivo recibió
  **2 líneas** de fixture (`pendientePagoMensajero: null` y `"0.00"`) y **no mide R26**. Lo
  mide de verdad `CierresAdminPagoMensajero.test.tsx` (bloque «T E.3/R26 — columna pendiente
  de liquidar»).
- **R67**: la fila nombra `reglas-bloqueos-cierre` y `cierre-vencido-modelo`. **Ninguno de
  los dos existe** en `tests/`. Lo mide de verdad
  `tests/unit/guards/liquidacion-alcance.test.ts`, que lee `ESTADOS_CIERRE_BLOQUEANTES` **del
  código** y afirma que son los tres de la 111 con `aprobado` fuera. Es mejor test que el que
  la tabla prometía.

**El criterio de «no se toca porque está aprobado» es el equivocado aquí.** Lo que protege
una puerta cerrada es el **contenido de los requisitos**: que nadie cambie qué se prometió sin
volver al humano. Un puntero de la tabla de trazabilidad no es un requisito: es el índice que
`CHECKPOINTS.md` obliga a mantener y que el próximo revisor leerá como si fuera cierto.
Corregir tres celdas no reabre ninguna decisión, no altera un solo EARS y no necesita
aprobación. Dejarlas mal sí tiene coste: dentro de seis meses, quien audite R67 buscará dos
archivos inexistentes y concluirá que el requisito quedó sin cubrir. **Recomendación:
corregir las tres celdas y dejar nota de la corrección en la bitácora.** Es la única acción
de este review que no es del implementer.

### N1 (importes brutos inflados) — cerrada correctamente

El default (no se netea; se declara en pantalla) está aplicado y **mejorado sobre lo que
pedía la task**: el aviso acabó en **4** superficies, no en 1, porque el leader detectó que
`/wallet/mensajeros` también muestra agregados inflados. La asimetría que la Tanda G dejó
abierta quedó cerrada. El razonamiento del coste (2 valores de enum nuevos con su cascada de
`down.sql`, o reescribir `CUBETA_POR_CATEGORIA`) es correcto y la decisión de no pagarlo,
razonable: **el saldo —el número con el que se decide cuánto pagar— siempre es exacto**.
Se acepta.

### E2E declarado INAPLICABLE — se acepta

Coherente con la decisión vigente del humano y con los reviews previos. Lo que lo hace
aceptable aquí y no una excusa es que la sustitución se comprobó: ver §3.

---

## 9. HALLAZGOS

### BLOQUEANTE 1 — `R61` es el único de los 85 sin ningún test, y su mitad testeable es una línea

- **Qué falla**: `docs/verification.md` (si un requisito no tiene test, es hallazgo
  bloqueante) y `CHECKPOINTS.md` (cada `R<n>` mapea a al menos un test concreto). La fila R61
  de la tabla apunta a *evidencia en una bitácora*, no a un test. El propio implementer lo
  declara: «RECUENTO: 84 de 85».
- **Qué falta para cumplirlo**, dos piezas de dueños distintos:
  1. **(implementer, en el código)** Un caso en
     `tests/integration/db/liquidacion-migration.test.ts` que afirme que **ninguno** de los
     dos `ADD CONSTRAINT … CHECK` de los libros lleva `NOT VALID`, de modo que la restricción
     no se pueda añadir sobre datos que la incumplen. Es lo que R61 dice en su primera mitad
     y es verificable sin tocar ninguna base. Con eso, la fila deja de apuntar a una
     bitácora.
  2. **(humano, antes de mergear)** Correr contra la base de **preview** la misma consulta de
     incoherencias de T A.0 (pegada literal en `progress/impl_172-liquidacion.md`), o dar el
     `project_ref` de preview y autorización para apuntar ahí el MCP. **No es opcional**: los
     dos `ADD CONSTRAINT` validan las filas existentes y en Vercel el build migra antes de
     compilar.
- **Nota**: el riesgo real es bajo (ver §8), pero bajo no es medido, y el arnés pide medido.

### BLOQUEANTE 2 — la respuesta P3 se afirma en la pantalla equivocada: `adminSatelite` nunca aparece en el test que dice cubrirlo

- **Qué falla**: R6 exige que a `adminSatelite` **no se le ofrezca el pago en pantalla**. La
  tabla de trazabilidad dice que lo cubre `CierresAdminPagoMensajero.test.tsx`, caso
  «adminSatelite aprueba sin oferta de pago». **En ese archivo no hay ningún
  `adminSatelite`**: el escenario se simula pasando `puedeRegistrarPago: false`. El test
  demuestra que el componente respeta su prop, no que el rol la produzca. El eslabón que
  convierte «adminSatelite» en «false» es una línea de `app/(app)/cierres-admin/page.tsx`
  (`puedeRegistrarPago={esAccesoTotal(actor.rol)}`) y **no la mide nadie**: ponerla en `true`
  no rompe ni uno de los 9857 tests.
- **Por qué es mayor y no cosmético**: el propio implementer **inventó el guard correcto** y
  lo aplicó a la otra página. `tests/integration/wallet-tiendas-pago.test.tsx:395-397` lee el
  fuente de `app/(app)/wallet/tiendas/page.tsx` y afirma que el valor sale de
  `esAccesoTotal(actor.rol)` y que no está escrito a mano. Pero, como reconoce el comentario
  de esa misma página, allí el valor **es siempre verdadero** porque la página ya hace
  `notFound` a todo rol sin acceso total: el guard está donde es inerte. **`/cierres-admin` es
  la única pantalla donde un rol llega a la página y no puede pagar** —es literalmente el
  caso que el humano decidió en P3— y es la que se quedó sin guard. Es la asimetría exacta
  que una revisión existe para encontrar.
- **Qué falta para cumplirlo**: replicar ese guard de fuente para
  `app/(app)/cierres-admin/page.tsx`, y/o —mejor— un caso en
  `tests/components/CierresAdminPage.test.tsx`, que **ya monta la página real con
  `resolveActorFromSession` mockeado y ya tiene un caso `adminSatelite`**: aprobar un cierre
  con pendiente mayor que cero como `adminSatelite` y afirmar que no aparece el diálogo de
  pago, y como `admin` que sí. La infraestructura está puesta; son del orden de 10 líneas.
- **Atenuantes que el leader debe pesar**: la prop **falla cerrado** (`= false`), y la Server
  Action responde `forbidden` a `adminSatelite` con test propio verificado por mutación. El
  peor caso de una regresión aquí es un botón visible que da error, no un pago no autorizado.
  Se marca bloqueante porque es una decisión explícita del humano sin medición en el punto
  donde se vuelve visible, en un repo con cicatrices por verdes que no medían nada, no porque
  el sistema esté hoy inseguro.

---

### menor 1 — un fallo derivando el pendiente hace que una aprobación YA COMMITEADA parezca fallida

`pendienteTrasAprobar` corre después del commit, así que **no puede revertir la aprobación**
(bien). Pero si `obtenerCierreParaPago` o `sumarVigentesPorCierre` lanzan, la excepción sube
y la acción devuelve error: el operador ve «falló» sobre un cierre que está aprobado, y al
reintentar recibirá `conflict`. La función ya es defensiva con `cierre === null` devolviendo
`"0.00"`; le falta serlo con el `throw`. Lo mismo aplica a `conPendiente`, que ahora es
dependencia dura de los **tres** listados y del detalle: un fallo de la nueva agregación
tumba una pantalla que antes no dependía de ella. Sugerencia: envolver las dos y degradar a
`"0.00"` / `null`, que es el valor seguro (no ofrece pagar una cifra no derivada, y el
listado la recalcula la próxima vez que alguien mira).

### menor 2 — las lecturas de dinero salen de una segunda conexión mientras la transacción sostiene el candado

`agregarSaldoPorTienda` y `sumarVigentesPorCierre` se llaman con el cliente propio del
repositorio, no con el `tx`. Es **correcto en semántica** (el candado ya está tomado, así que
nadie más puede leer esa cifra hasta el commit, y `READ COMMITTED` hace visible lo
committeado), y está razonado en el código. El flanco es de recursos: cada operación de pago
sostiene una conexión con el candado **y pide una segunda** del mismo pool. Con suficientes
pagos concurrentes al mismo beneficiario, las que esperan el candado ocupan el pool y la que
lo tiene no consigue su segunda conexión: se cuelga hasta el timeout de transacción de
Prisma. Degrada a error, no a un importe mal, por eso es menor. `obtenerCierreParaPago` ya
acepta `tx?`; extender el mismo parámetro a las dos agregaciones lo cerraría.

### menor 3 — el candado serializa a los escritores de la 172, no al feed de la aprobación

El `FOR UPDATE` se toma sobre la fila del beneficiario, pero la aprobación de un cierre
escribe en `wallet_tienda_movimiento` **sin** tomar ese candado. Si una aprobación con neto
deudor para esa tienda confirma entre la lectura del disponible y la escritura del pago, el
saldo puede quedar levemente en negativo. Está **fuera del alcance que el spec fijó** (la
sección K habla de las operaciones que compiten por el mismo dinero en el sentido
pagar/anular, y tocar la transacción de aprobación era justo lo que las tandas evitaron a
propósito), el sistema representa y pinta saldos negativos sin romperse, y la ventana es de
milisegundos. Se registra como residual conocido, útil para la 173.

### menor 4 — tres punteros incorrectos en `tasks.md § Trazabilidad`

R26 y R67 (dos archivos). Diagnóstico y recomendación en §8: **corregir las celdas.** La
cobertura real fue verificada por este revisor y existe; el defecto es del índice.

### menor 5 — `buildFiltrosWhere` emite su consulta de ids dos veces por vista

Al pasar a método async, lo consumen el listado **y** la agregación, así que filtrar el
desglose por cierre dispara dos `liquidacionPago.findMany` idénticos. Que lo consuman los dos
es lo correcto (cabecera y tabla no pueden contar cosas distintas); lo mejorable es que no
compartan el resultado. Trivial.

### menor 6 — falta la entrada de la 172 en `progress/history.md`

`CHECKPOINTS.md` la exige para pasar a `done`. Es tarea de cierre del leader, no del
implementer; se anota para que no se caiga.

### Observación — el símbolo de moneda y `lib/config/moneda.ts`

Los 4 usos literales nuevos siguen la convención viva del repo y **no tenían alternativa**:
`formatMonto` recibe un `number`, incompatible con R14. No es un defecto de la 172, pero sí
un dato útil: el módulo que existe para «no hardcodear moneda» es inutilizable por cualquier
código money-safe. Merece una ficha propia algún día.

---

## 10. Lo que este review quiere dejar dicho a favor

Para que el rechazo no se lea como un juicio sobre el trabajo:

- Las **13 pruebas por mutación** del implementer no son decorado: las 6 que este revisor
  reprodujo por su cuenta, sobre código real y sin avisar, **todas caen**. Incluida la número
  5, un error de signo en el contraasiento que la base habría aceptado.
- El store de `liquidacion-idempotencia` es la mejor pieza de la feature: **lee el
  `FOR UPDATE` de la sentencia cruda que emite el repositorio** en vez de tener una lista de
  a quién bloquear, y **lanza** ante cualquier sentencia que no reconozca. Eso es lo que
  impide que una mutación pase por «no casa nada». Es el patrón que el repo debería copiar.
- El hallazgo del censo (la guardia solo recorría `app/`) se persiguió hasta el final en vez
  de rodearse, y destapó una tabla preexistente invisible.
- Las desviaciones del diseño están **declaradas con su porqué** (tope de la referencia, la
  sección con pendiente cero, el desglose en el contrato de `listarMisMovimientos`), no
  escondidas.
- La bitácora declara sus propios fallos, incluido el store que pasaba sin candado, en vez de
  presentar solo el resultado. Eso es lo que ha hecho posible revisar esto de verdad.

---

## VEREDICTO: **RECHAZADO**

Vuelve al implementer con **dos** bloqueantes, los dos acotados:

1. **R61 sin test** — añadir la aserción de que los dos `ADD CONSTRAINT … CHECK` no llevan
   `NOT VALID`. (Y, en paralelo y del humano: medir la base de **preview** antes de mergear.)
2. **R6 sin medición en `/cierres-admin`** — afirmar que un `adminSatelite` que aprueba **no**
   recibe la oferta de pago, con el rol de verdad y no con la prop; y/o replicar en
   `cierres-admin/page.tsx` el guard de fuente que ya existe para `wallet/tiendas/page.tsx`.

Los seis menores no bloquean. De ellos, el **menor 4** (corregir las tres celdas de
`§ Trazabilidad`) es acción del leader/revisor, no del implementer, y conviene hacerlo en el
mismo ciclo.

Cerrados esos dos, esta feature pasa. No hay ninguna otra objeción: `./init.sh` verde
verificado, 85/85 requisitos con fila, cero regresiones, cero aserciones ajenas debilitadas,
RLS y migración reversible en su sitio, capas separadas, y las tres respuestas del humano
implementadas donde tenían que estarlo.
