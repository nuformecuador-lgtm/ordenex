# Review 476 — Informe de picking por WhatsApp

- Revisado: `origin/feature/476-informe-picking-whatsapp` @ `689ce3d6` («gate --rapido verde con backend,
  arreglo contra Postgres y frontend integrados»), diff de tres puntos contra `origin/dev` (33 archivos).
- Fuentes: `specs/476-informe-picking-whatsapp/{requirements,design,tasks}.md`, `progress/impl_476.md`,
  `progress/gate_476.log`, `CHECKPOINTS.md`, maquetas `design-whatsapp/{ParamsPicking,PdfPicking}.dc.html`.
- Grafo `codebase-memory`: no hizo falta; los símbolos venían nombrados en la bitácora y se leyeron en los
  archivos reales (lectura completa de repo, informe, modelo, pdf, acción, panel y tests).

## Veredicto: **APROBADO** (para mergear a `dev`)

Ningún bloqueante de código. Igual que en las reviews 474 y 475, **antes de pasar a `done`** hay que
cerrar M1–M3 (tasks sin marcar, verificación visual T5.2 no hecha, cierre F6 + `history.md`): bloquean
el `done`, no el merge.

## Verificación ejecutada por mí

- `vitest run` de los 26 archivos de la 476 + motor + ParamsTransito + guardia `clave-remision`:
  `Test Files 25 passed | 1 skipped (26)`, `Tests 259 passed | 7 skipped`. El saltado es la integración
  (este worktree no tiene `DATABASE_URL`).
- `vitest related --run components/ui/radio-group.tsx lib/services/EjecucionEnvioService.ts
  lib/whatsapp-envios/informes/formato.ts lib/whatsapp-envios/informes/transito/pdf.ts` (las 8 pantallas
  del radio, la 474 y la 475): `Test Files 328 passed | 7 skipped (335)`, `Tests 4676 passed | 36 skipped`.
- `progress/gate_476.log` (leader, con `.env`): `INIT_EXIT=0`, modo rápido «normal» (no toca migraciones,
  schema ni `lib/types/`), 603 archivos, sin rojos nuevos; las dos integraciones de la 476 **corrieron**
  (`picking-ordenes-en-preparacion` 7 tests, `picking-resumen-tiendas` 3 tests, no `skipped`).
- PDF real: generé con `pdfDePicking` un picking de 70 órdenes (6 formas de producto, una vacía, una con
  U+1D552, una con guía, entradas de 0 a 4 días): `picking-gameos-tienda-2026-10-05.pdf`, totales
  ordenes 70, unidades 107, productos 6, atrasadas 28, sin excepción. **No pude mirarlo** (no hay
  `pdftoppm` en esta máquina): la comparación visual sigue pendiente (M2).
- No corrí `./init.sh` (regla 5 y orden del leader).

## Checklist (CHECKPOINTS.md)

### Especificación
- [x] `requirements.md` EARS R1–R30.
- [x] `design.md` con alternativas descartadas (A–G) y su porqué.
- [ ] `tasks.md` con todas marcadas: **0 marcadas** (M1).

### Trazabilidad
- [x] Cada R1–R30 mapea a un test que lo verifica de verdad (tabla abajo).
- [x] `progress/impl_476.md` contiene el mapa R a test (backend y pantalla).

### Calidad de código
- [x] typecheck / lint: verdes en el gate del leader (0 errores, 235 warnings preexistentes; ninguno en
  archivos de la 476 según la bitácora).
- [x] Tests: verdes (los míos y el gate). Integración contra Postgres verde en el gate, 0 skipped.
- [x] E2E: no aplica (no hay harness; no toca auth/pagos/recaudo/ingesta/webhooks).

### Datos y seguridad
- [x] Sin tablas nuevas (RLS no aplica), sin migraciones, sin enum, sin env vars.
- [x] Sin secretos. SQL con `Prisma.sql` (todo valor viaja como parámetro).
- [x] Sin webhooks nuevos.
- [x] `detalleDeCausa` solo expone `cause.name` y un `code` alfanumérico de hasta 20 caracteres; nunca el
  `message` de Prisma (que copia argumentos). Test con «secreto» en el mensaje y con `code` malicioso.
- [x] PDF sin datos sensibles extra: solo tienda, producto, remisión y (si existiera) guía. Ni
  destinatario, ni teléfono, ni dirección, ni montos.

### Capas
- [x] Repositorio solo SQL/Prisma; informe sin HTTP; modelo y maqueta PUROS; acción delgada
  (sesión, rol, zod, repo). Interfaz en `lib/interfaces/repositories/`.

