# Revisión 458-C «Registrar un movimiento y panel Ver» — REVIEWER (adversarial)

- **Rama revisada:** `origin/feature/458-C` @ `03122992` (detached), diff de tres puntos contra `origin/dev` (dev con #830, el arreglo async).
- **Fecha:** 2026-09-26.
- **Búsqueda:** el MCP `codebase-memory` no estaba en mi conjunto de herramientas en esta sesión; usé `grep`/lectura de archivos reales (regla 7, declarado).
- **Base:** sin base propia (el modo auto no deja copiar el `.env`). Integración contra Postgres: me apoyo en `progress/gate_458C.log` (`INIT_EXIT=0`, 2307 archivos, 0 saltados en `integration/db`), que se corrió sobre `4257d25f`, **antes** del merge de `fix/458-B-async` (`a25cdceb`) y de `03122992`.

## Veredicto: **RECHAZADA**

Hay tres bloqueantes. Ninguno es de cálculo del dinero, que está bien hecho: servidor, money-safe, D5 y enrutado. Los tres son de **lo que la pantalla afirma sobre el estado del dinero** y de **red de tests perdida**. Esa es exactamente la familia de los fallos mudos.

## Verificación ejecutada por mí (salidas en este worktree)

| Qué | Resultado | Log |
| --- | --- | --- |
| pnpm install --frozen-lockfile + prisma generate (URL ficticia, sin base) | OK | progress/review_458C_prisma.log |
| pnpm run typecheck | TYPECHECK_EXIT=0 | progress/review_458C_typecheck.log |
| pnpm run lint | 0 errores, 218 warnings (preexistentes), LINT_EXIT=0 | progress/review_458C_lint.log |
| Tests de componentes/unitarios de la hija (15 rutas: panel, anular, libro, diálogo, catálogo, comprobante, asistente, egresos-actions, types, efecto) | 114 archivos, 1890 tests, TESTS_EXIT=0 | progress/review_458C_tests.log |
| Guardias (vitest run guard) | 265 archivos OK; los 2 saltados son integration/db/zona-* (necesitan base, ajenos) | progress/review_458C_guardias.log |
| pnpm run build (sin VERCEL_ENV: migración OMITIDA, lo dice el log) | Compiled successfully, /wallet y /wallet/tiendas compilan, BUILD_EXIT=0 | progress/review_458C_build.log |

## Checklist (CHECKPOINTS.md + reviewer)

- [x] requirements/design/tasks existen (458 común).
- [ ] **tasks TC.0–TC.7 marcadas [x]**: las ocho siguen [ ] en specs/458-rediseno-wallet/tasks.md:208-252 (la 458-B sí marcó las suyas).
- [~] Trazabilidad R→test: mapa presente en progress/impl_458-C.md. Pero **la tabla de «tests retirados con su sustituto» afirma sustitutos que no existen** (ver B1). R58 está mapeado, pero se cumple a medias (M1).
- [x] typecheck, lint y build verdes (medido por mí).
- [x] Tests sin base verdes (medido). Tests con base: gate del implementer verde, sobre un SHA anterior al merge.
- [n/a] E2E: no hay arnés (memoria del proyecto). Lo sustituye el recorrido, que **no ejercita los dos conceptos nuevos de dinero** (M2).
- [x] Sin tablas ni migraciones nuevas en esta hija (RLS n/a). Sin secretos. Sin webhooks.
- [x] Capas: el diálogo y el panel solo llaman a Server Actions. El libro (WalletLedger.tsx) vuelve a no importar ninguna action.
- [x] Permisos: toda action comprueba el rol en el servidor. Recorrido: adminTienda y mensajero dan forbidden con 0 filas y 404 en /wallet. adminSatelite no se sondeó (m5).
- [x] Sin hardcode de moneda (money de config) y sin Number( ni parseFloat( en el diff. La guardia wallet-money-safe-458 es real, con contraprueba.
- [ ] progress/history.md: sin entrada de la 458-C.

## Lo que está BIEN (verificado, no de la bitácora)

- **Diálogo, claves por concepto:** formData() (RegistrarMovimientoDialog.tsx:308-369) manda solo las claves del camino. Cada test del diálogo afirma la lista entera de claves en los diez conceptos. Los schemas .strict() de 172/205 (camposComunesDelPago + tiendaId/mensajeroId) casan con lo que se envía (nota opcional, fechaPago siempre).
- **Frases de efecto:** las siete de la 461 están byte a byte (diff de FRASE_DEL_EFECTO: solo añade dos claves) y el test las afirma literales.
- **Clave de idempotencia:** se genera en abrir() → reset() (:247), se conserva en los reintentos y cambia en la siguiente apertura (test R51).
- **Tiendas inactivas:** listarAdminTiendas → UserRepository filtra estado "activo", sin tope. Los mensajeros, igual.
- **D5, en el diálogo y en el servidor:**
  - El diálogo lo exige (:289).
  - El servidor lo exige con superRefine (lib/types/wallet-laterales.ts:51-57).
  - Único llamador de registrarEgresoAdministrativoAction y de registrarEgresoConLateralesSchema: el diálogo nuevo. WalletEgresoService.registrarEgreso solo lo llama esa action. Ni la API pública, ni el asistente, ni las plantillas de gasto fijo (cron), ni scripts/ pasan por ese schema. **No se rompe ningún llamador.**
- **«Así queda»:**
  - Cargando y error sin cifras, también con una respuesta no-ok.
  - «no cambia» por línea.
  - saldoEnContra y superaDisponible los decide lib/utils/efecto-movimiento.ts:85-108.
  - Sin aritmética en el cliente.
- **Anular:**
  - anularMovimientoAction({destino, motivo}), sin monto.
  - ya_anulado cierra con «Ya estaba anulado; no se registró nada más.».
  - no_anulable, con sus seis motivos en palabras (Record total).
  - El enrutado del servidor cubre todos los caminos (WalletAnulacionService.rutaDeCaja).
- **Comprobante:**
  - Rótulo legible y ninguna ruta.
  - «Adjuntar» no se ofrece en filas anuladas.
  - NO_ADMITE_COMPROBANTE_LABEL total.
  - «Ver comprobante» siempre va al servidor.
- **H6:** el panel y el libro tienen test de «ningún id en texto ni en aria-label». R96 sigue verde.
- **R100 en el panel:** el cobro por rechazo se explica como cargo, y como anulado.

## Hallazgos

### BLOQUEANTE

**B1 — Tests retirados sin sustituto real (regla de tasks: «Ninguno desaparece sin reemplazo»).**

tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx se reescribió entero. La tabla de impl_458-C.md da por sustituidos bloques que el archivo nuevo no mide. Medido con grep sobre tests/: ningún test de componente monta RegistrarMovimientoDialog con las respuestas ya_registrado, sin_deuda, ya_hay_saldo_inicial ni el excede del abono, y ninguno afirma los avisos de éxito de aporte, abono ni pago de un gasto. La lógica existe, pero nada la vigila:

- **461 R68** (doble envío = éxito sin toast de error): ya_registrado en RegistrarMovimientoDialog.tsx:380, :386, :392, :398, :404, :433, :449.
  - Escenario: quitar «|| res.status === "ya_registrado"» en cualquiera de ellas convierte el reintento de un sueldo ya registrado en un throw («estado inesperado») y en un diálogo mudo. **La suite queda verde.**
  - Antes lo cubrían «ya_registrado se anuncia como registrado…» y «…en un gasto de Ordenex y en una corrección…».
- **457 R57/R58 + m7:**
  - ya_registrado del abono con el importe que quedó (:417-421).
  - sin_deuda bajo la tienda (:423).
  - excede bajo el monto, con la deuda del servidor (:426).
  - El aviso de éxito con el saldo del servidor y «todavía debe» (:415).
  - El «sustituto» citado («una tienda le paga a Ordenex: … fechaPago, siempre») solo mira las claves del FormData.
- **459 R68/R70:**
  - El literal de éxito «Registrado. Saldo inicial de ₡2.500.000,50.» (:405).
  - ya_hay_saldo_inicial bajo la clase (:407-409).
- **459 R63:** el aviso de éxito del pago de un gasto, con el saldo y su signo (:399).
- **Conceptos nuevos:** sin_saldo/excede del pago a un mensajero (:459-470) sin ningún test.

Qué falta: restituir esos casos en el test del diálogo, con el literal donde el literal es el contrato, y matar al menos la mutación «ya_registrado → error» en un camino de caja y en el abono.

**B2 — La fila anulada del libro ya no dice «Anulado»: literal de contrato perdido.**

- Tres requisitos firmados piden que el libro de la caja «DEBE mostrar «Anulado»» en la fila anulada: 457 R41, 459 R66 y 461 R20. La 458 R71 pide «se muestre «Anulado»», y el design §5.1 dice «line-through + texto muted y el motivo en texto».
- Ahora app/(app)/wallet/_components/WalletLedger.tsx:136 (claseDeFila) solo aplica line-through y text-muted-foreground. La fila no lleva la palabra, ni visible ni sr-only, ni en el aria-label de «Ver» (PANEL_TEXTO.verNombre).
- Los tests que afirmaban within(fila).getByText("Anulado") (WalletLedgerAcciones457, 459 y 461) se borraron. El sustituto (WalletLedgerVer458C.test.tsx, «R71 … tachada») solo mira className.
- Escenario: un lector de pantalla recorre el libro y oye un gasto anulado igual que uno vigente.
- Además, la ayuda (docs/ayuda/oficina/wallet-caja.md:326: «La fila original pasa a decir Anulado») y la respuesta del asistente en el recorrido afirman algo que la pantalla no hace.

Qué falta: la palabra en la fila, a partir de documento.anulado del servidor, y un test que la afirme como literal.

**B3 — El panel afirma «Vigente» sin que el servidor lo haya dicho.**

- app/(app)/wallet/_components/VerMovimientoCaja.tsx:58-62 deduce «anulado: documento?.anulado ?? false», y components/shared/wallet/DetalleMovimientoPanel.tsx:269-279 pinta «Vigente» para toda fila con documento null.
- WalletService.tipoDeDocumentoOriginal (lib/services/WalletService.ts:70-112) NO da documento a:
  - egreso_pago_tienda (pago de Ordenex a una tienda, 172);
  - egreso_pago_mensajero con origen ranking_snapshot_fila (premio, 293).
- Sin embargo, el servidor SÍ los anula (lib/services/WalletAnulacionService.ts:106 y :115).
- Escenario: Ordenex le paga ₡50.000 a una tienda desde el diálogo nuevo, alguien lo anula en /wallet/tiendas, y en /wallet → «Ver» esa fila dice **«Estado: Vigente»**, no sale tachada y no ofrece «Anular…». Viola R71: el estado lo decide el servidor, y ninguna superficie lo deduce. Lo mismo con un premio anulado. Y los contra-asientos se rotulan «Vigente».
- El test de «los diez caminos anulables» (WalletLedgerVer458C.test.tsx, ANULABLES) no incluye ni el pago a una tienda ni el premio: lista el cobro dos veces, propio y completado.

Qué falta, como mínimo en esta hija: no afirmar «Vigente» cuando la fila no trae documento (decir «—» o no pintar la línea). Llevar documento a esas dos filas es servidor: ver M1 para anotarlo.

### MAYOR

**M1 — R58 y R63 incompletos en el panel del libro, declarados solo en la bitácora.**

- Falta en el panel:
  - quién anuló, cuándo y con qué motivo en las filas de la caja (solo «Anulado» o «Anulado · motivo no registrado»);
  - el método y la referencia («cómo»);
  - el instante de registro.
- A eso se suma el «Anular…» del pago a una tienda y del premio en la caja (B3).
- La referencia que ahora se captura en sueldo, gasto y corrección se guarda (wallet_anotacion) y no se enseña en ninguna parte.
- No bloquea si el leader lo acepta, pero hoy vive solo en impl_458-C.md → «Pendiente 3». Tiene que quedar escrito en tasks.md (TE.3 de la 458-E u otra ficha), con los R58/R63/R71 que arrastra, antes de cerrar la 458-C.

**M2 — Los dos conceptos nuevos de dinero no se ejercitaron nunca en la app.**

- El recorrido (progress/recorrido_458-C/recorrido.md) registra sueldo, cobro, pago de un gasto, corrección y cobro por rechazo. **Ni «Ordenex le paga a una tienda» ni «Ordenex le paga a un mensajero»** se registraron (ni anularon) en el navegador, y no hay medida R7/R8 tras ellos.
- Su única evidencia son tests con las actions simuladas.
- Son caminos de dinero reales (172/205 con FormData y comprobante desde la 458-B).
- Qué falta: repetir el paso con los dos y medir R7/R8 como en c458c-1.sql.

**M3 — Fallo mudo y clave compartida entre conceptos del mismo camino.**

- registrar() lanza ante un estado desconocido (comun, RegistrarMovimientoDialog.tsx:136-138) o ante un error de red. El Modal (:553-566) no recibe onError, así que el diálogo vuelve a «idle» sin decir nada.
- La clave de idempotencia NO cambia al cambiar de concepto (elegirConcepto, :257-265), y gasto y sueldo comparten action (igual que la corrección suma y resta).
- Escenario: el gasto se registra pero la respuesta se pierde; la persona no ve nada, cambia a «Sueldo» y confirma; el servidor responde ya_registrado del gasto y el diálogo anuncia «Movimiento registrado correctamente.». Queda un gasto donde la persona cree haber registrado un sueldo.
- Qué falta: avisar del fallo (onError o try/catch) y regenerar la clave al cambiar de concepto, o al menos al cambiar de tipoEgreso/tipo.

### menor

- **m1:** tasks TC.0–TC.7 sin [x]. Sin entrada en progress/history.md.
- **m2:** el gate completo (gate_458C.log) es de 4257d25f. HEAD 03122992 trae el merge de fix/458-B-async, sin gate completo posterior. Mis corridas sin base (typecheck, lint, 1890 tests, guardias, build) están verdes sobre HEAD.
- **m3:** reversarEgresoAdministrativoAction queda viva como Server Action invocable (acceso total) SIN superficie. Escribe un contra-asiento sin motivo ni constancia, al margen de la anulación uniforme. El índice único evita el doble asiento, pero es una puerta de dinero sin motivo: retirarla en una ficha de servidor.
- **m4:** los tres obtenerComprobante{Abono,AporteCapital,PagoPorCuenta}Action quedan con @sin-superficie y la etiqueta «decisión, no deuda». Es deuda, con dueño TD.5 de la 458-D. **No bloquean:** conservan su control de alcance y verComprobanteAction cubre la lectura desde el panel. Solo deben rotularse como deuda con su dueño.
- **m5:** R104 incluye adminSatelite. El recorrido solo sondea adminTienda y mensajero.
- **m6:** la ayuda cita «no se puede anular desde aquí», pero el texto real ahora es «Este movimiento no se puede anular: …» (detalle-movimiento-panel-labels.ts:116).
- **m7:** el diálogo no deja pagar a una tienda o a un mensajero INACTIVO que aún tenga saldo, y R41 lo permite donde el camino lo admite. Sigue siendo posible desde /wallet/tiendas, así que no hay pérdida. Anotarlo.

## Lo que tiene que volver al implementer

1. **B1:** restituir los casos perdidos del diálogo: ya_registrado en los caminos de caja, cobro, pago de un gasto, aporte, abono, pago a tienda y reparto; sin_deuda/excede del abono; ya_hay_saldo_inicial; los literales de éxito de aporte, abono y pago de un gasto; sin_saldo/excede del reparto. Con una mutación «ya_registrado → error» que muera.
2. **B2:** «Anulado» como texto en la fila anulada (desde documento.anulado), con test literal. Ayuda coherente con la pantalla.
3. **B3:** no pintar «Vigente» sin documento, con test sobre una fila egreso_pago_tienda con documento null.
4. **M3:** aviso ante un fallo de red o un estado desconocido, y clave nueva al cambiar de concepto.
5. **M1** anotado en tasks (458-E u otra ficha) y **M2** medido en un recorrido. Después, [x] en tasks, gate sobre HEAD y entrada en history.
