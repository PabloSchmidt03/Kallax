const fs = require('fs')

const config = `window.APP_CONFIG = {
  dg_token:  '${process.env.DG_TOKEN  || ''}',
  yt_key:    '${process.env.YT_KEY    || ''}',
  groq_key:  '${process.env.GROQ_KEY  || ''}',
}
`

fs.writeFileSync('config.js', config)
console.log('config.js generado desde variables de entorno.')
