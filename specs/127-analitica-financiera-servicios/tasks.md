# Feature 127 — analítica: servicios financieros · tasks

Orden por tandas. Dentro de una tanda, `[P]` = paralelizable con las demás `[P]` de esa tanda.

**PUERTA T0 CERRADA el 2026-08-02.** Las nueve decisiones están respondidas en `requirements.md`
(D7 por implicación, marcada). No queda nada que esperar: se puede implementar.

**Comandos de verificación** (`docs/verification.md`): `pnpm run typecheck`, `pnpm run lint`,
`pnpm test`, `./init.sh`. **Nunca `pnpm build`** (encadena migraciones contra una base real).

**Baseline de la rama, medido:** **778 archivos / 9432 tests, 0 rojos, 0 workers caídos.** Cualquier
rojo que aparezca durante la implementación **es nuestro**. Si una corrida reporta menos archivos que
778 o menciona *unhandled errors* de workers, está degradada y **no cuenta como verde**: se repite
antes de creerse el conteo.

---

## TANDA 0 — Registro de la puerta (no bloquea; se hace al abrir la rama)

- [ ] **T0.1** Copiar las nueve respuestas (fecha **2026-08-02**, autor: humano) a
  `progress/impl_127.md`, marcando **D7 como resuelta por implicación y reabrible**.
  *Hecho cuando:* el archivo existe y ningún requisito conserva una marca de decisión pendiente.
- [ ] **T0.2** Registrar que esta feature **modifica un archivo ajeno**: `lib/analytics/metrics.ts`
  (catálogo de la 135), para pasar `egresos` a `estadoProduccion: "producida"`.
  *Hecho cuando:* está anotado como archivo ajeno tocado, **con la autorización humana del 2026-08-02
  citada** (D8 → (b)), en `progress/impl_127.md` y en el cuerpo del PR. No es un retoque de paso: el
  catálogo es fuente única de trece features.

---

## TANDA A — Contratos y tipos (sin lógica)

Depende de: T0.

- [ ] **A.1** `lib/types/analitica-financiera.ts`: `ImporteAnalitico` (**`bruto` + `neto`**),
  `VistaFinanciera` (**`id`, `sumableCon`**), `ResultadoFinanciero` (**`esAcumulado`**),
  `ResultadoConciliacion` (**`fechadoPor` por fila**), `RespuestaFinanciera` (**sin
  `no_producida`**).
  *Hecho cuando:* `pnpm run typecheck` verde y **ningún** campo de importe es `number` (test de forma
  que recorre las claves del DTO de ejemplo y afirma `typeof === "string"`). → **R27, R37, R38, R39,
  R43**
- [ ] **A.2 [P]** Las cuatro interfaces de repositorio en `lib/interfaces/repositories/`, todas con
  firma `(consulta: ConsultaAnalitica)`.
  *Hecho cuando:* un test con `@ts-expect-error` confirma que **no** compilan llamadas con
  `AnaliticaFiltroInput`. → **R7**
- [ ] **A.3 [P]** `lib/interfaces/services/IAnaliticaFinancieraService.ts`.
  *Hecho cuando:* typecheck verde y la interfaz no menciona Prisma, `Request` ni `cookies`. → **R30**
- [ ] **A.4 [P]** `lib/config/analitica-financiera.ts` con el **umbral de descuadre** (D5), comentado
  como **provisional y no medido** (patrón `lib/config/analitica-rollup.ts`).
  *Hecho cuando:* el número no aparece como literal en ningún servicio ni repositorio. → **R40**

---

## TANDA B — Guardias PRIMERO (rojo antes que verde)

Depende de: A. **Se escriben antes que los repositorios**: un guardia escrito después de la
implementación tiende a describirla en vez de juzgarla.

