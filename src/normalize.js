/* eslint-disable */
const parse = require('csv-parse/lib/sync')
import colors from 'colors'
import _ from 'lodash'
import writeCSV from 'write-csv'

import * as fs from 'fs'
import * as path from 'path'

const numbeoCsv = fs.readFileSync(path.resolve(__dirname, './../output/numbeo_world.csv'))
const expatCsv = fs.readFileSync(path.resolve(__dirname, './../output/expatistan_world.csv'))

let numbeoData = parse(numbeoCsv, { columns: true })
let expatData = parse(expatCsv, { columns: true })

let output = []
let citiesNotFound = []
let expandedObjects = []
let untouchedObjects = []

citiesNotFound = _.clone(expatData)

// match the contents of both arrays
for (let row of numbeoData) {
  let city = row.City, country = row.Country
  let match = expatData.filter(r => r.City === city && r.Country === country)

  if (match.length) {
    expandedObjects.push(_.assign(row, match[0]))
    _.remove(citiesNotFound, el => el.City === row.City && el.Country === row.Country)    
  } else {
    untouchedObjects.push(row)
  }
}

/**
 * Copy over elements in an orderly fashion.
 * Add an expanded object as the first element to ensure proper CSV output
 */

for (let expandedRow of expandedObjects) {
  output.push(expandedRow)
}
for (let untouchedRow of untouchedObjects) {
  output.push(untouchedRow)
}

output = _.orderBy(output, ['Country', 'City'])
output.unshift(_.first(expandedObjects))

// export CSVs
console.log(colors.bgGreen(`${output.length} elements | ${citiesNotFound.length} not found.`))
console.log(colors.yellow(`The first item has ${Object.keys(output[0]).length} keys.`))
writeCSV(path.resolve(__dirname, './../output/mixed_world.csv'), output)
