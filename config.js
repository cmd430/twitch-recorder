const { resolve, join } = require('path')
const minimist = require('minimist')(process.argv.slice(2))
const merge = require('lodash.merge')
const chalk = require('chalk')

const configDefaults = {
  channel: 'TwitchUser',
  recorder: {
    auth: null,
    quality: 'best',
    tryVOD: false,
    lowLatency: false,
    template: join('.', 'recordings', ':shortYear.:month.:day :period -- :channel')
  },
  time: {
    timezone: 'Europe/London',
    timezoneFormat: 'en-GB'
  },
  developer: {
    log: 'logs',
    debug: false
  }
}

let configUser = {}
try {
  configUser = minimist.config ? require(resolve(minimist.config)) : require(join(process.cwd(), 'config.json'))
} catch (error) {}

const configArgs = {
  channel: minimist.channel,
  recorder: {
    auth: minimist.auth,
    quality: minimist.quality,
    tryVOD: minimist.vod,
    lowLatency: minimist.lowLatency,
    template: minimist.template
  },
  time: {
    timezone: minimist.tz,
    timezoneFormat: minimist.tzFormat
  },
  developer: {
    log: minimist.log,
    debug: minimist.debug
  }
}

const config = merge(configDefaults, configUser, configArgs)

if (minimist.help) {
  console.info(`
    ${chalk.magentaBright(`Twitch Recorder`)}  -  Monitor Twitch Streamer and Record Live Stream automatically.
    ---------------------------------------------------------------------------------
    ${chalk.grey(`Created by Bradley 'Bred/cmd430' Treweek`)}


      Usage: node index ${chalk.grey(`[options] [dev options]`)}

        Options:
          --channel=${chalk.grey(`<streamer username>`)}     Set the Twitch streamer to monitor
                                            Default: ${chalk.grey(`TwitchUser`)}

          --auth=${chalk.grey(`<twitch auth token>`)}        Set auth token to use when getting the stream (This must be a user auth token)
                                            This may be used to avoid Twitch Ads for subscribed channels
                                            Default: ${chalk.grey(`null`)}

          --quality=${chalk.grey(`<format>`)}                 Set the stream recording quality
                                            Accepts qualities by height (e.g ${chalk.grey(`1080/720`)}), ${chalk.grey(`source`)}, and ${chalk.grey(`best`)}
                                            Default: ${chalk.grey(`best`)}

          --vod                                               Attempt to download from 'live' VOD

          --lowLatency                                        Set the Twitch stream to low latency mode

          --template=${chalk.grey(`"<template>"`)}    Set template and path for recorded streams, if path does not exit it will be created
                                            Accepts tokens; :channel, :date, :time, :day, :month, :year, :shortYear, :period
                                            Default: ${chalk.grey(`./recordings/:date, :time -- :channel`)}

          --tz=${chalk.grey(`<timezone>`)}                   Set the timezone used when dating saved streams
                                            Default: ${chalk.grey(`Europe/London`)}

          --tzFormat=${chalk.grey(`<timezone format>`)}     Set the timezone for local logs and file names, accepts en-GB or en-US
                                            Default: ${chalk.grey(`en-GB`)}

          --config=${chalk.grey(`<path>`)}                   Set path to config.json to use
                                            Default: ${chalk.grey(`./config.json`)}

          --help                            Show this help

        Dev Options:
          --debug                           Show debug info in console
  `)
  process.exit(0)
}

module.exports = config