- [ ] **B.1** `tests/unit/analytics/financiera-fuente.guardia.test.ts`: censo sobre los archivos de
  la feature; falla si nombran una tabla fuera de `TablaDinero`, incluido dentro de `$queryRaw`.
  *Hecho cuando:* pasa con el fixture legítimo y **falla** con los dos infractores (uno Prisma, uno
  SQL crudo), y falla también si se le mete `analytics_daily`. → **R1, R2, R3, R33, R34**
- [ ] **B.2 [P]** `tests/unit/analytics/financiera-alcance.guardia.test.ts`: recorre las ocho
  financieras del catálogo y falla si alguna declara `acotado` para algún rol.
  *Hecho cuando:* mutar `ALCANCE_FINANCIERA.adminTienda` a `"acotado"` lo pone rojo, y revertir lo
  pone verde. → **R9, R35**
- [ ] **B.3 [P]** Test de correspondencia fuente↔consulta: para cada métrica, las tablas que su
  repositorio consulta ⊆ `metrica.fuente.tablas`.
  *Hecho cuando:* añadir `cierre_dia` al repositorio de `ingreso_flete` lo pone rojo. → **R4**
- [ ] **B.4 [P]** Test de «no hay adaptador de dinero»: `lib/analytics/alcance-columnas.ts` sigue sin
  función para las cinco tablas (complementa `alcance-dinero.guardia.test.ts` de la 122).
  *Hecho cuando:* añadir `whereWalletTienda` lo pone rojo. → **R8**
- [ ] **B.5 [P]** Test de coherencia catálogo↔producción: ninguna financiera queda `declarada`
  mientras el servicio la produce, ni al revés.
  *Hecho cuando:* revertir `egresos` a `"declarada"` lo pone rojo. → **R41**

---

## TANDA C — Repositorios (Prisma puro)

Depende de: A, B. Las cuatro van `[P]` entre sí: archivos disjuntos.

- [ ] **C.1 [P]** `IngresosAnaliticaRepository`: `groupBy(categoria)` + `_sum(monto)` sobre
  `wallet_movimiento`, categorías **leídas del catálogo**, ventana `[desde, hasta)` por
  `fecha_movimiento`, devolviendo material para `bruto` **y** `neto` (agregado por `tipo`).
  *Hecho cuando:* el test con un `ingreso_ajuste` dentro del rango **no** lo ve en `ingreso_flete`, y
  el test que altera `definicion.categorias` en memoria **sí** ve cambiar la consulta. → **R16, R17,
  R26, R37**
- [ ] **C.2 [P]** `RecaudoAnaliticaRepository`: **dos métodos separados** —
  `porMetodoDeCierresResueltos` (`cierre_dia` aprobados, `resuelto_at ∈ [desde,hasta)`) y
  `porTiendaDeLedger` (`wallet_tienda_movimiento`, categoría `cod_recaudado`).
  *Hecho cuando:* el test del mensajero con órdenes de dos tiendas comprueba que las dos vistas **no**
  se suman en el repositorio, y el test del cierre `solicitado` comprueba que **no** aporta importe.
  → **R19, R25, R26**
- [ ] **C.3 [P]** `CuentasPorPagarAnaliticaRepository`: `groupBy` por tipo (y por tienda en el de
  tienda) con `fecha_movimiento < hasta`, **sin cota inferior**.
  *Hecho cuando:* el test con un devengo anterior al rango lo ve incluido en el saldo, y añadir
  `>= desde` lo pone rojo. → **R21**
- [ ] **C.4 [P]** `ConciliacionCierresAnaliticaRepository`: `groupBy(estado)` sobre ambos cierres, con
  **doble coordenada temporal** (aprobados por `resuelto_at`; resto por `solicitado_at`), + agregación
  de ledger por `origen_tipo = cierre_dia` y los `origen_id` aprobados del rango.
  *Hecho cuando:* el test con un ajuste manual dentro del rango **no** lo cuenta como descuadre; el
  test con un `cierre_bodega` que consolida tres `cierre_dia` no duplica el dinero; el test del cierre
  `solicitado` recibe `fechadoPor: "solicitado_at"`. → **R22, R23, R25, R39**
