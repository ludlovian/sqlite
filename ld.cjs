import('./src/index.mjs')
  .then(mod => {
    global.Database = mod.default
    console.log('Database loaded')
  })
