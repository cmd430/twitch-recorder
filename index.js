const chalk = require('chalk')

const Twitch = require('./twitch')
const Logger = require('./logger')
const Downloader = require('./downloader')
const config = require('./config')

const state = {
  live: false,
  downloading: false
}

const logger = new Logger({
  directory: config.developer.log,
  debug: config.developer.debug,
  timezoneFormat: config.timezoneFormat
})

const twitch = new Twitch({
  channel: config.channel,
  lowLatency: config.recorder.lowLatency,
  auth: config.recorder.auth,
  tryVOD: config.recorder.tryVOD,
  logger: logger
})

const downloader = new Downloader({
  fileTemplate: config.recorder.template,
  channel: config.channel,
  timezone: config.time.timezone,
  timezoneFormat: config.time.timezoneFormat,
  downloadOptions: {
    maxRetries: config.recorder.download.maxRetries,
    maxReconnects: config.recorder.download.maxReconnects
  },
  logger: logger
})

logger.debug('Using config:', JSON.stringify(config, null, 2))

downloader.on('start', () => {
  logger.info(`${chalk.cyanBright('•')} ${chalk.reset(`Recording '${config.channel}' live ${twitch.isVOD ? 'VOD' : 'stream'} to file`)}`)
  state.downloading = true
})
downloader.on('finish', () => {
  logger.info(`${chalk.greenBright('•')} ${chalk.reset(`Recording of '${config.channel}' live ${twitch.isVOD ? 'VOD' : 'stream'} completed`)}`)
  state.downloading = false
})
downloader.on('error', error => {
  if (state.downloading) {
    logger.info(`${chalk.yellowBright('•')} ${chalk.reset(`Recording of '${config.channel}' live ${twitch.isVOD ? 'VOD' : 'stream'} error`)}`)
    state.downloading = false
  }
  logger.error(error)
})

twitch.on('live', async () => {
  state.live = true
  logger.info(`${config.channel} is ${chalk.greenBright('live')}`)
  downloader.start(await twitch.getStream('best'))
})
twitch.on('offline', () => {
  state.live = false
  logger.info(`${config.channel} is ${chalk.redBright('offline')}`)
})

async function init () {
  if (await twitch.isLive()) {
    twitch.emit('live')
  } else {
    twitch.emit('offline')
  }
}

const exit = signal => {
  if (state.downloading) logger.info(`${chalk.yellowBright('•')} ${chalk.reset(`Recording of '${config.channel}' live ${twitch.isVOD ? 'VOD' : 'stream'} aborted; a partial ${twitch.isVOD ? 'VOD' : 'stream'} may have been saved`)}`)
  if (signal === 'SIGINT' || signal === 'SIGHUP') {
    logger.debug(`Signal ${signal} recevied Application Exiting...`)
    process.exit(0)
  } else {
    logger.error(`${chalk.redBright(signal)}`)
    process.exit(1)
  }
}

process.on('SIGINT', exit)
process.on('SIGHUP', exit)
process.on('uncaughtException', exit)

if (!module.parent) {
  init()
} else {
  module.exports = init
}
