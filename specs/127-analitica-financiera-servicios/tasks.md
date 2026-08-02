# Feature 127 — analítica: servicios financieros · tasks

Orden por tandas. Dentro de una tanda, `[P]` = paralelizable con las demás `[P]` de esa tanda.
Nada de la TANDA A en adelante arranca sin la puerta T0 contestada.

**Comandos de verificación** (`docs/verification.md`): `pnpm run typecheck`, `pnpm run lint`,
`pnpm test`, `./init.sh`. **Nunca `pnpm build`** (encadena migraciones contra una base real).

---

## TANDA 0 — Puerta humana (bloquea todo)

- [ ] **T0.1** Obtener respuesta a **D1…D9** de `requirements.md`.
  *Hecho cuando:* cada decisión tiene respuesta escrita y fechada en `progress/current.md`, y los
  `R` que dependen de ella (`R18`, `R19`, `R21`, `R22`, `R23`, `R25`, `R26`) están reescritos sin
  la marca `⟨D_n⟩`.
- [ ] **T0.2** SI D8 = (b): registrar que esta feature modifica `lib/analytics/metrics.ts`
  (`egresos` → `producida`), que es catálogo ajeno.
  *Hecho cuando:* el cambio está autorizado por escrito y anotado en `progress/impl_127.md` como
  archivo ajeno tocado.
- [ ] **T0.3** SI D6 = (b): abrir el cambio de catálogo en la 135 **antes** de implementar
  `cod_recaudado`.
  *Hecho cuando:* existe la decisión, o se confirma D6 = (a) y se implementan las dos vistas.

---

## TANDA A — Contratos y tipos (sin lógica)

Depende de: TANDA 0.

- [ ] **A.1** `lib/types/analitica-financiera.ts`: `ImporteAnalitico`, `VistaFinanciera`,
  `ResultadoFinanciero`, `ResultadoConciliacion`, `RespuestaFinanciera`.
  *Hecho cuando:* `pnpm run typecheck` verde y **ningún** campo de importe es `number` (test de forma
  que recorre las claves del DTO de ejemplo y afirma `typeof === "string"`). → **R27**
- [ ] **A.2 [P]** Las cuatro interfaces de repositorio en `lib/interfaces/repositories/`, todas con
  firma `(consulta: ConsultaAnalitica)`.
  *Hecho cuando:* un test con `@ts-expect-error` confirma que **no** compilan llamadas con
  `AnaliticaFiltroInput`. → **R7**
- [ ] **A.3 [P]** `lib/interfaces/services/IAnaliticaFinancieraService.ts`.
  *Hecho cuando:* typecheck verde y la interfaz no menciona Prisma, `Request` ni `cookies`. → **R30**
- [ ] **A.4 [P]** `lib/config/analitica-financiera.ts` con el umbral de descuadre ⟨D5⟩, comentado
  como **provisional y no medido** (patrón `lib/config/analitica-rollup.ts`).
  *Hecho cuando:* no hay ningún número mágico de umbral fuera de este archivo. → **R24**

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

---

## TANDA C — Repositorios (Prisma puro)

Depende de: A, B. Las cuatro van `[P]` entre sí: archivos disjuntos, tablas disjuntas salvo lectura.

- [ ] **C.1 [P]** `IngresosAnaliticaRepository`: `groupBy(categoria)` + `_sum(monto)` sobre
  `wallet_movimiento`, categorías **leídas del catálogo**, ventana `[desde, hasta)`.
  *Hecho cuando:* el test con un `ingreso_ajuste` dentro del rango **no** lo ve en `ingreso_flete`, y
  el test que altera `definicion.categorias` en memoria **sí** ve cambiar la consulta. → **R16, R17**
- [ ] **C.2 [P]** `RecaudoAnaliticaRepository`: vista por método (cierres) + vista por tienda
  (ledger), como **dos métodos separados**.
  *Hecho cuando:* el test del mensajero con órdenes de dos tiendas comprueba que las dos vistas **no**
  se suman en el repositorio. → **R19**
- [ ] **C.3 [P]** `CuentasPorPagarAnaliticaRepository`: `groupBy` por tipo (y por tienda en el de
  tienda) con `fecha_movimiento < hasta` ⟨D3⟩, sin cota inferior.
  *Hecho cuando:* el test con un devengo anterior al rango lo ve incluido en el saldo. → **R21**
