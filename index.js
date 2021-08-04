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
  timezoneFormat: config.time.format
})

const twitch = new Twitch({
  channel: config.channel,
  lowLatency: config.recorder.lowLatency,
  auth: config.recorder.auth,
  logger: logger
})

const downloader = new Downloader({
  fileTemplate: config.recorder.template,
  outputDir: config.recorder.outputDir,
  channel: config.channel,
  timezone: config.time.timezone,
  timezoneFormat: config.time.format,
  keepSegments: config.recorder.downloadOptions.keepSegments,
  keepAds: config.recorder.downloadOptions.keepAds,
  logger: logger
})

logger.debug('Using config:', JSON.stringify(config, null, 2))

downloader.on('start', () => {
  logger.info(`${chalk.cyanBright('•')} ${chalk.reset('Recording live stream to file')}`)
  state.downloading = true
})
downloader.on('finish', () => {
  logger.info(`${chalk.greenBright('•')} ${chalk.reset('Recording live stream completed')}`)
  state.downloading = false
})
downloader.on('error', error => {
  if (state.downloading) {
    logger.info(`${chalk.redBright('•')} ${chalk.reset('Error recording live stream; a partial recording has been saved')}`)
    state.downloading = false
  }
  logger.error(error)
})

twitch.on('live', async () => {
  state.live = true
  logger.info(`${config.channel} is ${chalk.greenBright('live')}`)
  downloader.start({
    url: await twitch.getStreamURI(),
    quality: config.recorder.quality
  })
})
twitch.on('offline', async () => {
  if (twitch.isVOD) return
  state.live = false
  logger.info(`${config.channel} is ${chalk.redBright('offline')}`)
})
twitch.on('error', async message => {
  logger.info(`${chalk.redBright('•')} ${chalk.reset(`Recording of Stream failed: ${message}`)}`)
})

async function init () {
  if (await twitch.isLive()) {
    return twitch.emit('live')
  } else {
    return twitch.emit('offline')
  }
}

const exit = signal => {
  if (state.downloading) logger.info(`${chalk.yellowBright('•')} ${chalk.reset('Recording of live stream aborted; a partial recording has been saved')}`)
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