- [ ] **C.5** Verificación transversal: los cuatro repositorios no contienen derivación (`.sub(`,
  `.add(` fuera de una agregación de Prisma) ni `try/catch` que devuelva ceros.
  *Hecho cuando:* revisión + test que fuerza el fallo de la base y observa que el error **se propaga**.
  → **R30, R32**

---

## TANDA D — Servicio

Depende de: C.

- [ ] **D.1** `AnaliticaFinancieraService.consultar(consulta)`: valida dominio, despacha por
  `metrica.id`, sin `default` permisivo.
  *Hecho cuando:* pedir `entregas` devuelve error explícito y el repositorio espiado **no** recibe
  ninguna llamada. → **R5, R10**
- [ ] **D.2** Derivación money-safe **reutilizando** `derivarSaldoTienda`, `derivarCuentaPorPagar`,
  `derivarBalance`, que son las que producen el `neto` con signo.
  *Hecho cuando:* el test compara el resultado del servicio contra esas funciones para un caso de
  saldo **negativo** e incluye el `signo`. → **R20, R27, R37**
- [ ] **D.3** Cobertura de las ocho métricas: ninguna de más, ninguna de menos.
  *Hecho cuando:* el test compara los ids servidos contra `listarMetricas({ dominio: "financiera" })`
  y falla por exceso y por defecto. → **R6**
- [ ] **D.4** `esAcumulado` exacto (true solo en las dos cuentas por pagar), `sumableCon` y `moneda`
  (de `lib/config/moneda.ts`) poblados.
  *Hecho cuando:* el test recorre las ocho métricas y compara el mapa exacto de `esAcumulado`; el test
  de moneda no encuentra ningún símbolo literal en los archivos de la feature. → **R29, R43**
- [ ] **D.5** `egresos` **producida**: Σ de las ocho categorías `egreso_*`.
  *Hecho cuando:* el test con una `egreso_indemnizacion` en el rango la ve sumada, y no existe ningún
  camino que devuelva `no_producida`. → **R18**
- [ ] **D.6** ⟨D8⟩ **Cambio del catálogo ajeno, con permiso explícito:** en
  `lib/analytics/metrics.ts`, `egresos.estadoProduccion` pasa de `"declarada"` a `"producida"`.
  *Autorización:* humano, **2026-08-02**, D8 → (b). Es el catálogo de la 135, fuente única de trece
  features; **no se toca ninguna otra entrada**, ni etiqueta, ni grano, ni alcance.
  *Hecho cuando:* el diff sobre ese archivo es **exactamente una línea**, B.5 queda verde y la suite
  de la 135 (`tests/unit/analytics/metrics*.test.ts`) sigue en 0 rojos. → **R41**
- [ ] **D.7** Conciliación: `cuadra` + `diferencia` + `cierresDescuadrados`, y **emisión por
  `ErrorLogger`** al superar el umbral de `lib/config/analitica-financiera.ts`, **sin lanzar**.
  *Hecho cuando:* el test con datos descuadrados recibe el DTO **y** una llamada al logger espiado; el
  test bajo umbral recibe el DTO **sin** llamada. → **R23, R24, R40**
- [ ] **D.8** Determinismo: `orderBy` estable en todo listado agregado; sin `Date.now()` interno.
  *Hecho cuando:* dos ejecuciones con la misma entrada producen la misma secuencia de filas, con más
  de una fila. → **R28**
- [ ] **D.9** Inyección por interfaz: el servicio se construye con repositorios mock.
  *Hecho cuando:* toda la suite unitaria del servicio corre **sin** `DATABASE_URL`. → **R31**

---

## TANDA E — Borde (Server Action) y los tres pasos

Depende de: D.

- [ ] **E.1** `lib/actions/analitica-financiera.ts` con `'use server'`, actor por
  `resolveActorFromSession()`, y el orden auditar → responder.
  *Hecho cuando:* el test con un `adminTienda` pidiendo `egresos` ve **una** llamada a
  `logger.logError` y estado `forbidden`. → **R11, R12, R15**