### Permisos
- [x] `listarTiendasPicking`: rol mirado ANTES de construir el repo (R4; mutación U12 muerta); solo
  `maestro`. Los `deps` de la Server Action no se pueden inyectar desde el cliente (funciones no
  serializables).
- [x] Sin mutaciones nuevas; la acción es de lectura.

### Multi-país
- [x] Sin país/moneda hardcodeada nueva; hora CR por las utilidades existentes (`fecha-cr.ts`), igual que la 475.

### Verificación final
- [x] `./init.sh --rapido` verde (gate del leader).
- [ ] `progress/history.md` (M3, cierre del leader).

## Trazabilidad R a test (comprobada leyendo los tests)

| R | Test | Comentario |
| --- | --- | --- |
| R1 | `unit/whatsapp-envios/informe-picking.test.ts` «476/R1»; `catalogo-informes.test.ts` | clave, nombre, documento, no apto, sin eventos |
| R2 | `informe-picking.test.ts` «476/R2»; `unit/services/whatsapp-envio-service-picking.test.ts` | strict, 0/31/1.5/texto, default 2, guardar sin tienda da error en `parametros.tiendaId` |
| R3 | int `picking-resumen-tiendas.test.ts` (conjunto exacto, N=2 y N=5, cruce selector = generar, inactivas fuera); `components/ParamsPicking.test.tsx` (15 tests); `picking-modelo.test.ts` «476/R3» | real |
| R4 | `unit/actions/informe-picking-actions.test.ts` (sin sesión + 5 roles, fábrica del repo no llamada) | real |
| R5 | `whatsapp-envio-service-picking.test.ts` «476/R5» con el informe REAL | real |
| R6 | int «R6/R26», «R6: tienda sin fulfillment», «R6/R3 entradas» (ids exactos) + M1–M4 muertas | real |
| R7 | `informe-picking.test.ts` «476/R7» (4 casos, sin leer órdenes); `unit/services/ejecucion-envio-informe-error.test.ts` (motor: terminal, sin entregas/PDF/Meta, motivo en la fila); int «R7/R8», «R7 decisión del leader» | el historial pinta `e.motivo` en rojo para `error` (`HistorialEnvios.tsx:192`) |
| R8 | `informe-picking.test.ts` «476/R8» (texto exacto); int «R7/R8» | real |
| R9 | int «R30/R9» (`updated_at`/estado/historial idénticos; +1 día sigue; movida no) | real |
| R10–R13 | `picking-modelo.test.ts` | reusa `parsearProducto` de la 345 |
| R14 | `picking-modelo.test.ts` «476/R14» (23:50 CR, frontera 06:00 UTC); int «R14» (historial posterior vs `created_at`) + M7 (MAX por MIN) muerta | real |
| R15 | `picking-modelo.test.ts` «476/R15» + U2 (estricto por no estricto) muerta | real |
| R16–R22 | `picking-pdf.test.ts` (19 tests sobre `maquetarPicking` + humo `%PDF` y nº de páginas) | real |
| R23 | `picking-modelo.test.ts` «476/R23» | real |
| R24 | `informe-picking.test.ts` «R24» (`pdf` no llamado) | real |
| R25–R28 | `informe-picking.test.ts`, `picking-modelo.test.ts`, `picking-pdf.test.ts` «R27» | real |
| R29 | `unit/repositories/picking-repository.test.ts` (UNA `$queryRaw` con 1 y con 60 órdenes; forma LATERAL) | real |
| R30 | int «R30/R9» por `INFORMES_WHATSAPP.get("picking")` + M6 muerta | real |

## Foco pedido por el leader

- **SQL** (`PickingRepository.seleccionEnPreparacion`): `deleted_at IS NULL`, `s.value = 'en_preparacion'`,
  `t.fulfillment = true`, filtro de tienda parametrizado; `LEFT JOIN LATERAL` con `MAX(created_at)` por
  `estatus_destino_id = s.id` (última entrada, D5) y `COALESCE` a `o.created_at`; orden por
  `clave_remision, id`. Sin N+1. Rol `adminTienda` y `estado = activo` se comprueban en `tiendaDelPicking`
  ANTES de leer órdenes, y el selector solo cuenta las tiendas de `tiendasFulfillment` (activo +
  adminTienda + fulfillment). Correcto. Mutaciones M1–M9 medidas por el leader contra Postgres, todas muertas.