- [ ] **C.4 [P]** `ConciliacionCierresAnaliticaRepository`: `groupBy(estado)` sobre ambos cierres +
  agregación de ledger por `origen_tipo = cierre_dia` y los `origen_id` aprobados del rango.
  *Hecho cuando:* el test con un ajuste manual dentro del rango **no** lo cuenta como descuadre, y el
  test con un `cierre_bodega` que consolida tres `cierre_dia` no duplica el dinero. → **R22, R23**
- [ ] **C.5** Verificación transversal de la tanda: los cuatro repositorios no contienen ninguna
  derivación (`.sub(`, `.add(` fuera de una agregación de Prisma) ni `try/catch` que devuelva ceros.
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
  `derivarBalance`.
  *Hecho cuando:* el test compara el resultado del servicio contra esas funciones para un caso de
  saldo **negativo** e incluye el `signo`. → **R20, R27**
- [ ] **D.3** Cobertura de las ocho métricas: ninguna de más, ninguna de menos.
  *Hecho cuando:* el test compara los ids servidos contra `listarMetricas({ dominio: "financiera" })`
  y falla por exceso y por defecto. → **R6**
- [ ] **D.4** `esAcumulado`, `sumableCon` y `moneda` (de `lib/config/moneda.ts`) poblados.
  *Hecho cuando:* el test busca cualquier símbolo de moneda literal en los archivos de la feature y
  no encuentra ninguno. → **R29**, y `esAcumulado === true` en las dos cuentas por pagar → **R21**
- [ ] **D.5** ⟨D8⟩: `egresos` producida (o `no_producida` explícita, según respuesta).
  *Hecho cuando:* el test con una `egreso_indemnizacion` en el rango la ve sumada — o, en la otra
  rama, el test distingue `no_producida` de `"0.00"`. → **R18**
- [ ] **D.6** ⟨D5⟩: emisión del descuadre por `ErrorLogger` al superar el umbral, **sin lanzar**.
  *Hecho cuando:* el test con datos descuadrados recibe el DTO **y** una llamada al logger espiado.
  → **R24**
- [ ] **D.7** Determinismo: `orderBy` estable en todo listado agregado; sin `Date.now()` interno.
  *Hecho cuando:* dos ejecuciones con la misma entrada producen la misma secuencia de filas, con más
  de una fila. → **R28**
- [ ] **D.8** Inyección por interfaz: el servicio se construye con repositorios mock.
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
- [ ] **E.3** Cuerpo del 403 sin motivo ⟨D9⟩; el motivo completo solo en el registro.
  *Hecho cuando:* el test afirma que la respuesta serializada **no** contiene ninguno de los siete
  literales de `MotivoDenegacion`, y que el registro del logger **sí** lo lleva. → **R12**
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
- [ ] **F.2** Caso de frontera horaria: un movimiento a las 22:00 CR y otro a las 00:30 CR caen en
  días distintos según `[D 06:00Z, D+1 06:00Z)`.
  *Hecho cuando:* usar medianoche UTC en vez de `rango.desde` pone el test rojo. → **R26**
- [ ] **F.3** Caso de anulación ⟨D1⟩: pago + contraasiento `ajuste_*` en el mismo rango.
  *Hecho cuando:* `bruto` los cuenta ambos y `neto` los cancela, y el test lo afirma **por separado**.
  → **R19, R20**
- [ ] **F.4** Caso de cierre pendiente ⟨D4⟩: un cierre `solicitado` no aporta dinero pero aparece en
  la conciliación; tras aprobarlo, aporta **una** vez.
  *Hecho cuando:* el test corre las dos fases y el importe no se duplica. → **R25**
- [ ] **F.5** Mapa `R1..R36 → test` en `progress/impl_127.md`, con la salida real de la suite.
  *Hecho cuando:* no queda ningún `R` sin test y `./init.sh` termina en verde. → **R36**
- [ ] **F.6** Sincronización con `dev` y PR hacia `dev`.
  *Hecho cuando:* `git merge origin/dev` resuelto, suite verde tras el merge y PR abierto. Conflictos
  ambiguos se preguntan al humano y se registran en `progress/current.md`.

---

## Dependencias en una línea

```
T0 → A → B → C(4×[P]) → D → E → F
```

`B` antes que `C` es deliberado: los guardias tienen que existir mientras la implementación se
escribe, no después, para que el primer intento de leer `orden` o `analytics_daily` se ponga rojo en
el momento en que se teclea y no en la revisión.
