const { resolve, join } = require('path')
const minimist = require('minimist')(process.argv.slice(2))
const merge = require('lodash.merge')
const chalk = require('chalk')

const configDefaults = {
  channel: 'TwitchUser',
  recorder: {
    auth: null,
    quality: 'best',
    lowLatency: false,
    template: ':shortYear.:month.:day :period -- :channel',
    outputDir: join('.', 'recordings'),
    downloadOptions: {
      keepSegments: false,
      keepAds: false
    }
  },
  time: {
    timezone: 'Europe/London',
    format: 'en-GB'
  },
  developer: {
    logs: 'logs',
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
    lowLatency: minimist.lowLatency,
    template: minimist.template,
    outputDir: minimist.outputDir,
    downloadOptions: {
      keepSegments: minimist.keepSegments,
      keepAds: minimist.keepAds
    }
  },
  time: {
    timezone: minimist.tz,
    format: minimist.tzFormat
  },
  developer: {
    logs: minimist.logs,
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

          --quality=${chalk.grey(`<format>`)}                Set the stream recording quality
                                            Accepts qualities by height (e.g ${chalk.grey(`720`)}), ${chalk.grey(`source`)}, and ${chalk.grey(`best`)}
                                            Default: ${chalk.grey(`best`)}

          --lowLatency                      Set the Twitch stream to low latency mode
          --keepSegments                    Don't delete downloaded segments after merging
          --keepAds                         Don't skip ad segments

          --outputDir=${chalk.grey(`"<directory path>"`)}    Set output directory for recorded streams (path will be created if not exist)
                                            Accepts tokens; :channel, :date, :time, :day, :month, :year, :shortYear, :period
                                            Default: ${chalk.grey(`./recordings`)}

          --template=${chalk.grey(`"<template>"`)}           Set filename template recorded streams
                                            Accepts tokens; :channel, :date, :time, :day, :month, :year, :shortYear, :period
                                            Default: ${chalk.grey(`:shortYear.:month.:day :period -- :channel`)}

          --tz=${chalk.grey(`<timezone>`)}                   Set the timezone used when dating saved streams
                                            Default: ${chalk.grey(`Europe/London`)}

          --tzFormat=${chalk.grey(`<timezone format>`)}      Set the timezone for local logs and file names, accepts en-GB or en-US
                                            Default: ${chalk.grey(`en-GB`)}

          --config=${chalk.grey(`"<path>"`)}                 Set path to config.json to use
                                            Default: ${chalk.grey(`./config.json`)}

          --help                            Show this help

        Dev Options:
          --logs=${chalk.grey(`"<directory path>"`)}         Set directory for log files (path will be created if not exist)
          --debug                           Show debug info in console
  `)
  process.exit(0)
}

module.exports = config
