'use strict'
// Montagem do relatório: ordem dos capítulos.
module.exports = () => [
  ...require('./cap01-02')(),
  ...require('./cap03')(),
  ...require('./cap04')(),
  ...require('./cap05')(),
  ...require('./cap06')(),
  ...require('./cap07')(),
  ...require('./cap08')(),
  ...require('./cap09')(),
  ...require('./cap10')(),
  ...require('./cap11')(),
  ...require('./cap12')(),
  ...require('./cap13-15')(),
]
