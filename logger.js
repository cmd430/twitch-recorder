const { createWriteStream, mkdirSync } = require('fs')
const chalk = require('chalk')
const stripAnsi = require('strip-ansi')

class Logger {

  static #logOut
  static #logErr
  static #logCombined

  constructor (options = {}) {
    process.stdout.write('\u001b[2J\u001b[0;0H') // clear console

    this.directory = options.directory ?? 'logs'
    this.debugMode = options.debug ?? false
    this.timezoneFormat = options.timezoneFormat ?? 'en-GB'

    mkdirSync(`${this.directory}`, { recursive: true })

    Logger.#logOut = createWriteStream(`${this.directory}/out.log`, {
      flags: 'w'
    })
    Logger.#logErr = createWriteStream(`${this.directory}/err.log`, {
      flags: 'w'
    })
    Logger.#logCombined = createWriteStream(`${this.directory}/combined.log`, {
      flags: 'w'
    })

    if (this.debugMode) this.debug(`${chalk.magentaBright('Debug Mode Enabled')}`)
  }

  #writeLog () {
    const message = [...arguments].join(' ')
    const formatted = `${chalk.grey(`[${new Date().toLocaleString(this.timezoneFormat)}]`)} ${message}`

    Logger.#logOut.write(`${stripAnsi(formatted)}\n`)
    Logger.#logCombined.write(`${stripAnsi(formatted)}\n`)

    console.log(formatted)
  }

  #writeDebug () {
    const message = [...arguments].join(' ')
    const formatted = `${chalk.grey(`[${new Date().toLocaleString(this.timezoneFormat)}]`)} ${message}`

    Logger.#logOut.write(`${stripAnsi(formatted)}\n`)
    Logger.#logCombined.write(`${stripAnsi(formatted)}\n`)

    if (!this.debugMode) return
    console.debug(formatted)
  }

  #writeError () {
    const message = [...arguments].join(' ')
    const formatted = `${chalk.grey(`[${new Date().toLocaleString(this.timezoneFormat)}]`)} ${message}`

    Logger.#logErr.write(`${stripAnsi(formatted)}\n`)
    Logger.#logCombined.write(`${stripAnsi(formatted)}\n`)

    console.error(formatted)
  }

  debug () {
    return this.#writeDebug(...arguments)
  }

  error () {
    return this.#writeError(...arguments)
  }

  info () {
    return this.#writeLog(...arguments)
  }

  log () {
    return this.#writeLog(...arguments)
  }

}

module.exports = Logger
