/**
 * Choose optimal responsive image widths to put in your `srcset` attribute
 *
 * Usage:
 *
 *     node responsive-image-sizes.js -h
 */

const fs = require('fs')
const util = require('util')
const writeFile = util.promisify(fs.writeFile)

const csvparse = require('csv-parse/lib/sync')
const puppeteer = require('puppeteer')
const color = require('ansi-colors')
const table = require('cli-table')

const sleep = timeout => new Promise(r => setTimeout(r, timeout))

const argv = require('yargs')
  .options({
    contextsfile: {
      alias: 'c',
      describe:
        'File path from which reading the actual contexts data in CSV format (screen density in dppx, viewport width in px, number of page views)',
      demandOption: true,
      type: 'string',
    },
    minviewport: {
      alias: 'i',
      describe: 'Minimum viewport width to check',
      type: 'number',
    },
    maxviewport: {
      alias: 'x',
      describe: 'Maximum viewport width to check',
      type: 'number',
    },
    url: {
      alias: 'u',
      describe: 'Page URL',
      demandOption: true,
    },
    selector: {
      alias: 's',
      describe: 'Image selector in the page',
      demandOption: true,
    },
    delay: {
      alias: 'd',
      describe:
        'Delay after viewport resizing before checking image width (ms)',
      default: 500,
      type: 'number',
    },
    variationsfile: {
      alias: 'a',
      describe:
        'File path to which saving the image width variations data, in CSV format',
      type: 'string',
    },
    widthsnumber: {
      alias: 'n',
      describe: 'Number of widths to recommend',
      default: 5,
      type: 'number',
    },
    destfile: {
      alias: 'f',
      describe:
        'File path to which saving the image widths for the srcset attribute',
      type: 'string',
    },
    verbose: {
      alias: 'v',
      describe: 'Log progress and result in the console',
    },
  })
  .group(
    ['minviewport', 'maxviewport'],
    'Global: limit viewport widths, for example for Art Direction (see docs)',
  )
  .group(['contextsfile'], 'Step 1: get actual contexts of site visitors')
  .group(
    ['url', 'selector', 'delay', 'variationsfile'],
    'Step 2: get variations of image width across viewport widths',
  )
  .group(
    ['widthsnumber', 'destfile'],
    'Step 3: compute optimal n widths from both datasets',
  )
  .check(function(argv) {
    // waiting for https://github.com/yargs/yargs/issues/1079
    if (argv.minviewport !== undefined && isNaN(argv.minviewport)) {
      throw new Error(
        color.red(`Error: ${color.redBright('minviewport')} must be a number`),
      )
    }
    if (argv.minviewport < 0) {
      throw new Error(
        color.red(`Error: ${color.redBright('minviewport')} must be >= 0`),
      )
    }
    if (argv.maxviewport !== undefined && isNaN(argv.maxviewport)) {
      throw new Error(
        color.red(`Error: ${color.redBright('maxviewport')} must be a number`),
      )
    }
    if (argv.maxviewport < argv.minviewport) {
      throw new Error(
        color.red(
          `Error: ${color.redBright(
            'maxviewport',
          )} must be greater than minviewport`,
        ),
      )
    }
    if (isNaN(argv.delay)) {
      throw new Error(
        color.red(`Error: ${color.redBright('delay')} must be a number`),
      )
    }
    if (argv.delay < 0) {
      throw new Error(
        color.red(`Error: ${color.redBright('delay')} must be >= 0`),
      )
    }
    if (argv.variationsfile && fs.existsSync(argv.variationsfile)) {
      throw new Error(
        color.red(
          `Error: file ${argv.variationsfile} set with ${color.redBright(
            'variationsfile',
          )} already exists`,
        ),
      )
    }
    if (isNaN(argv.widthsnumber)) {
      throw new Error(
        color.red(`Error: ${color.redBright('widthsnumber')} must be a number`),
      )
    }
    if (argv.destfile && fs.existsSync(argv.destfile)) {
      throw new Error(
        color.red(
          `Error: file ${argv.destfile} set with ${color.redBright(
            'destfile',
          )} already exists`,
        ),
      )
    }
    if (!argv.destfile && !argv.verbose) {
      throw new Error(
        color.red(
          `Error: data should be either saved in a file (${color.redBright(
            'destfile',
          )} and/or output to the console (${color.redBright('verbose')}`,
        ),
      )
    }
    return true
  })
  .alias('h', 'help')
  .help()
  .example(
    "node $0 --contextsfile ./contexts.csv --url 'https://example.com/' --selector 'main img[srcset]:first-of-type' --verbose",
  )
  .example(
    "node $0 -c ./contexts.csv -u 'https://example.com/' -s 'main img[srcset]:first-of-type' -i 320 -x 1280 -a ./variations.csv -f ./srcset-widths.txt -v",
  )
  .wrap(null)
  .detectLocale(false).argv
