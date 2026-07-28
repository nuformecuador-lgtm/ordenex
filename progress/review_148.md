# Feature 148 — Manifiesto Excel al crear o mover órdenes · REVIEW

Revisor: agente `reviewer`. Fecha: 2026-07-28.
Worktree: `../ordenex-wt-148`, rama `feature/148-manifiesto-excel-lotes`, 16 commits sobre
`origin/dev` @ `55b0cd4`. Diff revisado: `git diff origin/dev...HEAD` (44 archivos, +4196 / -48).

## VEREDICTO: RECHAZADO — 2 bloqueantes, 8 menores

El trabajo técnico es sólido: la trazabilidad R1–R30 es real (verificada abriendo los tests,
no leyendo las bitácoras), las líneas rojas del gate se respetan, la prueba por mutación mata
tests en las 6 invariantes probadas y los números declarados cuadran exactamente con los que
medí. Los 2 bloqueantes son de cierre, no de diseño, y ambos se arreglan sin tocar la lógica.

---

## 1. Verificación ejecutable (medida por MÍ, no por las bitácoras)

| | Baseline declarado (55b0cd4) | Final declarado | Medido por el reviewer | Delta |
|---|---|---|---|---|
| pnpm typecheck | 0 errores | 0 errores | **0 errores** | 0 |
| pnpm lint | — | 0 errores / 145 warnings | **0 errores / 145 warnings** | 0 |
| pnpm test --run | 518 archivos / 5308 tests | 524 / 5400, 0 fallos | **524 archivos / 5400 tests** | **+6 archivos / +92 tests** |
| ./init.sh | — | verde | **verde (exit 0)**, con la suite 524/5400 y **0 fallos** | — |

+92 = +57 (backend: 32+11+14) +35 (frontend: 7+8+9+11). Cuadra al test.
**Delta de regresiones = 0.** Ningún test ajeno cambió de estado.

Nota sobre una corrida: en mi PRIMERA ejecución de `pnpm test --run` cayó 1 test,
`tests/integration/recuperar-contrasena-form.test.tsx` (findByText con timeout bajo carga).
Reejecutado en aislamiento: 7/7 verde. Y la corrida completa de `./init.sh` dio
**524/524 archivos, 5400/5400 tests, 0 fallos**. Es flake ajena a la 148 (menor 7).

---

## 2. Prueba por MUTACIÓN

Se rompió a propósito una invariante y se comprobó qué tests mueren. Los archivos mutados se
restauraron desde copia de respaldo; `git status --porcelain` quedó vacío al terminar.

| # | Mutación introducida | Resultado | Tests que murieron |
|---|---|---|---|
| A | Invertir origen/destino de `carga_masiva` (fila 1 de la tabla del §4): tienda→central pasa a central→tienda | **KILL (2)** | "carga_masiva: TIENDA -> CENTRAL, responsable el actor"; "sin zona central configurada, origen/destino caen al literal de respaldo" |
| B | `responsable` usa SIEMPRE el actor aunque haya mensajero asignado (2 ramas) | **KILL (3)** | "generacion_guia, orden GAM CON mensajero..."; "asignacion_satelite: ZONA -> ZONA, responsable el mensajero"; "responsable es el mensajero asignado..." |
| C | `esVisiblePara` devuelve true siempre: se quita el acotamiento por tienda del actor apiKey (R29) | **KILL (2)** | "con actor apiKey solo incluye ordenes de su tienda"; "una API key de otra tienda no obtiene NINGUNA fila del lote" |
| D | Alterar el orden de las 11 columnas (origen/destino permutadas en COLUMNAS_MANIFIESTO) | **KILL (2)** | "R2: la cabecera trae las 11 columnas pedidas, en el orden pedido"; "R4/R6/R7: vuelca los valores de la fila en su columna" |
| E | El diferimiento pierde el refresco: `handleOpenChange` de GenerarGuiaModal deja de llamar `onSuccess()` | **KILL (5)** | "R25: un fallo de la descarga NO re-ejecuta..."; 2 de GenerarGuiaModal.test.tsx; **2 de OrdenesListadoEtiquetasChain.test.tsx (feature 95)** |
| F | El fallo de la descarga se traga en silencio (se quita el toast.error del catch) | **KILL (2)** | "R26: si la generación del binario lanza, se informa..."; "R25: un fallo de la descarga NO re-ejecuta..." |

