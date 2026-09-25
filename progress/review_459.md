# Revisión independiente — Ficha 459 «La caja muestra el dinero real»

- Revisado: origin/feature/459-frontend @ 66549de6 (contiene backend fa2624fb + frontend). merge-base con dev = 6280fdbb; dev (6973d3ca) solo lleva un commit de docs por delante.
- Entorno propio: pnpm install --frozen-lockfile (sin junction) + prisma generate; base CLON ordenex_459_rev (CREATE DATABASE ... TEMPLATE ordenex_459), prisma migrate status: «ordenex_459_rev at localhost:5432, 216 migrations, up to date». Borrado al terminar.
- Búsqueda: MCP codebase-memory (R-job-singularis-projects-ordenex) para los consumidores de derivarCaja (trace_path); índice rancio (no ve lo de esta rama), así que todo se confirmó en el archivo real con grep.
- NO se corrió ./init.sh completo (lo hace el leader). Sí: typecheck, lint, 466 archivos de la ficha y 692 archivos de componentes/guardias.

## Veredicto: RECHAZADO

El dinero está bien: la derivación, la migración de reclasificación y los caminos de escritura resisten todas las mutaciones que les hice. Se rechaza por dos motivos concretos y baratos de arreglar: (1) R77 y parte de R45 no tienen un test que los verifique (dos mutaciones sobreviven con toda la suite verde) y (2) el checkpoint de tareas: tasks.md tiene las 60 tareas en «[ ]» y faltan las evidencias de varias de ellas.

## Checklist

| # | Punto | Resultado |
| --- | --- | --- |
| 1 | Trazabilidad R1–R100 → test que existe y pasa | FALLA en R77 (sin test efectivo) y en R45 (el origen legible no se verifica). R79 y R91 son evidencia del leader que no está en progress/ (ver hallazgos). El resto: test existente y verde. |
| 2 | Derivación reproducida a mano con la línea base de producción | OK (sección 2) |
| 3 | Invariantes R7/R8: 4 mutaciones propias | OK — las 4 en ROJO (sección 3) |
| 4 | Migración 20260925120300_reclasificar_cobros_459, línea a línea y ejecutada en el clon | OK — 10 escenarios, todos con el resultado esperado |
| 5 | lista_aprobada.csv idéntica a 459_reclasificacion_aprobada.csv, y la guardia lo exige | OK — cmp idénticos, md5 4ddc3ceb4c3daa5de413dfee5150effc igual al blob de 6973d3ca; migración y down = CSV en ids y montos |
| 6 | Seguridad y alcance | OK (sección 6); RLS en las 4 tablas nuevas |
| 7 | R27 y textos literales de design §3.3 / §3.4 / §5 | OK |
| 8 | Fase 0 intacta fuera del bloque «a propósito» | OK — el diff 268277c5..HEAD del test solo toca ese bloque; el fixture solo gana cableado de servicios |
| — | tasks.md todo en [x] (CHECKPOINTS) | FALLA — 0 de 60 marcadas |
| — | typecheck | OK (tsc --noEmit, exit 0) |
| — | lint | OK (0 errors, 217 warnings preexistentes) |
| — | tests de la ficha | OK — 466 archivos / 6358 tests: 6356 verdes, 0 skipped; los 2 rojos (factura-contraste, impresion-flujo: «Test timed out in 20000ms», ajenos a la ficha) pasan al repetirlos en la corrida de 692 archivos (9725 verdes; 26 skipped preexistentes de AnaliticaPage/AnaliticaShell) |
| — | RLS en tablas nuevas | OK — ENABLE ROW LEVEL SECURITY en pago_por_cuenta_tienda, pago_por_cuenta_tienda_anulacion, aporte_capital, aporte_capital_anulacion; caja-459-migration lo prueba contra Postgres |
| — | Migraciones con down.sql | OK — las 4 lo tienen; caja-459-migration verde (up, down, up; rollback con filas falla sin borrar) |
| — | Secretos / webhooks | OK — sin secretos; sin webhooks |
| — | E2E de pagos | Inaplicable (sin arnés); su sustituto, el recorrido por rol de design §16, NO se ha hecho (progress/recorrido_459/ no existe) |

## 2. La derivación, a mano

Línea base de producción (design §11, final; agregados por concepto de M6): contra-entrega 29.059.224,00; cargos 4.372.000 + 1.017.074,04 + 1.753.200 + 568.360 + 132.223,43 + 227.916 = 8.070.773,47; egresos 8.871.709 + 3.439.700 + 165.000 + 1 = 12.476.410,00 (todos propios; no hay pagos a tienda ni ajustes, por eso de_tiendas_hoy = 29.059.224,00).