;(async () => {
  /* ======================================================================== */
  if (argv.verbose) {
    console.log(
      color.bgCyan.black(
        '\nStep 1: get actual contexts (viewports & screen densities) of site visitors',
      ),
    )
  }

  // Load content from the CSV file
  let contextsCsv = fs.readFileSync(argv.contextsfile, 'utf8')
  const csvHasHeader = contextsCsv.match(/[a-zA-Z]/)

  // Transform CSV into an array
  let contexts = csvparse(contextsCsv, {
    columns: ['viewport', 'density', 'views'],
    from: csvHasHeader ? 2 : 1,
    cast: function(value, context) {
      if (context.column == 'density') {
        return parseFloat(value)
      } else {
        return parseInt(value, 10)
      }
    },
  })
  if (argv.verbose) {
    console.log(color.green(`Imported ${contexts.length} lines of context`))
  }
  const contextMinViewport = contexts.reduce(
    (min, p) => (p.viewport < min ? p.viewport : min),
    contexts[0].viewport,
  )
  const contextMaxViewport = contexts.reduce(
    (max, p) => (p.viewport > max ? p.viewport : max),
    contexts[0].viewport,
  )
  if (argv.verbose) {
    console.log(
      color.green(
        `Viewports in context go from ${contextMinViewport}px to ${contextMaxViewport}px`,
      ),
    )
  }

  minViewport = contextMinViewport
  if (argv.minviewport !== undefined) {
    minViewport = Math.max(contextMinViewport, argv.minviewport)
  }
  maxViewport = contextMaxViewport
  if (argv.maxviewport !== undefined) {
    maxViewport = Math.min(contextMaxViewport, argv.maxviewport)
  }

  if (argv.verbose) {
    console.log(
      color.green(
        `Viewports will be considered from ${color.white(
          minViewport + 'px',
        )} to ${color.white(maxViewport + 'px')}`,
      ),
    )
  }

  /* ======================================================================== */
  if (argv.verbose) {
    console.log(
      color.bgCyan.black(
        '\nStep 2: get variations of image width across viewport widths',
      ),
    )
  }

  const VIEWPORT = {
    width: minViewport,
    height: 2000,
    deviceScaleFactor: 1,
  }
  const imageWidths = []
  if (argv.verbose) {
    console.log(color.green('Launch headless Chrome'))
  }
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  if (argv.verbose) {
    console.log(color.green(`Go to ${argv.url}`))
  }
  await page
    .goto(argv.url, { waitUntil: 'networkidle2' })
    .then(async () => {
      if (argv.verbose) {
        console.log(
          color.green(`Checking widths of image ${color.white(argv.selector)}`),
        )
        process.stdout.write(
          `Current viewport: ${color.cyan(VIEWPORT.width)}px`,
        )
      }
      while (VIEWPORT.width <= maxViewport) {
        // Set new viewport width
        await page.setViewport(VIEWPORT)

        // Give the browser some time to adjust layout, sometimes requiring JS
        await sleep(argv.delay)

        // Check image width
        let imageWidth = await page.evaluate(sel => {
          return document.querySelector(sel).width
        }, argv.selector)
        imageWidths[VIEWPORT.width] = imageWidth

        // Increment viewport width
        VIEWPORT.width++

        // Update log in the console
        if (argv.verbose) {
          process.stdout.clearLine()
          process.stdout.cursorTo(0)
          if (VIEWPORT.width <= maxViewport) {
            process.stdout.write(
              `Current viewport: ${color.cyan(VIEWPORT.width)}px`,
            )
          }
        }
      }

      // Save data into the CSV file
      if (argv.variationsfile) {
        let csvString = 'viewport width (px);image width (px)\n'
        imageWidths.map(
          (imageWidth, viewportWidth) =>
            (csvString += `${viewportWidth};${imageWidth}` + '\n'),
        )
        await writeFile(argv.variationsfile, csvString)
          .then(() => {
            if (argv.verbose) {
              console.log(
                color.green(
                  `Image width variations saved to CSV file ${
                    argv.variationsfile
                  }`,
                ),
              )
            }
          })
          .catch(error =>
            console.log(
              color.red(
                `Couldn't save image width variations to CSV file ${
                  argv.variationsfile
                }:\n${error}`,
              ),
            ),
          )
      }

      // Output clean table to the console
      if (argv.verbose) {
        const imageWidthsTable = new table({
          head: ['viewport width', 'image width'],
          colAligns: ['right', 'right'],
          style: {
            head: ['green', 'green'],
            compact: true,
          },
        })
        imageWidths.map((imageWidth, viewportWidth) =>
          imageWidthsTable.push([viewportWidth + 'px', imageWidth + 'px']),
        )
        console.log(imageWidthsTable.toString())
      }
    })
    .catch(error =>
      console.log(
        color.red(`Couldn't load page located at ${argv.url}:\n${error}`),
      ),
    )

  await page.browser().close()

  /* ======================================================================== */
  if (argv.verbose) {
    console.log(
      color.bgCyan.black(
        '\nStep 3: compute optimal n widths from both datasets',
      ),
    )
  }

  if (argv.verbose) {
    console.log(color.green('Compute all perfect image widths'))
  }
  let perfectWidthsTemp = []
  let totalViews = 0
  contexts.map((value, index) => {
    if (value.viewport >= minViewport && value.viewport <= maxViewport) {
      perfectWidth = Math.ceil(imageWidths[value.viewport] * value.density)
      if (perfectWidthsTemp[perfectWidth] === undefined) {
        perfectWidthsTemp[perfectWidth] = 0
      }
      perfectWidthsTemp[perfectWidth] += value.views
      totalViews += value.views
    }
  })
  // Change views numbers to percentages and create an array without holes
  let perfectWidths = []
  perfectWidthsTemp.map((value, index) => {
    perfectWidths.push({
      width: index,
      percentage: value / totalViews,
    })
  })
  if (argv.verbose) {
    console.log(
      color.green(`${perfectWidths.length} perfect widths have been computed`),
    )
    console.dir(perfectWidths)
  }

  if (argv.verbose) {
    console.log(color.green('Sort the array by percentage in decreasing order'))
  }
  perfectWidths.sort((a, b) => {
    return b.percentage - a.percentage
  })
  console.dir(perfectWidths)

  if (argv.verbose) {
    console.log(color.green(`Find ${argv.widthsnumber} best widths`))
  }
  // todo
  let srcset = []

  if (argv.verbose) {
    console.dir(srcset)
  }

  // Save data into the CSV file
  if (argv.destfile) {
    let fileString = `
page           : ${argv.url}
image selector : ${argv.selector}
widths in srcset: ${srcset.join(',')}`
    await writeFile(argv.destfile, fileString)
      .then(() => {
        if (argv.verbose) {
          console.log(color.green(`Data saved to file ${argv.destfile}`))
        }
      })
      .catch(error =>
        console.log(
          color.red(`Couldn't save data to file ${argv.destfile}:\n${error}`),
        ),
      )
  }
})()