**Ninguna mutación quedó viva: no hay tests decorativos en las invariantes probadas.**
La mutación E es la más informativa: demuestra que los 3 tests ajustados de la feature 95
siguen siendo aserciones VIVAS y que la garantía de refresco del padre está genuinamente
cubierta, no relajada.

---

## 3. Trazabilidad R1–R30 → test (verificada abriendo cada test, no la bitácora)

| R | Test que lo ejercita de verdad |
|---|---|
| R1 | manifiesto-service › "arma las filas de los 6 flujos con el mismo servicio" (itera MANIFIESTO_FLUJOS y asserta 11 claves) + "la carga masiva usa el MISMO servicio por num_remision" |
| R2 | manifiesto-service › "no expone ids internos..." (Object.keys EN ORDEN); manifiesto-xlsx › "la cabecera trae las 11 columnas... en el orden pedido" (+ columnCount === 11). Matado por mutación D |
| R3 | manifiesto-service › "devuelve N filas... en el orden en que se pidieron" (el repo devuelve en otro orden a propósito) + "un id repetido no duplica la fila"; manifiesto-xlsx › "emite una fila de datos por orden" |
| R4 | orden-repository.manifiesto › "proyecta guia, remision, destinatario, telefono y direccion"; manifiesto-service › idem a nivel de fila |
| R5 | manifiesto-service › "deja num_guia vacio..."; manifiesto-xlsx › "sin guía y sin monto las celdas quedan VACÍAS" (lee la celda del binario recargado) |
| R6 | manifiesto-service › "usa el nombre de la zona, no su id" (+ afirma que ningún id de zona se filtra) |
| R7 | 3 casos: null → vacío, 0 → 0 (no vacío), 25.5 → propaga; repo › Decimal → number |
| R8 | **8 casos, uno por fila de la tabla del §4** + el respaldo "Bodega central". Matados por mutación A |
| R9 | "responsable es el mensajero..." / "...es el usuario que ejecutó" + repo › findUsuarioNombre. Matados por mutación B |
| R10 | Reloj fijo 2026-07-16T02:00Z → 2026-07-15; asserta explícitamente que NO es toISOString().slice(0,10) (off-by-one) |
| R11 | service › Object.keys exacto + JSON.stringify sin id de orden/tienda/deleted; repo › el select NO pide deletedAt/notas/producto/geografía; xlsx › un campo ajeno no llega al archivo |
| R12 | service › omite y reporta sin abortar (x2); repo › deletedAt null en ambos where; botón › avisa cuántas quedaron fuera y descarga igual |
| R13 | manifiesto-xlsx › round-trip REAL con ExcelJS.Workbook.load, 1 sola hoja, valores leídos por celda |
| R14 | manifiesto-xlsx › manifiesto-flujo-fecha.xlsx (x2); botón › lee el anchor.download real del DOM |
| R15 | DescargarManifiestoButton › Blob con MIME XLSX + anchor.click + revokeObjectURL, y **expect(fetch).not.toHaveBeenCalled()** |
| R16 | botón › promesa suspendida, toBeDisabled, 2º clic ignorado, obtenerManifiesto llamado 1 vez |
| R17 | botón › selección vacía no renderiza (ids y remisiones) + 0 filas no genera archivo; buildManifiestoXlsx([]) lanza; ManifiestoFlujos › nuevasCount 0 y la sección "En tránsito" sin envío previo |
| R18–R23 | ManifiestoFlujos, un test por flujo, cada uno asserta el {flujo, seleccion} exacto que viaja a la action. **R22 comprueba que la orden que falló (d2) NO entra: ordenIds ["d1"]** |
| R24 | service › **Proxy** que registra CUALQUIER acceso fuera de los 3 métodos de lectura, en los 6 flujos + la vía por remisiones; action › Object.keys(service) === ["armar"] |
| R25 | ManifiestoFlujos › la action del manifiesto rechaza y se comprueba generarGuia 1 vez, success 1 vez, el resumen sigue en pantalla y onSuccess ocurre al cerrar. Matado por mutaciones E y F |
| R26 | botón › mensaje accionable por causa (/vuelve a iniciar sesión/, /vuelve a intentarlo/) y rehabilitación. Matado por mutación F |
| R27 | Por diff (los 5 services no aparecen) + ManifiestoFlujos › input y toast idénticos + los tests propios de los 5 modales, verdes con sus mismas aserciones |
| R28 | manifiesto-action › unauthenticated sin tocar el service, **y antes de validar la entrada** (el resultado no contiene la remisión enviada) |
| R29 | 5 tests de service (apiKey propia/ajena, rol de sesión sí ve, vía remisión acotada a actor.usuarioId) + repo › tiendaId en el where. Matados por mutación C |
| R30 | manifiesto-action › **9 casos** parametrizados (vacíos, string vacío, flujo inventado, flujo ausente, sin selección, no-array, remisiones en flujo no-masivo, input no-objeto), todos sin tocar el service |

