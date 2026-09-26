# 458-E — Recorrido del libro de caja (design §10, pasos que tocan `/wallet`) · 2026-09-26

Playwright ad hoc (`@playwright/test`, script fuera del árbol) contra UN dev server (`next dev -p 3471`,
`.next` borrado antes, apagado al terminar) sobre la base propia `ordenex_458e` (clon de `ordenex`).
Usuarios `maestro.qa`, `admin.qa`, `tienda.qa`, con las claves QA rotadas SOLO en el clon. Salida cruda:
`maestro.json`, `admin.json`, `tienda.json`. Sobre `c36b2efc` (458-E + la revisión de la 458-C);
`maestro-09` sobre `e35d3c01`.

| Rol | Paso | Resultado | Números |
| --- | --- | --- | --- |
| maestro | E.1 columnas | OK | `Desglose · Fecha · Movimiento y motivo · A quién · Monto · Registró · Ver` (`maestro-01-libro.png`) |
| maestro | E.1 «A quién» / «Registró» | OK | cierre: «Quino QUEPOS» (enlace, nombre accesible «Quino QUEPOS · estado de cuenta del mensajero», `href /wallet/mensajeros/<uuid>`) · «Automático · Aprobación del cierre por Sat QUEPOS»; sueldo nuevo: «Pedro Recorrido maestro» · «Maestro QA» |
| maestro | E.1 sin ids | OK | uuid en el texto de la tabla: no; en `aria-label`: no (solo en `href`) |
| maestro | 1 tarjetas | OK | «Flujo de dinero registrado ₡13.483.932,72» · Entró 13.524.733,22 · Salió 40.800,50 · 36 movimientos = la SQL (cifra 13.483.932,72, entró 13.524.733,22, salió 40.800,50) |
| maestro | E.2 «Entra» | OK | `aria-pressed=true`; 29 movimientos (1-20 de 29), todas las filas «Entra»; tarjeta «Movimiento neto del periodo ₡13.524.733,22», Salió ₡0 |
| maestro | E.2 «Sale» | OK | 7 movimientos, todas «Sale»; «Movimiento neto del periodo -₡40.800,50», Entró ₡0 |
| maestro | E.2 «Todo» | OK | 36 de nuevo; «Flujo de dinero registrado ₡13.483.932,72» |
| maestro | 1 concepto con cuenta | OK | «Flete cobrado a la tienda (5)», «Corrección de caja (suma) (2)», «Ordenex le paga a un mensajero (4)»…; con «Entra» solo los de entrada (8 conceptos); «Otro gasto de Ordenex» no aparece |
| maestro | E.2 periodo (hoy CR) | OK | 0 movimientos, tarjeta «Movimiento neto del periodo En cero ₡0» |
| maestro | 2/3 registrar sueldo 12.345 a «Pedro Recorrido maestro» | OK | fila nueva arriba SIN recargar: «Sueldo · Sueldo recorrido 458-E (maestro)» · «Pedro Recorrido maestro» · «Sale ₡12.345 Ordenex» · «Maestro QA»; tarjeta 13.483.932,72 → 13.471.587,72 |
| maestro | 3 «Ver» | OK | panel: A quién, Por qué, De dónde sale, Cómo «—», Comprobante, Registró «Maestro QA», Estado «Vigente», «Cómo quedó» ₡13.471.587,72 / ganancia ₡13.323.917,62 |
| maestro | 3 «Anular…» | OK | sin recargar: contra-asiento «Corrección de caja (suma) · Anulación de: Sueldo recorrido 458-E (maestro)» ₡12.345 arriba; el original tachado con la insignia «Anulado» (no tachada, `maestro-09`) ; tarjeta de vuelta a ₡13.483.932,72 |
| maestro | 3 panel del anulado (pendiente de la 458-C) | OK | «Estado Anulado el 2026-09-26 por Maestro QA · Recorrido 458-E (maestro): registrado para probar»; 0 botones «Anular…» |
| maestro | 9 descarga | OK | `libro-de-movimientos-2026-09-26.xlsx`; cabecera `Fecha · Movimiento · Motivo y origen · A quién · Entra o sale · Monto · Dueño · Registró`; 38 filas; uuid en celdas o nombre: **no**; monto «12345.00» (texto del servidor) |
| admin | los mismos pasos | OK | 38 movimientos; «Entra» 30, «Sale» 8; sueldo 11.111 «Pedro Recorrido admin» · «Ana Admin»; anulado «Anulado el 2026-09-26 por Ana Admin · …»; descarga 40 filas sin uuid |
| adminTienda | `/wallet`, `/wallet/tiendas` | OK | HTTP 404 y 404 («No encontramos esta página»), 0 tablas del libro |

## R7 / R8 — `progress/recorrido_458-C/c458c-1.sql` (solo lectura, contra el clon)

| Momento | cifra | ganancia | De las tiendas | Σ saldos | R8 | R7 |
| --- | --- | --- | --- | --- | --- | --- |
| antes (maestro) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras registrar el sueldo (maestro) | 13.471.587,72 | 13.323.917,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras anularlo (maestro) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras registrar (admin) | 13.472.821,72 | 13.325.151,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |
| tras anular (admin) | 13.483.932,72 | 13.336.262,62 | 147.670,10 | 147.670,10 | 0,00 | 0,00 |

Seis medidas, todas `0,00`. «Entró» sube 12.345 / 11.111 al anular (bruto, como desde la 45).

## Hallazgo del recorrido, arreglado

La insignia «Anulado» que la revisión de la 458-C puso en la celda de «Ver» salía TACHADA (la celda era
`flex` y hereda el tachado de la fila). Pasa a `inline-flex` (`e35d3c01`): medido
`text-decoration-line: none` en la insignia y fila con `line-through` (`maestro-09-fila-anulada-insignia.png`).

## Notas

- «Movimiento y motivo» del sueldo dice «Sueldo» dos veces («Sueldo» concepto + «Sueldo · <motivo>» origen de la 458-A): es la composición del design, no un error; se anota por si se quiere acortar.
- El contra-asiento de un sueldo dice «A quién: —» (no lleva anotación): es lo que fija design §3.4.
- El botón de cerrar del panel (`Sheet` de shadcn) se anuncia «Close» en inglés: ajeno a la 458-E.
- Un aviso ajeno («Confirmá el SINPE de GAM») se abre al entrar a `/wallet` con el maestro; el script lo cierra con «Ahora no».
- El cobro por rechazo anulado (TE.4) no se re-midió en vivo: lo midió la 458-C (paso 7) y aquí lo cubre `WalletLibroCaja458E.test.tsx` (T E.4) + `wallet-anulacion-458.test.ts` (R73, contra Postgres).