- Entró nueva = 37.129.997,47 − 8.070.773,47 = 29.059.224,00
- cifra_nueva = 29.059.224,00 − 12.476.410,00 = **16.582.814,00** ✓
- de_tiendas_nueva = 29.059.224,00 − 8.070.773,47 = **20.988.450,53** ✓
- ganancia = 8.070.773,47 − 12.476.410,00 = **−4.405.636,53** ✓ (igual que antes)
- R7: −4.405.636,53 + 20.988.450,53 + 0 = 16.582.814,00 → diferencia **0,00** ✓
- R8: −4.780.583,97 + 25.769.034,50 = 20.988.450,53 → diferencia_r8 **0,00** ✓
- Tras los 203: cifra −9.186.220,50; «De las tiendas» −4.780.583,97 = Σ saldos ✓

El código calcula exactamente eso: tests/unit/utils/caja-derivacion-459.test.ts afirma esos literales (escritos a mano, no con la función) sobre derivarCaja y está verde; la mutación M-R2 lo pone rojo.

**Consumidores de la fórmula** (trace_path + grep sobre lib/, app/, components/, scripts/): derivarCaja solo la llaman WalletService.verResumenCaja (tarjeta; KPIs vía verResumenCajaAction) y AnaliticaFinancieraService (dinero_en_caja por cubo, con test «dinero_en_caja = cifra de la tarjeta»). finanzas-diarias usa LIQUIDEZ_POR_CATEGORIA para «ingresos». La descarga del libro no lleva resumen. KPIs: rótulo y pista de la misma función que la tarjeta. Ningún consumidor sigue con la fórmula vieja. Queda un rótulo viejo en analítica (m3).

## 3. Mutaciones propias

Una a una: aplicada con sed sobre un texto único, diff no vacío comprobado, solo los tests relacionados, revertida con checkout del archivo y árbol limpio comprobado después de cada una.

| # | Mutación | Archivo | Tests corridos | Resultado |
| --- | --- | --- | --- | --- |
| M-R1 | pago por cuenta SIN su egreso en la caja (la llamada a emitirEgresoDePagoPorCuenta queda tras «if (tx === null)») | lib/services/PagoPorCuentaTiendaService.ts | caja-invariante-tiendas, pago-por-cuenta-tienda (int), pago-por-cuenta-tienda-service | **ROJO** — 11 de 40 (R8/R89 tras cada paso, R29, R41, R46, orden de escrituras) |
| M-R2 | un CARGO contado también como entrada de efectivo (en acumular, suma a cargosATiendas Y a entradasEfectivo) | lib/utils/caja-tesoreria.ts | caja-derivacion-459, caja-tesoreria, caja-invariante-tiendas, caja-caracterizacion-459, DineroIdentidadesEnPantalla | **ROJO** — 18 de 94 (R2/R3 con M6, R7 en 500 conjuntos, R7 en Postgres tras cada paso, bloque «a propósito» de la fase 0) |
| M-R3 | el saldo inicial clasificado como GANANCIA (ingreso_aporte_capital: "propio") | lib/utils/caja-tesoreria.ts | caja-derivacion-459, caja-invariante-tiendas, aporte-capital (int), caja-clasificacion-459.guardia | **ROJO** — 3 de 33 (columna 4 de §2.4 y «R39/R48/R72/R75: nunca la ganancia» en Postgres). Ver m2 |
| M-R4 | reclasificación SIN débito (el INSERT de la migración no escribe: «JOIN usuario u ON u.id = m.tienda_id AND false») | db/migrations/20260925120300_reclasificar_cobros_459/migration.sql | reclasificacion-459-migration, caja-invariante-tiendas, reclasificacion-459-lista.guardia | **ROJO** — 3 de 16 (R81/R8, R85/R86, R84). caja-invariante-tiendas sigue verde: no ejecuta la migración (m1) |
| M-R5 | dueño del capital «Ordenex (capital)» → «Ordenex» y origen «Saldo inicial o aporte» → «Aporte» | app/(app)/wallet/_components/wallet-labels.ts | tests/components, tests/unit/components, tests/unit/descarga, wallet-page, caja-textos-459 | **VERDE — SUPERVIVIENTE** (519 archivos, 7306 tests). R77 sin test |
| M-R6 | origen del pago por cuenta «Pago por cuenta de tienda» → el valor crudo «pago_por_cuenta_tienda» | app/(app)/wallet/_components/wallet-labels.ts | tests/components, tests/unit/components, tests/unit/descarga, tests/unit/guards, wallet-page | **VERDE — SUPERVIVIENTE** (692 archivos, 9725 tests). R45 (origen legible) sin test |

## 4. La migración de reclasificación

Lectura línea a línea (migration.sql y down.sql):

