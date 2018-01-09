/* eslint-disable */

import puppeteer from 'puppeteer'
import colors from 'colors'
import writeCSV from 'write-csv'
import _ from 'lodash'
import * as path from 'path'

(async () => {
  
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
    for (let country of countries.filter(c => c.country === 'Spain')) {
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
        
        _.assign(allCities, cities)
      }
    }
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
        
        _.assign(allCities, cities)
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
    _.assign(londonData, await page.evaluate(() => {
      let cityData = {}
      let table = document.querySelector('.single-city tbody')
      let rows = Array.from(table.querySelectorAll('tr'))
      
      for (let row of rows) {
        if (row.cells[1].innerText.trim()) {
          let itemName = row.cells[1].innerText
          let price = +row.cells[2].innerHTML.trim().replace('€', '')
          cityData[itemName] = +price                    
        }
      }
      
      return cityData
    }))
    
    allCitiesData.push(londonData)
  } catch (error) {
    console.log(colors.red(`Error getting test drive data. We're fucked.`))
  }
  
  console.log(allCitiesData)
  
  // Repeat the process for every city available
  
  
  await browser.close()
})()
