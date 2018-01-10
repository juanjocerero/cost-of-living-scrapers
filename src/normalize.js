/* eslint-disable */
const parse = require('csv-parse/lib/sync')
import colors from 'colors'

import * as fs from 'fs'
import * as path from 'path'

const numbeoCsv = fs.readFileSync(path.resolve(__dirname, './../output/numbeo_spain.csv'))
const expatCsv = fs.readFileSync(path.resolve(__dirname, './../output/expatistan_spain.csv'))

const numbeoData = parse(numbeoCsv, { columns: true })
const expatData = parse(expatCsv, { columns: true })

for (let city of expatData) {
  
}