- Casa **solo por id** (tabla temporal aprobados_459 (id, monto)); la fecha del CSV es solo comentario. ✓
- Control de la **propia lista** antes de nada: 203 filas y 25.769.034,50, o excepción. ✓
- 0 presentes → RAISE NOTICE y RETURN sin escribir (R83). Presentes distinto de 203 → excepción (R83). ✓
- Por fila: categoría cobro_manual, tipo debito, tienda_id = constante ecf6c289-9799-4558-be6d-ce5f8a12f5cd, monto exacto; si una no cuadra → excepción (R82). ✓
- INSERT: egreso / egreso_pago_por_cuenta_tienda / origen cobro_manual_reclasificado → id del cobro; m.monto; m.fecha_movimiento de la PROPIA fila; m.registrado_por; descripción «Nombre Apellido · descripción» sin ids; ON CONFLICT sobre wallet_movimiento_origen_categoria_uq DO NOTHING (R85). ✓
- Control final sobre lo escrito: 203 por 25.769.034,50 o excepción (R84). Todo en un único bloque DO: o todo o nada. ✓
- down.sql: DELETE restringido a origen cobro_manual_reclasificado + categoría egreso_pago_por_cuenta_tienda + los 203 ids (= CSV). ✓

Ejecutada en el clon (cada escenario en su transacción, revertida; recuento de la base igual antes y después):

| Escenario | Resultado |
| --- | --- |
| 0 ids presentes | NOTICE «ningun cobro de la lista existe…»; 0 filas escritas; caja 36 → 36 |
| 3 cobros falsos con ids de la lista, sembrados en una transacción que termina en COMMIT | **ERROR «existen 3 de 203 cobros aprobados»**; después: 0 usuarios, 0 cobros, 0 salidas (no quedó nada, ni la siembra) |
| 203 correctos (fecha con microsegundos) | 203 salidas por 25.769.034,50; 203/203 con el mismo instante, monto, tipo, categoría y autor; libro de tiendas idéntico (md5 antes = después); descripción «Nuform Rev · pago prueba» |
| la misma, aplicada 2 veces | sigue en 203 / 25.769.034,50 (idempotente) |
| down con una fila ajena del mismo origen fuera de la lista | DELETE 203; queda solo la ajena |
| 203 con un monto +0,01 | ERROR «algun cobro no coincide en tipo, categoria, tienda o monto» |
| 203 con una fila de otra tienda | ERROR, el mismo |
| 203 con una fila de categoría flete | ERROR, el mismo |
| 202 de 203 presentes | ERROR «existen 202 de 203 cobros aprobados» |
| lista tocada a mano (+1,00 en una fila) | ERROR «la lista tiene 203 filas por 25769035.50, se esperaban 203 por 25769034.50» |

## 5. El CSV

progress/reclasificacion_459/lista_aprobada.csv y progress/459_reclasificacion_aprobada.csv: cmp idénticos; 203 filas, 203 ids distintos, suma 2.576.903.450 céntimos = 25.769.034,50. Los pares (id, monto) de la migración y los ids del down coinciden 1 a 1 con el CSV (diff vacío). La guardia reclasificacion-459-lista está verde, y la mutación C4-1 del implementer (una fila con otro monto) la pone roja.

## 6. Seguridad y alcance

- Pago por cuenta y saldo inicial/aporte: registrar y anular exigen esAccesoTotal ANTES de leer nada (servicio); sesión antes de mirar la entrada (action); zod .strict(). Comprobante del aporte: solo acceso total.
- Comprobante del pago por cuenta: acceso total o la tienda dueña; a una tienda con un pago ajeno o inexistente, el mismo no_encontrado. URL firmada con TTL; bucket privado que hay que CREAR antes de desplegar B (nota de operaciones del implementer).
- Ids: DTOs sin tiendaId ni ruta; la descarga del libro no gana columnas (test verde); descripciones sin forma de uuid (test verde). El id del documento viaja solo como origenId/pagoId para las acciones y no se pinta.
- RLS activado en las 4 tablas.

## 7. R27 y textos

- Ningún método ni action devuelve un importe; el monto del aporte no lleva placeholder (el resto de conceptos, «0.00»); la mutación M6 del frontend (poner un ejemplo) queda roja.
- CAJA_RESUMEN_LABEL, avisos de negativo, TIENDAS_DEBEN, AVISO_TERCEROS, NOTA_DIFERENCIA, mensajes de la barra y su nombre accesible: literales de design §3.3/§3.4, comparados uno a uno. Rótulos de design §5 (conceptos, orígenes, dueño capital, conceptos de la tienda): presentes y literales.

## 8. Fase 0

El diff 268277c5..HEAD de caja-caracterizacion-459.test.ts toca SOLO el describe «lo que esta ficha cambia a proposito»; sus literales nuevos cuadran a mano: 100.487,93 − 12.970,68 = 87.517,25; −61.357,84 − 12.970,68 = −74.328,52; 28.517,00 − 12.970,68 = 15.546,32 = 7.530,70 + 5.515,12 + 2.500,50; ganancia −89.874,84 (= −61.357,84 − 28.517,00 de la foto previa). El fixture caja-459.ts solo añade el cableado de los servicios nuevos. Fotografía verde; M-R2 rompe su bloque «a propósito».