**30/30 requisitos con al menos un test que realmente los ejercita. Sin huecos.**

---

## 4. Líneas rojas del gate

- **R27 / D-gate-1 — los 5 servicios de negocio INTACTOS.** Verificado contra el diff, no
  contra las bitácoras: `git diff --stat origin/dev...HEAD` NO lista BulkOrdenService.ts,
  GuiaAsignacionService.ts, AsignacionSateliteService.ts, EnvioDevolucionCentralService.ts
  ni DevolucionOrigenService.ts. Tampoco sus interfaces ni la ruta del chunk de carga
  masiva. El lote de los flujos 4 y 5 se acumula en la UI (enviadasIds /
  ultimoEnvioACentral), como cerró el §9.1. **CUMPLE.**
- **R25 — un fallo de la descarga no re-ejecuta, no revierte y no cambia el resultado.**
  Probado de verdad (mutaciones E y F, más el test que hace rechazar obtenerManifiesto).
  Además es cierto POR CONSTRUCCIÓN: el botón no tiene ninguna referencia a la acción de
  negocio y su catch solo dispara un toast; handleOpenChange (donde vive onSuccess) no se
  atraviesa desde el catch. **CUMPLE.**
- **D3 — cero migraciones, cero db/schema.prisma, cero RLS nueva.** El diff no toca db/**.
  ./init.sh confirma "todas las migraciones tienen down.sql". **CUMPLE.**
- **D1 — generación en CLIENTE, exceljs con import dinámico DENTRO de la función, sin
  Storage ni endpoint de archivos.** buildXlsxRows hace
  `const ExcelJS = (await import("exceljs")).default` dentro del cuerpo
  (lib/utils/xlsx-template.ts:184); el botón además importa manifiesto-xlsx de forma
  dinámica. El binario se envuelve en Blob + anchor en components/shared/descargar-blob.ts
  y el test afirma que fetch no se llama. No hay ruta de API ni bucket. **CUMPLE.**

---

## 5. Los 3 cambios NO previstos en design.md

1. **findUsuarioNombre en IOrdenRepository — JUSTIFICADO.** R9/§9.8 exige el NOMBRE del
   ejecutor y Actor solo lleva { usuarioId, rol }. Resolverlo en el borde metería Prisma
   dentro de la Server Action (violaría el patrón de capas). Precedente exacto en la MISMA
   interfaz: findUsuarioFulfillment, findUsuarioZonaId, findUsuarioVehiculoId. Es
   estrictamente aditivo (ninguna firma existente cambió) y está cubierto por 2 tests de
   repo. NO es alcance de más. Coste real: +3 stubs en 5 suites ajenas (ver §6).
2. **components/shared/ManifiestoResultado.tsx — JUSTIFICADO.** 4 consumidores (la regla de
   docs/architecture.md para shared/ pide 2 o más), y NO duplica ni el mapeo de columnas
   (vive en el servicio único, R1) ni la mecánica de descarga (sigue en UN solo botón, con
   lo que la alternativa E descartada en el §7 se respeta). Es composición, no lógica.
   NO es alcance de más.
3. **onSuccess() diferido al cierre de la fase "resultado" — JUSTIFICADO Y FORZOSO, pero con
   un efecto colateral no cerrado (bloqueante 2).** El onSuccess de los padres cierra el
   modal y refresca; invocarlo al confirmar destruiría la fase donde vive el botón que el
   humano aprobó en el §9.7. La implementación envuelve onOpenChange para cubrir el cierre
   por CUALQUIER vía (botón, Escape, overlay), así que ninguna de las garantías de refresco
   se pierde:
   - Refresco de listados / router.refresh(): intacto, solo posterior. La mutación E lo prueba.
   - Invalidación de SWR: OrdenesCargaResumen (SWR) no vive en un modal; no le afecta.
   - Contadores / navegación: RecepcionSateliteModule no es modal; su refresco (enviadas,
     limpieza de la selección, toasts) ocurre exactamente cuando ocurría.
   - Encadenado a "Imprimir etiquetas" (feature 95): sigue ocurriendo, ahora tras el cierre.

   Los 3 tests ajustados NO se relajaron: conservan íntegras todas sus aserciones
   (generarGuiaMock 1 vez, el diálogo de etiquetas con el MISMO lote, "cerrar el modal de
   etiquetas termina el flujo") y solo añaden un click en "Cerrar". La mutación E mata 2 de
   ellos, así que siguen siendo aserciones vivas.

   PERO el efecto colateral se cerró solo para los tests de vitest y se dejó fuera el único
   E2E que confirma uno de esos modales. Ver BLOQUEANTE 2.

---

## 6. Los 12 tests ajenos tocados, uno por uno

**Backend (5 suites, +4 líneas cada una)** — asignacion-mensajero-service,
bulk-orden-service, bulk-orden-service.carga-api, orden-service, rol-admin-satelite-authz:
las cinco declaran el repo como objeto literal EXHAUSTIVO de IOrdenRepository, así que
cualquier método nuevo en la interfaz las rompe en typecheck. Se añadieron 3 stubs
vi.fn() en cada una. **Ninguna aserción tocada, ningún expect eliminado ni aflojado.**
Adaptación mecánica legítima.

**Frontend (7 suites):**
- GenerarGuiaModal (2 tests), AsignarBodegaModal, AsignarSateliteModal, RutearSateliteModal,
  DevolverATiendaModal (1 cada uno): se añade un click en "Cerrar" ANTES del waitFor de
  onSuccess ya existente. Las aserciones previas (toHaveBeenCalledWith del input de negocio,
  el texto exacto del toast, onSuccess EXACTAMENTE 1 vez) quedan idénticas.
  Adaptación, no aflojamiento.
- OrdenesListadoEtiquetasChain (3 tests, feature 95): igual, un click en "Cerrar" dentro del
  diálogo correcto (within(guiaDialog) / within(asignarDialog)) antes de esperar el diálogo
  de etiquetas. Se conservan generarGuiaMock 1 vez, la comprobación de que el lote encadenado
  es el mismo y que cerrar etiquetas termina el flujo. **La mutación E las mata, luego no son
  decorativas.**
- BulkUpload (T21): el doble de @/lib/utils/xlsx-template reexpone XLSX_MIME con EL MISMO
  valor literal que tenía la constante local borrada; los tests de MIME y de nombre de
  archivo siguen intactos. Cambio obligado por el import dinámico. Legítimo.

**Ningún test ajeno perdió una aserción.** Revisado línea a línea sobre el diff.

---

## 7. Checklist de CHECKPOINTS.md

| Ítem | Estado |
|---|---|
| requirements.md con EARS numerados | OK (R1–R30) |
| design.md con alternativa descartada y su porqué | OK (§7: 5 alternativas A–E con su razón) |
| tasks.md con TODAS las tasks [x] | **FALLA — BLOQUEANTE 1** (las 22 siguen en [ ]) |
| Cada R mapea a 1 o más tests concretos | OK 30/30, verificado abriendo los tests |
| progress/impl_<feature>.md con el mapa R → test | PARCIAL — menor 1 (partido en 2 archivos) |
| pnpm run typecheck sin errores | OK, 0 |
| pnpm run lint sin errores | OK, 0 errores / 145 warnings (igual que el baseline) |
| pnpm test pasa | OK, 524/5400, 0 fallos en la corrida de ./init.sh |
| E2E si toca flujo crítico | **FALLA — BLOQUEANTE 2** (el E2E del flujo tocado quedó desalineado) |
| RLS en tabla nueva | n/a (D3: sin tabla) |
| Migraciones reversibles | n/a (cero migraciones); ./init.sh valida los down.sql |
| Sin secretos hardcodeados | OK |
| Webhooks con firma / idempotencia | n/a |
| Controller sin queries ni lógica | OK: lib/actions/manifiesto.ts es zod + actor + delegación |
| Service sin HTTP | OK: ManifiestoService recibe repos por constructor; no importa next/headers ni Prisma |
| Repository solo queries | OK: WITH_MANIFIESTO + serializador, sin lógica de negocio |
| Interfaces en lib/interfaces/ por categoría | OK: services/IManifiestoService.ts, repositories/IOrdenRepository.ts |
| Páginas protegidas validan en servidor | OK (sin rutas nuevas; la action exige sesión, R28) |
| private/ recibe datos por props | OK |
| Mutaciones por Server Actions, no fetch | OK (es un READ, y va por Server Action) |
| Sin hardcode de país, moneda ni cuenta | OK (el literal "Bodega central" es el respaldo aprobado en el §9.2, no un dato de contexto) |
| ./init.sh en verde | OK, exit 0 |
| progress/review_<feature>.md con veredicto OK | **FALLA** — este archivo: RECHAZADO |
| Entrada en progress/history.md | FALTA — menor 2 (cierre del leader) |

---

## 8. Hallazgos

### BLOQUEANTE 1 — tasks.md: las 22 tareas siguen sin marcar

specs/148-manifiesto-excel-lotes/tasks.md tiene **T1–T22 en [ ]**, ninguna en [x], pese a
que todas están ejecutadas (verificado contra el diff y contra los commits).
CHECKPOINTS.md > Especificacion lo exige literalmente: "todas las tasks estan marcadas [x]".
Fue el mismo bloqueante de la feature 140.

**Qué falta para cumplirlo:** marcar [x] las 22 tareas. Si alguna se considera no completada,
decirlo explícitamente en la bitácora en vez de dejarla ambigua.

### BLOQUEANTE 2 — el E2E asignacion-satelite.spec.ts no se adaptó a la fase "resultado"

El diferimiento de onSuccess() cambia el comportamiento observable de los 4 modales, y hay un
E2E que confirma uno de ellos y NO se tocó: e2e/asignacion-satelite.spec.ts:94-105, test
"seleccionar orden recibida -> Asignar mensajero -> por_recoger".

Dos roturas concretas, ambas causadas por esta feature:

1. **Línea 97 — violación del strict mode de Playwright.**
   `await expect(page.getByText(/Mensajero asignado a/i)).toBeVisible();`
   Tras el cambio ese texto aparece DOS veces: en el toast (toast.success(mensaje)) y en el
   Alert role="status" de ManifiestoResultado, que recibe EL MISMO string. En
   AsignarSateliteModal.tsx: `const mensaje = ...; toast.success(mensaje);
   setResultado({ ordenIds, mensaje })`. page.getByText en modo estricto falla con
   "resolved to 2 elements".

2. **Líneas 99-105 — la aserción ya no mide lo que dice.**
   `await expect(recibidas.getByRole("checkbox", { name: ... })).toHaveCount(0);`
   con el comentario "After router.refresh(), the order left Recibidas". Ese router.refresh()
   va dentro de onSuccess y YA NO ha ocurrido en ese punto: ahora se dispara al cerrar la
   fase "resultado". El diálogo abierto marca el fondo con aria-hidden, así que el
   toHaveCount(0) puede pasar POR EL MOTIVO EQUIVOCADO (elemento fuera del árbol de
   accesibilidad, no porque la orden haya transicionado). El test dejaría de verificar la
   transición en_bodega_satelite -> por_recoger, que es justo lo que dice cubrir.

Como los E2E de Playwright no corren en `pnpm test` ni en `./init.sh`, esto NO aparece en
rojo en ninguna corrida: por eso hay que arreglarlo antes del merge, no después.

**Qué falta para cumplirlo:** añadir el click en "Cerrar" tras confirmar (igual que se hizo
en los 7 tests de vitest) y reafirmar la salida de "Recibidas" DESPUÉS de ese cierre;
desambiguar la aserción del toast (acotarla al contenedor del toast, o usar .first() con la
razón escrita). Y dejar constancia en la bitácora del frontend de que el efecto colateral del
diferimiento alcanza también a la capa E2E, no solo a los 12 tests de vitest declarados.

### Menores

1. **menor — el mapa R → test está partido en dos archivos.** T22 pedía
   progress/impl_148-manifiesto-excel-lotes.md con el mapa R1..R30; existen
   impl_148_backend.md (R1–R12, R24, R27–R30) e impl_148_frontend.md (R2–R3, R5, R7,
   R11–R23, R25–R27). Entre los dos está completo y ambos son honestos sobre su mitad, pero
   no hay un único mapa consolidado como exige CHECKPOINTS.md > Trazabilidad.
2. **menor — falta la entrada en progress/history.md.** Es tarea de cierre del leader, pero
   está en la checklist.
3. **menor — design.md §4 afirma que num_remision es único POR TIENDA**; en db/schema.prisma
   es @unique GLOBAL. Ya lo declaró el backend_dev (su deuda 3). No cambia el código (acotar
   por tiendaId sigue siendo lo correcto por R29), pero el design queda con una afirmación
   inexacta.
4. **menor — asignacion_satelite añade un respaldo que la tabla del §4 no contempla.**
   ubicacionesDe devuelve `responsable: mensajero ?? ctx.actor`, mientras la tabla dice
   MENSAJERO seco. Es defensivo y razonable (una asignación siempre deja mensajero), pero
   NINGÚN test fija ese respaldo: si la rama `?? ctx.actor` desapareciera, la suite seguiría
   verde. Cubrirlo o eliminarlo.
5. **menor — responsable vacío ("") si findUsuarioNombre devuelve null**
   (ManifiestoService.armar:153). Documentado como deuda por el backend_dev, sin test que lo
   fije. Emitir "" es coherente con el §9.8 (que prohíbe textos de rol), pero conviene
   decidirlo explícitamente.
6. **menor — manifiestoSchema es un z.union de objetos no estrictos.** Una entrada
   { flujo: "carga_masiva", ordenIds: [...], numRemisiones: [...] } casa con la PRIMERA rama
   y numRemisiones se ignora en silencio. No es alcanzable desde la UI (el botón manda una
   sola forma de selección), pero el borde no es tan cerrado como sugiere R30.
7. **menor — flake ajena.** tests/integration/recuperar-contrasena-form.test.tsx falló una vez
   bajo carga (findByText con timeout) en mi primera corrida completa, y pasó aislada (7/7) y
   dentro de ./init.sh (524/524 archivos). No es de la 148 ni de su diff; queda anotada porque
   puede reaparecer en CI.
8. **menor — el botón del último envío a central persiste.** En RecepcionSateliteModule el
   botón "Descargar manifiesto del último envío" queda visible indefinidamente tras el envío
   (hasta recargar la página), sin distinguir "recién enviado" de "hace media hora". Ya
   declarado como limitación (bitácora frontend, deuda 3); es una decisión de UX que conviene
   que el humano vea en vivo.

---

## 9. Qué NO es hallazgo (revisado y correcto)

- El orden de hooks en DescargarManifiestoButton (el `return null` de R17 va DESPUÉS del
  useState): correcto, no rompe las reglas de hooks.
- `montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null`: un Decimal(0) es un
  objeto y por tanto truthy, así que el 0 NO se convierte en null. Además hay un test
  explícito ("un monto de cero se emite como 0, no como celda vacia").
- El `deps` como segundo parámetro de la Server Action: precedente exacto en
  lib/actions/etiquetas-guia.ts:60.
- DevolverATiendaModal lanza al primer error y por tanto no llega a la fase "resultado" en
  fallo parcial: es el comportamiento PREVIO, no lo introduce esta feature, y hay un test que
  lo fija ("si el envío a la tienda falla, no hay fase de resultado ni manifiesto").
- El conflicto previsto con la feature 143 (design.md §5) no se materializó: buildXlsxRows y
  XLSX_MIME no existían en esta base. Sigue siendo un riesgo de merge si la 143 aterriza
  después; la nota del design cubre cómo resolverlo.

---

## 10. Resumen para el leader

**RECHAZADO por 2 bloqueantes, ambos de cierre y baratos:**

1. Marcar las 22 tareas de specs/148-manifiesto-excel-lotes/tasks.md como [x].
2. Adaptar e2e/asignacion-satelite.spec.ts a la fase "resultado" (click en "Cerrar" antes de
   comprobar la salida de "Recibidas", y desambiguar la aserción del texto "Mensajero
   asignado a", que ahora aparece dos veces), y registrar en la bitácora del frontend que el
   efecto colateral del diferimiento alcanza también a la capa E2E.

Vuelve al frontend_dev. **No hay nada que rehacer en la lógica:** los 30 requisitos están
trazados a tests vivos, las 4 líneas rojas del gate se cumplen, las 6 mutaciones murieron,
los 12 tests ajenos son adaptaciones legítimas y el delta de regresiones es 0.
