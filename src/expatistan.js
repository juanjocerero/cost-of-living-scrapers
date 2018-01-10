/* eslint-disable */

import puppeteer from 'puppeteer'
import colors from 'colors'
import writeCSV from 'write-csv'
import _ from 'lodash'
import * as path from 'path'

(async () => {
  
  const chunkArray = (arr, chunkSize) => {
    let results = []
    while (arr.length) {
      results.push(arr.splice(0, chunkSize))
    }
    return results
  }
  
  const EXPATISTAN_COUNTRIES_BASE_URL = 'https://www.expatistan.com/cost-of-living/country/ranking'
  
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true
  })
  const page = await browser.newPage()
  page.on('console', msg => console.log(colors.yellow(...msg.args)))
  
  // load base url
  try {
    await page.setJavaScriptEnabled(false)
    await page.goto(EXPATISTAN_COUNTRIES_BASE_URL)
  } catch (error) {
    console.log(colors.red('Error loading base URL'))
  }
  
  // get list of available countries and their urls
  let countries = []
  try {
    await page.waitForSelector('.prices')
    
    countries = await page.evaluate(() => {
      let countriesTable = document.querySelector('.country-ranking tbody')
      let linksToCountries = countriesTable.querySelectorAll('.country-name a')
      let c = []
      
      for (let link of linksToCountries) {
        c.push({ country: link.innerText, url: link.href })
      }
      
      return c
    })
  } catch (error) {
    console.log(colors.red('Error fetching list of countries', error))
  }
  
  // get list of available cities for each country
  let allCities = []
  let remainingCountries = []
  try {
    for (let country of countries) {
      console.log(colors.cyan(`${country.country}`))
      await page.goto(country.url)
      
      let currentUrl = await page.evaluate(() => window.location.href)
      
      if (currentUrl.includes('check')) {
        console.log(colors.bgYellow('Found humanity check. Skipping...'))
        remainingCountries.push(country)
        continue
      } else {
        await page.waitForSelector('.cities')
        
        let cities = await page.evaluate(() => {
          let citiesContainer = document.querySelector('.cities table tbody')
          let citiesCells = citiesContainer.querySelectorAll('tr td a')
          if (!citiesCells) {
            citiesContainer = document.querySelector('div.home-module:nth-child(13) > div:nth-child(1)')
            citiesCells = citiesContainer.querySelectorAll('tr td a')
          }
          let c = []
          
          for (let cell of citiesCells) {
            if (!cell.href.includes('/rate/')) {
              c.push({ city: cell.innerText, url: cell.href })
            }
          }
          
          return c
        })
        
        cities.map(c => {
          c.url = c.url += '?currency=EUR'
          c.country = country.country
          return c
        })
        
        allCities.push.apply(allCities, cities)
        console.log(colors.bgCyan(`${allCities.length} cities...`))
      }
    }
    
    await browser.close()
  } catch (error) {
    console.log(colors.red('Error getting cities', error))
  }
  
  // try to fetch data for remaining countries affected by humanity checks  
  if (remainingCountries.length > 0) {
    try {
      console.log(colors.green('Trying to fetch data for remaining countries...'))
      
      const newBrowser = await puppeteer.launch({
        headless: true,
        ignoreHTTPSErrors: true
      })
      const newTab = await newBrowser.newPage()
      await newTab.setJavaScriptEnabled(false)
      
      for (let country of remainingCountries) {
        console.log(colors.cyan(`${country.country}`))
        
        await newTab.goto(country.url)
        await newTab.waitForSelector('.cities')
        
        let cities = await newTab.evaluate(() => {
          let citiesContainer = document.querySelector('.cities table tbody')
          let citiesCells = citiesContainer.querySelectorAll('tr td a')
          if (!citiesCells) {
            citiesContainer = document.querySelector('div.home-module:nth-child(13) > div:nth-child(1)')
            citiesCells = citiesContainer.querySelectorAll('tr td a')
          }
          let c = []
          
          for (let cell of citiesCells) {
            if (!cell.href.includes('/rate/')) {
              c.push({ city: cell.innerText, url: cell.href })
            }
          }
          
          return c
        })
        
        cities.map(c => {
          c.url = c.url += '?currency=EUR'
          c.country = country.country
          return c
        })
        
        allCities.push.apply(allCities, cities)
        console.log(colors.bgCyan(`${allCities.length} cities...`))
      }
      
      await newBrowser.close()
    } catch (error) {
      console.log(colors.red('Error fetching data for remaining countries'))
    }
  }
  
  // order resulting set alphabetically
  allCities = _.orderBy(allCities, 'country')
  
  // declare container for data
  const allCitiesData = []
  
  // Do a 'test drive' using London as a subject
  const LONDON_URL = 'https://www.expatistan.com/cost-of-living/london?currency=EUR'
  let londonData = {}
  londonData.City = 'London'
  londonData.Country = 'UK'
  
  try {
    console.log(colors.green('Getting test drive data for London...'))
    let londonBrowser = await puppeteer.launch({
      headless: true,
      ignoreHTTPSErrors: true
    })
    let londonPage = await londonBrowser.newPage()
    await londonPage.setJavaScriptEnabled(false)
    
    await londonPage.goto(LONDON_URL)
    await londonPage.waitForSelector('.single-city')
    
    _.assign(londonData, await londonPage.evaluate(() => {
      let cityData = {}
      let table = document.querySelector('.single-city tbody')
      let rows = Array.from(table.querySelectorAll('tr'))
      .filter(r => !r.classList.contains('categoryHeader') && r.cells.length > 2)
      
      for (let row of rows) {
        let itemName = row.cells[1].innerText
        let price = null

        if (row.cells[2].innerText.trim().includes('€')) {
          price = row.cells[2].innerText.trim().replace('€', '').replace(/\(/g, '').replace(/\)/g, '')
        }  
        if (row.cells[3].innerText.trim().includes('€')) {
          price = row.cells[3].innerText.trim().replace('€', '').replace(/\(/g, '').replace(/\)/g, '')          
        }

        cityData[itemName] = +price
      }
      
      return cityData
    }))
        
    allCitiesData.push(londonData)
    await londonBrowser.close()
  } catch (error) {
    console.log(colors.red(`Error getting test drive data. We're fucked.`, error))
  }
  
  /** 
  * Expatistan will throttle a browser instance
  * after 100 pages requested and
  * make it pass a captcha check. We split the list
  * of cities in chunks of 99 elements and create
  * new instances of the browser every time.
  */
  
  const allCitiesInChunks = chunkArray(allCities, 99)
  console.log(colors.bgBlack(`${allCitiesInChunks.length} chunks to scrape...`))
  
  for (let chunk of allCitiesInChunks) {
    // declare browser instance for city scraping
    console.log(colors.bgGreen('Creating new browser instance...'))
    
    let cityBrowser = await puppeteer.launch({
      headless: true,
      ignoreHTTPSErrors: true
    })
    let cityPage = await cityBrowser.newPage()
    await cityPage.setJavaScriptEnabled(false)
    
    cityPage.on('console', msg => console.log(colors.yellow(...msg.args)))
    
    // Repeat the process for every city available     
    for (let city of chunk) {
      console.log(colors.yellow(`${city.city}...`))
      try {
        await cityPage.goto(city.url)
        await cityPage.waitForSelector('.single-city')
        
        let cityData = {}
        cityData.City = city.city
        cityData.Country = city.country
        
        let pageData = await cityPage.evaluate(() => {
          let data = {}
          let table = document.querySelector('.single-city tbody')
          let rows = Array.from(table.querySelectorAll('tr'))
          .filter(r => !r.classList.contains('categoryHeader') && r.cells.length > 2)
          
          for (let row of rows) {
            let itemName = row.cells[1].innerText
            let price = null

            if (row.cells[2].innerText.trim().includes('€')) {
              price = row.cells[2].innerText.trim().replace('€', '').replace(/\(/g, '').replace(/\)/g, '')
            }  
            if (row.cells[3] && row.cells[3].innerText.trim().includes('€')) {
              price = row.cells[3].innerText.trim().replace('€', '').replace(/\(/g, '').replace(/\)/g, '')          
            }

            data[itemName] = +price
          }
          
          return data
        })
        
        _.assign(cityData, pageData)
        allCitiesData.push(cityData)
        
      } catch (error) {
        console.log(colors.red(`Error getting data from ${city.city}`, error))
      }
    }
    
    await cityBrowser.close()    
  }
  
  // all data should be inside an array now, exporting
  console.log(colors.bgGreen(`${allCitiesData.length} elements collected. Exporting...`))  
  writeCSV(path.resolve(__dirname, './../output/expatistan.csv'), allCitiesData)
  
})()
