# Revisión — Ficha 463 (wallets: buscador y filtros canónicos en dos niveles, selector de orden)

Revisor: reviewer. Fecha: 2026-10-01. Rama revisada: `origin/feature/463-wallets-filtros-y-orden` @ `b5bb07e1`
(merge-base con `dev`: `78972be6`). Revisado en worktree aislado, `checkout --detach` de ese SHA.

Búsqueda de código: lectura directa de archivos y `grep` (el diff es acotado y se leyó entero); no hizo
falta el grafo `codebase-memory` para localizar nada que el diff no dijera ya.

## Veredicto: **RECHAZADO**

Dos bloqueantes, los dos de trazabilidad sobre dinero y los dos baratos de cerrar:

1. **R49 no se cumple en los cuatro estados de cuenta** (solo en la caja), y su fila del mapa apunta a un
   test que no lo verifica. Medido con una sonda (abajo).
2. **R12, cláusula «el detalle de una fila de la composición»: sin red.** Una mutación que manda
   Entra/Sale y categoría al detalle de fila sobrevive a todas las suites de la caja.

El resto está bien hecho: backend sólido y probado contra Postgres con datos, el modo «Aplicar» es opt-in
de verdad, las cifras de la caja no se mueven con la zona del libro (mutación propia muerta), el saldo
corrido es idéntico en los dos sentidos y la línea del saldo inicial cae donde debe en pantalla y en Excel
(mutaciones propias muertas).

## Checklist

### Especificación
- [x] `requirements.md` con R1–R49 en EARS.
- [x] `design.md` con 6 alternativas descartadas y su porqué.
- [x] `tasks.md`: T1–T10 marcadas `[x]`.

### Trazabilidad
- [x] `progress/impl_463.md` contiene el mapa R1–R49 → test.
- [ ] **Cada R mapea a un test que lo verifica: NO** — R49 (estado de cuenta) y R12 (detalle de fila). Ver B1/B2.

### Calidad de código
- [x] `pnpm run typecheck`: 0 errores (gate).
- [x] `pnpm run lint`: 0 errores, 220 warnings preexistentes.
- [x] `pnpm test`: verde en el gate completo (abajo).
- [x] E2E: **no aplica** — el repo no tiene harness E2E; el riesgo se cubre con integración contra Postgres
      y la verificación en la app de `impl_463.md` (T10).

