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
  lastVOD: config.recorder.lastVOD,
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
  logger.info(`${chalk.cyanBright('•')} ${chalk.reset(`${twitch.isVOD ? 'Downloading' : 'Recording'} ${twitch.isVOD ? 'VOD' : 'live stream'} to file`)}`)
  state.downloading = true
})
downloader.on('finish', () => {
  logger.info(`${chalk.greenBright('•')} ${chalk.reset(`${twitch.isVOD ? 'Download' : 'Recording'} of ${twitch.isVOD ? 'VOD' : 'live stream'} completed`)}`)
  state.downloading = false
})
downloader.on('error', error => {
  if (state.downloading) {
    logger.info(`${chalk.redBright('•')} ${chalk.reset(`Error ${twitch.isVOD ? 'downloading' : 'recording'} ${twitch.isVOD ? 'VOD' : 'live stream'}; a partial ${twitch.isVOD ? 'download' : 'recording'} has been saved`)}`)
    state.downloading = false
  }
  logger.error(error)
})

twitch.on('live', async () => {
  if (twitch.isVOD) return
  state.live = true
  logger.info(`${config.channel} is ${chalk.greenBright('live')}`)
  downloader.start(await twitch.getStream('best'))
})
twitch.on('offline', async () => {
  if (twitch.isVOD) return
  state.live = false
  logger.info(`${config.channel} is ${chalk.redBright('offline')}`)
})
twitch.on('error', async message => {
  logger.info(`${chalk.redBright('•')} ${chalk.reset(`${twitch.isVOD ? 'Download' : 'Recording'} of ${twitch.isVOD ? 'VOD' : 'Stream'} failed: ${message}`)}`)
})

async function init () {
  if (twitch.isVOD) {
    logger.info(`Channel ${config.channel}`)
    return downloader.start(await twitch.getVOD('best'))
  }
  if (await twitch.isLive()) {
    return twitch.emit('live')
  } else {
    return twitch.emit('offline')
  }
}

const exit = signal => {
  if (state.downloading) logger.info(`${chalk.yellowBright('•')} ${chalk.reset(`${twitch.isVOD ? 'Download' : 'Recording'} of ${twitch.isVOD ? 'VOD' : 'live stream'} aborted; a partial ${twitch.isVOD ? 'download' : 'recording'} has been saved`)}`)
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
