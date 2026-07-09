# docs/verification.md — Cómo demostrar que funciona

"Compila" y "el agente dice que está listo" NO son verificación. Una feature está
verificada cuando hay evidencia ejecutable.

## Comandos de verificación
```bash
npm run typecheck   # TypeScript strict, cero errores
npm run lint        # ESLint, cero errores
npm test            # unit + integracion
npm run test:e2e    # Playwright, flujos criticos (si aplica)
./init.sh           # corre todo lo anterior + valida el estado del arnes
```

## Qué cuenta como evidencia
- Salida real de los tests pasando, pegada en `progress/impl_<feature>.md`.
- El mapa `R<n> → test`: para cada requisito, el test que lo cubre.
- Para features con UI o flujo crítico: un test E2E que ejercita el camino
  completo, no solo un unit test del helper.

## Qué NO cuenta
- "Debería funcionar."
- Un test que no asegura nada (sin asserts reales).
- Tests que el implementer escribió para pasar, sin cubrir el requisito.

## Datos (Supabase)
- Verifica RLS con un test que intente acceder sin permiso y confirme el rechazo.
- Verifica migraciones aplicando y revirtiendo en un entorno de prueba.

## Regla del reviewer
Si un requisito no tiene test, o un test no verifica el requisito que dice cubrir,
es hallazgo bloqueante. La feature no pasa a `done`.