- **Parseo/agrupación**: `parsearProducto` + su `clave` (la 345); fusión por orden (R11) y forma visible
  (R12) replicadas con cita (alternativa E). «Sin producto indicado» al final, cuenta en órdenes y no en
  productos.
- **Días CR y estricto**: `diasNaturalesCRDesde` (calendario CR, nunca negativo) y `estaAtrasada` con
  comparación estricta, compartidas por PDF y selector (desvío 4: una sola definición; mejor que la del design).
- **PDF**: A4 vertical mm; «Página X de Y» en segunda pasada; cabecera repetida; fila «(continúa)» sin
  recortar; atrasadas legibles SIN color (bloque textual + sufijo «· Nd» en la ficha); `imprimible` cuenta
  por dato; Helvetica solo en rótulos fijos con test de `seguroEnFuenteEstandar`. Contenido comparado con
  `PdfPicking.dc.html`: mismo orden de piezas; diferencias = D1/D2 aprobadas (remisiones, pie sin «X e Y
  van en su propio PDF»).
- **Rama error**: una línea en el motor tras `vacio`, terminal; `generar` solo se consume en
  `EjecucionEnvioService` (comprobado por búsqueda); 474 y 475 verdes en `related` (328 archivos).
- **`radio-group.tsx`**: sin `detalle` el JSX es idéntico (`option.label` como antes); las 8 pantallas
  verdes en `related`.
- **m4 (`onNormalizar`)**: aplicado y con 2 tests.
- **Test de la 475 `picking` a `futuro`**: legítimo; el caso sigue siendo «panel desconocido».
- **Desvíos 1–8**: aceptables. 2 (panel en vez de catálogo) es necesario para leer `diasAtraso`; 3
  (`min(1)` en vez de `.uuid()`) es coherente con `usuario.id` String y la existencia se comprueba al
  generar (R7); 5 evita tocar `lib/types/` (cimientos).

## Hallazgos

### Bloqueantes
Ninguno.

### Mayores (bloquean `done`, no el merge)
- **M1 — `tasks.md` sin marcar (0 de 27).** Marcar las hechas; dejar abiertas T5.2, T6.1, T6.2.
- **M2 — T5.2 sin hacer: nadie ha VISTO ni el panel (escritorio y 390 px) ni el PDF real.** La bitácora
  frontend lo deja al leader; yo generé un PDF real sin error pero no pude renderizarlo. Memorias
  «verificar lo que el usuario ve» y «ver la app encuentra lo que la suite no». Hacer las capturas y
  compararlas con `ParamsPicking.dc.html` / `PdfPicking.dc.html` antes de `done`.
- **M3 — Cierre F6 + `progress/history.md`.** Checks del PR (build de Vercel) antes de mergear; tras
  desplegar, plantilla «de informe: Picking», un envío por tienda apagado y «Probar ahora», comparando
  ÓRDENES/UNIDADES con un conteo de solo lectura.

### Menores
- **m1 — `lib/whatsapp-envios/informes/transito/informe.ts:65-68` sigue memoizando el repo (`deps ??=`).**
  Mismo patrón que causó el P2028 en la 476. En producción es inocuo (`getPrismaClient()` es singleton);
  el riesgo es solo de tests que rediriguen `getPrismaClient` en dos o más tests del mismo archivo. Es de
  la 475, fuera de alcance: arreglo aparte de 2 líneas, no bloquea la 476.
- **m2 — Pie del PDF sin partir:** el sello «Ordenex · Picking (tienda) · (fecha) (hora)» no se mide; una
  tienda de nombre muy largo puede pisar «Página X de Y» a la derecha.
- **m3 — Sesión caducada se pinta como permiso:** `unauthenticated` cae en `sin_permiso` y dice «Solo un
  maestro puede ver las tiendas del picking.» (y no vuelve a pedir). Mensaje engañoso para un maestro con
  la sesión vencida.
- **m4 — a11y:** el `RadioGroup` con error de tienda pone `aria-invalid` pero sin `aria-describedby` al
  `FieldError` (el número sí lo enlaza).
- **m5 — Cosmético frente a la maqueta:** ficha atrasada «· 3d» (maqueta «· 3 d»); casilla con borde gris
  (maqueta tinta).
- **m6 — Disposición de archivos distinta del design §4.1** (`picking/` en subcarpeta, `fechaLargaCR`
  movida a `formato.ts`, panel `ParamsPicking` en vez de `SelectorTiendaPicking`) sin declararse como
  desvío. Inocuo; la trazabilidad usa los nombres reales.
