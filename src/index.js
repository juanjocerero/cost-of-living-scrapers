/* eslint-disable */
import puppeteer from 'puppeteer'
import colors from 'colors'
import writeCSV from 'write-csv'
import _ from 'lodash'
import * as path from 'path'

(async () => {
  const BASE_URL = 'https://www.numbeo.com/cost-of-living/'
  const CITIES_BASE_URL = 'https://www.numbeo.com/common/form.jsp?country=__COUNTRY__&returnUrl=%2Fcost-of-living%2Fcountry_result.jsp%3Fcountry%3D__COUNTRY__'
  const COST_OF_LIVING_BASE_URL = 'https://www.numbeo.com/cost-of-living/in/'
  
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true
  })
  
  const page = await browser.newPage()
  page.on('console', msg => console.log(colors.yellow(...msg.args)))
  
  await page.setJavaScriptEnabled(false)
  await page.goto(BASE_URL)
  
  // get list of available countries
  const countries = await page.evaluate(() => {
    const relatedLinksTable = document.querySelector('.related_links')
    const linkElementsInTable = relatedLinksTable.getElementsByTagName('a')
    const countries = []
    
    for (let linkElement of linkElementsInTable) {
      let href = linkElement.href
      countries.push(href.split('=')[1])
    }
    
    return countries
  })
  
  // get list of available cities for each country
  let allCities = []
  for (let country of countries) {
    console.log(colors.bgCyan(`${country.replace(/\+/g, ' ')}`))
    const COUNTRY_BASE_URL = CITIES_BASE_URL.replace(/__COUNTRY__/g, country)
    
    try {
      await page.goto(COUNTRY_BASE_URL)
      
      const cities = await page.evaluate(() => {
        const elements = []
        const citySelect = document.getElementById('select_city')
        const options = citySelect.getElementsByTagName('option')
        
        for (let option of Array.from(options).filter(o => o.value !== '')) {
          elements.push({ city: option.value })
        }
        
        return elements
      })
      
      // didn't trust _.assign() too much for this, weird results
      allCities.push.apply(allCities, cities.map(city => {
        // don't even look at this.
        city.country = country.replace(/\+/g, ' ')
        city.urlNoCountry = `${city.city.replace(/ /g, '-').replace(/\+/g, '-').replace(/\'/g, '').replace(/,/g, '')}?displayCurrency=EUR`
        city.url = `${city.city.replace(',','').replace(/ /g, '-').replace(/\+/g, '-').replace(/\'/, '')}-${country.replace(/ /g, '-').replace(/\+/g, '-').replace(/'/, '').replace(/, /g, '')}?displayCurrency=EUR`
        
        return city
      }))
    } catch (error) {
      console.log(colors.red(`Couldn't gather cities for a country`))
    }
  }
  
  // get data for each city
  const allCitiesData = []
  for (let city of _.flattenDeep(allCities)) {
    console.log(colors.bgBlack(`${city.city} (${city.country})`))
    let cityUrl = `${COST_OF_LIVING_BASE_URL}${city.url}`
    let cityUrlNoCountry = `${COST_OF_LIVING_BASE_URL}${city.urlNoCountry}`
    
    // if the url redirects to another one, check that one and overwrite url
    try {
      await page.goto(cityUrl)
      try {
        await page.waitForSelector('.footer_content')
        let newUrl = await page.evaluate(() => {
          let container = document.querySelectorAll('[style="error_message"]')
          if (container.length > 0) {
            return document.querySelectorAll('[style="error_message"]')[0].querySelector('a').href
          }
        })
        if (newUrl) {
          cityUrl = `${newUrl}?displayCurrency=EUR`
          console.log(colors.bgCyan('Redirected...'))          
        }
      } catch (error) {
        console.log(colors.bgBlue(`A page for this city doesn't actually exist`)) 
      }
    } catch (error) {
      console.log(colors.red('Error managing a redirection'))
    }

    
    // check if the page for this city has usable data
    let availableData = null
    try {
      // console.log(colors.green(`cityCountryUrl: ${cityUrl}`))
      await page.goto(cityUrl)
      await page.waitForSelector('.footer_content')

      let hasTable = await page.evaluate(() => document.querySelectorAll('.data_wide_table tbody').length > 0)

      // try to remove the country (works for big cities)
      if (!hasTable) {
        console.log(colors.bgCyan('Trying a different URL...'))
        // console.log(colors.green(`noCountryUrl: ${cityUrlNoCountry}`))        
        await page.goto(cityUrlNoCountry)
        await page.waitForSelector('.footer_content')
        /** 
         * as a desperate measure to try to deal with US city, ST name pattern,
         * try to remove the last 3 letters of the city part of the url.
         * This is a horrible hack.
         */
        let stillNoTable = await page.evaluate(() => document.querySelectorAll('.data_wide_table tbody').length < 1)

        if (stillNoTable) {
          console.log(colors.yellow('Trying yet another url...'))
          let urlDeconstructed = cityUrlNoCountry.split('?')
          urlDeconstructed[0] = urlDeconstructed[0].slice(0,-3)

          // console.log(colors.green(`desperateUrl: ${urlDeconstructed.join('?')}`))          
          await page.goto(urlDeconstructed.join('?'))
          await page.waitForSelector('.footer_content')
        }
      }

      await page.waitForSelector('.nearby_city_info', { timeout: 3000 })
      
      availableData = await page.evaluate(() => {
        let table = document.querySelector('.data_wide_table tbody')
        let rows = table.querySelectorAll('tr')
        // console.log('availableData', rows[1].cells[1].innerText.trim() !== '?')
        return rows[1].cells[1].innerText.trim() !== '?'
      })
    } catch (error) {
      console.log(colors.bgRed('No data available for this city'))
    }
    
    // scrape data for this city
    try {
      if (availableData) {
        await page.waitForSelector('.data_wide_table tbody', { timeout: 3000 })
        
        let cityData = {
          city: city.city,
          country: city.country
        }
        
        _.assign(cityData, await page.evaluate(() => {
          let table = document.querySelector('.data_wide_table tbody')
          let rows = table.querySelectorAll('tr')
          let data = {}
          
          for (let row of rows) {
            if (!row.cells[0].classList.contains('highlighted_th') && row.cells[1].innerText !== '?') {
              let item = row.cells[0].innerText
              let rawPrice = row.cells[1].innerText
              let price = +(rawPrice.split(/(\s+)/)[0].replace(',',''))
              data[item] = price
            }
          }
          
          return data
        }))
        
        allCitiesData.push(cityData)
      } else {
        console.log(colors.yellow('Non-valuable data for this city'))
      }
    } catch (error) {
      console.log(colors.bgMagenta('No data was scraped. Probably an error'))
    }
  }
  
  // all data should be inside an array now, exporting
  console.log(colors.bgGreen(`${allCitiesData.length} elements collected. Exporting...`))  
  writeCSV(path.resolve(__dirname, './../output/output.csv'), allCitiesData)
  
  await browser.close()
  
  // TODO: write to CSV as each city gets scraped
  // TODO: write to CSV asynchronously as a stream
})()