### Datos y seguridad
- [x] Sin tablas nuevas (sin RLS que poner), sin migraciones, sin índices.
- [x] Sin secretos ni hardcode de país/moneda/cuenta. Sin webhooks.
- [x] Escapado de `%` y `_` (`escaparComodinesLike`, que también escapa `\`) en caja y estado de cuenta;
      probado con filas trampa contra Postgres (`100%dto` vs `100 dto`, `a_b` vs `axb`, `%%%`, `___`).
- [x] Mínimo de 3 en el borde (`.trim().min(3).max(100)`); `ILIKE` parametrizado, sin `Prisma.raw`.
- [x] R27 se decide en el servidor: `conNombreRegistrador = vista === "oficina"`, y `vista` la fija el método
      del servicio (`leerMiTienda` ⇒ `"tienda"`), no el cliente. El placeholder de `/mi-wallet` no nombra a
      quién registró. Probado contra Postgres: buscar el nombre del registrador en `/mi-wallet` = texto ausente.

### Patrón de capas
- [x] Acciones parsean con zod y llaman al servicio; servicios sin HTTP; SQL solo en repositorios.
- [x] Interfaces actualizadas en `lib/interfaces/`.
- [x] Término y orden NO están en `BalanceFiltros`: ningún agregado de las cifras puede recibirlos por tipo;
      `terminoYOrden` vive fuera de `construirFiltros`.

### Permisos / multi-país
- [x] Mismos guards (`esAccesoTotal`) antes de leer. Nada hardcodeado.

### Verificación final
- [x] `./init.sh` COMPLETO en verde, corrido por el revisor (no se confió en la bitácora).
- [ ] `progress/review_463.md` con veredicto OK — **no: RECHAZADO**.
- [ ] Entrada en `progress/history.md` — pendiente (la pone el leader al cerrar).

## Verificación ejecutable (salida real)

`./init.sh` completo, secuencial, sin dev server ni mutaciones en paralelo; log en
`progress/gate_review_463.log` (`INIT_EXIT` escrito dentro):

```
✓ feature_list.json: sin ids duplicados (461 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 325 archivos de tests contra Postgres SI se ejecutan
 Test Files  2351 passed (2351)
      Tests  32666 passed | 26 skipped (32692)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2351 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son de `AnaliticaPage` (17) y `AnaliticaShell` (9), ajenos. Las tres integraciones nuevas
corrieron contra Postgres: `libro-caja-busqueda-orden-463` (9), `estado-cuenta-busqueda-orden-463` (10),
`saldos-tiendas-busqueda-463` (5). Ninguna tiene `if (!x) return;`; todas afirman conteos exactos del
conjunto sembrado (no-vacuidad).

## Mutaciones propias (todas restauradas; árbol limpio comprobado con `git status` tras cada una)

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | Dinero: al releer la wallet, resumen y desglose reciben Entra/Sale y categoría (`entradaWallet = inputDeLibro(...)`) | **Muerta**: 5 rojos (CJ R12, CJ R19, 458E periodo, 458E R60, AQuien458E mensajero) |
| M1b | Dinero: el detalle de una fila de la composición recibe Entra/Sale y categoría (`ComposicionGananciaCard filtros={{...filtrosDeWallet(..), tipo, categoria}}`) | **SOBREVIVE** a WalletCaja463, WalletLibroCaja458E, WalletFiltroAQuien458E, WalletDescarga, DetalleFilaComposicion, ComposicionGananciaCard y wallet-page → **B2** |
| M2 | `ORDER BY` final del estado de cuenta invertido (`asc`⇒DESC, `desc`⇒ASC) | **Muerta**, pero solo por las redes de la 458 (5 rojos vía `CRONOLOGICO`); `estado-cuenta-busqueda-orden-463` **pasa entero** → m3 |
| M3a | Excel del estado de cuenta: saldo inicial siempre primera fila | **Muerta**: 4 rojos (EC R43 desc, descarga-columnas ×2, WalletDescarga) |
| M3b | Pantalla: con «Más recientes» el saldo inicial arriba de la página 1 | **Muerta**: 14 rojos (EC regla y R39, EstadoCuenta.test 463 R39 ×2, Anulados, Satélite, mi-wallet-page…) |
| M4 | R14: `verResumenCajaAction` parsea el esquema del libro (acepta término y orden) | **Muerta**: 4 rojos (ACT R14 ×4) |
| M5 | `FilterComponent`: la precarga de URL se emite siempre en el acto (rama del modo «Aplicar» para todos) | **SOBREVIVE** a las 5 suites `filter-component*` (110 tests) → m4 |
| M6 | Libro de la caja: sentido del orden invertido en el repositorio | **Muerta**: 7 rojos en `libro-caja-busqueda-orden-463` |

Más las del implementador (M1–M8, E1–E7, T1–T2, F1–F3), que no se repitieron.

## Hallazgos

### B1 — BLOQUEANTE — R49 no se cumple en los estados de cuenta; el test mapeado no lo verifica

R49 (ubicuo): «SI una lectura falla, ENTONCES el sistema DEBE avisar en español y conservar en pantalla
las cifras, el libro y los filtros aplicados que había antes del intento.» Aplica a toda superficie con
libro. Design §6 y T7 solo lo resolvieron en la caja, y el mapa lo da por cubierto en el estado de cuenta
con `EstadoCuenta.test` «R5 (171) … el fallo se dice», que solo afirma que sale el aviso y que las tarjetas
siguen en pie.

**Medido** con una sonda de componente (montar la tienda, hacer fallar `verEstadoCuentaAction`; la sonda
se borró después):

- **Aplicar un periodo que falla:** las tarjetas siguen siendo las de SIN periodo (`keepPreviousData`), pero
  la zona de la wallet dice `Periodo: 01 oct 2026 – 28 oct 2026` con «Quitar periodo» visible, y la tabla
  queda REEMPLAZADA por «No se pudo cargar el estado de cuenta.» (el libro anterior desaparece). Es lo que
  la caja evita con su `siembra` («para que la pantalla no diga que hay puesto un periodo que las cifras no
  reflejan», `WalletFiltrosCaja.tsx`): cifras de dinero de un periodo con el control diciendo otro.
- **Cambiar un chip que falla:** «Cobros» queda `aria-pressed=true` y el libro se sustituye por el aviso.

Qué falta: en `components/shared/estado-cuenta/EstadoCuenta.tsx`, ante un fallo de lectura, (a) seguir
pintando las filas de la última lectura buena con el aviso en español al lado (no en lugar de la tabla), y
(b) devolver periodo, chip, cierre, término y orden a los de esa lectura (para el periodo, `siembra` del
`FilterComponent`, como en la caja). Más un test de componente que afirme las tres cosas (aviso, libro
anterior, filtros anteriores) para el periodo y para un filtro del libro. Si el humano prefiere acotar R49
a la caja, hay que enmendar `requirements.md` y el mapa; tal como está aprobado, falla.

Nota: el contrato viejo «171 R5 — el extracto lo dice» (el aviso SUSTITUYE la tabla) choca con R49; el
arreglo debe reescribir ese test conforme al contrato nuevo, no debilitarlo.

### B2 — BLOQUEANTE — R12, «el detalle de una fila de la composición»: sin test

R12 nombra tres cosas: resumen, composición/desglose y «el detalle de una fila de la composición». El
código es correcto (`ComposicionGananciaCard` recibe `filtrosDeWallet(filtrosWallet)`, con tipo y categoría
vacíos), pero la mutación M1b —pasarle Entra/Sale y categoría— sobrevive a todas las suites que montan la
caja. CJ «R12» solo mira `resumen` y `desglose`. Es dinero: el detalle de una fila enseñaría un conjunto
distinto del importe de esa fila (lo que la ficha 339 R20 prohibió).

Qué falta: en `tests/components/WalletCaja463.test.tsx` (o `WalletLibroCaja458E`), con Entra/Sale y una
categoría puestas en la zona del libro, abrir el detalle de una fila de la composición y afirmar que
`listarMovimientosDeFilaAction` recibe solo `fila`, periodo/«A quién» y paginación (ni `tipo` ni
`categoria`). Comprobar que M1b lo pone rojo.

### m1 — menor — Clics del libro de la caja ignorados en silencio mientras se lee

`LibroCajaBarra.tsx`: los `SegmentedToggle` de orden y de Todo/Entra/Sale descartan el clic con
`if (!disabled …)` mientras `loading` (que incluye cada lectura del buscador), pero el control no se ve
deshabilitado (`SegmentedToggle` no tiene `disabled`). Pulsar «Más antiguas» mientras viaja una búsqueda
no hace nada y no lo dice. Los turnos (`turnoLibro`) ya resuelven la concurrencia, así que la guarda sobra:
o se quita, o se pinta deshabilitado.

### m2 — menor — Posición del saldo inicial con el orden pedido, no con el pintado

`EstadoCuenta.tsx`: `posicionSaldoInicial(sortDir, page, pageSize, data.total)` usa el `sortDir` del estado,
pero con `keepPreviousData: true` `data` puede ser la lectura anterior (otro orden). Mientras llega la nueva
página —y de forma persistente si falla— la línea del saldo inicial se coloca según un orden que no es el de
las filas pintadas. El comentario dice «con el orden de lo que se PINTA»; el código no. Se arregla guardando
el orden junto a la lectura (o derivándolo de la clave de `data`). Se resuelve de paso con B1.

### m3 — menor — La integración 463 del estado de cuenta no fija el sentido absoluto

`estado-cuenta-busqueda-orden-463` solo compara relativos (`desc` = `asc` al revés; «sin orden» = `desc`):
M2 la pasa entera. Hoy la atrapan las redes de la 458 vía `CRONOLOGICO`; conviene que «R34/R47» afirme
también que la primera fila de «Más recientes» es la de fecha mayor.

### m4 — menor — La precarga de URL de `FilterComponent` sin red de R22

M5 (emitir la precarga en el acto, sin debounce, también fuera del modo «Aplicar») sobrevive a las 110
pruebas de `filter-component*`. Ninguna wallet combina `leerDeUrl` con «Aplicar», así que la rama nueva no
está en uso, pero el test «463 R22» no cubre ese camino. Añadir un caso R22 con precarga por URL y debounce.

### m5 — menor — La ayuda del asistente describe el comportamiento viejo

`docs/ayuda/oficina/wallet-tiendas.md` («La primera fila es el saldo inicial», «Desde y Hasta»),
`wallet-mensajeros.md` («El extracto va del más antiguo al más reciente, con el saldo inicial como primera
fila», «Desde/Hasta»), `mi-wallet.md` y `wallet-caja.md` (la tarjeta «Movimiento neto del periodo» con
«Tenés filtros puestos»: ahora solo la mueven periodo y «A quién») quedan desfasadas. No lo exige el spec,
pero el asistente responderá con lo de antes. Ficha o tarea del leader.

### m6 — menor — Desvíos del design no anotados en él (decisiones técnicas de `impl_463.md`, juzgadas)

- Categoría (caja) y cierre (estado de cuenta) a la vista y no tras el selector «Filtros». **Aceptable**:
  R5/R7 solo exigen que estén en la zona del libro, y lo están.
- `WalletFiltros.tsx` se conserva como módulo de traducción sin JSX (design/T7 decían retirarlo).
  **Aceptable** por las referencias de la ayuda y su test; el nombre `PascalCase.tsx` sin componente choca
  con `docs/conventions.md` (kebab-case para lo que no es componente).
- «El orden por defecto no viaja». **Aceptable**: el borde pone `desc` (probado en SCH/ACT) y la clave SWR
  lleva el orden explícito (R41).
- Periodo con el calendario de `FilterComponent`; R18 solo por unitario. **Aceptable**: con el calendario un
  rango invertido no se puede elegir; la guarda existe y está probada (siembra invertida en
  `filter-component-aplicar-463`). Por eso el test viejo del aviso en `EstadoCuenta.test` pasó a uno de R17.

Conviene anotar los cuatro en `design.md` al cerrar.

### Observación (no es de la 463)

`tests/integration/wallet-page.test.tsx` falla AISLADO (timeout de 20 s en el primer `import()` en frío del
page; el segundo caso hereda la llamada tardía), en las tres corridas, con y sin mutación; en el gate
completo pasa (13/13). `WalletModule` está stubbed en ese archivo: no lo causa esta ficha.

## Juicio de los tests reescritos

- `WalletLibroCaja458E` «R54»: pasar resumen/desglose de `toHaveBeenCalledWith(esperado)` a
  `not.toHaveBeenCalled()`, y la ganancia que NO cambia, ES el contrato nuevo aprobado (pregunta abierta 1).
  Pasar el libro de `LastCalledWith` a `CalledWith` se debe a la lectura extra del conteo de la tarjeta
  (decisión 5) y no oculta nada: M1 lo pone rojo.
- `WalletFiltroAQuien458E`: opciones de «A quién» con el periodo aplicado y sin `tipo` (afirmado con un bucle
  sobre TODAS las llamadas); «Limpiar» → «Limpiar todo» del libro, que no toca «A quién» (R30). Correcto.
- `EstadoCuenta.test`, `EstadoCuentaAnulados`, `EstadoCuentaSatelite`, `mi-wallet-page`,
  `estado-cuenta-descarga-columnas`, `WalletDescarga`: cambian los índices porque el saldo inicial pasa al
  final en «Más recientes» (R39/R43); las aserciones de contenido se conservan. M3a/M3b los ponen rojos.
- Integraciones de la 458 con `CRONOLOGICO` explícito: siguen midiendo lo mismo (y son las que matan M2).
- `wallet-listados-descarga-action`: deja de tratar `busqueda` como clave colada SOLO para saldos de tiendas
  (R45 la declara); las plantillas la siguen rechazando. Correcto.
- Guardias (`wallet-conceptos-sin-seed`, `wallet-textos-458`, `wallet-sin-uuid`): cambio de ruta al archivo
  nuevo, sin relajar el patrón.

## `FilterComponent`: el modo «Aplicar» es opt-in

`aplicarConBoton` solo lo pasan `WalletFiltrosCaja.tsx` y `EstadoCuenta.tsx`; los otros 8 consumidores
(`OrdenesListado`, `SateliteOrdenesListado`, `NovedadesFiltrosBarra`, `HistoricoFiltrosBar`,
`HistorialAccionesFiltrosBar`, `UsuariosModule`, `FiltrosCierresBarra`, `FiltrosEntregas`) no se tocaron, ni
sus tests ni los 4 `filter-component*.test.tsx` previos. Sin la prop, `emitir` y la precarga siguen el camino
de antes (las ramas nuevas se guardan con `modoAplicar`). Ver m4 para el hueco de red.

## Trazabilidad R1–R49 (comprobada contra los archivos)

R1–R11, R13–R48: cada uno tiene al menos un test que lo afirma (mapa de `impl_463.md`, verificado por nombre
en los archivos y, para dinero/orden/búsqueda, con mutación). Excepciones:

| R | Estado |
| --- | --- |
| R12 | Parcial: resumen y desglose sí (CJ R12, M1 muerta); **detalle de fila sin test (B2)** |
| R18 | Solo unitario de `FilterComponent` (aceptado, m6) |
| R49 | Caja sí (CJ R49 ×2); **estados de cuenta: no se cumple y el test mapeado no lo mide (B1)** |

## Para volver a revisión

1. B1: R49 en `EstadoCuenta.tsx` + test (o enmienda del spec por el humano).
2. B2: test del detalle de fila sin filtros del libro, que mate M1b.
3. Opcional en la misma vuelta: m1–m4.

---

# Segunda revisión

Revisor: reviewer. Fecha: 2026-10-01. Rama revisada: `origin/feature/463-wallets-filtros-y-orden` @ `c1998d88`
(delta revisado: `git diff b5bb07e1..c1998d88`). Worktree aislado, `checkout --detach` de ese SHA.

Búsqueda de código: lectura directa del delta y `grep` (renombre); el MCP `codebase-memory` no hizo falta
(el delta nombra cada archivo). Por indicación del leader NO se corrió `./init.sh` ni `tests/integration`
(gate completo ajeno sobre la base local compartida) ni dev server: se corrieron las suites de componente y
unitarias del delta, `tsc` y mutaciones/sondas puntuales, todas restauradas (`git status` limpio tras cada una).

## Veredicto: **RECHAZADO**

B1, B2 y m1–m6 están cerrados y bien probados (mutaciones repetidas abajo). Pero al juzgar m1 —lo que pidió
el leader: ¿puede pintarse una lectura vieja sobre una nueva?— salieron dos huecos de R49 en la CAJA, medidos
con sondas de componente. Ninguno lo introduce este delta (están en `WalletModule.tsx` desde `b5bb07e1` y la
primera revisión no los vio), pero R49 es requisito de esta ficha, el síntoma es exactamente el que bloqueó
B1 (cifras de un periodo con el control diciendo otro) y la ayuda nueva (m5) promete al usuario lo contrario.

## Checklist

- [x] B1 — R49 en los estados de cuenta: cerrado (`EstadoCuenta.tsx` guarda `{ seleccion, estado }`, `onError`
      devuelve periodo/chip/cierre/término/orden/página a la última lectura buena, siembras de calendario y
      buscador, aviso `role=alert` ENCIMA del libro, `shouldRetryOnError: false`). Verificado en SWR 2.4.2
      que `onError` solo se llama si la clave que falló sigue vigente (`callbackSafeguard`) y que `data` con
      `keepPreviousData` es la última buena: una respuesta tardía de otra clave no se pinta.
- [x] B2 — R12 detalle de fila: test CJ «463 R12 (revisión B2)» con `toHaveBeenCalledWith` exacto y bucle de
      claves prohibidas; M1b repetida: **muerta**.
- [x] m1 — conmutadores sin guarda; test con respuestas en orden inverso. Ver juicio abajo (B4).
- [x] m2 — posición del saldo inicial con `data.seleccion` (lo pintado); test m2.
- [x] m3 — integración con sentido absoluto (no corrida aquí por la restricción; la mutación consta en `impl_463.md`).
- [x] m4 — `filter-component-url-aplicar-463` (con/sin «Aplicar», debounce 499/500 ms).
- [x] m5 — ayuda de las 4 superficies reescrita; contrastada con R2/R3/R15–R17/R19/R23–R34/R39/R43: no
      contradice el spec. Excepción: la frase de R49 en `wallet-caja.md` no es cierta hoy para la caja (B3).
- [x] m6 — §9 de `design.md` con los 6 desvíos; renombre `WalletFiltros.tsx` → `wallet-filtros-input.ts`.
- [x] Renombre sin importadores rotos: `grep` de `_components/WalletFiltros` / `./WalletFiltros` en código y
      tests = 0. Quedan menciones en comentarios (`lib/actions/wallet-filtros.ts:56`,
      `tests/fixtures/libro-caja-barra.tsx:12`) y en documentos históricos: inocuas. `pnpm run typecheck`: exit 0.
- [x] Suites del delta: 20 archivos / **352 tests verdes** (EstadoCuenta463, EstadoCuenta, WalletCaja463,
      ComposicionGananciaCard, DetalleFilaComposicion, WalletFiltroAQuien458E, `tests/unit/asistente` (12),
      filter-component-url-aplicar-463, guardia wallet-sin-uuid).
- [ ] `./init.sh` completo: no corrido por el revisor (restricción del leader). El del implementador
      (`progress/gate_463_fix.log`) da un rojo ajeno (`liberacion-reprogramada-cierre-real`, FK al sembrar,
      4/4 verde aislado ×3). Hay que repetirlo antes de mergear.
- [ ] **R49 en la caja: NO se cumple** con una lectura que lanza (B3) ni con un fallo parcial cruzado (B4).

## Mutaciones repetidas por el revisor (restauradas con `git checkout --`)

| # | Mutación | Resultado |
| --- | --- | --- |
| R1 | «No restaurar el periodo»: fuera `setPeriodo(buena.periodo)` en `conservarLoUltimo` | **Muerta**: 1 rojo (EC «aplicar un periodo que falla») |
| R2 | «Borrar el libro al fallar»: `estado={hayFallo ? undefined : data?.estado}` | **Muerta**: 4 rojos (EC chip, periodo, término/orden; `EstadoCuenta.test` R5/171) |
| R3 | M1b: `ComposicionGananciaCard filtros={{ ...filtrosDeWallet(..), tipo, categoria }}` | **Muerta**: 1 rojo (CJ R12 revisión B2) |

## Hallazgos

### B3 — BLOQUEANTE — Caja: una lectura que LANZA no avisa y deja el periodo puesto sin cifras (R49)

`recargarTodo` y `recargarLibro` (`app/(app)/wallet/_components/WalletModule.tsx`) tienen `try/finally` sin
`catch`: R49 solo se atiende cuando la acción RESPONDE `status !== "ok"`. Si la acción lanza (red caída, 500
del servidor, timeout: el modo de fallo más común en producción, p. ej. los 500 intermitentes del pooler), la
promesa se rechaza sin manejar, no hay toast ni `deshacerPedido`.

**Medido** (sonda de componente, borrada): `verResumenCajaAction` rechaza con `Error("Failed to fetch")` al
aplicar 01–28 → 1 rechazo no manejado, **0 toasts**, el control dice `Periodo: 01 oct 2026 – 28 oct 2026` y
la ganancia sigue en `-₡20.000` (la de SIN periodo). Es el síntoma exacto de B1 —cifras de dinero de un
periodo con el control diciendo otro—, sin aviso. El estado de cuenta NO lo tiene (el fetcher de SWR
convierte el rechazo en `onError`); la caja sí. Y `docs/ayuda/oficina/wallet-caja.md` promete «Si una lectura
falla, la pantalla te lo dice y se queda con lo que mostraba».

Qué falta: tratar el rechazo como un fallo en las dos funciones (toast en español + `deshacerPedido` / volver
`pedidoLibro`), respetando el turno; y un test por función con `mockRejectedValue` que afirme aviso, cifras,
libro y control del periodo de antes. Comprobar que quitar el `catch` lo pone rojo.

### B4 — BLOQUEANTE — Caja: fallo parcial con las dos zonas en vuelo deja libro y cifras de periodos distintos

Respuesta a la pregunta del leader sobre m1. **Dentro de una zona, no**: `turnoLibro`/`turnoWallet` impiden
que una respuesta vieja pise a una nueva (lo prueba el test m1 y lo confirma el código). **Entre zonas, sí**,
cuando una de las dos lecturas falla. `recargarLibro` lee con `pedidoWallet.current` (el periodo PEDIDO, aún
no aplicado) y `recargarTodo` se salta su libro si hay otro turno de libro. Medido con sondas (aplicar
01–28 y, con la wallet en vuelo, pulsar «Sale»):

- **A — wallet OK, libro falla:** ganancia `-₡1.234` (la del periodo), control `01 oct – 28 oct`, pero el
  libro sigue con las 3 filas de SIN periodo (la lectura de la wallet no lo pintó por turno y la del libro
  falló). El libro no es del periodo que dicen el control y las cifras (R3/R8).
- **B — libro OK primero, wallet falla:** control vuelve a `Cualquier fecha`, ganancia `-₡20.000`, pero el
  libro enseña la fila leída CON el periodo 01–28 y «Sale» pulsado. R49 pide conservar el libro de ANTES
  del intento; se queda uno leído con el periodo que falló. (`deshacerPedido` además restaura
  `pedidoLibro` con el `filtrosLibro` de su cierre, que ya no es el pintado.)
- **C — mismo caso B por el buscador** (escribir «Juan» con la wallet en vuelo): idéntico. O sea, el hueco
  existe desde `b5bb07e1` por R32 (el buscador nunca se deshabilita); m1 no lo crea, le añade dos disparadores
  de un clic. Con B3 resuelto, los fallos parciales por red (un 500 en una de dos peticiones) lo hacen alcanzable.

Qué falta: un fallo de la wallet debe invalidar también el libro pedido con ese periodo (p. ej. tomar turno
de libro en `deshacerPedido` y apagar `cargandoLibro`, de modo que una lectura del libro en vuelo con el
periodo fallido no se pinte), y un fallo del libro cuya wallet SÍ se aplicó mientras tanto no puede dejar el
libro del periodo anterior (releerlo con la wallet aplicada, o pintar el libro que trajo `recargarTodo`).
Tests de componente para A y B. Si el humano prefiere acotar R49 a fallos no concurrentes, que lo diga y se
anota en `requirements.md`; tal como está aprobado, falla.

### m7 — menor — El aviso de R49 en el estado de cuenta solo se prueba con `status !== "ok"`

El camino del rechazo (acción que lanza) es el mismo por SWR y es correcto por construcción, pero ningún
test lo fija; un caso con `mockRejectedValue` lo blindaría frente a un futuro `try/catch` en `leer`.

### m8 — menor — `progress/review_463.md` va copiado en la rama de la feature

`c1998d88` añade este archivo tal como estaba en `review/463` @ `7d7df39c`. Esta segunda revisión solo añade
al final, así que el merge debería ser limpio, pero si la siguiente vuelta lo toca en la rama de la feature
habrá conflicto con `review/463`. Mejor no editarlo allí.

## Juicio de m1 (quitar la guarda `!disabled`)

Seguro para la concurrencia DENTRO del libro: cada clic compone sobre `pedidoLibro` y toma turno; solo pinta
el último pedido. No es la causa de B4, que ya existía por el buscador, pero sí lo hace más fácil de
disparar. Con B3 y B4 arreglados, m1 queda bien como está.

## Para volver a revisión

1. B3: `catch` en `recargarTodo` y `recargarLibro` con R49 completo + tests con rechazo.
2. B4: un fallo en una zona no deja el libro y las cifras de periodos distintos + tests de las secuencias A y B.
3. `./init.sh` completo en verde (repetir el rojo ajeno contra `dev` limpio si vuelve a salir).
4. Opcional: m7.

---

# Tercera revisión — `origin/feature/463-wallets-filtros-y-orden` @ `c3599d0e` (fix `988f8649` sobre `c1998d88`)

Revisor en worktree aislado, desacoplado en `c3599d0e`. Búsqueda: el delta nombra cada archivo;
lectura directa del diff y de `WalletModule.tsx` entero (no hizo falta el grafo). Restricción del leader:
sin `./init.sh`, sin `tests/integration`, sin dev server (gate completo ajeno sobre la base compartida).

## Veredicto: **OK**

B3 y B4 están cerrados en el código y con red que los mata; m7 y m8 cerrados. Las preguntas del leader
sobre las carreras tienen respuesta «no» en el código actual, salvo una pérdida acotada de texto tecleado
(m9, menor). Quedan dos huecos de RED (no de código): dos guardas correctas que ninguna prueba fija (m10,
m11). Condición ya conocida y no nueva: el gate completo del implementador sale rojo por un archivo ajeno
(ficha 276, FK por base compartida, 9/9 verde aislado x3); repetirlo verde antes de mergear, como se dijo
en la segunda revisión.

## Checklist

- [x] **B3** — `recargarTodo` y `recargarLibro` llevan `catch` → `fallo(null)` con toast `LECTURA_CAJA_FALLO`
      (literal escrito a mano en el test: contrato), respetando el turno. Tests CJ «revisión B3» (wallet
      lanza / libro lanza por orden y por buscador). M1 del implementador (quitar los `catch`) consta muerta.
- [x] **B4** — zona de la wallet atómica (las cuatro lecturas en `Promise.all`; nada se pinta si una falla
      o lanza), un solo `turno`, libro con la wallet APLICADA, `pedirLibro` suma el cambio del libro a la
      wallet en vuelo. Tests CJ «revisión B4» A/B/C + «las dos bien», cada uno soltando DESPUÉS la lectura
      superada con respuesta buena y comprobando que no pinta.
- [x] **m7** — EC «(m7)» x2 con `mockRejectedValue` (periodo; chip y término). Verdes sin código: el fetcher
      de SWR lleva el rechazo a `onError` → `conservarLoUltimo` (`EstadoCuenta.tsx:404`).
- [x] **m8** — `progress/review_463.md` añadido en `c1998d88` y borrado en `988f8649`: neto CERO contra
      `dev` (el árbol de `c3599d0e` no lo contiene). Sin conflicto con `review/463`.
- [x] `design.md` §9.7 recoge la decisión del leader (atómico / solo libro / lo superado no pinta).
- [x] Trazabilidad: `impl_463.md` (tercera vuelta) mapea B3/B4/m7 a tests concretos. La fila R49 de los
      mapas anteriores no se actualizó (ver m12).
- [x] `tasks.md`: 0 casillas sin marcar.
- [x] `tsc --noEmit` exit 0; `eslint app` + los dos tests: 0 errores, ningún aviso en lo tocado.
- [x] Suites corridas por el revisor: 44 archivos / **573 tests verdes** (CJ, EC, `EstadoCuenta`,
      `WalletFiltroAQuien458E`, `WalletLibroCaja458E`, `CajaComposicionBarra`, `WalletRefrescoDirigido`,
      `WalletLedgerVer458C`, `WalletFiltros458`, `tests/components/descarga`, `tests/unit/asistente`).
- [x] Merge limpio contra `origin/dev` (merge-tree), que va 1 commit por delante.
- [ ] `./init.sh` completo: no corrido por el revisor (restricción). El del implementador
      (`progress/gate_463_fix2.log`, `INIT_EXIT=1`) tiene como único rojo `cierre-sin-gestion-tope-sql-real`
      (276), ajeno al delta (solo frontend de la caja). Repetir antes de mergear.

## Razonamiento de las carreras (`WalletModule.tsx` @ `c3599d0e`)

Invariantes que sostienen el código: (1) toda lectura toma `++turno` y solo la del turno vigente pinta,
avisa o suelta `cargando`; (2) `recargarLibro` solo arranca con `vueloTodo === false`, y en ese estado
`pedidoWallet === aplicadoWallet` (un `recargarTodo` acabado o bien confirmó `aplicado = pedido` o bien
`fallo()` devolvió `pedido = aplicado`) — por eso leer con `pedidoWallet` (R3 abajo) es equivalente hoy;
(3) `recargarTodo` asigna `aplicadoWallet` y `aplicadoLibro` y TODOS los `set*` en el mismo bloque síncrono.

- **¿Cifras y libro de selecciones distintas?** No. El libro solo se pinta (a) junto con las cifras en
  `recargarTodo`, con el mismo `fw`, o (b) en `recargarLibro` con `aplicadoWallet`, que es lo que dicen las
  cifras pintadas y no puede cambiar mientras esa lectura es la vigente (cambiarlo exige un `recargarTodo`
  con turno posterior). El control del periodo se compone desde lo aplicado y queda deshabilitado mientras
  `cargando === "todo"`; un fallo lo resiembra a lo aplicado.
- **¿`cargando` para siempre?** No. Una sola variable; la pone cada `tomarTurno` y la apaga el `finally` del
  turno vigente, que siempre corre (`try/catch/finally`). Lo único fuera del `try` tras tomar el turno son
  funciones puras (`paginado`, `inputDeWallet`, `hayFiltrosDeLibro`). El colateral de la segunda vuelta
  (`cargandoLibro` colgado al superar un libro con un todo) desaparece con el estado único.
- **¿Se pierde un cambio del usuario?** Un clic nunca: compone sobre lo PEDIDO y toma turno; si falla, lo
  restaurado es lo aplicado y el aviso lo dice. Sí se pierde **texto tecleado y aún no emitido** (m9).

## Mutaciones del revisor

Arnés de un solo uso que comprueba que el archivo CAMBIÓ y restaura byte a byte desde una copia
(restaurado `true` las 7 veces); CJ entero en cada una; arnés y logs borrados.

| # | Mutación en `WalletModule.tsx` | Resultado |
| --- | --- | --- |
| M2 (repetida) | pintar `resumen`/`composicion` tras el chequeo de turno y ANTES de mirar los status | **Muerta**: 1 rojo (B4-A) |
| M5 (repetida) | quitar `if (mio !== turno.current) return` de `recargarTodo` | **Muerta**: 4 rojos (B4 A/B/C, «las dos bien») |
| R1 (nueva) | quitar el chequeo de turno de `recargarLibro` | **Muerta**: 1 rojo (m1 «Más antiguas» en vuelo) |
| R2 (nueva) | `fallo()` no devuelve `pedidoLibro` a lo aplicado | **SOBREVIVE** (29/29) → m11 |
| R3 (nueva) | `recargarLibro` lee con `pedidoWallet` en vez de `aplicadoWallet` | Sobrevive; **equivalente** por el invariante (2) |
| R4 (nueva) | `soltarTurno` sin la guarda `mio !== turno.current` | **SOBREVIVE** (29/29) → m10 |
| R5 (nueva) | el éxito de `recargarTodo` no asigna `aplicadoWallet` | **Muerta**: 1 rojo (R30) |

## Hallazgos

### m9 — menor — Un fallo borra el texto tecleado que aún no se había emitido

`fallo()` siembra siempre el término aplicado en el buscador, y la `siembra` de `BuscadorFiltros` cancela el
debounce en vuelo (500 ms). **Medido** (sonda de componente, borrada): pulsar «Sale» con su lectura
pendiente, teclear «Juan», la lectura de «Sale» responde `validation_error` → toast, el campo queda vacío
y no se pide nada más (`listar` x1). El usuario ve el campo vaciarse junto al aviso, así que no hay pantalla
incoherente ni dato equivocado; pero tecleó algo que no llegó a pedirse y se descarta. Es coherente con la
letra de la decisión («los controles vuelven a lo aplicado»), por eso no bloquea. Si se quiere afinar:
sembrar el término solo cuando la lectura que falló llevaba un término distinto del aplicado.

### m10 — menor — La guarda de `soltarTurno` no la fija ningún test

R4 sobrevive a CJ. Sin la guarda, una lectura SUPERADA que termina apaga `cargando` y `vueloTodo` mientras la
vigente sigue en vuelo; el siguiente cambio del libro va por `recargarLibro` con la wallet anterior y el
periodo pedido se pierde sin resiembra — el control diría 01–28 y las cifras serían las de sin periodo (el
síntoma de B1). **Medido** con sonda (borrada): periodo en vuelo (T1) → «Sale» (T2) → soltar T1 bien →
«Más antiguas»; con el código actual `resumen` se pide 3 veces y el libro lleva `desde` + `egreso` + `asc`
(verde); con R4, `resumen` x2 (rojo). Añadir ese test a CJ.

### m11 — menor — Que `fallo()` devuelva `pedidoLibro` a lo aplicado no lo fija ningún test

R2 sobrevive. Sin esa línea, tras un fallo del libro (p. ej. «Más antiguas») el siguiente cambio se compone
con el orden que falló aunque el conmutador diga «Más recientes». El test B3 «el libro lanza» ya teclea
«Juan» después del fallo: basta afirmar que esa lectura va SIN `sortDir: "asc"`.

### m12 — menor — La fila R49 de los mapas R → test de `impl_463.md` no nombra los tests nuevos

Las filas R49 (líneas ~354 y ~564) siguen citando «CJ R49 x2»; los bloques «revisión B3» y «revisión B4» solo
aparecen en la sección de la tercera vuelta. Actualizar la fila al cerrar la ficha.

## Para mergear

1. `./init.sh` completo en verde (o el rojo ajeno de la 276 repetido contra `dev` limpio).
2. Opcional, antes o en ficha aparte: tests de m10 y m11 (son dos aserciones), m9 si el humano lo pide, m12.