## Hallazgos

**BLOQUEANTE**

- **B1 — R77 sin test (y R45 a medias).** M-R5 y M-R6 sobreviven con toda la suite verde: el dueño «Ordenex (capital)» y el origen «Saldo inicial o aporte» de la entrada de capital, y el origen «Pago por cuenta de tienda» de la salida del pago por cuenta, pueden cambiar a cualquier cosa (o al valor crudo del enum) sin que nada lo note. Ningún test del repo contiene el texto «Ordenex (capital)». impl_459_frontend.md atribuye R45/R77 a WalletLedgerAcciones459.test.tsx, pero ese archivo solo afirma concepto, dueño y origen de la fila RECLASIFICADA. **Qué falta:** en WalletLedgerAcciones459.test.tsx, para SALDO_INICIAL y PAGO_VIGENTE, afirmar en la tabla y en filaDescargaMovimientoCaja el concepto, el dueño («Ordenex (capital)» / «Tienda») y el origen legible con su texto de design §5, y que el filtro por concepto del libro ofrece los 4 conceptos nuevos con su rótulo. Comprobar con M-R5 y M-R6 en rojo.
- **B2 — Checkpoint de tareas.** specs/459-la-caja-muestra-el-dinero-real/tasks.md tiene las 60 tareas en «[ ]». Hay que marcar lo hecho; y faltan las evidencias de: T A.10/T B.18 (recorrido por rol de design §16: progress/recorrido_459/ no existe, y es el sustituto declarado del E2E de pagos), T Z.1 (fase 0 repetida con el árbol final: sin anexo en impl_459_fase0.md), T0.4/T Z.3 (progress/contraste_459.md no existe; la línea base vive al final de design.md), T C.1/T C.2 (candidatos.csv y aprobacion.md no existen; la constancia de la aprobación está en progress/medicion_457.md de dev, NO en esta rama). Parte es del leader, pero la ficha no puede pasar a done sin ello.

**menor**

- m1 — caja-invariante-tiendas.test.ts reclasifica con un insert de Prisma escrito a mano, no con el SQL real de la migración como pide design §12.3 (por eso M-R4 lo deja verde). R8 con el SQL real sí lo cubre reclasificacion-459-migration.test.ts.
- m2 — aporte-capital.test.ts (integración, «R72: no cambia la ganancia») y la guardia caja-clasificacion-459 no cazan M-R3 (saldo inicial como propio); lo cazan caja-derivacion-459 y caja-invariante-tiendas. La guardia no afirma que los conceptos de capital sean «capital».
- m3 — /analitica (TableroFinanciero, vivo) rotula la métrica dinero_en_caja con la etiqueta de catálogo «Dinero en caja» (lib/analytics/metrics.ts:670) aunque su valor ahora es el flujo registrado; y app/(app)/wallet/page.tsx:110 describe la pantalla con «dinero en caja». Fuera del alcance literal de R16 (tarjeta y barra), pero es la misma afirmación que HF4 retira. Decisión del leader.
- m4 — requirements.md dice que los 203 van «del 2026-09-08 al 2026-09-23»; el CSV aprobado empieza el 2026-08-28 (fecha UTC informativa). Inconsistencia del spec, no del código.
- m5 — HF5/T C.2 pedían decisión fila a fila y explícita sobre las tres filas marcadas (LEMME BURN 400.000, ABONO TARJETA 453.000, FACEBOOK IVA 11.233,20: las tres están en la lista). La aprobación es global («si no estoy mal todos para Nuform») y deja abierto que los servicios tecnológicos (Vercel, OpenAI, Atlassian…) sean de Ordenex. Que conste en aprobacion.md antes de aplicar en producción.
- m6 — lista_aprobada.csv no tiene las columnas tienda_id y decisión de design §10.1; la tienda es una constante de la migración (autorizado por el coordinador, impl_459.md decisión 4). Aceptable.
- m7 — AporteCapitalService lee primerDiaDeLaCaja (R71) fuera de la transacción; carrera teórica, inocua en la práctica.
- m8 — R79 (consulta C3) y R91 (contraste) no tienen test por diseño: su evidencia en progress/ es del leader y hoy falta (ver B2).

## Qué tiene que hacer el implementer para pasar

1. B1: los asserts de R45/R77 descritos arriba, con M-R5 y M-R6 en rojo, anotados en impl_459_frontend.md.
2. B2: marcar en tasks.md lo hecho y dejar explícito, con dueño, lo que es del leader: recorrido por rol, contraste_459.md, aprobacion.md/candidatos.csv, anexo de la fase 0.
