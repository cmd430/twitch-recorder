const { createWriteStream, mkdirSync } = require('fs')
const chalk = require('chalk')
const stripAnsi = require('strip-ansi')

class Logger {

  static #logOut
  static #logDbg
  static #logErr
  static #logAll

  constructor (options = {}) {
    process.stdout.write('\u001b[2J\u001b[0;0H') // clear console

    this.channel = options.channel ?? ''
    this.directory = this.#parseTokens(options.directory)
    this.debugMode = options.debug ?? false
    this.timezoneFormat = options.timezoneFormat ?? 'en-GB'

    mkdirSync(`${this.directory}`, { recursive: true })

    Logger.#logOut = createWriteStream(`${this.directory}/out.log`, {
      flags: 'w'
    })
    Logger.#logDbg = createWriteStream(`${this.directory}/dbg.log`, {
      flags: 'w'
    })
    Logger.#logErr = createWriteStream(`${this.directory}/err.log`, {
      flags: 'w'
    })
    Logger.#logAll = createWriteStream(`${this.directory}/all.log`, {
      flags: 'w'
    })

    if (this.debugMode) this.debug(`${chalk.magentaBright('Debug Mode Enabled')}`)
  }

  #parseTokens (inputString) {
    try {
      let parsed = inputString

      const name = this.channel.replace(/[/\\?%*:|"<>]/g, '_')

      parsed = parsed.replace(/:channel/gi, `${name}`)

      if (process.platform === 'win32') {
        parsed = parsed.replace(/\//g, '\\') // convert unix path seperators to windows style
        parsed = parsed.replace(/[?%*:|"<>]/g, '-')
        parsed = parsed.replace(/^([A-Z-a-z])(-)\\/, '$1:\\') // windows drive letter fix
      } else {
        parsed = parsed.replace(/\\/g, '/') // convert windows path seperators to unix style
        parsed = parsed.replace(/[!?%*:;|"'<>`\0]/g, '-') // unix invaild filename chars
      }

      return parsed
    } catch (err) {
      return 'logs'
    }
  }

  #writeLog () {
    const message = [...arguments].join(' ')
    const formatted = `${chalk.grey(`[${new Date().toLocaleString(this.timezoneFormat)}]`)} ${message}`

    Logger.#logOut.write(`${stripAnsi(formatted)}\n`)
    Logger.#logAll.write(`${stripAnsi(formatted)}\n`)

    console.log(formatted)
  }

  #writeDebug () {
    const message = [...arguments].join(' ')
    const formatted = `${chalk.grey(`[${new Date().toLocaleString(this.timezoneFormat)}]`)} ${message}`

    Logger.#logDbg.write(`${stripAnsi(formatted)}\n`)
    Logger.#logAll.write(`${stripAnsi(formatted)}\n`)

    if (!this.debugMode) return
    console.debug(formatted)
  }

  #writeError () {
    const message = [...arguments].join(' ')
    const formatted = `${chalk.grey(`[${new Date().toLocaleString(this.timezoneFormat)}]`)} ${message}`

    Logger.#logErr.write(`${stripAnsi(formatted)}\n`)
    Logger.#logAll.write(`${stripAnsi(formatted)}\n`)

    if (!this.debugMode) return
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