- [ ] **E.2** Distinción 400 / 403: entrada malformada no audita.
  *Hecho cuando:* `{ rango: "no_valido" }` devuelve `validation_error` con `fieldErrors` y el logger
  espiado **no** recibe nada. → **R13**
- [ ] **E.3** Cuerpo del 403 **genérico** (D9): `{ code: "FORBIDDEN" }`, sin motivo.
  *Hecho cuando:* el test afirma que la respuesta serializada **no** contiene ninguno de los siete
  literales de `MotivoDenegacion`, y que el registro del logger **sí** lo lleva. → **R12, R42**
- [ ] **E.4** Barrido de identidad: ninguna respuesta financiera contiene un id de mensajero.
  *Hecho cuando:* el test recorre la **cadena serializada completa** (`JSON.stringify`) de las ocho
  métricas y no encuentra el uuid del mensajero sembrado. → **R14**
- [ ] **E.5** Errores con contexto y sin PII.
  *Hecho cuando:* el test del fallo de repositorio ve el `metricaId` y el rango en el mensaje, y
  **no** ve ids de tienda, teléfonos ni correos. → **R32**

---

## TANDA F — Integración y cierre

Depende de: E.

- [ ] **F.1** `tests/integration/actions/analitica-financiera-action.test.ts`: camino completo con
  base de test, por rol (`maestro` ok, `adminTienda` 403) y por métrica.
  *Hecho cuando:* pasa contra base de test, sin mocks de Prisma.
- [ ] **F.2** Frontera horaria: un movimiento a las 22:00 CR y otro a las 00:30 CR caen en días
  distintos según `[D 06:00Z, D+1 06:00Z)`.
  *Hecho cuando:* usar medianoche UTC en vez de `rango.desde` pone el test rojo. → **R26**
- [ ] **F.3** Frontera de cierre (D2-b): un cierre **solicitado el lunes y aprobado el miércoles**
  cuenta en el miércoles.
  *Hecho cuando:* fechar por `solicitado_at` pone el test rojo. → **R26**
- [ ] **F.4** Anulación (D1-c): pago + contraasiento `ajuste_*` en el mismo rango.
  *Hecho cuando:* `bruto` los cuenta ambos y `neto` los cancela, y el test lo afirma **por separado**.
  → **R37, R20**
- [ ] **F.5** Cierre pendiente (D4-b): un cierre `solicitado` no aporta dinero pero aparece en la
  conciliación con `fechadoPor: "solicitado_at"`; tras aprobarlo, aporta **una** vez.
  *Hecho cuando:* el test corre las dos fases y el importe no se duplica. → **R25, R39**
- [ ] **F.6** No-sumabilidad (D6-a): las dos vistas de `cod_recaudado` llegan con ids distintos y
  `sumableCon: []`.
  *Hecho cuando:* declarar una sumable con la otra pone el test rojo. → **R19, R38**
- [ ] **F.7** Mapa `R1..R43 → test` en `progress/impl_127.md`, con la salida real de la suite.
  *Hecho cuando:* no queda ningún `R` sin test, `./init.sh` termina en verde y la corrida reporta
  **≥ 778 archivos y 0 rojos** (baseline). → **R36**
- [ ] **F.8** Sincronización con `dev` y PR hacia `dev`.
  *Hecho cuando:* `git merge origin/dev` resuelto —**mirando con cuidado `lib/analytics/metrics.ts`,
  que es archivo ajeno**—, suite verde tras el merge y PR abierto citando la autorización de D8.
  Conflictos ambiguos se preguntan al humano y se registran en `progress/current.md`.

---

## Dependencias en una línea

```
T0 → A → B(5×[P]) → C(4×[P]) → D → E → F
```

`B` antes que `C` es deliberado: los guardias tienen que existir mientras la implementación se
escribe, no después, para que el primer intento de leer `orden` o `analytics_daily` se ponga rojo en
el momento en que se teclea y no en la revisión.
